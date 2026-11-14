import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from typing import Any

import pandas as pd
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import SecretStr

from brasa.api import app as app_module
from brasa.api.app import (
    AI_CALLS_PER_HOUR,
    HEAVY_CONCURRENCY,
    _bounded,
    _limited,
    _pick_summarizer,
    _with_cache,
    create_app,
)
from brasa.api.explain import Summarizer
from brasa.api.schemas import ExplainFacts, Lang
from brasa.api.service import SAMPLE_DATA_PATH, CalendarService, CountryCalendars, outlook
from brasa.config import Settings
from brasa.domain.models import BoundingBox
from brasa.ingestion.boundaries import load_world_subdivisions

# Explicitly keyless so a developer's .env never makes tests hit an AI provider.
TEST_SETTINGS = Settings(
    environment="test",
    anthropic_api_key=None,
    llm_base_url=None,
    llm_api_key=None,
    llm_model=None,
)
SAMPLE_ONI = {(2010, 1): 1.5}
# Two small "countries" with both sensors so each gets its own ratio.
COUNTRY_MONTHLY = pd.DataFrame(
    [
        (country, f"{year}-{month:02d}-01", sensor, count * scale)
        for country, scale in [("Colombia", 1), ("Brazil", 10)]
        for year in range(2010, 2014)
        for month in range(1, 13)
        for sensor, count in [("MODIS", 20 + month), ("VIIRS", 0 if year < 2012 else 80 + month)]
        if count
    ],
    columns=["country", "month", "sensor", "count"],
).assign(month=lambda frame: pd.to_datetime(frame["month"]))


# Brazil split into two states; Mato Grosso has a spike in Aug 2013 (an unusual month).
SUBDIVISION_MONTHLY = pd.DataFrame(
    [
        ("Brazil", state, f"{year}-{month:02d}-01", sensor, count)
        for state in ("Mato Grosso", "Pará")
        for year in range(2010, 2014)
        for month in range(1, 13)
        for sensor, count in [
            ("MODIS", 100 + month + year % 3),
            ("VIIRS", 0 if year < 2012 else 400 + month + year % 3),
        ]
        if count
    ],
    columns=["country", "subdivision", "month", "sensor", "count"],
).assign(month=lambda frame: pd.to_datetime(frame["month"]))
SPIKE = (SUBDIVISION_MONTHLY["subdivision"] == "Mato Grosso") & (
    SUBDIVISION_MONTHLY["month"] == "2013-08-01"
)
SUBDIVISION_MONTHLY.loc[SPIKE, "count"] *= 20


def _app(summarizer: Summarizer | None = None) -> TestClient:
    service = CalendarService.from_sample_data(oni=SAMPLE_ONI)
    countries = CountryCalendars.from_monthly(
        COUNTRY_MONTHLY, oni=SAMPLE_ONI, subdivisions=SUBDIVISION_MONTHLY
    )
    return TestClient(
        create_app(TEST_SETTINGS, service=service, summarizer=summarizer, countries=countries)
    )


@pytest.fixture(scope="module")
def client() -> TestClient:
    return _app()


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_security_headers_present(client: TestClient) -> None:
    response = client.get("/health")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"


def test_calendar_default_area_returns_harmonized_series(client: TestClient) -> None:
    body = client.get("/api/v1/calendar").json()
    assert body["sensor_ratio"] > 1.0  # VIIRS detects more than MODIS
    sources = {month["source"] for month in body["months"]}
    assert sources == {"VIIRS", "MODIS_SCALED"}
    assert body["dataset"] == "synthetic-sample"
    assert body["sensor_ratio_q25"] <= body["sensor_ratio"] <= body["sensor_ratio_q75"]
    assert body["overlap_months"] > 0
    january_2010 = next(m for m in body["months"] if m["month"] == "2010-01-01")
    assert january_2010["oni"] == 1.5
    assert january_2010["climatology_q25"] <= january_2010["climatology_median"]
    assert january_2010["climatology_median"] <= january_2010["climatology_q75"]
    assert body["months"][0]["oni"] is None


def test_calendar_empty_area_returns_no_months(client: TestClient) -> None:
    body = client.get("/api/v1/calendar", params={"bbox": "10,10,11,11"}).json()
    assert body["months"] == []


