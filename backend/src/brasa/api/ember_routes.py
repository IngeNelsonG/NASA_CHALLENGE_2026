"""Compatibility API routes (/api/*) for the NASA Space Apps 2026 frontend.

Serves 100% real NASA FIRMS data (MODIS Terra/Aqua + VIIRS Suomi NPP/NOAA-20/NOAA-21),
inverse-variance MODIS-equivalent harmonization, deterministic anomaly/alert evaluation,
active-fire hotspot spatial queries, TLE orbital parameters, and a deterministic
statistical + radiative-physics analyst over Server-Sent Events (SSE).
"""

from __future__ import annotations

import json
import logging
import math
import time
import unicodedata
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Literal, cast

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from brasa.alerts.detector import evaluate_rows
from brasa.alerts.schemas import AlertItem
from brasa.api.hotspot_sources import (
    FIRMS_MAX_SPAN_DAYS,
    ORINOQUIA,
    FirmsHotspots,
    hotspot_source,
    merge_geometries,
)
from brasa.api.service import (
    PROCESSED_DETECTIONS,
    CalendarService,
    CountryCalendars,
    _calendar,
    _rows,
    recent_summary,
)
from brasa.domain.models import COLOMBIA, BoundingBox, InvalidBoundingBoxError
from brasa.harmonization import aggregate_monthly, fit_sensor_ratio
from brasa.harmonization.calibrate import InsufficientOverlapError, SensorRatio
from brasa.ingestion.boundaries import geometry_bbox
from brasa.ingestion.recent import RecentSource

logger = logging.getLogger(__name__)

Resolution = Literal["day", "week", "month"]
MODIS_START = date(2000, 11, 1)
VIIRS_FIRST_LIGHT = date(2012, 1, 20)
HOTSPOT_POINT_CAP = 25_000
MIN_STAT_SAMPLES = 2
DECEMBER = 12
DAYS_IN_LEAP_YEAR = 366
ANOM_EXTREME_Z = 2.5
ANOM_STRONG_Z = 2.0
ANOM_POS_MIN_Z = 1.5
ANOM_NEG_MIN_Z = -1.8
ANOM_NEG_MIN_COUNT = 20.0
SOLAR_DAWN_HOUR = 6.0
SOLAR_DUSK_HOUR = 18.0
DETECTION_COLS = [
    "latitude",
    "longitude",
    "acq_date",
    "acq_time",
    "sensor",
    "satellite",
    "frp",
]
ONSET_MONTH_NAMES_ES = (
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
)
ONSET_MONTH_NAMES_EN = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)

# Current TLE parameters for the 5 NASA/NOAA fire-monitoring platforms.
FIRE_SATELLITES_TLE: list[dict[str, Any]] = [
    {
        "name": "TERRA",
        "norad": 25994,
        "instrument": "MODIS",
        "line1": "1 25994U 99068A   26318.26383354  .00000353  00000+0  80719-4 0  9994",
        "line2": "2 25994  97.9264   1.7139 0003548 108.2320 317.4647 14.61197239431525",
    },
    {
        "name": "AQUA",
        "norad": 27424,
        "instrument": "MODIS",
        "line1": "1 27424U 02022A   26318.26912927  .00000809  00000+0  17013-3 0  9994",
        "line2": "2 27424  98.4492 290.7189 0001167 107.6740   4.2826 14.62279695305206",
    },
    {
        "name": "SUOMI NPP",
        "norad": 37849,
        "instrument": "VIIRS",
        "line1": "1 37849U 11061A   26318.26300303  .00000083  00000+0  60593-4 0  9994",
        "line2": "2 37849  98.8118 258.2021 0000717 241.2677 118.8427 14.19543146779734",
    },
    {
        "name": "NOAA 20 (JPSS-1)",
        "norad": 43013,
        "instrument": "VIIRS",
        "line1": "1 43013U 17073A   26318.27699829  .00000079  00000+0  58684-4 0  9991",
        "line2": "2 43013  98.7927 256.4869 0001180 130.5819 229.5459 14.19537036465765",
    },
    {
        "name": "NOAA 21 (JPSS-2)",
        "norad": 54234,
        "instrument": "VIIRS",
        "line1": "1 54234U 22150A   26318.23695393  .00000079  00000+0  58380-4 0  9991",
        "line2": "2 54234  98.7206 254.5758 0002663 110.5249 249.6213 14.19558913207830",
    },
]


class AnalystContext(BaseModel):
    from_date: str | None = Field(default=None, alias="from")
    to_date: str | None = Field(default=None, alias="to")
    sensor: str | None = None

    model_config = {"populate_by_name": True}


class AnalystRequest(BaseModel):
    aoi_id: str = Field(alias="aoiId", max_length=120)
    question: str = Field(min_length=1, max_length=2000)
    lang: Literal["es", "en"] = "es"
    context: AnalystContext | None = None

    model_config = {"populate_by_name": True}


class AlertsOverviewResponse(BaseModel):
    countries: list[AlertItem]
    colombia: list[AlertItem]


AoiKind = Literal[
    "colombia_all",
    "colombia_box",
    "department",
    "country",
    "subdivision",
    "subdivision_group",
]


@dataclass(frozen=True)
class AoiEntry:
    id: str
    name: str
    bbox: tuple[float, float, float, float]
    kind: AoiKind
    department: str | None = None
    country: str | None = None
    subdivisions: tuple[str, ...] = ()
    priority: int = 100
    geometry: dict[str, Any] | None = None


def _slug(text: str) -> str:
    norm = unicodedata.normalize("NFKD", text)
    ascii_only = "".join(ch for ch in norm if not unicodedata.combining(ch)).lower()
    cleaned = "".join(ch if ch.isalnum() else "-" for ch in ascii_only)
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-")


def _norm_text(text: str) -> str:
    norm = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in norm if not unicodedata.combining(ch)).lower().strip()


def _parse_bbox_str(raw: str) -> tuple[float, float, float, float]:
    parts = [float(v) for v in raw.split(",")]
    return (parts[0], parts[1], parts[2], parts[3])


def _union_bbox(
    boxes: Sequence[tuple[float, float, float, float]],
) -> tuple[float, float, float, float]:
    return (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )


def _overlaps_colombia(bbox: tuple[float, float, float, float]) -> bool:
    w, s, e, n = bbox
    return not (e < COLOMBIA.west or w > COLOMBIA.east or n < COLOMBIA.south or s > COLOMBIA.north)


