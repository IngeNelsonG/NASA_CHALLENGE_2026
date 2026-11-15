from datetime import date
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from brasa.api.app import create_app
from brasa.api.hotspot_sources import (
    FIRMS_MAX_SPAN_DAYS,
    FirmsHotspots,
    areas_source,
    hotspot_source,
    merge_geometries,
    normalize_firms_frame,
    parse_areas,
)
from brasa.api.service import CalendarService, CountryCalendars
from brasa.config import Settings
from brasa.domain.models import BoundingBox, InvalidBoundingBoxError
from brasa.ingestion.boundaries import load_departments
from brasa.ingestion.firms_client import FirmsSource

INSIDE_COLOMBIA = BoundingBox(-74.0, 4.0, -72.0, 6.0)
ARGENTINA = BoundingBox(-73.6, -55.1, -53.6, -21.8)
CROSSES_BORDER = BoundingBox(-70.0, 5.0, -60.0, 10.0)
DATA_DIR = Path(__file__).resolve().parents[1] / "data"


@pytest.fixture(scope="module")
def ember_client() -> TestClient:
    settings = Settings(environment="test", data_dir=str(DATA_DIR))
    depts = load_departments(DATA_DIR / "context" / "colombia_departments.geojson")["features"]
    service = CalendarService.from_sample_data(departments=depts)
    countries = CountryCalendars.from_monthly(
        pd.DataFrame(columns=["country", "month", "sensor", "count"])
    )
    return TestClient(create_app(settings, service=service, countries=countries))


def test_source_is_archive_inside_colombia_even_with_firms() -> None:
    d = date(2024, 1, 1)
    assert hotspot_source(INSIDE_COLOMBIA, d, d, firms_available=True) == "archive"


def test_source_outside_colombia_depends_on_key_and_span() -> None:
    d = date(2024, 1, 1)
    long_end = date.fromordinal(d.toordinal() + FIRMS_MAX_SPAN_DAYS)
    assert hotspot_source(ARGENTINA, d, d, firms_available=True) == "firms"
    assert hotspot_source(ARGENTINA, d, long_end, firms_available=True) == "too_long"
    assert hotspot_source(ARGENTINA, d, d, firms_available=False) == "none"
    assert hotspot_source(CROSSES_BORDER, d, d, firms_available=False) == "partial"


def test_normalize_keeps_confident_rows_and_names_satellites() -> None:
    raw = pd.DataFrame(
        {
            "latitude": [-30.0, -31.0, -32.0, -33.0],
            "longitude": [-64.0, -64.5, -65.0, -65.5],
            "acq_date": ["2024-08-01"] * 4,
            "acq_time": [1405, 1410, 230, 1500],
            "satellite": ["A", "T", "N", "N20"],
            "confidence": ["80", "10", "h", "l"],
            "frp": [12.5, 3.0, 4.0, 1.0],
            "sensor": ["MODIS", "MODIS", "VIIRS", "VIIRS"],
        }
    )
    out = normalize_firms_frame(raw)
    assert list(out["satellite"]) == ["Aqua", "Suomi NPP"]  # low-confidence rows dropped
    assert list(out["sensor"]) == ["MODIS", "VIIRS"]
    assert out["acq_date"].dtype.kind == "M"


class _FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[FirmsSource, int]] = []

    def fetch_area(
        self, source: FirmsSource, area: BoundingBox, start: date, day_range: int = 1
    ) -> pd.DataFrame:
        self.calls.append((source, day_range))
        if source is FirmsSource.VIIRS_SNPP_SP:
            raise RuntimeError("FIRMS down")  # one failing source must not sink the rest
        return pd.DataFrame(
            {
                "latitude": [-30.0],
                "longitude": [-64.0],
                "acq_date": [start.isoformat()],
                "acq_time": [1400],
                "satellite": ["A"],
                "confidence": ["90"],
                "frp": [10.0],
                "sensor": [source.sensor.value],
            }
        )


def test_firms_fetch_chunks_by_five_days_degrades_and_caches() -> None:
    fake = _FakeClient()
    firms = FirmsHotspots(fake, today=lambda: date(2026, 11, 14))  # type: ignore[arg-type]
    start, end = date(2024, 8, 1), date(2024, 8, 12)  # 12 days -> chunks of 5, 5, 2
    out = firms.fetch(ARGENTINA, start, end)
    # chunks run in parallel, so only the set of spans is fixed, not their order
    assert sorted(c[1] for c in fake.calls if c[0] is FirmsSource.MODIS_SP) == [2, 5, 5]
    assert len(out) == 3  # MODIS rows only; the VIIRS failures were swallowed
    n_calls = len(fake.calls)
    firms.fetch(ARGENTINA, start, end)
    assert len(fake.calls) == n_calls  # second call served from the cache


def test_recent_days_use_near_real_time_sources() -> None:
    fake = _FakeClient()
    firms = FirmsHotspots(fake, today=lambda: date(2026, 11, 14))  # type: ignore[arg-type]
    firms.fetch(ARGENTINA, date(2026, 11, 1), date(2026, 11, 1))
    assert {c[0] for c in fake.calls} == {FirmsSource.MODIS_NRT, FirmsSource.VIIRS_SNPP_NRT}