@pytest.mark.parametrize("bbox", ["1,2,3", "x,y,z,w", "-70,2,-75,6", "1" * 200])
def test_calendar_rejects_invalid_bbox(client: TestClient, bbox: str) -> None:
    assert client.get("/api/v1/calendar", params={"bbox": bbox}).status_code == 422


def test_only_get_is_allowed(client: TestClient) -> None:
    assert client.post("/api/v1/calendar").status_code == 405


def test_docs_disabled_in_production() -> None:
    production = TestClient(
        create_app(
            Settings(environment="production", anthropic_api_key=None),
            service=CalendarService.from_sample_data(),
        )
    )
    assert production.get("/docs").status_code == 404
    assert production.get("/openapi.json").status_code == 404


def test_unhandled_errors_do_not_leak_details() -> None:
    class BrokenService:
        sensor_ratio = None
        department_months = pd.DataFrame()

        def calendar_for(self, _: object) -> list[object]:
            raise RuntimeError("secret internal detail")

    app = create_app(TEST_SETTINGS, service=BrokenService())  # type: ignore[arg-type]
    response = TestClient(app, raise_server_exceptions=False).get("/api/v1/calendar")
    assert response.status_code == 500
    assert "secret internal detail" not in response.text


def test_data_dir_prefers_processed_parquet(tmp_path: Path) -> None:
    sample = pd.read_csv(SAMPLE_DATA_PATH)
    (tmp_path / "processed").mkdir()
    sample.head(len(sample) // 2).to_parquet(tmp_path / "processed" / "detections.parquet")
    assert len(CalendarService.from_data_dir(tmp_path).detections) == len(sample) // 2


def test_data_dir_falls_back_to_sample(tmp_path: Path) -> None:
    assert len(CalendarService.from_data_dir(tmp_path).detections) == len(
        pd.read_csv(SAMPLE_DATA_PATH)
    )


def test_departments_geojson_is_gzipped(client: TestClient) -> None:
    response = client.get("/api/v1/departments", headers={"Accept-Encoding": "gzip"})
    assert response.status_code == 200
    assert response.headers["Content-Encoding"] == "gzip"
    body = response.json()
    assert body["type"] == "FeatureCollection"
    assert len(body["features"]) == 33
    properties = body["features"][0]["properties"]
    assert set(properties) == {"name", "bbox"}
    assert len(properties["bbox"].split(",")) == 4


def test_explain_template_without_llm(client: TestClient) -> None:
    response = client.get("/api/v1/explain", params={"month": "2010-01", "lang": "en"})
    assert response.status_code == 200
    body = response.json()
    assert body["generated_by"] == "template"
    assert body["model"] is None
    assert body["month"] == "2010-01-01"
    assert body["facts"]["oni"] == 1.5
    assert body["facts"]["years_in_record"] == 9
    assert body["facts"]["area_name"] == "Colombia"
    assert body["summary"].startswith("In Colombia, January 2010 had")


def test_explain_uses_summarizer_and_caches() -> None:
    calls: list[tuple[ExplainFacts, Lang]] = []

    def fake(facts: ExplainFacts, lang: Lang) -> tuple[str, str]:
        calls.append((facts, lang))
        return "Resumen.", "claude-test"

    client = _app(fake)
    params = {"month": "2012-03", "bbox": "-79.1,-4.3,-66.8,13.5"}
    first = client.get("/api/v1/explain", params=params).json()
    client.get("/api/v1/explain", params=params)  # same request: cache hit
    assert first["generated_by"] == "ai"
    assert first["model"] == "claude-test"
    assert first["summary"] == "Resumen."
    assert first["lang"] == "es"
    assert len(calls) == 1


def test_explain_falls_back_to_template_when_summarizer_fails() -> None:
    body = _app(lambda _facts, _lang: None).get("/api/v1/explain", params={"month": "2012-03"})
    assert body.json()["generated_by"] == "template"


def test_explain_retries_llm_after_transient_failure() -> None:
    answers: list[tuple[str, str] | None] = [None, ("Resumen.", "claude-test")]
    client = _app(lambda _facts, _lang: answers.pop(0))
    params = {"month": "2012-03"}
    assert client.get("/api/v1/explain", params=params).json()["generated_by"] == "template"
    assert client.get("/api/v1/explain", params=params).json()["generated_by"] == "ai"


def test_explain_month_not_in_series(client: TestClient) -> None:
    assert client.get("/api/v1/explain", params={"month": "1990-01"}).status_code == 404
    empty_area = {"month": "2012-03", "bbox": "10,10,11,11"}
    assert client.get("/api/v1/explain", params=empty_area).status_code == 404


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"month": "2024-13"},
        {"month": "2024-1"},
        {"month": "2024-01-01"},
        {"month": "abcd-ef"},
        {"month": "2024-01", "lang": "fr"},
        {"month": "2024-01", "bbox": "1,2,3"},
    ],
)
def test_explain_rejects_invalid_input(client: TestClient, params: dict[str, str]) -> None:
    assert client.get("/api/v1/explain", params=params).status_code == 422