def _build_aoi_index(
    department_collection: dict[str, Any],
    world_collection: Mapping[str, list[dict[str, Any]]],
    countries: CountryCalendars,
) -> tuple[dict[str, AoiEntry], list[AoiEntry]]:
    """Build deterministic gazetteer mapping AOI IDs to real boundaries & archives."""
    by_id: dict[str, AoiEntry] = {}

    def _add(entry: AoiEntry) -> None:
        if entry.id not in by_id:
            by_id[entry.id] = entry

    # Featured Colombian presets (preserving exact frontend IDs from NASA_CHALLENGE_2026)
    _add(
        AoiEntry(
            id="co-orinoquia",
            name="Orinoquía, Colombia",
            bbox=(-74.0, 2.0, -67.4, 7.2),
            kind="colombia_box",
            priority=1,
        )
    )
    _add(
        AoiEntry(
            id="co",
            name="Colombia",
            bbox=(COLOMBIA.west, COLOMBIA.south, COLOMBIA.east, COLOMBIA.north),
            kind="colombia_all",
            country="Colombia",
            priority=2,
        )
    )

    # All 33 Colombian departments from real GeoJSON geometries
    for feat in department_collection.get("features", []):
        name = str(feat["properties"]["name"])
        bbox = _parse_bbox_str(feat["properties"]["bbox"])
        slug = _slug(name)
        _add(
            AoiEntry(
                id=f"co-{slug}",
                name=f"{name}, Colombia",
                bbox=bbox,
                kind="department",
                department=name,
                country="Colombia",
                priority=5 if slug in {"boyaca", "casanare", "meta", "vichada", "arauca"} else 12,
                geometry=feat.get("geometry"),
            )
        )

    # High-priority Colombian hotspot corridors (queried directly against FIRMS parquet points)
    _add(
        AoiEntry(
            id="co-paz-de-ariporo",
            name="Paz de Ariporo, Casanare",
            bbox=(-71.95, 5.5, -70.3, 6.3),
            kind="colombia_box",
            priority=8,
        )
    )
    _add(
        AoiEntry(
            id="co-puerto-gaitan",
            name="Puerto Gaitán, Meta",
            bbox=(-72.3, 3.3, -70.6, 4.6),
            kind="colombia_box",
            priority=9,
        )
    )

    # Country and subdivision bounding boxes computed from Natural Earth geometries
    country_boxes: dict[str, tuple[float, float, float, float]] = {}
    sub_boxes: dict[tuple[str, str], tuple[float, float, float, float]] = {}
    sub_geoms: dict[tuple[str, str], dict[str, Any]] = {}
    for c_name, feats in world_collection.items():
        boxes = [_parse_bbox_str(geometry_bbox(f["geometry"])) for f in feats if "geometry" in f]
        if boxes:
            country_boxes[c_name] = _union_bbox(boxes)
        for f in feats:
            s_name = str(f["properties"]["name"])
            if "geometry" in f:
                sub_boxes[(c_name, s_name)] = _parse_bbox_str(geometry_bbox(f["geometry"]))
                sub_geoms[(c_name, s_name)] = f["geometry"]

    # Featured international AOIs mapped to exact real NASA FIRMS monthly archives
    intl_presets: list[AoiEntry] = [
        AoiEntry(
            id="ar",
            name="Argentina",
            bbox=country_boxes.get("Argentina", (-73.6, -55.1, -53.6, -21.8)),
            kind="country",
            country="Argentina",
            priority=10,
        ),
        AoiEntry(
            id="ar-cordoba",
            name="Córdoba, Argentina",
            bbox=sub_boxes.get(("Argentina", "Córdoba"), (-65.8, -35.0, -61.8, -29.5)),
            kind="subdivision",
            country="Argentina",
            subdivisions=("Córdoba",),
            priority=11,
            geometry=sub_geoms.get(("Argentina", "Córdoba")),
        ),
        AoiEntry(
            id="ar-chaco",
            name="Chaco, Argentina",
            bbox=sub_boxes.get(("Argentina", "Chaco"), (-63.4, -28.0, -58.2, -24.1)),
            kind="subdivision",
            country="Argentina",
            subdivisions=("Chaco",),
            priority=11,
            geometry=sub_geoms.get(("Argentina", "Chaco")),
        ),
        AoiEntry(
            id="ar-corrientes",
            name="Corrientes, Argentina",
            bbox=sub_boxes.get(("Argentina", "Corrientes"), (-59.7, -30.8, -55.6, -27.2)),
            kind="subdivision",
            country="Argentina",
            subdivisions=("Corrientes",),
            priority=11,
            geometry=sub_geoms.get(("Argentina", "Corrientes")),
        ),
        AoiEntry(
            id="br-mato-grosso",
            name="Mato Grosso, Brazil",
            bbox=sub_boxes.get(("Brazil", "Mato Grosso"), (-61.6, -18.1, -50.2, -7.3)),
            kind="subdivision",
            country="Brazil",
            subdivisions=("Mato Grosso",),
            priority=12,
            geometry=sub_geoms.get(("Brazil", "Mato Grosso")),
        ),
        AoiEntry(
            id="br-pantanal",
            name="Pantanal (MT/MS), Brazil",
            bbox=sub_boxes.get(("Brazil", "Mato Grosso do Sul"), (-59.2, -22.2, -54.9, -15.5)),
            kind="subdivision_group",
            country="Brazil",
            subdivisions=("Mato Grosso do Sul", "Mato Grosso"),
            priority=13,
        ),
        AoiEntry(
            id="us-california",
            name="California, USA",
            bbox=sub_boxes.get(("United States", "California"), (-124.5, 32.5, -114.1, 42.0)),
            kind="subdivision",
            country="United States",
            subdivisions=("California",),
            priority=14,
            geometry=sub_geoms.get(("United States", "California")),
        ),
        AoiEntry(
            id="pt",
            name="Portugal",
            bbox=country_boxes.get("Portugal", (-9.6, 36.9, -6.2, 42.2)),
            kind="country",
            country="Portugal",
            priority=15,
        ),
        AoiEntry(
            id="au-nsw",
            name="New South Wales, Australia",
            bbox=sub_boxes.get(("Australia", "New South Wales"), (141.0, -37.5, 153.6, -28.2)),
            kind="subdivision",
            country="Australia",
            subdivisions=("New South Wales",),
            priority=16,
            geometry=sub_geoms.get(("Australia", "New South Wales")),
        ),
        AoiEntry(
            id="id-kalimantan",
            name="Kalimantan, Indonesia",
            bbox=(108.8, -4.2, 119.0, 4.4),
            kind="subdivision_group",
            country="Indonesia",
            subdivisions=(
                "Kalimantan Barat",
                "Kalimantan Selatan",
                "Kalimantan Tengah",
                "Kalimantan Timur",
            ),
            priority=17,
        ),
        AoiEntry(
            id="zm",
            name="Zambia",
            bbox=country_boxes.get("Zambia", (22.0, -18.1, 33.7, -8.2)),
            kind="country",
            country="Zambia",
            priority=18,
        ),
    ]
    for entry in intl_presets:
        _add(entry)

    # All remaining countries and subdivisions in the global FIRMS archive
    sub_names = countries.subdivision_names()
    for c_name in sorted(countries.totals()):
        c_slug = _slug(c_name)
        c_box = country_boxes.get(c_name, (-180.0, -60.0, 180.0, 80.0))
        _add(
            AoiEntry(
                id=f"country:{c_slug}",
                name=c_name,
                bbox=c_box,
                kind="country",
                country=c_name,
                priority=40,
            )
        )
        for s_name in sorted(sub_names.get(c_name, set())):
            s_slug = _slug(s_name)
            s_box = sub_boxes.get((c_name, s_name), c_box)
            _add(
                AoiEntry(
                    id=f"sub:{c_slug}:{s_slug}",
                    name=f"{s_name}, {c_name}",
                    bbox=s_box,
                    kind="subdivision",
                    country=c_name,
                    subdivisions=(s_name,),
                    priority=60,
                )
            )

    ordered = sorted(by_id.values(), key=lambda e: (e.priority, e.name))
    return by_id, ordered


def _resolve_aoi_id(aoi_id: str, by_id: Mapping[str, AoiEntry]) -> AoiEntry | None:
    if aoi_id in by_id:
        return by_id[aoi_id]
    if aoi_id.startswith("bbox:"):
        raw = aoi_id[5:]
        try:
            box = BoundingBox.parse(raw)
        except InvalidBoundingBoxError:
            return None
        return AoiEntry(
            id=aoi_id,
            name=(
                f"Custom area ({box.west:.2f}\u00b0, {box.south:.2f}\u00b0 to "
                f"{box.east:.2f}\u00b0, {box.north:.2f}\u00b0)"
            ),
            bbox=(box.west, box.south, box.east, box.north),
            kind="colombia_box",
            priority=999,
        )
    return None


