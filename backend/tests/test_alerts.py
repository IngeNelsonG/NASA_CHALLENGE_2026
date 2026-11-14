"""Tests for the deterministic unusual-trend alert engine and institutional authority routing."""

from datetime import date
from pathlib import Path

import pandas as pd
from fastapi.testclient import TestClient

from brasa.alerts.authorities import COLOMBIA_CAR_BY_DEPARTMENT, get_authorities_for_aoi
from brasa.alerts.detector import evaluate_rows, summarize_alerts
from brasa.api.app import create_app
from brasa.api.service import CalendarService, CountryCalendars
from brasa.config import Settings
from brasa.ingestion.boundaries import load_departments

DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def test_all_33_colombian_departments_have_statutory_authorities() -> None:
    collection = load_departments(DATA_DIR / "context" / "colombia_departments.geojson")
    dept_names = {f["properties"]["name"] for f in collection["features"]}
    assert len(dept_names) == 33
    for name in dept_names:
        assert name in COLOMBIA_CAR_BY_DEPARTMENT, f"Missing CAR mapping for {name}"
        authorities = get_authorities_for_aoi(department=name, in_colombia=True)
        levels = {a.level for a in authorities}
        assert "national" in levels
        assert "departmental" in levels
        assert "regional_environmental" in levels
        codes = {a.code for a in authorities}
        assert {"UNGRD", "IDEAM", "DNBC"}.issubset(codes)


def _synthetic_history(
    feb_last_value: float, *, oni: float | None = 0.0
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for yr in range(2010, 2025):
        for mo in range(1, 13):
            is_feb = mo == 2
            base = 40.0 if is_feb else 5.0
            val = feb_last_value if (yr == 2024 and is_feb) else base + ((yr + mo) % 5)
            rows.append(
                {
                    "month": pd.Timestamp(f"{yr}-{mo:02d}-01"),
                    "harmonized": val,
                    "climatology_median": 42.0 if is_feb else 7.0,
                    "climatology_q25": 40.0 if is_feb else 5.5,
                    "climatology_q75": 45.0 if is_feb else 8.5,
                    "robust_z": (val - 42.0) / 3.5 if is_feb else (val - 7.0) / 2.0,
                    "oni": oni if (yr == 2024 and is_feb) else 0.0,
                }
            )
    # Trim after Feb 2024 so Feb 2024 is the evaluated reference month
    return [r for r in rows if r["month"] <= pd.Timestamp("2024-02-01")]


def test_evaluate_rows_classifies_normal_and_critical_deterministically() -> None:
    normal = evaluate_rows(
        _synthetic_history(42.0, oni=0.1),
        aoi_id="co-meta",
        region_name="Meta",
        department="Meta",
        country="Colombia",
    )
    assert normal.severity == "NORMAL"
    assert normal.severity_rank == 0
    assert any(a.code == "CORMACARENA" for a in normal.authorities)

    critical = evaluate_rows(
        _synthetic_history(380.0, oni=1.6),
        aoi_id="co-meta",
        region_name="Meta",
        department="Meta",
        country="Colombia",
    )
    assert critical.severity == "CRITICAL"
    assert critical.severity_rank == 3
    assert critical.enso_phase == "EL_NINO"
    assert critical.z_score >= 2.0
    assert critical.anomaly_ratio > 8.0
    assert any(a.code == "CORMACARENA" for a in critical.authorities)
    assert any("PMU" in act for act in critical.recommended_actions_es)


def test_summarize_alerts_ranks_critical_above_normal() -> None:
    crit = evaluate_rows(
        _synthetic_history(320.0, oni=1.2),
        aoi_id="co-vichada",
        region_name="Vichada",
        department="Vichada",
    )
    norm = evaluate_rows(
        _synthetic_history(41.0),
        aoi_id="co-boyaca",
        region_name="Boyacá",
        department="Boyacá",
    )
    resp = summarize_alerts([norm, crit], min_severity="NORMAL")
    assert resp.critical_count == 1
    assert resp.active_alerts == 1
    assert resp.alerts[0].aoi_id == "co-vichada"


def test_api_v1_alerts_endpoint_scan_and_filter() -> None:
    settings = Settings(environment="test", data_dir=str(DATA_DIR))
    depts = load_departments(DATA_DIR / "context" / "colombia_departments.geojson")["features"]
    service = CalendarService.from_sample_data(departments=depts)
    empty_monthly = pd.DataFrame(columns=["country", "month", "sensor", "count"])
    countries = CountryCalendars.from_monthly(empty_monthly)
    client = TestClient(create_app(settings, service=service, countries=countries))

    all_res = client.get("/api/v1/alerts")
    assert all_res.status_code == 200
    body = all_res.json()
    assert body["scope"] == "colombia-departments"
    assert body["total_evaluated"] == 33
    assert len(body["alerts"]) == 33

    dept_res = client.get("/api/v1/alerts", params={"department": "Boyacá"})
    assert dept_res.status_code == 200
    dept_body = dept_res.json()
    assert dept_body["scope"] == "aoi"
    assert len(dept_body["alerts"]) == 1
    assert any("CORPOBOYACÁ" in a["code"] for a in dept_body["alerts"][0]["authorities"])
    assert dept_body["alerts"][0]["reference_month"] <= date.today().isoformat()


def test_evaluate_rows_falls_back_to_recent_oni_within_3_months() -> None:
    rows = _synthetic_history(45.0, oni=None)
    # _synthetic_history ends at 2024-02-01 (with oni=None). Put ONI on 2023-12-01 (2 months prior).
    for r in rows:
        if r["month"] == pd.Timestamp("2023-12-01"):
            r["oni"] = 1.85
        elif r["month"] > pd.Timestamp("2023-12-01"):
            r["oni"] = None

    recent = evaluate_rows(
        rows,
        aoi_id="co-meta",
        region_name="Meta",
        department="Meta",
        country="Colombia",
    )
    assert recent.oni_value == 1.85
    assert recent.enso_phase == "EL_NINO"

    # When the only non-null ONI is > 3 months older than reference month, phase stays UNKNOWN.
    stale_rows = [dict(r) for r in rows]
    for r in stale_rows:
        if r["month"] > pd.Timestamp("2023-10-01"):
            r["oni"] = None
        elif r["month"] == pd.Timestamp("2023-10-01"):
            r["oni"] = 1.85

    stale = evaluate_rows(
        stale_rows,
        aoi_id="co-meta",
        region_name="Meta",
        department="Meta",
        country="Colombia",
    )
    assert stale.oni_value is None
    assert stale.enso_phase == "UNKNOWN"
