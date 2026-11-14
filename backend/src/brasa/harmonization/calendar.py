"""Burning calendar: monthly climatology, critical periods and anomalies."""

from collections.abc import Iterable

import numpy as np
import pandas as pd

# Converts the IQR into an equivalent standard deviation under normality.
IQR_TO_SIGMA = 1.349
CRITICAL_PERCENTILE = 0.75
ANOMALY_Z_THRESHOLD = 2.0


def build_calendar(
    harmonized: pd.DataFrame, baseline_years: tuple[int, int] | None = None
) -> pd.DataFrame:
    """Aggregate by month of year and flag critical months and anomalies.

    - `median`, `q25`, `q75`: robust climatology per month of year (optional baseline).
    - `is_critical_month`: the month's median is at or above the 75th percentile of monthly
      medians.
    - On every monthly row: `robust_z` and `is_anomaly` (|z| >= 2) against its climatology.

    The spread uses IQR/1.349 with a Poisson noise floor (sqrt(median)), so a month with a very
    stable history neither yields infinite z-scores nor hides obvious anomalies.
    """
    frame = harmonized.copy()
    frame["month"] = pd.to_datetime(frame["month"])
    frame["year"] = frame["month"].dt.year
    frame["month_of_year"] = frame["month"].dt.month

    baseline = frame
    if baseline_years is not None:
        start, end = baseline_years
        baseline = frame[(frame["year"] >= start) & (frame["year"] <= end)]

    climatology = baseline.groupby("month_of_year")["harmonized"].agg(
        median="median",
        mean="mean",
        q25=lambda series: series.quantile(0.25),
        q75=lambda series: series.quantile(0.75),
        p10=lambda series: series.quantile(0.10),
        p90=lambda series: series.quantile(0.90),
    )
    threshold = climatology["median"].quantile(CRITICAL_PERCENTILE)
    climatology["is_critical_month"] = climatology["median"] >= threshold

    # Parametric log-activity climatology (matches log(1 + H) anomaly z-score for calendar alerts).
    log_vals = np.log1p(baseline["harmonized"].clip(lower=0.0))
    log_stats = baseline.assign(_log=log_vals).groupby("month_of_year")["_log"].agg(
        log_mean="mean",
        log_std="std",
    )
    log_stats["log_std"] = log_stats["log_std"].fillna(0.0).clip(lower=0.25)

    result = frame.merge(climatology, left_on="month_of_year", right_index=True, how="left")
    result = result.merge(log_stats, left_on="month_of_year", right_index=True, how="left")
    iqr_sigma = (result["q75"] - result["q25"]) / IQR_TO_SIGMA
    poisson_sigma = np.sqrt(result["median"].clip(lower=1.0))
    sigma = np.maximum(iqr_sigma, poisson_sigma)
    result["robust_z"] = (result["harmonized"] - result["median"]) / sigma
    log_harm = np.log1p(result["harmonized"].clip(lower=0.0))
    result["log_z"] = (log_harm - result["log_mean"]) / result["log_std"]
    result["anomaly_ratio"] = np.where(
        result["median"] > 0.0,
        result["harmonized"] / result["median"],
        np.where(result["harmonized"] == 0.0, 1.0, 1.0 + result["harmonized"]),
    )
    # Catch high anomalies even when median == 0 if activity exceeds Q3 and noise floor.
    noise_floor = np.maximum(result["q75"], 5.0)
    zero_baseline_surge = (result["median"] == 0.0) & (result["harmonized"] > noise_floor)
    result["is_anomaly"] = (result["robust_z"].abs() >= ANOMALY_Z_THRESHOLD) | zero_baseline_surge
    return result.sort_values("month").reset_index(drop=True)


# A month is a widespread anomaly when at least this share of regions is unusually high at once.
WIDESPREAD_SHARE = 0.25


def count_anomalous(calendars: Iterable[pd.DataFrame]) -> pd.Series:
    """Per month, how many regional calendars flag an above-normal anomaly.

    National totals are dominated by regions that burn every year regardless of climate (the
    Llanos), which dilutes El Nino. Counting how many regions are unusual at the same time
    recovers that signal (validation in docs/data/datasets.md).
    """
    flagged = [c.loc[c["is_anomaly"] & (c["robust_z"] > 0), "month"] for c in calendars]
    if not flagged:
        return pd.Series(dtype="int64")
    counts: pd.Series = pd.concat(flagged).value_counts().sort_index()
    return counts