def _modis_equiv_blend(
    m_raw: float | None,
    v_raw: float | None,
    ratio: SensorRatio,
    *,
    is_transition_month: bool = False,
) -> tuple[float | None, float | None, float | None]:
    """Combine MODIS and VIIRS counts into MODIS-equivalent detections + 90% CI."""
    k = max(ratio.ratio, 0.1)
    rel_iqr = max(0.08, (ratio.q75 - ratio.q25) / (1.349 * k))
    if m_raw is None and v_raw is None:
        return None, None, None
    if v_raw is None and m_raw is not None:
        sd_m = math.sqrt(max(m_raw, 0.5) + (0.08 * m_raw) ** 2)
        return (
            round(m_raw, 2),
            round(max(0.0, m_raw - 1.645 * sd_m), 2),
            round(m_raw + 1.645 * sd_m, 2),
        )
    if m_raw is None and v_raw is not None:
        xv = v_raw / k
        sd_v = math.sqrt(max(v_raw, 0.5) / (k * k) + (xv * rel_iqr) ** 2)
        return (
            round(xv, 2),
            round(max(0.0, xv - 1.645 * sd_v), 2),
            round(xv + 1.645 * sd_v, 2),
        )
    if m_raw is None or v_raw is None:
        return None, None, None
    if is_transition_month:
        # January 2012 mixes MODIS across all 31 days with VIIRS only from Jan 20-31.
        # Weight VIIRS by 12/31 coverage when blending or use VIIRS-only normalized cautiously,
        # while avoiding dividing raw partial-month VIIRS as if it covered full Jan 1-31.
        cov_v = max(v_raw, 0.0) / (k * (12.0 / 31.0))
        sd_m = math.sqrt(max(m_raw, 0.5) + (0.08 * m_raw) ** 2)
        sd_v = math.sqrt(max(v_raw, 0.5) / ((k * (12.0 / 31.0)) ** 2) + (cov_v * rel_iqr) ** 2)
        w_m = 1.0 / (sd_m * sd_m)
        w_v = 1.0 / (sd_v * sd_v)
        h = (w_m * m_raw + w_v * cov_v) / (w_m + w_v)
        sd_h = 1.0 / math.sqrt(w_m + w_v)
        return round(h, 2), round(max(0.0, h - 1.645 * sd_h), 2), round(h + 1.645 * sd_h, 2)

    xv = v_raw / k
    var_m = max(m_raw, 0.5) + (0.08 * m_raw) ** 2
    var_v = max(v_raw, 0.5) / (k * k) + (xv * rel_iqr) ** 2
    w_m = 1.0 / var_m
    w_v = 1.0 / var_v
    h = (w_m * m_raw + w_v * xv) / (w_m + w_v)
    sd_h = 1.0 / math.sqrt(w_m + w_v)
    return round(h, 2), round(max(0.0, h - 1.645 * sd_h), 2), round(h + 1.645 * sd_h, 2)