def test_countries_lists_archive_names_with_totals(client: TestClient) -> None:
    countries = client.get("/api/v1/countries").json()["countries"]
    assert [country["name"] for country in countries] == ["Brazil", "Colombia"]
    assert countries[0]["detections_total"] > countries[1]["detections_total"]


def test_calendar_for_country_uses_its_own_ratio(client: TestClient) -> None:
    body = client.get("/api/v1/calendar", params={"country": "Brazil"}).json()
    assert body["scope"] == "country"
    assert (body["country"], body["bbox"], body["area_name"]) == ("Brazil", None, "Brazil")
    assert body["dataset"] == "firms-archive"
    assert body["sensor_ratio"] > 3.0
    assert body["departments_total"] == 2  # states in the subdivision fixture
    assert {month["source"] for month in body["months"]} == {"VIIRS", "MODIS_SCALED"}
    assert body["months"][0]["anomalous_departments"] == 0


def test_explain_for_country(client: TestClient) -> None:
    params = {"month": "2013-02", "country": "Brazil", "lang": "en"}
    body = client.get("/api/v1/explain", params=params).json()
    assert body["facts"]["area_name"] == "Brazil"
    assert body["facts"]["in_colombia"] is False
    assert "less rain" not in body["summary"]


@pytest.mark.parametrize(
    "params",
    [
        {"country": "Atlantis"},
        {"country": "Brazil", "bbox": "-79.1,-4.3,-66.8,13.5"},
        {"country": "x" * 81},
    ],
)
def test_calendar_rejects_bad_country(client: TestClient, params: dict[str, str]) -> None:
    assert client.get("/api/v1/calendar", params=params).status_code == 422


def _square(name: str, west: float, south: float) -> dict[str, Any]:
    """A 2 deg x 2 deg "department"."""
    east, north = west + 2, south + 2
    ring = [[west, south], [east, south], [east, north], [west, north], [west, south]]
    return {"properties": {"name": name}, "geometry": {"type": "Polygon", "coordinates": [ring]}}


# Four squares over the synthetic Llanos sample act as departments.
SQUARES = [
    _square("SW", -73.5, 3),
    _square("SE", -71.5, 3),
    _square("NW", -73.5, 5),
    _square("NE", -71.5, 5),
]


def test_area_scope_reports_widespread_months_across_departments() -> None:
    service = CalendarService.from_sample_data(oni=SAMPLE_ONI, departments=SQUARES)
    client = TestClient(create_app(TEST_SETTINGS, service=service))
    body = client.get("/api/v1/calendar").json()
    assert (body["scope"], body["area_name"], body["departments_total"]) == ("area", "Colombia", 4)
    months = {month["month"]: month for month in body["months"]}
    assert all(m["anomalous_departments"] is not None for m in months.values())
    widespread = [m for m in months.values() if m["is_widespread_anomaly"]]
    assert widespread, "the synthetic El Nino boosts (2010, 2016) must show up regionally"
    assert all(m["anomalous_departments"] >= 1 for m in widespread)


