"""Integration tests for the unified /api/* compatibility endpoints (ember_routes)."""

import json
import math
import re
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from brasa.alerts.detector import _enso_phase, is_enso_relevant
from brasa.api.app import create_app
from brasa.api.ember_routes import (
    _compute_enso_payload,
    _detect_enso_episodes,
    _enso_strength,
    _point_in_geometry,
)
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


def test_aoi_at_antimeridian_country_stored_in_0_360() -> None:
    # The USA geometry crosses the antimeridian and is stored with longitudes in 0..360.
    months = pd.date_range("2018-01-01", periods=36, freq="MS").strftime("%Y-%m-%d")
    countries = CountryCalendars.from_monthly(
        pd.DataFrame(
            [
                {"country": "United States", "month": m, "sensor": s, "count": n}
                for m in months
                for s, n in (("MODIS", 100), ("VIIRS", 300))
            ]
        )
    )
    client = TestClient(
        create_app(
            Settings(environment="test", data_dir=str(DATA_DIR)),
            service=CalendarService.from_sample_data(),
            countries=countries,
        )
    )
    res = client.get("/api/aoi/at", params={"lat": 40.0, "lon": -100.0})
    assert res.status_code == 200
    assert res.json()["id"] == "country:united-states"


def test_aoi_at_ocean_returns_404(ember_client: TestClient) -> None:
    res = ember_client.get("/api/aoi/at", params={"lat": 0.0, "lon": -30.0})
    assert res.status_code == 404


def test_aoi_at_out_of_range_returns_422(ember_client: TestClient) -> None:
    res = ember_client.get("/api/aoi/at", params={"lat": 95.0, "lon": 0.0})
    assert res.status_code == 422


def test_point_in_geometry_respects_hole() -> None:
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


def test_enso_phase_and_strength_thresholds() -> None:
    assert (_enso_phase(0.49), _enso_strength(0.49)) == ("NEUTRAL", None)
    assert (_enso_phase(-0.49), _enso_strength(-0.49)) == ("NEUTRAL", None)
    assert (_enso_phase(0.5), _enso_strength(0.5)) == ("EL_NINO", "weak")
    assert (_enso_phase(0.99), _enso_strength(0.99)) == ("EL_NINO", "weak")
    assert (_enso_phase(1.0), _enso_strength(1.0)) == ("EL_NINO", "moderate")
    assert (_enso_phase(1.49), _enso_strength(1.49)) == ("EL_NINO", "moderate")
    assert (_enso_phase(-1.5), _enso_strength(-1.5)) == ("LA_NINA", "strong")
    assert (_enso_phase(2.0), _enso_strength(2.0)) == ("EL_NINO", "very_strong")
    assert (_enso_phase(None), _enso_strength(None)) == ("UNKNOWN", None)


def test_enso_episode_detection_requires_five_consecutive_months() -> None:
    series = [
        # 4 consecutive months -> NOT an episode
        {"month": "2010-01-01", "oni": 0.6, "z": 0.1},
        {"month": "2010-02-01", "oni": 0.7, "z": 0.2},
        {"month": "2010-03-01", "oni": 0.8, "z": 0.3},
        {"month": "2010-04-01", "oni": 0.6, "z": 0.2},
        {"month": "2010-05-01", "oni": 0.3, "z": 0.0},
        # 5 consecutive months -> El Niño episode
        {"month": "2010-06-01", "oni": 0.5, "z": 0.4},
        {"month": "2010-07-01", "oni": 1.1, "z": 0.6},
        {"month": "2010-08-01", "oni": 1.6, "z": 1.0},
        {"month": "2010-09-01", "oni": 1.2, "z": 0.8},
        {"month": "2010-10-01", "oni": 0.7, "z": 0.4},
        {"month": "2010-11-01", "oni": 0.1, "z": 1.2},
        {"month": "2010-12-01", "oni": -0.2, "z": 0.0},
    ]
    episodes = _detect_enso_episodes(series, lag_months=1)
    assert len(episodes) == 1
    ep = episodes[0]
    assert ep["phase"] == "EL_NINO"
    assert ep["start"] == "2010-06-01"
    assert ep["end"] == "2010-10-01"
    assert ep["peak_oni"] == 1.6
    # Mean over Jun..Nov (extended by lag=1): (0.4+0.6+1.0+0.8+0.4+1.2)/6 = 0.73
    assert ep["fire_z"] == 0.73