def _slot_for_date(d: date, resolution: Resolution) -> int:
    if resolution == "month":
        return d.month
    if resolution == "week":
        return min(52, (d.timetuple().tm_yday - 1) // 7)
    return d.timetuple().tm_yday


def _assign_log_z_scores(cells: list[dict[str, Any]], resolution: Resolution) -> None:
    """Populate deterministic standardized log-activity anomalyZ per cell across all years."""
    buckets: dict[int, list[float]] = {}
    for c in cells:
        h = c["harmonized"]
        if h is None:
            continue
        slot = _slot_for_date(date.fromisoformat(c["date"]), resolution)
        buckets.setdefault(slot, []).append(math.log1p(max(0.0, float(h))))

    stats: dict[int, tuple[float, float]] = {}
    if resolution == "day":
        for doy in range(1, DAYS_IN_LEAP_YEAR + 1):
            pooled: list[float] = []
            for offset in range(-7, 8):
                s = ((doy - 1 + offset) % DAYS_IN_LEAP_YEAR) + 1
                pooled.extend(buckets.get(s, ()))
            if len(pooled) >= MIN_STAT_SAMPLES:
                arr = np.asarray(pooled, dtype=float)
                stats[doy] = (float(arr.mean()), max(0.25, float(arr.std(ddof=1))))
    else:
        for slot, vals in buckets.items():
            if len(vals) >= MIN_STAT_SAMPLES:
                arr = np.asarray(vals, dtype=float)
                stats[slot] = (float(arr.mean()), max(0.25, float(arr.std(ddof=1))))

    for c in cells:
        h = c["harmonized"]
        if h is None:
            continue
        slot = _slot_for_date(date.fromisoformat(c["date"]), resolution)
        st = stats.get(slot)
        if st is None:
            continue
        mu, sd = st
        c["anomalyZ"] = round((math.log1p(max(0.0, float(h))) - mu) / sd, 2)


def _summarize_clim_bucket(doy: int, vals: Sequence[float]) -> dict[str, Any]:
    if not vals:
        return {"doy": doy, "mean": 0.0, "p10": 0.0, "p90": 0.0}
    arr = np.asarray(vals, dtype=float)
    return {
        "doy": doy,
        "mean": round(float(arr.mean()), 1),
        "p10": round(float(np.percentile(arr, 10)), 1),
        "p90": round(float(np.percentile(arr, 90)), 1),
    }


def _build_climatology(cells: list[dict[str, Any]], resolution: Resolution) -> list[dict[str, Any]]:
    """Build DOY-indexed climatology (mean, p10, p90) in MODIS-equivalent units."""
    # Mid-month day-of-year in leap year 2000 ensures getUTCMonth() always resolves 0..11 cleanly.
    month_doys = [15, 46, 75, 106, 136, 167, 197, 228, 259, 289, 320, 350]
    buckets: dict[int, list[float]] = {}
    for c in cells:
        h = c["harmonized"]
        if h is None:
            continue
        d = date.fromisoformat(c["date"])
        if resolution == "month":
            doy = month_doys[d.month - 1]
        elif resolution == "week":
            w = min(52, (d.timetuple().tm_yday - 1) // 7)
            doy = w * 7 + 1
        else:
            doy = d.timetuple().tm_yday
        buckets.setdefault(doy, []).append(float(h))

    if resolution == "day":
        out: list[dict[str, Any]] = []
        for doy in range(1, DAYS_IN_LEAP_YEAR + 1):
            pooled: list[float] = []
            for offset in range(-7, 8):
                s = ((doy - 1 + offset) % DAYS_IN_LEAP_YEAR) + 1
                pooled.extend(buckets.get(s, ()))
            out.append(_summarize_clim_bucket(doy, pooled))
        return out

    slots = month_doys if resolution == "month" else [w * 7 + 1 for w in range(53)]
    return [_summarize_clim_bucket(doy, buckets.get(doy, ())) for doy in slots]


def _detect_anomalies_from_cells(cells: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Group consecutive anomalous monthly cells into deterministic Anomaly episodes."""
    out: list[dict[str, Any]] = []
    run: dict[str, Any] | None = None

    def _flush() -> None:
        nonlocal run
        if run is None:
            return
        z = float(run["z"])
        az = abs(z)
        band = (
            "Extreme" if az >= ANOM_EXTREME_Z else ("Strong" if az >= ANOM_STRONG_Z else "Moderate")
        )
        direction = "excess" if z > 0 else "deficit"
        out.append(
            {
                "start": run["start"],
                "end": run["end"],
                "zScore": round(z, 2),
                "label": f"{band} {direction} of fire activity",
            }
        )
        run = None

    for c in cells:
        z = c.get("anomalyZ")
        h = c.get("harmonized")
        if z is None or h is None:
            _flush()
            continue
        relevant = z >= ANOM_POS_MIN_Z or (z <= ANOM_NEG_MIN_Z and float(h) > ANOM_NEG_MIN_COUNT)
        d = date.fromisoformat(c["date"])
        # Last day of that calendar month
        end_d = (
            date(d.year, 12, 31)
            if d.month == DECEMBER
            else date(d.year, d.month + 1, 1) - timedelta(days=1)
        )
        end_iso = end_d.isoformat()
        if relevant and run is not None and ((z > 0) == (float(run["z"]) > 0)):
            run["end"] = end_iso
            if abs(z) > abs(float(run["z"])):
                run["z"] = z
        else:
            _flush()
            if relevant:
                run = {"start": c["date"], "end": end_iso, "z": z}
    _flush()
    out.sort(key=lambda x: abs(float(x["zScore"])), reverse=True)
    return out[:24]


def _local_daynight(acq_time: int, lon: float) -> Literal["D", "N"]:
    hh = int(acq_time) // 100
    mm = int(acq_time) % 100
    utc_hour = hh + mm / 60.0
    local_hour = (utc_hour + lon / 15.0) % 24.0
    return "D" if SOLAR_DAWN_HOUR <= local_hour < SOLAR_DUSK_HOUR else "N"


def _fmt_hhmm(acq_time: Any) -> str:
    try:
        val = int(acq_time)
    except (TypeError, ValueError):
        return "00:00"
    hh = max(0, min(23, val // 100))
    mm = max(0, min(59, val % 100))
    return f"{hh:02d}:{mm:02d}"


def _norm_satellite(sat: Any, sensor: str) -> str:
    code = str(sat or "").strip().upper()
    if code in {"T", "TERRA"}:
        return "Terra"
    if code in {"A", "AQUA"}:
        return "Aqua"
    if code in {"N", "NPP", "SUOMI NPP"}:
        return "Suomi NPP"
    if code in {"N20", "NOAA-20", "J1", "JPSS-1"}:
        return "NOAA-20"
    if code in {"N21", "NOAA-21", "J2", "JPSS-2"}:
        return "NOAA-21"
    return "Terra" if sensor == "MODIS" else "Suomi NPP"


@dataclass(frozen=True)
class _EmberContext:
    service: CalendarService
    countries: CountryCalendars
    aoi_by_id: dict[str, AoiEntry]
    aoi_ordered: list[AoiEntry]
    recent_src: RecentSource | None
    parquet_path: Path
    export_path: Path | None
    has_parquet: bool
    firms: FirmsHotspots | None = None
    department_collection: dict[str, Any] | None = None
    world_collection: Mapping[str, list[dict[str, Any]]] | None = None


def _select_detections_mask(detections: pd.DataFrame, entry: AoiEntry) -> pd.Series:
    if entry.kind == "colombia_all":
        return pd.Series(True, index=detections.index)
    if entry.kind == "department" and entry.department is not None and "department" in detections:
        return detections["department"] == entry.department
    w, s, e, n = entry.bbox
    return detections["longitude"].between(w, e) & detections["latitude"].between(s, n)


def _bin_dates(dt: pd.Series, resolution: Resolution) -> Any:
    if resolution == "month":
        return [date(y, m, 1) for y, m in zip(dt.dt.year, dt.dt.month, strict=False)]
    if resolution == "week":
        return (dt - pd.to_timedelta(dt.dt.dayofweek, unit="D")).dt.date
    return dt.dt.date


def _compute_mean_frp_by_date(
    detections: pd.DataFrame,
    entry: AoiEntry,
    resolution: Resolution,
    parquet_path: Path,
    has_parquet: bool,
) -> dict[date, float]:
    """Compute real average radiative power (MW) per date slot from detections.parquet."""
    mask = _select_detections_mask(detections, entry)
    if "frp" in detections:
        sub = detections.loc[mask, ["acq_date", "frp"]]
    elif has_parquet:
        idx = np.flatnonzero(mask.to_numpy())
        if len(idx) == 0:
            return {}
        frp_col = pd.read_parquet(parquet_path, columns=["frp"]).iloc[idx]["frp"]
        dates_arr = detections.loc[mask, "acq_date"].to_numpy()
        sub = pd.DataFrame({"acq_date": dates_arr, "frp": frp_col.to_numpy()})
    else:
        return {}

    if sub.empty:
        return {}
    dt = pd.to_datetime(sub["acq_date"])
    slot: Any = _bin_dates(dt, resolution)
    grouped = sub.assign(_slot=slot).groupby("_slot", sort=False)["frp"].mean()
    return {cast(date, k): round(float(v), 1) for k, v in grouped.items() if pd.notna(v)}


def _monthly_frame_for_country_aoi(
    entry: AoiEntry,
    countries: CountryCalendars,
    fallback_ratio: SensorRatio,
) -> tuple[pd.DataFrame, SensorRatio]:
    if entry.country is None:
        return pd.DataFrame(columns=["month", "sensor", "count"]), fallback_ratio
    c_df = countries.monthly[countries.monthly["country"] == entry.country]
    fallback = countries.fallback_ratio or fallback_ratio
    if c_df.empty:
        return pd.DataFrame(columns=["month", "sensor", "count"]), fallback
    try:
        ratio = fit_sensor_ratio(c_df)
    except InsufficientOverlapError:
        ratio = fallback
    if entry.kind == "country":
        return c_df[["month", "sensor", "count"]], ratio
    sub_df = countries.subdivisions[
        (countries.subdivisions["country"] == entry.country)
        & (countries.subdivisions["subdivision"].isin(entry.subdivisions))
    ]
    if sub_df.empty:
        return pd.DataFrame(columns=["month", "sensor", "count"]), ratio
    grouped = sub_df.groupby(["month", "sensor"], observed=True)["count"].sum().reset_index()
    return grouped, ratio


def _next_month_start(cur: date) -> date:
    if cur.month == DECEMBER:
        return date(cur.year + 1, 1, 1)
    return date(cur.year, cur.month + 1, 1)


def _make_calendar_cell(
    cur: date,
    m_val: float | None,
    v_val: float | None,
    ratio: SensorRatio,
    *,
    is_transition_month: bool = False,
    frp_val: float | None = None,
) -> dict[str, Any]:
    h, h_lo, h_hi = _modis_equiv_blend(m_val, v_val, ratio, is_transition_month=is_transition_month)
    cell: dict[str, Any] = {
        "date": cur.isoformat(),
        "modis": m_val,
        "viirs": v_val,
        "harmonized": h,
    }
    if h_lo is not None and h_hi is not None:
        cell["harmonizedLow"] = h_lo
        cell["harmonizedHigh"] = h_hi
    if frp_val is not None:
        cell["frp"] = frp_val
    return cell


def _merge_nrt_viirs_counts(
    viirs_map: dict[date, int],
    *,
    recent_src: RecentSource | None,
    entry: AoiEntry,
    max_data_date: date,
    req_to: date,
    resolution: Resolution,
    base_effective_to: date,
) -> date:
    latest_recent = recent_src.get() if recent_src is not None else None
    if latest_recent is None or latest_recent.points.empty:
        return base_effective_to
    pts = latest_recent.points
    nrt_mask = (pts["acq_date"] > pd.Timestamp(max_data_date)) & _select_detections_mask(pts, entry)
    nrt_inside = pts.loc[nrt_mask]
    if nrt_inside.empty:
        return base_effective_to
    nrt_max = pd.Timestamp(nrt_inside["acq_date"].max()).date()
    nrt_slots: Any = _bin_dates(pd.to_datetime(nrt_inside["acq_date"]), resolution)
    counts = nrt_inside.assign(_slot=nrt_slots).groupby("_slot").size()
    for slot_key, count in counts.items():
        k_date = cast(date, slot_key)
        viirs_map[k_date] = viirs_map.get(k_date, 0) + int(count)
    return max(base_effective_to, min(req_to, nrt_max))


def _colombia_calendar_cells(
    service: CalendarService,
    entry: AoiEntry,
    *,
    req_from: date,
    req_to: date,
    resolution: Resolution,
    frp_map: dict[date, float],
    recent_src: RecentSource | None = None,
) -> tuple[list[dict[str, Any]], SensorRatio]:
    d = service.detections
    mask = _select_detections_mask(d, entry)
    inside = d.loc[mask, ["latitude", "longitude", "acq_date", "sensor"]]
    empty_monthly = pd.DataFrame(columns=["month", "sensor", "count"])
    agg = aggregate_monthly(inside) if not inside.empty else empty_monthly
    ratio = (
        fit_sensor_ratio(
            agg,
            fallback_ratio=service.sensor_ratio.ratio,
            fallback_iqr=(service.sensor_ratio.q25, service.sensor_ratio.q75),
        )
        if not agg.empty
        else service.sensor_ratio
    )
    max_data_date = pd.Timestamp(d["acq_date"].max()).date() if not d.empty else date.today()
    effective_to = min(req_to, max_data_date)

    modis_map: dict[date, int] = {}
    viirs_map: dict[date, int] = {}
    if not inside.empty:
        slot_series: Any = _bin_dates(pd.to_datetime(inside["acq_date"]), resolution)
        piv = (
            inside.assign(_slot=slot_series)
            .groupby(["_slot", "sensor"], observed=True)
            .size()
            .unstack(fill_value=0)
        )
        if "MODIS" in piv:
            modis_map = {cast(date, k): int(v) for k, v in piv["MODIS"].items()}
        if "VIIRS" in piv:
            viirs_map = {cast(date, k): int(v) for k, v in piv["VIIRS"].items()}

    viirs_effective_to = _merge_nrt_viirs_counts(
        viirs_map,
        recent_src=recent_src,
        entry=entry,
        max_data_date=max_data_date,
        req_to=req_to,
        resolution=resolution,
        base_effective_to=effective_to,
    )

    cells: list[dict[str, Any]] = []
    if resolution == "month":
        cur = date(req_from.year, req_from.month, 1)
        end_slot = date(req_to.year, req_to.month, 1)
        while cur <= end_slot:
            obs_modis = MODIS_START <= cur <= effective_to
            obs_viirs = date(2012, 1, 1) <= cur <= viirs_effective_to
            m_val = float(modis_map.get(cur, 0)) if obs_modis else None
            is_jan2012 = cur == date(2012, 1, 1)
            v_val = float(viirs_map.get(cur, 0)) if obs_viirs else None
            cells.append(
                _make_calendar_cell(
                    cur,
                    m_val,
                    v_val,
                    ratio,
                    is_transition_month=is_jan2012,
                    frp_val=frp_map.get(cur),
                )
            )
            cur = _next_month_start(cur)
        return cells, ratio

    step = timedelta(days=7 if resolution == "week" else 1)
    cur = req_from - timedelta(days=req_from.weekday()) if resolution == "week" else req_from
    while cur <= req_to:
        bin_end = cur + timedelta(days=6) if resolution == "week" else cur
        obs_modis = bin_end >= MODIS_START and cur <= effective_to
        obs_viirs = bin_end >= VIIRS_FIRST_LIGHT and cur <= viirs_effective_to
        m_val = float(modis_map.get(cur, 0)) if obs_modis else None
        v_val = float(viirs_map.get(cur, 0)) if obs_viirs else None
        cells.append(_make_calendar_cell(cur, m_val, v_val, ratio, frp_val=frp_map.get(cur)))
        cur += step
    return cells, ratio


def _global_calendar_cells(
    monthly_df: pd.DataFrame,
    ratio: SensorRatio,
    countries: CountryCalendars,
    req_from: date,
    req_to: date,
) -> list[dict[str, Any]]:
    max_m_date = (
        pd.Timestamp(countries.record_end).date()
        if countries.record_end is not None
        else date(2025, 12, 1)
    )
    modis_map: dict[date, int] = {}
    viirs_map: dict[date, int] = {}
    if not monthly_df.empty:
        m_dates = pd.to_datetime(monthly_df["month"]).dt.date
        for dt_val, sens, cnt in zip(
            m_dates, monthly_df["sensor"], monthly_df["count"], strict=True
        ):
            if sens == "MODIS":
                modis_map[dt_val] = int(cnt)
            elif sens == "VIIRS":
                viirs_map[dt_val] = int(cnt)

    cells: list[dict[str, Any]] = []
    cur = date(req_from.year, req_from.month, 1)
    end_slot = date(req_to.year, req_to.month, 1)
    while cur <= end_slot:
        obs_modis = MODIS_START <= cur <= max_m_date
        obs_viirs = date(2012, 1, 1) <= cur <= max_m_date
        m_val = float(modis_map.get(cur, 0)) if obs_modis else None
        is_jan2012 = cur == date(2012, 1, 1)
        v_val = float(viirs_map.get(cur, 0)) if obs_viirs else None
        cells.append(_make_calendar_cell(cur, m_val, v_val, ratio, is_transition_month=is_jan2012))
        cur = _next_month_start(cur)
    return cells


def _query_hotspots_df(
    ctx: _EmberContext,
    area: BoundingBox,
    *,
    start_ts: pd.Timestamp,
    end_ts_excl: pd.Timestamp,
    sensor: Literal["modis", "viirs", "all"],
) -> pd.DataFrame:
    if ctx.has_parquet and ctx.export_path is not None:
        filters: list[tuple[str, str, Any]] = [
            ("acq_date", ">=", start_ts),
            ("acq_date", "<", end_ts_excl),
            ("longitude", ">=", area.west),
            ("longitude", "<=", area.east),
            ("latitude", ">=", area.south),
            ("latitude", "<=", area.north),
        ]
        if sensor in {"modis", "viirs"}:
            filters.append(("sensor", "=", sensor.upper()))
        rows_df = pd.read_parquet(ctx.parquet_path, columns=DETECTION_COLS, filters=filters)
    else:
        d = ctx.service.detections
        mask = (
            (d["acq_date"] >= start_ts)
            & (d["acq_date"] < end_ts_excl)
            & d["longitude"].between(area.west, area.east)
            & d["latitude"].between(area.south, area.north)
        )
        if sensor in {"modis", "viirs"}:
            mask = mask & (d["sensor"] == sensor.upper())
        cols = [c for c in DETECTION_COLS if c in d]
        rows_df = d.loc[mask, cols]

    if ctx.recent_src is not None and sensor in {"all", "viirs"}:
        latest = ctx.recent_src.get()
        if latest is not None and not latest.points.empty:
            pts = latest.points
            nrt_mask = (
                (pts["acq_date"] >= start_ts)
                & (pts["acq_date"] < end_ts_excl)
                & pts["longitude"].between(area.west, area.east)
                & pts["latitude"].between(area.south, area.north)
            )
            nrt_sub = pts.loc[nrt_mask]
            if not nrt_sub.empty:
                existing_dates = (
                    set(pd.to_datetime(rows_df["acq_date"]).dt.date) if not rows_df.empty else set()
                )
                nrt_new = nrt_sub[~nrt_sub["acq_date"].dt.date.isin(existing_dates)]
                if not nrt_new.empty:
                    nrt_frame = pd.DataFrame(
                        {
                            "latitude": nrt_new["latitude"].to_numpy(),
                            "longitude": nrt_new["longitude"].to_numpy(),
                            "acq_date": nrt_new["acq_date"].to_numpy(),
                            "acq_time": 1800,
                            "sensor": "VIIRS",
                            "satellite": latest.satellite,
                            "frp": 5.0,
                        }
                    )
                    rows_df = (
                        nrt_frame
                        if rows_df.empty
                        else pd.concat([rows_df, nrt_frame], ignore_index=True)
                    )
    return rows_df


def _serialize_hotspots(rows_df: pd.DataFrame) -> list[dict[str, Any]]:
    if rows_df.empty:
        return []
    if len(rows_df) > HOTSPOT_POINT_CAP:
        stride = math.ceil(len(rows_df) / HOTSPOT_POINT_CAP)
        rows_df = rows_df.iloc[::stride]

    lats = rows_df["latitude"].to_numpy()
    lons = rows_df["longitude"].to_numpy()
    sensors = rows_df["sensor"].astype(str).to_numpy()
    n_rows = len(rows_df)
    acq_times = rows_df["acq_time"].to_numpy() if "acq_time" in rows_df else np.full(n_rows, 1800)
    sats = (
        rows_df["satellite"].astype(str).to_numpy()
        if "satellite" in rows_df
        else np.full(n_rows, "")
    )
    frps = rows_df["frp"].to_numpy() if "frp" in rows_df else np.full(n_rows, 0.0)
    acq_dates = (
        pd.to_datetime(rows_df["acq_date"], errors="coerce").dt.strftime("%Y-%m-%d").to_numpy()
        if "acq_date" in rows_df
        else np.full(n_rows, None)
    )

    out: list[dict[str, Any]] = []
    for i in range(n_rows):
        s_raw = sensors[i].upper()
        s_lower: Literal["modis", "viirs"] = "modis" if s_raw == "MODIS" else "viirs"
        lon = float(lons[i])
        lat = float(lats[i])
        t_int = int(acq_times[i]) if pd.notna(acq_times[i]) else 1800
        frp_val = round(float(frps[i]), 2) if pd.notna(frps[i]) else 0.0
        out.append(
            {
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "sensor": s_lower,
                "satellite": _norm_satellite(sats[i], s_raw),
                "acqTime": _fmt_hhmm(t_int),
                "acqDate": acq_dates[i] if isinstance(acq_dates[i], str) else None,
                "frp": frp_val,
                "confidence": "nominal",
                "daynight": _local_daynight(t_int, lon),
            }
        )
    return out


def _summarize_analyst_stats(
    cells: list[dict[str, Any]],
    anomalies: list[dict[str, Any]],
) -> dict[str, Any]:
    by_month: list[list[float]] = [[] for _ in range(DECEMBER)]
    by_year: dict[int, float] = {}
    frps: list[float] = []
    for c in cells:
        h = c["harmonized"]
        if h is not None:
            d = date.fromisoformat(c["date"])
            by_month[d.month - 1].append(float(h))
            by_year[d.year] = by_year.get(d.year, 0.0) + float(h)
        if "frp" in c and c["frp"] is not None:
            frps.append(float(c["frp"]))

    means = [float(np.mean(vals)) if vals else 0.0 for vals in by_month]
    total_mean = sum(means) or 1.0
    peak_idx = int(np.argmax(means))
    season_idx = [(peak_idx - 1) % DECEMBER, peak_idx, (peak_idx + 1) % DECEMBER]
    return {
        "peak_idx": peak_idx,
        "season_idx": season_idx,
        "season_share": round(100.0 * sum(means[i] for i in season_idx) / total_mean),
        "mean_frp": round(float(np.mean(frps)), 1) if frps else None,
        "top_anoms": [a for a in anomalies if float(a["zScore"]) > 0][:3],
        "top_years": sorted(by_year.items(), key=lambda kv: kv[1], reverse=True)[:3],
    }


def _compose_analyst_reply(
    entry: AoiEntry,
    cells: list[dict[str, Any]],
    ratio: SensorRatio,
    *,
    alert: AlertItem,
    anomalies: list[dict[str, Any]],
    question: str,
    lang: Literal["es", "en"],
) -> tuple[str, list[dict[str, str]]]:
    st = _summarize_analyst_stats(cells, anomalies)
    peak_idx: int = st["peak_idx"]
    season_idx: list[int] = st["season_idx"]
    season_share: int = st["season_share"]
    mean_frp: float | None = st["mean_frp"]
    top_anoms: list[dict[str, Any]] = st["top_anoms"]
    top_years: list[tuple[int, float]] = st["top_years"]

    months_tbl = ONSET_MONTH_NAMES_ES if lang == "es" else ONSET_MONTH_NAMES_EN
    q_lower = _norm_text(question)

    def _ym(iso_d: str) -> str:
        d = date.fromisoformat(iso_d)
        return f"{months_tbl[d.month - 1]} {d.year}"

    highlights: list[dict[str, str]] = [
        {
            "date": a["start"],
            "reason": (
                f"Anomal\u00eda positiva verificada (z = {a['zScore']:+.2f}\u03c3)"
                if lang == "es"
                else f"Verified positive anomaly (z = {a['zScore']:+.2f}\u03c3)"
            ),
        }
        for a in top_anoms
    ]

    enso_terms = ("nino", "enso", "oni", "sequia", "drought", "2024", "2016")
    alert_terms = ("alerta", "gobierno", "ungrd", "riesgo", "alert", "warning", "government")
    is_enso_q = any(t in q_lower for t in enso_terms)
    is_alert_q = any(t in q_lower for t in alert_terms) or alert.severity != "NORMAL"

    if lang == "es":
        bullets: list[str] = [
            (
                f"\u2022 Estacionalidad cr\u00edtica: {months_tbl[season_idx[0]]}\u2013"
                f"{months_tbl[season_idx[2]]} concentra ~{season_share}% de la densidad "
                f"t\u00e9rmica anual en {entry.name}, con pico en {months_tbl[peak_idx]}."
            ),
            (
                f"\u2022 Calibraci\u00f3n MODIS\u2013VIIRS: raz\u00f3n emp\u00edrica k = "
                f"{ratio.ratio:.2f}\u00d7 (RIC {ratio.q25:.2f}\u2013{ratio.q75:.2f} en "
                f"{ratio.overlap_months} meses de traslape). VIIRS (375 m I4 a 3,74 \u00b5m) "
                "detecta focos m\u00e1s peque\u00f1os que MODIS (1 km a 3,96 \u00b5m); "
                "la mezcla por inversa de varianza evita saltos artificiales."
            ),
        ]
        if top_anoms:
            anom_txt = ", ".join(
                f"{_ym(a['start'])} (z = {float(a['zScore']):+.2f}\u03c3)" for a in top_anoms
            )
            yr_txt = ", ".join(f"{y} ({v:,.0f} MODIS-eq)" for y, v in top_years)
            suffix = f" \u2014 a\u00f1os pico: {yr_txt}." if top_years else "."
            bullets.append(f"\u2022 Episodios extremos (log-estandarizado): {anom_txt}{suffix}")
        if mean_frp is not None:
            bullets.append(
                f"\u2022 Potencia Radiativa (FRP): promedio de {mean_frp:.1f} MW en celdas "
                "activas (Stefan-Boltzmann / banda MIR ~4 \u00b5m)."
            )
        if is_enso_q:
            bullets.append(
                f"\u2022 Modulaci\u00f3n ENSO/ONI y alerta actual: {alert.technical_summary_es}"
            )
        elif is_alert_q:
            auths = ", ".join(a.code for a in alert.authorities[:4])
            bullets.append(
                f"\u2022 Alerta temprana ({alert.severity_label_es}): {alert.headline_es} "
                f"Entidades destinadas: {auths}."
            )
        text = (
            f"An\u00e1lisis determinista NASA FIRMS \u2014 {entry.name}\n"
            f'Consulta: "{question.strip()}"\n\n'
            + "\n".join(bullets)
            + "\n\nConclusi\u00f3n trazable sobre serie armonizada real (sin IA generativa)."
        )
        return text, highlights

    bullets = [
        (
            f"\u2022 Critical fire season: {months_tbl[season_idx[0]]}\u2013"
            f"{months_tbl[season_idx[2]]} accounts for ~{season_share}% of annual harmonized "
            f"thermal activity in {entry.name}, peaking in {months_tbl[peak_idx]}."
        ),
        (
            f"\u2022 MODIS\u2013VIIRS calibration: empirical ratio k = {ratio.ratio:.2f}\u00d7 "
            f"(IQR {ratio.q25:.2f}\u2013{ratio.q75:.2f} across {ratio.overlap_months} overlap "
            "months). VIIRS (375 m I4 at 3.74 \u00b5m) resolves smaller fires than MODIS "
            "(1 km ch. 21/22 at 3.96 \u00b5m); inverse-variance blending avoids step jumps."
        ),
    ]
    if top_anoms:
        anom_txt = ", ".join(
            f"{_ym(a['start'])} (z = {float(a['zScore']):+.2f}\u03c3)" for a in top_anoms
        )
        yr_txt = ", ".join(f"{y} ({v:,.0f} MODIS-eq)" for y, v in top_years)
        suffix = f" \u2014 peak years: {yr_txt}." if top_years else "."
        bullets.append(f"\u2022 Extreme departure episodes (log-standardized): {anom_txt}{suffix}")
    if mean_frp is not None:
        bullets.append(
            f"\u2022 Fire Radiative Power (FRP): observed mean {mean_frp:.1f} MW per active "
            "period (Planck MIR ~4 \u00b5m brightness)."
        )
    if is_enso_q:
        bullets.append(f"\u2022 ENSO/ONI forcing & current departure: {alert.technical_summary_en}")
    elif is_alert_q:
        auths = ", ".join(a.code for a in alert.authorities[:4])
        bullets.append(
            f"\u2022 Deterministic early warning ({alert.severity_label_en}): "
            f"{alert.headline_en} Target agencies: {auths}."
        )
    text = (
        f"Deterministic NASA FIRMS Analysis \u2014 {entry.name}\n"
        f'Query: "{question.strip()}"\n\n'
        + "\n".join(bullets)
        + "\n\nTraceable synthesis computed from real harmonized FIRMS records (no LLM)."
    )
    return text, highlights


def _rows_for_entry(
    ctx: _EmberContext, entry: AoiEntry
) -> tuple[list[dict[str, Any]], SensorRatio, bool]:
    if entry.kind == "colombia_all":
        rows, ratio = ctx.service.calendar_and_ratio_for(COLOMBIA, None)
        return rows, ratio, True
    if entry.kind == "department":
        rows, ratio = ctx.service.calendar_and_ratio_for(BoundingBox(*entry.bbox), entry.department)
        return rows, ratio, True
    if entry.kind == "colombia_box":
        rows, ratio = ctx.service.calendar_and_ratio_for(BoundingBox(*entry.bbox), None)
        return rows, ratio, _overlaps_colombia(entry.bbox)

    monthly_df, ratio = _monthly_frame_for_country_aoi(
        entry, ctx.countries, ctx.service.sensor_ratio
    )
    if monthly_df.empty:
        return [], ratio, False
    cal = _calendar(
        monthly_df,
        ratio,
        start_month=ctx.countries.record_start,
        end_month=ctx.countries.record_end,
    )
    rows = _rows(cal, ctx.countries.oni)
    return rows, ratio, entry.country == "Colombia"


def _recent_stamp(ctx: _EmberContext) -> str | None:
    latest = ctx.recent_src.get() if ctx.recent_src is not None else None
    return latest.fetched_at.isoformat() if latest is not None else None


def _register_calendar_and_hotspot_routes(app: FastAPI, ctx: _EmberContext, build_cal: Any) -> None:
    @app.get("/api/aoi/search")
    def api_aoi_search(q: str = Query(default="", max_length=120)) -> list[dict[str, Any]]:
        query = _norm_text(q)
        if not query:
            hits = ctx.aoi_ordered[:12]
        else:
            starts: list[AoiEntry] = []
            contains: list[AoiEntry] = []
            for entry in ctx.aoi_ordered:
                n_name = _norm_text(entry.name)
                if n_name.startswith(query) or entry.id == query:
                    starts.append(entry)
                elif query in n_name or query in entry.id:
                    contains.append(entry)
            hits = (starts + contains)[:12]
        return [{"id": e.id, "name": e.name, "bbox": list(e.bbox)} for e in hits]

    @app.get("/api/calendar")
    def api_calendar(
        aoi: str = Query(max_length=120),
        from_date: str = Query(default="2000-01-01", alias="from", max_length=10),
        to_date: str = Query(default=date.today().isoformat(), alias="to", max_length=10),
        resolution: Resolution = "day",
    ) -> dict[str, Any]:
        return dict(build_cal(aoi, from_date, to_date, resolution, _recent_stamp(ctx)))

    @app.get("/api/hotspots")
    def api_hotspots(
        bbox: str = Query(max_length=120),
        date_str: str | None = Query(default=None, alias="date", max_length=10),
        from_str: str | None = Query(default=None, alias="from", max_length=10),
        to_str: str | None = Query(default=None, alias="to", max_length=10),
        sensor: Literal["modis", "viirs", "all"] = "all",
    ) -> list[dict[str, Any]]:
        try:
            area = BoundingBox.parse(bbox)
        except InvalidBoundingBoxError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if from_str and to_str:
            start_s, end_s = from_str, to_str
        elif date_str:
            start_s, end_s = date_str, date_str
        else:
            raise HTTPException(status_code=422, detail="Provide `date` or `from` and `to`.")
        try:
            start_d = date.fromisoformat(start_s)
            end_d = date.fromisoformat(end_s)
        except ValueError as exc:
            raise HTTPException(
                status_code=422, detail="Invalid date format; use YYYY-MM-DD."
            ) from exc
        if start_d > end_d:
            raise HTTPException(status_code=422, detail="`from` must not be after `to`.")
        source = hotspot_source(area, start_d, end_d, firms_available=ctx.firms is not None)
        if source == "firms" and ctx.firms is not None:
            rows_df = ctx.firms.fetch(area, start_d, end_d)
            if sensor in {"modis", "viirs"} and not rows_df.empty:
                rows_df = rows_df[rows_df["sensor"] == sensor.upper()]
        else:
            rows_df = _query_hotspots_df(
                ctx,
                area,
                start_ts=pd.Timestamp(start_d),
                end_ts_excl=pd.Timestamp(end_d) + pd.Timedelta(days=1),
                sensor=sensor,
            )
        return _serialize_hotspots(rows_df)


def _register_area_routes(app: FastAPI, ctx: _EmberContext) -> None:
    @app.get("/api/hotspots/coverage")
    def api_hotspots_coverage(
        bbox: str = Query(max_length=120),
        from_str: str = Query(alias="from", max_length=10),
        to_str: str = Query(alias="to", max_length=10),
    ) -> dict[str, Any]:
        """Where the points for this area and span come from, so the UI can explain gaps."""
        try:
            area = BoundingBox.parse(bbox)
            start_d, end_d = date.fromisoformat(from_str), date.fromisoformat(to_str)
        except (InvalidBoundingBoxError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="Invalid bbox or dates.") from exc
        return {
            "source": hotspot_source(area, start_d, end_d, firms_available=ctx.firms is not None),
            "firmsConfigured": ctx.firms is not None,
            "maxDays": FIRMS_MAX_SPAN_DAYS,
        }

    @app.get("/api/aoi/geometry")
    def api_aoi_geometry(aoi: str = Query(max_length=120)) -> dict[str, Any]:
        """Real outline of an area (department, subdivision, group). Countries return no
        geometry: the client draws them from its own Natural Earth country layer."""
        entry = _resolve_aoi_id(aoi, ctx.aoi_by_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Unknown area.")
        return {
            "id": entry.id,
            "kind": entry.kind,
            "country": entry.country,
            "geometry": _entry_geometry(ctx, entry),
        }


def _entry_geometry(ctx: _EmberContext, entry: AoiEntry) -> dict[str, Any] | None:
    if entry.kind in {"country", "colombia_all"} or entry.id.startswith("bbox:"):
        return None
    if entry.geometry is not None:
        return entry.geometry
    departments = (ctx.department_collection or {}).get("features", [])
    if entry.id == "co-orinoquia":
        return merge_geometries(
            [f.get("geometry") for f in departments if f["properties"]["name"] in ORINOQUIA]
        )
    if entry.department is not None:
        return merge_geometries(
            [f.get("geometry") for f in departments if f["properties"]["name"] == entry.department]
        )
    if entry.country is not None and entry.subdivisions:
        feats = (ctx.world_collection or {}).get(entry.country, [])
        wanted = set(entry.subdivisions)
        return merge_geometries(
            [f.get("geometry") for f in feats if str(f["properties"]["name"]) in wanted]
        )
    return None


def _evaluate_entry_alert(
    ctx: _EmberContext,
    entry: AoiEntry,
    *,
    as_of: date | None = None,
    latest_recent: Any = None,
) -> AlertItem:
    rows, _, in_col = _rows_for_entry(ctx, entry)
    nrt_det: int | None = None
    nrt_pct: float | None = None
    if latest_recent is not None and in_col:
        summary = recent_summary(
            ctx.service, latest_recent, BoundingBox(*entry.bbox), entry.department
        )
        nrt_det = summary.get("detections")
        nrt_pct = summary.get("percent_of_normal")
    return evaluate_rows(
        rows,
        aoi_id=entry.id,
        region_name=entry.name,
        department=entry.department,
        country=entry.country,
        in_colombia=in_col,
        as_of=as_of,
        nrt_detections=nrt_det,
        nrt_percent_of_normal=nrt_pct,
    )


def _alert_sort_key(item: AlertItem) -> tuple[int, float, float, str]:
    return (-item.severity_rank, -item.z_score, -item.anomaly_ratio, item.region_name)


def _build_alerts_overview(
    ctx: _EmberContext, *, as_of: date | None = None
) -> AlertsOverviewResponse:
    latest_recent = ctx.recent_src.get() if ctx.recent_src is not None else None
    country_items: list[AlertItem] = []
    seen_countries: set[str] = set()
    colombia_items: list[AlertItem] = []

    for entry in ctx.aoi_ordered:
        if entry.kind == "colombia_all":
            if "Colombia" not in seen_countries:
                seen_countries.add("Colombia")
                country_items.append(
                    _evaluate_entry_alert(ctx, entry, as_of=as_of, latest_recent=latest_recent)
                )
        elif entry.kind == "country" and entry.country is not None:
            if entry.country in seen_countries:
                continue
            seen_countries.add(entry.country)
            country_items.append(
                _evaluate_entry_alert(ctx, entry, as_of=as_of, latest_recent=latest_recent)
            )
        elif entry.kind == "department":
            colombia_items.append(
                _evaluate_entry_alert(ctx, entry, as_of=as_of, latest_recent=latest_recent)
            )

    country_items.sort(key=_alert_sort_key)
    colombia_items.sort(key=_alert_sort_key)
    return AlertsOverviewResponse(countries=country_items, colombia=colombia_items)


def _register_intel_routes(app: FastAPI, ctx: _EmberContext, build_cal: Any) -> None:
    @lru_cache(maxsize=4)
    def _cached_overview(
        as_of_key: date | None, recent_stamp: str | None
    ) -> AlertsOverviewResponse:
        _ = recent_stamp
        return _build_alerts_overview(ctx, as_of=as_of_key)

    @lru_cache(maxsize=128)
    def _cached_alert(
        entry_id: str, as_of_key: date | None, recent_stamp: str | None
    ) -> AlertItem:
        _ = recent_stamp
        entry = _resolve_aoi_id(entry_id, ctx.aoi_by_id)
        if entry is None:  # pragma: no cover - validated before cache lookup
            raise HTTPException(status_code=404, detail=f"Unknown AOI: {entry_id}")
        latest = ctx.recent_src.get() if ctx.recent_src is not None else None
        return _evaluate_entry_alert(ctx, entry, as_of=as_of_key, latest_recent=latest)

    @app.get("/api/anomalies")
    def api_anomalies(aoi: str = Query(max_length=120)) -> list[dict[str, Any]]:
        cal = build_cal(aoi, "2000-01-01", date.today().isoformat(), "month", _recent_stamp(ctx))
        return _detect_anomalies_from_cells(cal["cells"])

    @app.get("/api/alerts/overview", response_model=AlertsOverviewResponse)
    def api_alerts_overview(
        as_of: Annotated[date | None, Query()] = None,
    ) -> AlertsOverviewResponse:
        return _cached_overview(as_of, _recent_stamp(ctx))

    @app.get("/api/alerts", response_model=AlertItem)
    def api_alerts(
        aoi: str = Query(max_length=120),
        as_of: Annotated[date | None, Query()] = None,
    ) -> AlertItem:
        entry = _resolve_aoi_id(aoi, ctx.aoi_by_id)
        if entry is None:
            raise HTTPException(status_code=404, detail=f"Unknown AOI: {aoi}")
        return _cached_alert(entry.id, as_of, _recent_stamp(ctx))

    @app.get("/api/satellites/tle")
    def api_satellites_tle() -> list[dict[str, Any]]:
        return FIRE_SATELLITES_TLE

    @app.post("/api/analyst")
    def api_analyst(req: AnalystRequest) -> StreamingResponse:
        entry = _resolve_aoi_id(req.aoi_id, ctx.aoi_by_id)
        if entry is None:
            raise HTTPException(status_code=404, detail=f"Unknown AOI: {req.aoi_id}")
        cal = build_cal(
            entry.id, "2000-01-01", date.today().isoformat(), "month", _recent_stamp(ctx)
        )
        rows, ratio, in_col = _rows_for_entry(ctx, entry)
        alert = evaluate_rows(
            rows,
            aoi_id=entry.id,
            region_name=entry.name,
            department=entry.department,
            country=entry.country,
            in_colombia=in_col,
        )
        anomalies = _detect_anomalies_from_cells(cal["cells"])
        text, highlights = _compose_analyst_reply(
            entry,
            cal["cells"],
            ratio,
            alert=alert,
            anomalies=anomalies,
            question=req.question,
            lang=req.lang,
        )

        def _stream() -> Iterator[str]:
            words = text.split(" ")
            for i in range(0, len(words), 3):
                chunk = " ".join(words[i : i + 3])
                if i + 3 < len(words):
                    chunk += " "
                yield f"data: {json.dumps({'delta': chunk})}\n\n"
                time.sleep(0.01)
            yield f"data: {json.dumps({'highlights': highlights})}\n\n"

        return StreamingResponse(_stream(), media_type="text/event-stream")


def register_ember_routes(
    app: FastAPI,
    *,
    service: CalendarService,
    countries: CountryCalendars,
    department_collection: dict[str, Any],
    world_collection: Mapping[str, list[dict[str, Any]]],
    recent_src: RecentSource | None,
    data_dir: Path,
    firms: FirmsHotspots | None = None,
) -> None:
    """Register unified /api/* endpoints backed by real NASA FIRMS archives."""
    aoi_by_id, aoi_ordered = _build_aoi_index(department_collection, world_collection, countries)
    export_path = getattr(service, "export_path", None)
    parquet_path = export_path or (data_dir / PROCESSED_DETECTIONS)
    ctx = _EmberContext(
        service=service,
        countries=countries,
        aoi_by_id=aoi_by_id,
        aoi_ordered=aoi_ordered,
        recent_src=recent_src,
        parquet_path=parquet_path,
        export_path=export_path,
        has_parquet=parquet_path.exists(),
        firms=firms,
        department_collection=department_collection,
        world_collection=world_collection,
    )

    @lru_cache(maxsize=64)
    def _mean_frp(aoi_key: str, resolution: Resolution) -> dict[date, float]:
        entry = _resolve_aoi_id(aoi_key, ctx.aoi_by_id)
        if entry is None:
            return {}
        return _compute_mean_frp_by_date(
            ctx.service.detections, entry, resolution, ctx.parquet_path, ctx.has_parquet
        )

    @lru_cache(maxsize=64)
    def _build_calendar_payload(
        aoi_id: str,
        from_str: str,
        to_str: str,
        resolution: Resolution,
        recent_stamp: str | None = None,
    ) -> dict[str, Any]:
        _ = recent_stamp
        entry = _resolve_aoi_id(aoi_id, ctx.aoi_by_id)
        if entry is None:
            raise HTTPException(status_code=404, detail=f"Unknown AOI: {aoi_id}")
        try:
            req_from = date.fromisoformat(from_str)
            req_to = date.fromisoformat(to_str)
        except ValueError as exc:
            raise HTTPException(
                status_code=422, detail="Invalid date format; use YYYY-MM-DD."
            ) from exc
        if req_from > req_to:
            raise HTTPException(status_code=422, detail="`from` must not be after `to`.")

        if entry.kind in {"colombia_all", "colombia_box", "department"}:
            cells, ratio = _colombia_calendar_cells(
                ctx.service,
                entry,
                req_from=req_from,
                req_to=req_to,
                resolution=resolution,
                frp_map=_mean_frp(entry.id, resolution),
                recent_src=ctx.recent_src,
            )
            eff_res: Resolution = resolution
            dataset_tag: str = ctx.service.dataset
        else:
            monthly_df, ratio = _monthly_frame_for_country_aoi(
                entry, ctx.countries, ctx.service.sensor_ratio
            )
            cells = _global_calendar_cells(monthly_df, ratio, ctx.countries, req_from, req_to)
            eff_res = "month"
            dataset_tag = "firms-global-monthly"

        _assign_log_z_scores(cells, eff_res)
        clim = _build_climatology(cells, eff_res)
        return {
            "aoi": {"id": entry.id, "name": entry.name, "bbox": list(entry.bbox)},
            "resolution": eff_res,
            "cells": cells,
            "climatology": clim,
            "meta": {
                "method": (
                    f"MODIS-equivalent inverse-variance blend (k={ratio.ratio:.2f}, "
                    f"IQR {ratio.q25:.2f}-{ratio.q75:.2f}, {ratio.overlap_months} overlap months)"
                ),
                "version": "1.0.0",
                "ratio": round(ratio.ratio, 3),
                "overlapMonths": ratio.overlap_months,
                "dataset": dataset_tag,
            },
        }

    _register_calendar_and_hotspot_routes(app, ctx, _build_calendar_payload)

    _register_area_routes(app, ctx)
    _register_intel_routes(app, ctx, _build_calendar_payload)