def test_pick_summarizer_prefers_openai_compatible_then_claude() -> None:
    assert _pick_summarizer(TEST_SETTINGS) is None
    groq = TEST_SETTINGS.model_copy(
        update={
            "llm_base_url": "https://api.groq.com/openai/v1",
            "llm_api_key": SecretStr("k"),
            "llm_model": "m",
            "anthropic_api_key": SecretStr("a"),
        }
    )
    claude = TEST_SETTINGS.model_copy(update={"anthropic_api_key": SecretStr("a")})
    assert _pick_summarizer(groq) is not None
    assert _pick_summarizer(claude) is not None


def test_llm_base_url_must_be_https() -> None:
    with pytest.raises(ValueError, match="https"):
        Settings(llm_base_url="http://insecure.test/v1")


def test_countries_include_iso_code_and_subdivision_count(client: TestClient) -> None:
    countries = {c["name"]: c for c in client.get("/api/v1/countries").json()["countries"]}
    assert countries["Brazil"]["iso_a2"] == "BR"
    assert countries["Brazil"]["subdivisions_total"] == 2
    assert countries["Colombia"]["subdivisions_total"] == 0


def test_calendar_for_subdivision_uses_the_country_ratio(client: TestClient) -> None:
    country = client.get("/api/v1/calendar", params={"country": "Brazil"}).json()
    state = client.get(
        "/api/v1/calendar", params={"country": "Brazil", "subdivision": "Mato Grosso"}
    ).json()
    assert state["scope"] == "subdivision"
    assert (state["country"], state["subdivision"]) == ("Brazil", "Mato Grosso")
    assert state["area_name"] == "Mato Grosso, Brazil"
    assert state["sensor_ratio"] == country["sensor_ratio"]
    assert state["departments_total"] == country["departments_total"] == 2
    spike = next(m for m in state["months"] if m["month"] == "2013-08-01")
    assert spike["is_anomaly"] is True
    assert spike["anomalous_departments"] == 1
    assert spike["is_widespread_anomaly"] is True  # 1 of 2 regions >= 25 %


def test_country_calendar_counts_unusual_regions(client: TestClient) -> None:
    months = client.get("/api/v1/calendar", params={"country": "Brazil"}).json()["months"]
    by_month = {m["month"]: m["anomalous_departments"] for m in months}
    assert by_month["2013-08-01"] == 1
    assert by_month["2013-07-01"] == 0


def test_country_without_subdivisions_has_no_regional_context(client: TestClient) -> None:
    body = client.get("/api/v1/calendar", params={"country": "Colombia"}).json()
    assert body["departments_total"] is None
    assert body["months"][0]["anomalous_departments"] is None


@pytest.mark.parametrize(
    ("params", "detail"),
    [
        ({"subdivision": "Pará"}, "subdivision requires country."),
        ({"country": "Brazil", "subdivision": "Atlantis"}, "Unknown subdivision"),
        ({"country": "Colombia", "subdivision": "Pará"}, "Unknown subdivision"),
        ({"country": "Brazil", "subdivision": "x" * 101}, None),
    ],
)
def test_calendar_rejects_bad_subdivision(
    client: TestClient, params: dict[str, str], detail: str | None
) -> None:
    response = client.get("/api/v1/calendar", params=params)
    assert response.status_code == 422
    if detail:
        assert detail in response.json()["detail"]


def test_subdivisions_map_marks_regions_with_data(client: TestClient) -> None:
    response = client.get("/api/v1/subdivisions", params={"country": "Brazil"})
    assert response.status_code == 200
    features = response.json()["features"]
    assert len(features) > 20  # Brazil's 27 federative units in Natural Earth
    with_data = {f["properties"]["name"] for f in features if f["properties"]["has_data"]}
    assert with_data == {"Mato Grosso", "Pará"}
    assert {"country", "name", "type", "iso_a2"} <= set(features[0]["properties"])


def test_subdivisions_map_rejects_unknown_country(client: TestClient) -> None:
    assert client.get("/api/v1/subdivisions", params={"country": "Atlantis"}).status_code == 422
    assert client.get("/api/v1/subdivisions").status_code == 422


def test_explain_for_subdivision_speaks_of_regions(client: TestClient) -> None:
    body = client.get(
        "/api/v1/explain",
        params={"country": "Brazil", "subdivision": "Mato Grosso", "month": "2013-08"},
    ).json()
    assert body["facts"]["area_name"] == "Mato Grosso, Brazil"
    assert body["facts"]["in_colombia"] is False
    assert "1 de 2 regiones (estados o provincias)" in body["summary"]
    assert "menos lluvias" not in body["summary"]


