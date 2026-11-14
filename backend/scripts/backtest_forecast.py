"""Backtest the fire outlook and write its weights to data/context/forecast_model.json.

Rolling origin: every year Y from 2010 to the last full year is predicted by a model fitted on the
years before Y only, with a climatology from those years only. Two references:
- climatology: always the training share of above-normal months (about 1/3);
- persistence: the same regression with last month's anomaly alone.

Brier skill is 1 - Brier(model) / Brier(climatology): 0 = no better than the calendar, 1 = perfect.

Usage (from backend/): uv run python scripts/backtest_forecast.py
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd

from brasa.api.service import CalendarService
from brasa.harmonization.forecast import (
    FEATURES,
    LEADS,
    auc,
    brier,
    climatology,
    features,
    fit_logistic,
    last_complete_month,
    monthly_panel,
    predict,
)

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
MODEL_FILE = DATA_DIR / "context" / "forecast_model.json"
FIRST_YEAR = 2001  # first full year of the archive (MODIS starts in November 2000)
FIRST_TEST_YEAR = 2010
ALERT = 0.5  # the probability at which the outlook calls a month likely above normal
CASES = ("2010-01", "2016-01", "2020-03", "2024-01", "2024-02", "2025-01")


def backtest(panel: pd.DataFrame, oni: dict, lead: int, last_year: int) -> pd.DataFrame:
    folds = []
    for year in range(FIRST_TEST_YEAR, last_year + 1):
        rows = features(panel, climatology(panel, (FIRST_YEAR, year - 1)), oni, lead)
        rows = rows.dropna(subset=["y"])
        train = rows[rows["target"].dt.year < year]
        test = rows[rows["target"].dt.year == year].copy()
        test["model"] = predict(fit_logistic(train, train["y"]), test)
        test["persistence"] = predict(fit_logistic(train, train["y"], ["a0"]), test, ["a0"])
        test["climatology"] = train["y"].mean()
        folds.append(test)
    return pd.concat(folds, ignore_index=True)


def skill(r: pd.DataFrame) -> dict[str, float]:
    y = r["y"].to_numpy()
    reference = brier(r["climatology"].to_numpy(), y)
    return {
        "n": len(r),
        "base_rate": round(float(y.mean()), 3),
        "brier_skill": round(1 - brier(r["model"].to_numpy(), y) / reference, 3),
        "persistence_brier_skill": round(1 - brier(r["persistence"].to_numpy(), y) / reference, 3),
        "auc": round(auc(r["model"].to_numpy(), y), 3),
        "hit_rate_at_half": round(float(y[r["model"] >= ALERT].mean()), 3),
    }


def main() -> None:
    service = CalendarService.from_data_dir(DATA_DIR)
    months = service.department_months
    end = last_complete_month(pd.Timestamp(service.detections["acq_date"].max()))
    panel = monthly_panel(months, end)
    last_year = (end + pd.offsets.MonthBegin(1)).year - 1  # the last full year
    model: dict = {
        "features": list(FEATURES),
        "baseline_years": [FIRST_YEAR, last_year],
        "backtest_years": [FIRST_TEST_YEAR, last_year],
        "leads": {},
    }
    for lead in LEADS:
        r = backtest(panel, service.oni, lead, last_year)
        stats = skill(r)
        print(f"\nLead {lead} month(s): {stats}")
        r["bin"] = pd.cut(r["model"], [0, 0.2, 0.35, 0.5, 0.65, 1])
        print(r.groupby("bin", observed=True)["y"].agg(["mean", "size"]).round(2).T.to_string())
        if lead == 1:
            for case in CASES:
                sub = r[r["target"] == pd.Timestamp(case)].sort_values("model", ascending=False)
                top = ", ".join(
                    f"{d} {p:.0%}{'+' if y else '-'}"
                    for d, p, y in sub[["department", "model", "y"]].head(5).to_numpy()
                )
                print(f"  {case}: {int(sub['y'].sum())}/{len(sub)} above normal; top: {top}")
        rows = features(panel, climatology(panel, (FIRST_YEAR, last_year)), service.oni, lead)
        rows = rows.dropna(subset=["y"])
        weights = fit_logistic(rows, rows["y"])
        model["leads"][str(lead)] = {"weights": np.round(weights, 4).tolist(), **stats}
    MODEL_FILE.write_text(json.dumps(model, indent=2) + "\n", encoding="utf-8")
    print(f"\n-> {MODEL_FILE}")


if __name__ == "__main__":
    main()
