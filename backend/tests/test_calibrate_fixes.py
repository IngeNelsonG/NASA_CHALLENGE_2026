"""Regression tests for audited MODIS/VIIRS harmonization and deterministic explain defaults."""

from pathlib import Path

import pandas as pd
from fastapi.testclient import TestClient
from pydantic import SecretStr

from brasa.api.app import create_app
from brasa.api.service import CalendarService, CountryCalendars
from brasa.config import Settings
from brasa.harmonization.calendar import build_calendar
from brasa.harmonization.calibrate import fit_sensor_ratio, harmonize

DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def test_fit_sensor_ratio_excludes_jan2012_and_preserves_zeros() -> None:
    rows: list[dict[str, object]] = []
    # 2012-01 has artificial 0.25 ratio from partial VIIRS coverage (Jan 20-31 only)
    rows.append({"month": pd.Timestamp("2012-01-01"), "sensor": "MODIS", "count": 400})
    rows.append({"month": pd.Timestamp("2012-01-01"), "sensor": "VIIRS", "count": 100})
    # Clean full overlap months (2012-02 .. 2014-01): exact ratio = 4.0
    for ts in pd.date_range("2012-02-01", "2014-01-01", freq="MS"):
        rows.append({"month": ts, "sensor": "MODIS", "count": 50})
        rows.append({"month": ts, "sensor": "VIIRS", "count": 200})

    monthly = pd.DataFrame(rows)
    ratio = fit_sensor_ratio(monthly)
    assert ratio.overlap_months == 24
    assert ratio.ratio == 4.0

    # Zero-detection month in 2011-06 must be retained as 0.0, not dropped!
    pre = pd.DataFrame(
        [
            {"month": pd.Timestamp("2011-05-01"), "sensor": "MODIS", "count": 10},
            {"month": pd.Timestamp("2011-07-01"), "sensor": "MODIS", "count": 20},
            *rows,
        ]
    )
    harm = harmonize(
        pre, ratio, start_month=pd.Timestamp("2011-05-01"), end_month=pd.Timestamp("2014-01-01")
    )
    june2011 = harm.loc[harm["month"] == pd.Timestamp("2011-06-01")].iloc[0]
    assert june2011["raw_modis"] == 0.0
    assert june2011["harmonized"] == 0.0
    assert june2011["source"] == "MODIS_SCALED"


def test_empirical_bayes_shrinkage_for_small_overlap() -> None:
    rows: list[dict[str, object]] = []
    for ts in pd.date_range("2015-01-01", "2015-06-01", freq="MS"):
        rows.append({"month": ts, "sensor": "MODIS", "count": 10})
        # Local raw ratio = 8.0 over 6 months.
        rows.append({"month": ts, "sensor": "VIIRS", "count": 80})
    monthly = pd.DataFrame(rows)
    shrunk = fit_sensor_ratio(monthly, fallback_ratio=4.0, shrinkage_months=24)
    # 6/24 * 8.0 + 18/24 * 4.0 = 2.0 + 3.0 = 5.0
    assert abs(shrunk.ratio - 5.0) < 0.01


def test_jan2012_transition_preserves_pre20_modis() -> None:
    ratio = fit_sensor_ratio(
        pd.DataFrame(
            [
                {"month": ts, "sensor": "MODIS", "count": 20}
                for ts in pd.date_range("2013-01-01", "2013-12-01", freq="MS")
            ]
            + [
                {"month": ts, "sensor": "VIIRS", "count": 80}
                for ts in pd.date_range("2013-01-01", "2013-12-01", freq="MS")
            ]
        )
    )
    monthly = pd.DataFrame(
        [
            {"month": pd.Timestamp("2012-01-01"), "sensor": "MODIS", "count": 100},
            {"month": pd.Timestamp("2012-01-01"), "sensor": "VIIRS", "count": 150},
        ]
    )
    out = harmonize(monthly, ratio, jan2012_modis_pre20=40.0, jan2012_viirs_post20=150.0)
    # 40 MODIS * 4.0 + 150 VIIRS = 310.0
    assert float(out.iloc[0]["harmonized"]) == 310.0


def test_zero_baseline_surge_flagged_as_anomaly() -> None:
    rows: list[dict[str, object]] = []
    for yr in range(2015, 2024):
        rows.append(
            {
                "month": pd.Timestamp(f"{yr}-06-01"),
                "raw_modis": 0.0,
                "raw_viirs": 0.0 if yr < 2023 else 25.0,
                "harmonized": 0.0 if yr < 2023 else 25.0,
                "source": "VIIRS",
            }
        )
    cal = build_calendar(pd.DataFrame(rows))
    surge = cal.loc[cal["month"] == pd.Timestamp("2023-06-01")].iloc[0]
    assert bool(surge["is_anomaly"]) is True
    assert float(surge["log_z"]) > 1.5


def test_generative_llm_disabled_by_default_even_with_keys() -> None:
    settings = Settings(
        environment="test",
        data_dir=str(DATA_DIR),
        anthropic_api_key=SecretStr("sk-ant-should-not-call"),
    )
    assert settings.enable_generative_llm is False
    service = CalendarService.from_sample_data()
    empty_monthly = pd.DataFrame(columns=["country", "month", "sensor", "count"])
    app = create_app(
        settings,
        service=service,
        countries=CountryCalendars.from_monthly(empty_monthly),
    )
    res = TestClient(app).get("/api/v1/explain", params={"month": "2010-01", "lang": "es"})
    assert res.status_code == 200
    assert res.json()["generated_by"] == "template"
