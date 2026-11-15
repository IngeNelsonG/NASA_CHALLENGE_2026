"""The virtual `world` area: what the frontend shows while no area is selected."""

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
def world_client() -> TestClient:
    settings = Settings(environment="test", data_dir=str(DATA_DIR))
    depts = load_departments(DATA_DIR / "context" / "colombia_departments.geojson")["features"]
    service = CalendarService.from_sample_data(departments=depts)
    monthly = pd.read_parquet(DATA_DIR / "processed" / "country_monthly.parquet")
    countries = CountryCalendars.from_monthly(monthly)
    return TestClient(create_app(settings, service=service, countries=countries))


def test_world_calendar_sums_every_country(world_client: TestClient) -> None:
    r = world_client.get(
        "/api/calendar",
        params={"aoi": "world", "from": "2019-01-01", "to": "2019-12-31", "resolution": "day"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["aoi"]["id"] == "world"
    assert body["resolution"] == "month"  # the global archive is monthly
    cells = body["cells"]
    assert len(cells) == 12
    assert all(c["modis"] is not None and c["viirs"] is not None for c in cells)

    monthly = pd.read_parquet(DATA_DIR / "processed" / "country_monthly.parquet")
    aug = monthly[(monthly["month"] == "2019-08-01") & (monthly["sensor"] == "MODIS")]
    assert cells[7]["modis"] == pytest.approx(float(aug["count"].sum()))
    assert body["meta"]["dataset"] == "firms-global-monthly"


def test_world_supports_every_area_endpoint(world_client: TestClient) -> None:
    for path in ("/api/anomalies", "/api/enso", "/api/alerts"):
        assert world_client.get(path, params={"aoi": "world"}).status_code == 200, path
    geom = world_client.get("/api/aoi/geometry", params={"aoi": "world"}).json()
    assert geom["kind"] == "world" and geom["geometry"] is None
    r = world_client.post(
        "/api/analyst", json={"aoiId": "world", "question": "trend?", "lang": "en"}
    )
    assert r.status_code == 200
    assert "highlights" in r.text


def test_world_is_not_a_search_result_or_an_overview_row(world_client: TestClient) -> None:
    hits = world_client.get("/api/aoi/search", params={"q": "world"}).json()
    assert all(h["id"] != "world" for h in hits)
    overview = world_client.get("/api/alerts/overview").json()
    assert all(item["aoi_id"] != "world" for item in overview["countries"] + overview["colombia"])


def test_cors_origin_regex_admits_preview_deployments() -> None:
    settings = Settings(
        environment="test",
        data_dir=str(DATA_DIR),
        cors_allowed_origins=["https://nasachallenge2026.vercel.app"],
        cors_allowed_origin_regex=r"https://nasachallenge2026(-[a-z0-9-]+)?\.vercel\.app",
    )
    client = TestClient(create_app(settings))
    for origin, allowed in (
        ("https://nasachallenge2026.vercel.app", True),
        ("https://nasachallenge2026-git-main-team.vercel.app", True),
        ("https://evil.example.com", False),
    ):
        r = client.get("/health", headers={"Origin": origin})
        assert (r.headers.get("access-control-allow-origin") == origin) is allowed, origin
