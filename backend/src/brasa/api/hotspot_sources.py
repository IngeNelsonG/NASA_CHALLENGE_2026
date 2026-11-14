"""Where the point detections for an area come from, and the real outline of each area.

The local archive (`detections.parquet`) holds individual detections only inside Colombia's box;
the rest of the world is stored as monthly totals. For points elsewhere this module asks the NASA
FIRMS Area API, when a MAP_KEY is configured, and caches the answer in memory.

Security: the area comes from `BoundingBox.parse` (validated floats) and the sources from a closed
enum, so nothing user-controlled reaches the URL beyond numbers; FirmsClient never logs the URL
(the MAP_KEY travels in its path). Any FIRMS failure degrades to "no points" instead of raising.
"""

from __future__ import annotations

import logging
import threading
from collections import OrderedDict
from collections.abc import Callable, Mapping, Sequence
from datetime import date, timedelta
from typing import Any, Literal

import pandas as pd

from brasa.domain.models import COLOMBIA, BoundingBox
from brasa.ingestion.firms_client import MAX_DAY_RANGE, FirmsClient, FirmsSource

logger = logging.getLogger(__name__)

# One timeline month needs ceil(31 / 5) = 7 requests per sensor; longer spans would exhaust the
# FIRMS quota (5000 transactions / 10 min) quickly, so they are refused.
FIRMS_MAX_SPAN_DAYS = 62
# The standard-processing (SP) archive trails real time by roughly three months.
FIRMS_SP_LAG_DAYS = 100
VIIRS_SP_START = date(2012, 1, 20)
MODIS_MIN_CONFIDENCE = 30
VIIRS_KEPT_CONFIDENCE = frozenset({"n", "h", "nominal", "high"})
CACHE_SIZE = 96
SATELLITE_NAMES = {
    "T": "Terra",
    "A": "Aqua",
    "TERRA": "Terra",
    "AQUA": "Aqua",
    "N": "Suomi NPP",
    "1": "Suomi NPP",
    "N20": "NOAA-20",
    "N21": "NOAA-21",
}
OUT_COLS = ["latitude", "longitude", "acq_date", "acq_time", "sensor", "satellite", "frp"]

Source = Literal["archive", "firms", "partial", "too_long", "none"]


def archive_covers(area: BoundingBox) -> bool:
    """Whether the local point archive holds every detection inside `area`."""
    return (
        area.west >= COLOMBIA.west
        and area.east <= COLOMBIA.east
        and area.south >= COLOMBIA.south
        and area.north <= COLOMBIA.north
    )


def overlaps_archive(area: BoundingBox) -> bool:
    return not (
        area.east < COLOMBIA.west
        or area.west > COLOMBIA.east
        or area.north < COLOMBIA.south
        or area.south > COLOMBIA.north
    )


def hotspot_source(area: BoundingBox, start: date, end: date, *, firms_available: bool) -> Source:
    """Which source answers a hotspot request (see the module docstring)."""
    if archive_covers(area):
        return "archive"
    if firms_available:
        return "firms" if (end - start).days + 1 <= FIRMS_MAX_SPAN_DAYS else "too_long"
    return "partial" if overlaps_archive(area) else "none"


def _sources_for(chunk_end: date, today: date) -> list[FirmsSource]:
    """Standard-processing archive for old days, near-real-time for recent ones."""
    if (today - chunk_end).days > FIRMS_SP_LAG_DAYS:
        sources = [FirmsSource.MODIS_SP]
        if chunk_end >= VIIRS_SP_START:
            sources.append(FirmsSource.VIIRS_SNPP_SP)
        return sources
    return [FirmsSource.MODIS_NRT, FirmsSource.VIIRS_SNPP_NRT]


