"""Integration tests for the unified /api/* compatibility endpoints (ember_routes)."""

from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from brasa.api.app import create_app
from brasa.api.service import CalendarService, CountryCalendars
from brasa.config import Settings
from brasa.ingestion.boundaries import load_departments

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


def test_aoi_search_returns_colombian_departments_and_orinoquia(
    ember_client: TestClient,
) -> None:
    r1 = ember_client.get("/api/aoi/search", params={"q": "boyaca"})
    assert r1.status_code == 200
    ids = [item["id"] for item in r1.json()]
    assert "co-boyaca" in ids

    r2 = ember_client.get("/api/aoi/search", params={"q": "orinoquia"})
    assert r2.status_code == 200
    assert r2.json()[0]["id"] == "co-orinoquia"


def test_calendar_modis_equivalent_contract_and_hotspots_range(
    ember_client: TestClient,
) -> None:
    cal = ember_client.get(
        "/api/calendar",
        params={"aoi": "co", "from": "2000-01-01", "to": "2016-12-31", "resolution": "month"},
    )
    assert cal.status_code == 200
    body = cal.json()
    assert body["aoi"]["id"] == "co"
    assert len(body["climatology"]) == 12
    # Pre-MODIS launch cell (Jan 2000) must be null, never 0
    jan2000 = body["cells"][0]
    assert jan2000["date"] == "2000-01-01"
    assert jan2000["modis"] is None
    assert jan2000["harmonized"] is None
    # Active cell inside sample span (Feb 2012) must carry MODIS-eq CI
    feb2012 = next(c for c in body["cells"] if c["date"] == "2012-02-01")
    assert feb2012["harmonized"] is not None
    assert feb2012["harmonizedLow"] <= feb2012["harmonized"] <= feb2012["harmonizedHigh"]

    # Range query for hotspots returns real detections inside dates
    hs = ember_client.get(
        "/api/hotspots",
        params={"bbox": "-79,-4,-66,13", "from": "2012-01-01", "to": "2012-12-31", "sensor": "all"},
    )
    assert hs.status_code == 200
    points = hs.json()
    assert len(points) > 0
    required = {"lat", "lon", "sensor", "satellite", "acqTime", "frp", "confidence", "daynight"}
    assert required.issubset(points[0].keys())


def test_anomalies_alerts_tle_and_deterministic_analyst_sse(ember_client: TestClient) -> None:
    assert ember_client.get("/api/anomalies", params={"aoi": "co"}).status_code == 200

    alert = ember_client.get("/api/alerts", params={"aoi": "co"})
    assert alert.status_code == 200
    assert alert.json()["protocol"] == "CAP-1.2-deterministic"

    tles = ember_client.get("/api/satellites/tle")
    assert tles.status_code == 200
    assert len(tles.json()) == 5

    sse = ember_client.post(
        "/api/analyst",
        json={"aoiId": "co", "question": "¿Cuáles son los meses críticos?", "lang": "es"},
    )
    assert sse.status_code == 200
    assert "text/event-stream" in sse.headers["content-type"]
    assert '"delta":' in sse.text
    assert '"highlights":' in sse.text


def test_alerts_overview_returns_country_and_departmental_lists(
    ember_client: TestClient,
) -> None:
    res = ember_client.get("/api/alerts/overview")
    assert res.status_code == 200
    body = res.json()
    assert "countries" in body
    assert "colombia" in body
    assert any(c["aoi_id"] == "co" for c in body["countries"])
    assert len(body["colombia"]) == 33


def test_aoi_at_colombia_returns_co(ember_client: TestClient) -> None:
    res = ember_client.get("/api/aoi/at", params={"lat": 4.65, "lon": -74.08})
    assert res.status_code == 200
    body = res.json()
    assert body["id"] == "co"
    assert len(body["bbox"]) == 4


def test_aoi_at_ocean_returns_404(ember_client: TestClient) -> None:
    res = ember_client.get("/api/aoi/at", params={"lat": 0.0, "lon": -30.0})
    assert res.status_code == 404


def test_aoi_at_out_of_range_returns_422(ember_client: TestClient) -> None:
    res = ember_client.get("/api/aoi/at", params={"lat": 95.0, "lon": 0.0})
    assert res.status_code == 422


def test_point_in_geometry_respects_hole() -> None:
    from brasa.api.ember_routes import _point_in_geometry

    poly = {
        "type": "Polygon",
        "coordinates": [
            [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]],
            [[3.0, 3.0], [7.0, 3.0], [7.0, 7.0], [3.0, 7.0], [3.0, 3.0]],
        ],
    }
    assert _point_in_geometry(1.0, 1.0, poly) is True
    assert _point_in_geometry(5.0, 5.0, poly) is False
    assert _point_in_geometry(15.0, 5.0, poly) is False

