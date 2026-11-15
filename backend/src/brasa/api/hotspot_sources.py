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
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any, Literal

import pandas as pd

from brasa.domain.models import COLOMBIA, MAX_LONGITUDE, BoundingBox, InvalidBoundingBoxError
from brasa.ingestion.firms_client import MAX_DAY_RANGE, FirmsAuthError, FirmsClient, FirmsSource

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
# Parallel FIRMS requests per download (a month is 7 chunks x 2 sources); well inside the quota.
FIRMS_PARALLEL = 6
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
# When an area spans two boxes, the least complete source describes it.
_SOURCE_RANK: dict[Source, int] = {"archive": 0, "firms": 1, "partial": 2, "none": 3, "too_long": 4}
FULL_TURN = 360.0
BBOX_PARTS = 4
FULL_WORLD_MIN_LON_SPAN = 350.0
FULL_WORLD_MIN_LAT_SPAN = 170.0


def parse_areas(raw: str) -> list[BoundingBox]:
    """'west,south,east,north' as one box, or two when the area crosses the antimeridian.

    Countries such as Russia, New Zealand or Fiji are stored unwrapped (east > 180), which
    BoundingBox and the FIRMS API reject, so they are split at 180 degrees.
    """
    parts = raw.split(",")
    if len(parts) != BBOX_PARTS:
        raise InvalidBoundingBoxError("Expected 4 values: west,south,east,north.")
    try:
        west, south, east, north = (float(part) for part in parts)
    except ValueError as error:
        raise InvalidBoundingBoxError("Coordinates must be numeric.") from error
    if east <= MAX_LONGITUDE:
        return [BoundingBox(west, south, east, north)]
    if west >= MAX_LONGITUDE:
        return [BoundingBox(west - FULL_TURN, south, east - FULL_TURN, north)]
    return [
        BoundingBox(west, south, MAX_LONGITUDE, north),
        BoundingBox(-MAX_LONGITUDE, south, east - FULL_TURN, north),
    ]


def areas_source(
    areas: Sequence[BoundingBox], start: date, end: date, *, firms_available: bool
) -> Source:
    """Source for one or more boxes: the least complete of them."""
    sources = [hotspot_source(a, start, end, firms_available=firms_available) for a in areas]
    return max(sources, key=_SOURCE_RANK.__getitem__)


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
    if (
        (area.east - area.west) >= FULL_WORLD_MIN_LON_SPAN
        and (area.north - area.south) >= FULL_WORLD_MIN_LAT_SPAN
    ):
        return "none"
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
    """FIRMS Area API downloads for one bbox and date span, cached in memory (LRU).

    Chunks are requested in parallel, a span inside an already downloaded one is cut from it
    (a day inside a cached month costs nothing), and `warm` downloads a span in the background
    so the next timeline step is already cached when the user gets there.
    """

    def __init__(self, client: FirmsClient, today: Callable[[], date] = date.today) -> None:
        self._client = client
        self._today = today
        self._cache: OrderedDict[tuple[str, date, date], pd.DataFrame] = OrderedDict()
        self._inflight: dict[tuple[str, date, date], Future[pd.DataFrame]] = {}
        self._lock = threading.Lock()
        self._auth_failed = False
        self._background = ThreadPoolExecutor(max_workers=2, thread_name_prefix="firms-warm")

    @property
    def available(self) -> bool:
        """False once NASA FIRMS rejects the MAP_KEY, stopping futile retry floods."""
        return not self._auth_failed

    def _cached(self, key: tuple[str, date, date]) -> pd.DataFrame | None:
        """Exact hit, or the slice of a cached span containing this one. Caller holds the lock."""
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]
        area, start, end = key
        for (c_area, c_start, c_end), frame in reversed(self._cache.items()):
            if c_area == area and c_start <= start and end <= c_end:
                if frame.empty:
                    return frame
                days = frame["acq_date"]
                return frame[(days >= pd.Timestamp(start)) & (days <= pd.Timestamp(end))]
        return None

    def fetch(self, area: BoundingBox, start: date, end: date) -> pd.DataFrame:
        if self._auth_failed:
            return pd.DataFrame(columns=OUT_COLS)
        key = (area.as_firms_area(), start, end)
        with self._lock:
            hit = self._cached(key)
            if hit is not None:
                return hit
            pending = self._inflight.get(key)
            if pending is None:
                future: Future[pd.DataFrame] = Future()
                self._inflight[key] = future
        if pending is not None:  # the same span is already downloading (e.g. a warm-up)
            return pending.result()
        try:
            result = self._download(area, start, end)
            with self._lock:
                self._cache[key] = result
                while len(self._cache) > CACHE_SIZE:
                    self._cache.popitem(last=False)
            future.set_result(result)
            return result
        except BaseException as exc:  # pragma: no cover - _download never raises
            future.set_exception(exc)
            raise
        finally:
            with self._lock:
                self._inflight.pop(key, None)

    def warm(self, area: BoundingBox, start: date, end: date) -> bool:
        """Download a span in the background; False when it is already cached or downloading."""
        if self._auth_failed:
            return False
        key = (area.as_firms_area(), start, end)
        with self._lock:
            if key in self._inflight or self._cached(key) is not None:
                return False
        self._background.submit(self.fetch, area, start, end)
        return True

    def _download(self, area: BoundingBox, start: date, end: date) -> pd.DataFrame:
        today = self._today()
        jobs: list[tuple[FirmsSource, date, int]] = []
        cur = start
        while cur <= end:
            span = min(MAX_DAY_RANGE, (end - cur).days + 1)
            chunk_end = cur + timedelta(days=span - 1)
            jobs.extend((source, cur, span) for source in _sources_for(chunk_end, today))
            cur = chunk_end + timedelta(days=1)

        def one(job: tuple[FirmsSource, date, int]) -> pd.DataFrame:
            source, day, span = job
            if self._auth_failed:
                return pd.DataFrame(columns=OUT_COLS)
            try:
                return normalize_firms_frame(self._client.fetch_area(source, area, day, span))
            except FirmsAuthError:
                with self._lock:
                    first = not self._auth_failed
                    self._auth_failed = True
                if first:
                    logger.warning(
                        "NASA FIRMS rejected BRASA_FIRMS_MAP_KEY (Invalid MAP_KEY); "
                        "disabling live FIRMS point downloads until a valid key is configured."
                    )
                return pd.DataFrame(columns=OUT_COLS)
            except Exception:  # network, HTTP or CSV errors: degrade, never raise
                logger.warning("FIRMS area request failed (source=%s, start=%s)", source, day)
                return pd.DataFrame(columns=OUT_COLS)

        with ThreadPoolExecutor(max_workers=min(FIRMS_PARALLEL, len(jobs) or 1)) as pool:
            frames = [f for f in pool.map(one, jobs) if not f.empty]
        return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=OUT_COLS)


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