def test_merge_geometries() -> None:
    square = [[[0, 0], [1, 0], [1, 1], [0, 0]]]
    merged = merge_geometries(
        [
            {"type": "Polygon", "coordinates": square},
            {"type": "MultiPolygon", "coordinates": [square, square]},
            None,
        ]
    )
    assert merged == {"type": "MultiPolygon", "coordinates": [square, square, square]}
    assert merge_geometries([None]) is None


def test_geometry_and_coverage_endpoints(ember_client: TestClient) -> None:
    dept = ember_client.get("/api/aoi/geometry", params={"aoi": "co-boyaca"})
    assert dept.status_code == 200
    assert dept.json()["geometry"]["type"] in {"Polygon", "MultiPolygon"}

    orinoquia = ember_client.get("/api/aoi/geometry", params={"aoi": "co-orinoquia"}).json()
    assert orinoquia["geometry"]["type"] == "MultiPolygon"
    assert len(orinoquia["geometry"]["coordinates"]) >= 4  # Arauca, Casanare, Meta, Vichada

    country = ember_client.get("/api/aoi/geometry", params={"aoi": "co"}).json()
    assert country["kind"] == "colombia_all"
    assert country["geometry"] is None  # the client draws countries itself

    assert ember_client.get("/api/aoi/geometry", params={"aoi": "nope"}).status_code == 404

    cov = ember_client.get(
        "/api/hotspots/coverage",
        params={"bbox": "-73.6,-55.1,-53.6,-21.8", "from": "2024-08-01", "to": "2024-08-31"},
    ).json()
    assert cov == {"source": "none", "firmsConfigured": False, "maxDays": FIRMS_MAX_SPAN_DAYS}


def test_parse_areas_splits_at_the_antimeridian() -> None:
    assert parse_areas("-74,2,-67,7") == [BoundingBox(-74, 2, -67, 7)]
    # Russia is stored unwrapped (east 191): two boxes, one on each side of 180
    assert parse_areas("19.6,41.2,191.0,81.8") == [
        BoundingBox(19.6, 41.2, 180.0, 81.8),
        BoundingBox(-180.0, 41.2, -169.0, 81.8),
    ]
    # an area wholly past 180 is shifted back
    assert parse_areas("181,-20,185,-15") == [BoundingBox(-179, -20, -175, -15)]
    for bad in ("1,2,3", "a,b,c,d", "10,0,5,1", "170,0,600,1"):
        with pytest.raises(InvalidBoundingBoxError):
            parse_areas(bad)


def test_areas_source_reports_the_least_complete_part() -> None:
    day = date(2024, 8, 1)
    year_end = date(2024, 12, 31)
    assert areas_source([INSIDE_COLOMBIA], day, year_end, firms_available=True) == "archive"
    assert areas_source([INSIDE_COLOMBIA, ARGENTINA], day, day, firms_available=True) == "firms"
    assert (
        areas_source([INSIDE_COLOMBIA, ARGENTINA], day, year_end, firms_available=True)
        == "too_long"
    )


def test_day_inside_a_cached_month_is_cut_from_it() -> None:
    fake = _FakeClient()
    firms = FirmsHotspots(fake, today=lambda: date(2026, 11, 14))  # type: ignore[arg-type]
    month = firms.fetch(ARGENTINA, date(2024, 8, 1), date(2024, 8, 31))
    n_calls = len(fake.calls)
    day = firms.fetch(ARGENTINA, date(2024, 8, 6), date(2024, 8, 6))
    assert len(fake.calls) == n_calls  # no new request
    assert len(month) == 7  # one MODIS row per 5-day chunk
    assert list(day["acq_date"].dt.date) == [date(2024, 8, 6)]


def test_warm_downloads_once_in_the_background() -> None:
    fake = _FakeClient()
    firms = FirmsHotspots(fake, today=lambda: date(2026, 11, 14))  # type: ignore[arg-type]
    start, end = date(2024, 8, 1), date(2024, 8, 10)
    assert firms.warm(ARGENTINA, start, end) is True
    out = firms.fetch(ARGENTINA, start, end)  # waits for, or reuses, the warm-up download
    assert len(out) == 2
    assert len(fake.calls) == 4  # 2 chunks x 2 sources, downloaded once
    assert firms.warm(ARGENTINA, start, end) is False  # already cached


def test_hotspot_endpoints_accept_areas_across_the_antimeridian(
    ember_client: TestClient,
) -> None:
    params = {"bbox": "19.6,41.2,191.0,81.8", "from": "2024-08-01", "to": "2024-08-31"}
    assert ember_client.get("/api/hotspots", params=params).json() == []
    cov = ember_client.get("/api/hotspots/coverage", params=params)
    assert cov.status_code == 200
    assert cov.json()["source"] == "none"
    assert ember_client.post("/api/hotspots/warm", params=params).json() == {"queued": False}
    bad = {**params, "from": "2024-09-01"}
    assert ember_client.get("/api/hotspots/coverage", params=bad).status_code == 422
