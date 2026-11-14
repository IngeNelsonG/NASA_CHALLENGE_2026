"""Outlook for the coming months: how likely is a department's month to burn above normal?

A logistic regression on what is known at the end of the issue month t:

- `a0`, `a1`, `a2`: the department's anomaly in months t, t-1 and t-2, as log1p(count) minus the
  median log1p(count) of that month of the year. Anomalies persist: this carries most of the skill.
- `oni`: the El Nino index of the season centred on t-1, the latest one published at t.

The target is "month t+lead has more detections than two years in three": above the 2/3 quantile
of that month of the year, so the climatological chance is 1/3. Months whose median is below
`MIN_NORMAL_COUNT` detections are left out: with a handful of fires "above normal" is noise.

Validation (rolling origin, every year 2010-2025 predicted from the years before it only):
scripts/backtest_forecast.py, results in docs/decisions/ADR-008-fire-outlook.md.
"""

from collections.abc import Sequence

import numpy as np
import pandas as pd

from brasa.ingestion.oni import OniTable

FEATURES = ("a0", "a1", "a2", "oni")
ABOVE_NORMAL_QUANTILE = 2 / 3
MIN_NORMAL_COUNT = 5.0
LEADS = (1, 2, 3)
L2_PENALTY = 1.0
NEWTON_STEPS = 25
CONVERGED = 1e-8


def last_complete_month(last_day: pd.Timestamp) -> pd.Timestamp:
    """First day of the last month the data covers to its end."""
    month = last_day.to_period("M")
    if last_day.normalize() < month.end_time.normalize():
        month -= 1
    return month.to_timestamp()


def monthly_panel(series: pd.DataFrame, end: pd.Timestamp) -> pd.DataFrame:
    """Every (department, month) from the first month in `series` to `end`; no detections = 0.

    `series`: columns department, month, harmonized (months without detections may be absent).
    """
    months = pd.date_range(series["month"].min(), end, freq="MS")
    grid = pd.MultiIndex.from_product(
        [sorted(series["department"].unique()), months], names=["department", "month"]
    )
    counts = series.groupby(["department", "month"])["harmonized"].sum()
    panel = counts.reindex(grid, fill_value=0.0).rename("count").reset_index()
    panel["log"] = np.log1p(panel["count"])
    return panel


def climatology(panel: pd.DataFrame, years: tuple[int, int]) -> pd.DataFrame:
    """Per (department, month of year): median log count, median count and the above-normal line."""
    base = panel[panel["month"].dt.year.between(*years)]
    table: pd.DataFrame = base.groupby(["department", base["month"].dt.month.rename("moy")]).agg(
        log_median=("log", "median"),
        normal=("count", "median"),
        threshold=("count", lambda c: c.quantile(ABOVE_NORMAL_QUANTILE)),
    )
    return table


def features(panel: pd.DataFrame, clim: pd.DataFrame, oni: OniTable, lead: int) -> pd.DataFrame:
    """One row per (department, issue month): the features, the target month and, when that
    month is already in `panel`, the outcome `y` (1 = above normal)."""
    frame = panel.sort_values(["department", "month"]).reset_index(drop=True)
    moy = frame["month"].dt.month.rename("moy")
    keyed = clim.reindex(pd.MultiIndex.from_arrays([frame["department"], moy]))
    anomaly = frame["log"] - keyed["log_median"].to_numpy()
    by_department = anomaly.groupby(frame["department"])
    target = frame["month"] + pd.DateOffset(months=lead)
    target_clim = clim.reindex(pd.MultiIndex.from_arrays([frame["department"], target.dt.month]))
    previous = frame["month"] - pd.DateOffset(months=1)
    rows = pd.DataFrame(
        {
            "department": frame["department"],
            "issue": frame["month"],
            "target": target,
            "a0": anomaly,
            "a1": by_department.shift(1),
            "a2": by_department.shift(2),
            "oni": [oni.get((m.year, m.month), np.nan) for m in previous],
            "normal": target_clim["normal"].to_numpy(),
            "threshold": target_clim["threshold"].to_numpy(),
        }
    )
    outcome = frame.set_index(["department", "month"])["count"]
    observed = outcome.reindex(pd.MultiIndex.from_arrays([rows["department"], rows["target"]]))
    rows["y"] = np.where(
        observed.isna().to_numpy(), np.nan, (observed.to_numpy() > rows["threshold"]).astype(float)
    )
    usable = rows[list(FEATURES)].notna().all(axis=1) & (rows["normal"] >= MIN_NORMAL_COUNT)
    return rows[usable].reset_index(drop=True)


def _design(x: pd.DataFrame, columns: Sequence[str]) -> np.ndarray:
    values = x[list(columns)].to_numpy(dtype=float)
    return np.column_stack([np.ones(len(values)), values])


def fit_logistic(
    x: pd.DataFrame, y: pd.Series | np.ndarray, columns: Sequence[str] = FEATURES
) -> np.ndarray:
    """Weights (intercept first) of an L2-penalised logistic regression, by Newton's method."""
    design, target = _design(x, columns), np.asarray(y, dtype=float)
    weights = np.zeros(design.shape[1])
    penalty = np.eye(design.shape[1]) * L2_PENALTY
    penalty[0, 0] = 0.0  # the intercept is not shrunk
    for _ in range(NEWTON_STEPS):
        p = 1.0 / (1.0 + np.exp(-design @ weights))
        gradient = design.T @ (p - target) + penalty @ weights
        hessian = (design * (p * (1 - p))[:, None]).T @ design + penalty
        step = np.linalg.solve(hessian, gradient)
        weights -= step
        if np.abs(step).max() < CONVERGED:
            break
    return weights


def predict(
    weights: Sequence[float], x: pd.DataFrame, columns: Sequence[str] = FEATURES
) -> np.ndarray:
    """Probability of an above-normal month."""
    design = _design(x, columns)
    return np.asarray(1.0 / (1.0 + np.exp(-design @ np.asarray(weights, dtype=float))))


def brier(p: np.ndarray, y: np.ndarray) -> float:
    return float(np.mean((p - y) ** 2))


def auc(p: np.ndarray, y: np.ndarray) -> float:
    """Chance that a random above-normal month got a higher probability than a random other one."""
    ranks = pd.Series(p).rank().to_numpy()
    positives = y == 1
    n1, n0 = int(positives.sum()), int((~positives).sum())
    return float((ranks[positives].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))