def test_world_helpers() -> None:
    world = {
        "Kosovo": [{"properties": {"name": "A", "iso_a2": "-99"}}],
        "Brazil": [{"properties": {"name": "Pará", "iso_a2": "BR"}}],
        "France": [{"properties": {"name": n, "iso_a2": "FR"}} for n in ("A", "B")],
        "Reunion": [{"properties": {"name": "Reunion", "iso_a2": "FR"}}],
    }
    assert app_module._iso_codes(world) == {"Brazil": "BR", "France": "FR"}
    maps = app_module._world_maps(world, {"Brazil": {"Pará"}})
    assert b'"has_data":true' in maps["Brazil"]
    assert b'"has_data":false' in maps["Kosovo"]


def test_country_service_reads_subdivisions_from_data_dir(tmp_path: Path) -> None:
    (tmp_path / "processed").mkdir()
    COUNTRY_MONTHLY.to_parquet(tmp_path / "processed" / "country_monthly.parquet")
    SUBDIVISION_MONTHLY.to_parquet(tmp_path / "processed" / "subdivision_monthly.parquet")
    service = CountryCalendars.from_data_dir(tmp_path)
    assert service.subdivision_names() == {"Brazil": {"Mato Grosso", "Pará"}}
    assert service.calendar_for("Brazil", "Atlantis") is None


def test_world_subdivisions_missing_file_is_empty(tmp_path: Path) -> None:
    assert load_world_subdivisions(tmp_path / "missing.geojson") == {}


def test_world_subdivisions_without_a_type_are_regions(tmp_path: Path) -> None:
    """Natural Earth leaves the type empty for Malta, Hong Kong...: the map used to crash."""
    path = tmp_path / "world.geojson"
    features = [
        {"properties": {"country": "Malta", "name": "Valletta", "type": None}, "geometry": None},
        {"properties": {"country": "Brazil", "name": "Pará", "type": "State"}, "geometry": None},
    ]
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    world = load_world_subdivisions(path)
    assert world["Malta"][0]["properties"]["type"] == "Region"
    assert world["Brazil"][0]["properties"]["type"] == "State"