def test_enso_lag_selection_detects_shifted_response() -> None:
    # Build 36 months where z(t+2) == oni(t)
    months = pd.date_range("2000-01-01", periods=36, freq="MS").date
    oni_vals = [1.5 * math.sin(i * 0.4) for i in range(36)]
    oni_table = {(d.year, d.month): round(oni_vals[i], 2) for i, d in enumerate(months)}
    cells = [
        {"date": d.isoformat(), "anomalyZ": round(oni_vals[i - 2], 2) if i >= 2 else None}
        for i, d in enumerate(months)
    ]
    payload = _compute_enso_payload(oni_table, cells)
    assert payload["impact"]["lag_months"] == 2
    assert payload["impact"]["r"] is not None
    assert payload["impact"]["r"] >= 0.99
    assert payload["impact"]["n"] >= 24


def test_enso_endpoint_returns_payload_and_404_for_unknown(ember_client: TestClient) -> None:
    res = ember_client.get("/api/enso", params={"aoi": "co"})
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"current", "series", "episodes", "impact", "relevant"}
    assert body["relevant"] is True
    assert body["current"]["phase"] in {"EL_NINO", "LA_NINA", "NEUTRAL", "UNKNOWN"}
    assert len(body["series"]) > 200
    assert body["series"][0]["month"] == "2000-01-01"

    missing = ember_client.get("/api/enso", params={"aoi": "unknown-place-xyz"})
    assert missing.status_code == 404


def test_alerts_regions_and_newsletter_subscribe(
    ember_client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    reg = ember_client.get("/api/alerts/regions", params={"country": "co"})
    assert reg.status_code == 200
    assert len(reg.json()) == 33

    status = ember_client.get("/api/alerts/smtp-status")
    assert status.status_code == 200
    assert "configured" in status.json()

    monkeypatch.setattr(
        "brasa.alerts.newsletter._subscriptions_path",
        lambda _dir: tmp_path / "subs.json",
    )
    sub = ember_client.post(
        "/api/alerts/subscribe",
        json={
            "email": "alerts-test@example.org",
            "name": "Test Team",
            "aoi_id": "co",
            "min_severity": "WATCH",
            "lang": "es",
            "send_immediate_report": True,
        },
    )
    assert sub.status_code == 200
    body = sub.json()
    assert body["email"] == "alerts-test@example.org"
    assert body["aoi_id"] == "co"
    assert (tmp_path / "subs.json").exists()


def test_enso_relevance_false_for_europe_and_true_for_tropics() -> None:
    assert is_enso_relevant(country="Colombia", in_colombia=True) is True
    assert is_enso_relevant(country="Peru", in_colombia=False) is True
    assert is_enso_relevant(country="Spain", in_colombia=False) is False
    assert is_enso_relevant(country="Germany", in_colombia=False) is False
    assert is_enso_relevant(country="Japan", in_colombia=False) is False
    assert is_enso_relevant(bbox=(129.0, 31.0, 146.0, 45.5), in_colombia=False) is False


def test_analyst_spanish_reply_uses_spanish_number_formatting(ember_client: TestClient) -> None:
    res = ember_client.post(
        "/api/analyst",
        json={
            "aoiId": "co",
            "question": "¿Cuáles son los años pico y la calibración?",
            "lang": "es",
        },
    )
    assert res.status_code == 200
    chunks: list[str] = []
    highlights: list[str] = []
    for line in res.text.splitlines():
        if not line.startswith("data: "):
            continue
        payload = json.loads(line[6:])
        if "delta" in payload:
            chunks.append(payload["delta"])
        if "highlights" in payload:
            highlights = payload["highlights"]
    full_reply = "".join(chunks)
    assert full_reply
    assert re.search(r"\d,\d{3}", full_reply) is None
    assert all(re.search(r"\d,\d{3}", h.get("reason", "")) is None for h in highlights)
    assert re.search(r"\d+,\d+", full_reply) is not None