def normalize_firms_frame(frame: pd.DataFrame) -> pd.DataFrame:
    """FIRMS Area API CSV -> the archive's columns, keeping confident detections only."""
    if frame.empty or "latitude" not in frame or "longitude" not in frame:
        return pd.DataFrame(columns=OUT_COLS)
    sensor = frame["sensor"].astype(str) if "sensor" in frame else pd.Series("VIIRS", frame.index)
    if "confidence" in frame:
        conf = frame["confidence"].astype(str).str.strip().str.lower()
        numeric = pd.to_numeric(conf, errors="coerce")
        keep = ((sensor == "MODIS") & (numeric >= MODIS_MIN_CONFIDENCE)) | (
            (sensor != "MODIS") & conf.isin(VIIRS_KEPT_CONFIDENCE)
        )
        frame, sensor = frame.loc[keep], sensor.loc[keep]
    if frame.empty:
        return pd.DataFrame(columns=OUT_COLS)
    satellite = (
        frame["satellite"].astype(str).str.strip().str.upper().map(SATELLITE_NAMES)
        if "satellite" in frame
        else pd.Series(index=frame.index, dtype=object)
    )
    satellite = satellite.fillna(sensor.map({"MODIS": "Terra"}).fillna("Suomi NPP"))

    def num_col(column: str, default: float) -> pd.Series:
        if column not in frame:
            return pd.Series(default, index=frame.index, dtype=float)
        return pd.Series(pd.to_numeric(frame[column], errors="coerce"), index=frame.index)

    return pd.DataFrame(
        {
            "latitude": num_col("latitude", float("nan")),
            "longitude": num_col("longitude", float("nan")),
            "acq_date": pd.to_datetime(frame["acq_date"], errors="coerce"),
            "acq_time": num_col("acq_time", 1800).fillna(1800).astype(int),
            "sensor": sensor.to_numpy(),
            "satellite": satellite.to_numpy(),
            "frp": num_col("frp", 0.0).fillna(0.0),
        }
    ).dropna(subset=["latitude", "longitude", "acq_date"])


class FirmsHotspots:
    """FIRMS Area API downloads for one bbox and date span, cached in memory (LRU)."""

    def __init__(self, client: FirmsClient, today: Callable[[], date] = date.today) -> None:
        self._client = client
        self._today = today
        self._cache: OrderedDict[tuple[str, date, date], pd.DataFrame] = OrderedDict()
        self._lock = threading.Lock()

    def fetch(self, area: BoundingBox, start: date, end: date) -> pd.DataFrame:
        key = (area.as_firms_area(), start, end)
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
        frames: list[pd.DataFrame] = []
        today = self._today()
        cur = start
        while cur <= end:
            span = min(MAX_DAY_RANGE, (end - cur).days + 1)
            chunk_end = cur + timedelta(days=span - 1)
            for source in _sources_for(chunk_end, today):
                try:
                    frames.append(
                        normalize_firms_frame(self._client.fetch_area(source, area, cur, span))
                    )
                except Exception:  # network, HTTP or CSV errors: degrade, never raise
                    logger.warning("FIRMS area request failed (source=%s, start=%s)", source, cur)
            cur = chunk_end + timedelta(days=1)
        result = (
            pd.concat([f for f in frames if not f.empty], ignore_index=True)
            if any(not f.empty for f in frames)
            else pd.DataFrame(columns=OUT_COLS)
        )
        with self._lock:
            self._cache[key] = result
            while len(self._cache) > CACHE_SIZE:
                self._cache.popitem(last=False)
        return result


# ---- outlines ----------------------------------------------------------------------------------

# Orinoquía is a preset box in the gazetteer; its real outline is these four departments.
ORINOQUIA = ("Arauca", "Casanare", "Meta", "Vichada")


def _polygons(geometry: Mapping[str, Any] | None) -> list[Any]:
    if not geometry:
        return []
    if geometry.get("type") == "Polygon":
        return [geometry["coordinates"]]
    if geometry.get("type") == "MultiPolygon":
        return list(geometry["coordinates"])
    return []


def merge_geometries(geometries: Sequence[Mapping[str, Any] | None]) -> dict[str, Any] | None:
    """Several (Multi)Polygons as one MultiPolygon; inner borders between them are kept."""
    polys = [p for g in geometries for p in _polygons(g)]
    if not polys:
        return None
    return {"type": "MultiPolygon", "coordinates": polys}