def test_root_points_to_the_docs(client: TestClient) -> None:
    response = client.get("/", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == "/docs"


def test_docs_csp_allows_swagger_only_on_docs(client: TestClient) -> None:
    docs = client.get("/docs").headers["Content-Security-Policy"]
    assert "script-src https://cdn.jsdelivr.net" in docs
    assert "frame-ancestors 'none'" in docs
    api = client.get("/health").headers["Content-Security-Policy"]
    assert api == "default-src 'none'; frame-ancestors 'none'"


def test_root_in_production_has_no_docs_link() -> None:
    settings = TEST_SETTINGS.model_copy(update={"environment": "production"})
    service = CalendarService.from_sample_data(oni=SAMPLE_ONI)
    countries = CountryCalendars.from_monthly(COUNTRY_MONTHLY, oni=SAMPLE_ONI)
    client = TestClient(create_app(settings, service=service, countries=countries))
    assert client.get("/").json() == {"name": "Brasa API", "health": "/health"}
    assert client.get("/docs").status_code == 404


def test_heatmap_for_a_colombian_area(client: TestClient) -> None:
    body = client.get("/api/v1/heatmap", params={"month": "2015-02"}).json()
    assert body["sensor"] == "VIIRS"
    assert body["cell_deg"] == 0.1
    assert body["detections"] == sum(count for _, _, count in body["cells"]) > 0
    counts = [count for _, _, count in body["cells"]]
    assert counts == sorted(counts, reverse=True)  # densest first
    lon, _lat, _ = body["cells"][0]
    assert round((lon / 0.1 - 0.5), 6).is_integer()  # a cell centre
    assert body["peak_day"].startswith("2015-02-")
    assert body["bbox"] == BoundingBox.parse(body["bbox"]).as_firms_area()


def test_heatmap_before_viirs_uses_modis(client: TestClient) -> None:
    body = client.get("/api/v1/heatmap", params={"month": "2011-02"}).json()
    assert body["sensor"] == "MODIS"


def test_heatmap_for_a_country_and_a_subdivision(client: TestClient) -> None:
    country = client.get("/api/v1/heatmap", params={"country": "Brazil", "month": "2013-08"}).json()
    assert (country["cells"], country["cell_deg"], country["peak_day"]) == ([], None, None)
    assert country["sensor"] == "VIIRS"
    assert country["detections"] == 10 * (80 + 8)  # COUNTRY_MONTHLY: Brazil, Aug, VIIRS
    assert [r["name"] for r in country["regions"]] == ["Mato Grosso", "Pará"]  # spike first
    assert country["bbox"] is not None
    state = client.get(
        "/api/v1/heatmap", params={"country": "Brazil", "subdivision": "Pará", "month": "2013-08"}
    ).json()
    assert state["detections"] == country["regions"][1]["count"]
    assert state["regions"] == country["regions"]  # national context
    west, _, east, _ = (float(v) for v in state["bbox"].split(","))
    assert -60 < west < east < -45  # Pará, not all of Brazil


def test_heatmap_month_without_detections_is_empty(client: TestClient) -> None:
    body = client.get("/api/v1/heatmap", params={"month": "1990-01"}).json()
    assert (body["sensor"], body["detections"], body["cells"], body["peak_day"]) == (
        None,
        0,
        [],
        None,
    )


@pytest.mark.parametrize(
    "params",
    [
        {"month": "2015-13"},
        {"month": "2015"},
        {"month": "2015-02", "country": "Atlantis"},
        {"month": "2015-02", "subdivision": "Pará"},
    ],
)
def test_heatmap_rejects_bad_input(client: TestClient, params: dict[str, str]) -> None:
    assert client.get("/api/v1/heatmap", params=params).status_code == 422


def _square(west: float, east: float) -> dict[str, object]:
    ring = [[west, 0], [east, 0], [east, 1], [west, 1], [west, 0]]
    return {"geometry": {"type": "Polygon", "coordinates": [ring]}}


def test_extent_keeps_the_wider_side_of_the_antimeridian() -> None:
    assert app_module._extent([_square(10, 20)]) == "10.000,0.000,20.000,1.000"
    russia = [_square(20, 100), _square(170, 191)]  # Chukotka shifted past 180
    assert app_module._extent(russia) == "20.000,0.000,180.000,1.000"
    usa = [_square(172, 180), _square(235, 293)]  # Aleutians + lower 48, shifted
    assert app_module._extent(usa) == "-180.000,0.000,-67.000,1.000"


def test_heavy_computations_run_a_few_at_a_time() -> None:
    """26 parallel calendars overran the 512 MB host; only HEAVY_CONCURRENCY may compute at once."""
    running, peak, lock = 0, 0, threading.Lock()

    @_bounded
    def work(_: int) -> None:
        nonlocal running, peak
        with lock:
            running += 1
            peak = max(peak, running)
        time.sleep(0.02)
        with lock:
            running -= 1

    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(work, range(24)))
    assert peak == HEAVY_CONCURRENCY


@pytest.fixture(scope="module")
def real_client() -> TestClient:
    """The app on the committed FIRMS archive (departments tagged by polygon)."""
    return TestClient(create_app(TEST_SETTINGS))


def test_department_is_counted_by_its_polygon_not_its_box(real_client: TestClient) -> None:
    department = real_client.get("/api/v1/calendar", params={"department": "Boyacá"}).json()
    assert (department["department"], department["area_name"]) == ("Boyacá", "Boyacá")
    assert department["scope"] == "area"
    box = real_client.get("/api/v1/calendar", params={"bbox": department["bbox"]}).json()
    assert (box["department"], box["area_name"]) == (None, None)  # a box is only a box

    def viirs(body: dict[str, Any]) -> int:
        return sum(month["raw_viirs"] for month in body["months"])

    assert viirs(department) == 8_167
    assert viirs(box) > 5 * viirs(department)  # the box also holds Casanare's plains


def test_department_heatmap_and_explanation_use_the_polygon(real_client: TestClient) -> None:
    params = {"department": "Meta", "month": "2024-02"}
    heat = real_client.get("/api/v1/heatmap", params=params).json()
    ranking = {region["name"]: region["count"] for region in heat["regions"]}
    assert heat["detections"] == ranking["Meta"]  # same polygon for the map and the ranking
    assert heat["cells"] and heat["peak_day"].startswith("2024-02")
    explained = real_client.get("/api/v1/explain", params=params).json()
    assert explained["facts"]["area_name"] == "Meta"
    assert explained["facts"]["raw_viirs"] == heat["detections"]


@pytest.mark.parametrize(
    "params",
    [
        {"department": "Atlantis"},
        {"department": "Meta", "bbox": "-74,3,-73,4"},
        {"department": "Meta", "country": "Colombia"},
        {"department": "x" * 61},
    ],
)
def test_department_parameter_is_validated(real_client: TestClient, params: dict[str, str]) -> None:
    assert real_client.get("/api/v1/calendar", params=params).status_code == 422


def test_hotspots_csv_downloads_the_detections_of_a_search(real_client: TestClient) -> None:
    params = {"department": "Meta", "start": "2024-02-01", "end": "2024-02-29"}
    response = real_client.get("/api/v1/hotspots.csv", params=params)
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    assert response.headers["content-disposition"] == (
        'attachment; filename="brasa-hotspots_2024-02-01_2024-02-29.csv"'
    )
    lines = response.text.strip().splitlines()
    assert lines[0] == "latitude,longitude,acq_date,acq_time,sensor,satellite,frp"
    rows = [line.split(",") for line in lines[1:]]
    assert {row[2][:7] for row in rows} == {"2024-02"}
    assert all(len(row[3]) == 4 and row[3].isdigit() for row in rows)  # HHMM keeps its zeros
    # Same polygon and month as the heat map: VIIRS rows equal its count.
    heat = real_client.get("/api/v1/heatmap", params={"department": "Meta", "month": "2024-02"})
    assert sum(row[4] == "VIIRS" for row in rows) == heat.json()["detections"]
    assert any(row[4] == "MODIS" for row in rows)


def test_hotspots_csv_of_a_box_and_an_empty_search(real_client: TestClient) -> None:
    box = {"bbox": "-74.3,4.4,-73.9,4.9", "start": "2024-01-01", "end": "2024-01-31"}
    rows = real_client.get("/api/v1/hotspots.csv", params=box).text.strip().splitlines()[1:]
    assert rows
    for row in rows:
        lat, lon = float(row.split(",")[0]), float(row.split(",")[1])
        assert 4.4 <= lat <= 4.9 and -74.3 <= lon <= -73.9
    empty = {"bbox": "-74.3,4.4,-73.9,4.9", "start": "1999-01-01", "end": "1999-01-02"}
    response = real_client.get("/api/v1/hotspots.csv", params=empty)
    assert response.status_code == 200
    assert response.text.strip() == "latitude,longitude,acq_date,acq_time,sensor,satellite,frp"


@pytest.mark.parametrize(
    "params",
    [
        {"start": "2024-02-01"},  # end is required
        {"start": "2024-02-30", "end": "2024-03-01"},  # not a date
        {"start": "2024-03-01", "end": "2024-02-01"},  # backwards
        {"start": "2000-01-01", "end": "2025-12-31"},  # all of Colombia, 25 years: too many
        {"start": "2024-01-01", "end": "2024-01-02", "department": "Atlantis"},
        {"start": "2024-01-01", "end": "2024-01-02", "bbox": "1,2,3"},
    ],
)
def test_hotspots_csv_rejects_bad_searches(real_client: TestClient, params: dict[str, str]) -> None:
    response = real_client.get("/api/v1/hotspots.csv", params=params)
    assert response.status_code == 422
    assert "Traceback" not in response.text


def test_hotspots_csv_from_the_sample_keeps_its_columns(client: TestClient) -> None:
    params = {"start": "2015-02-01", "end": "2015-02-03"}
    header = client.get("/api/v1/hotspots.csv", params=params).text.splitlines()[0]
    assert header.startswith("latitude,longitude,acq_date")


def test_only_successful_data_answers_may_be_cached_by_the_browser(client: TestClient) -> None:
    assert client.get("/api/v1/calendar").headers["Cache-Control"] == "public, max-age=3600"
    assert client.get("/api/v1/recent").headers["Cache-Control"] == "public, max-age=300"
    # Errors and everything outside the data API are never stored.
    assert client.get("/api/v1/calendar?bbox=oops").headers["Cache-Control"] == "no-store"
    assert client.get("/health").headers["Cache-Control"] == "no-store"
    explained = client.get("/api/v1/explain", params={"month": "2012-03"})
    assert explained.headers["Cache-Control"] == "no-store"  # may be a fallback template
    assert "Strict-Transport-Security" not in client.get("/health").headers  # not production


def test_production_tells_browsers_to_use_https_only() -> None:
    settings = TEST_SETTINGS.model_copy(update={"environment": "production"})
    service = CalendarService.from_sample_data()
    production = TestClient(create_app(settings, service=service, recent=None))
    assert (
        production.get("/health").headers["Strict-Transport-Security"]
        == "max-age=31536000; includeSubDomains"
    )


def test_ai_summaries_stop_at_the_hourly_budget_and_resume_later() -> None:
    """No pattern of requests can run up the AI bill: past the budget, the template is served."""
    now = [0.0]
    calls: list[int] = []

    def summarizer(facts: ExplainFacts, lang: Lang) -> tuple[str, str]:
        calls.append(1)
        return "summary", "model"

    summarize = _with_cache(summarizer, clock=lambda: now[0])
    facts = ExplainFacts.model_validate(
        {
            "month": "2024-01-01",
            "harmonized": 1.0,
            "raw_modis": 0,
            "raw_viirs": 1,
            "source": "VIIRS",
            "climatology_median": 1.0,
            "climatology_q25": 1.0,
            "climatology_q75": 1.0,
            "robust_z": 0.0,
            "is_anomaly": False,
            "is_critical_month": False,
            "oni": None,
            "rank_in_month_of_year": 1,
            "years_in_record": 1,
            "sensor_ratio": 4.0,
            "area_name": None,
            "percent_of_normal": 100.0,
            "previous_year_harmonized": None,
        }
    )
    for key in range(AI_CALLS_PER_HOUR):
        assert summarize(key, facts, "es") == ("summary", "model")
    assert summarize("one too many", facts, "es") is None  # the caller serves the template
    assert summarize(0, facts, "es") == ("summary", "model")  # cached answers stay free
    assert len(calls) == AI_CALLS_PER_HOUR
    now[0] = 3601.0
    assert summarize("an hour later", facts, "es") == ("summary", "model")


def test_a_busy_server_refuses_instead_of_queueing_forever(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app_module, "HEAVY_WAIT_SECONDS", 0.01)
    release = threading.Event()
    started = threading.Event()

    @_limited(threading.BoundedSemaphore(1))
    def slow() -> str:
        started.set()
        release.wait(timeout=5)
        return "done"

    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(slow)
        assert started.wait(timeout=5)
        with pytest.raises(HTTPException) as refused:
            slow()
        assert refused.value.status_code == 503
        assert refused.value.headers == {"Retry-After": "5"}
        release.set()
        assert first.result(timeout=5) == "done"
    assert slow() == "done"  # the slot was released


def test_outlook_forecasts_the_months_after_the_archive(real_client: TestClient) -> None:
    body = real_client.get("/api/v1/outlook").json()
    assert body["available"] is True
    assert body["dataset"] == "firms-archive"
    issued = date.fromisoformat(body["issued"])
    assert issued.day == 1
    leads = body["leads"]
    assert [lead["lead"] for lead in leads] == [1, 2, 3]
    assert date.fromisoformat(leads[0]["month"]) > issued
    # The backtest beat the calendar alone at every lead (the gain over persistence is not
    # significant, ADR-008, so it is not asserted).
    assert all(lead["brier_skill"] > 0 for lead in leads)
    meta = next(d for d in body["departments"] if d["department"] == "Meta")
    assert len(meta["months"]) == 3
    assert all(0 < m["probability"] < 1 and m["threshold"] >= m["normal"] for m in meta["months"])


def test_outlook_without_a_model_is_unavailable() -> None:
    assert outlook(CalendarService.from_sample_data(oni=SAMPLE_ONI), None) == {"available": False}
