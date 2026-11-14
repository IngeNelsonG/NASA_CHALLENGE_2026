"""Cross-sensor calibration over the MODIS/VIIRS overlap period.

VIIRS (375 m) detects more small fires than MODIS (1 km), so its counts are systematically
higher. We estimate a robust scale factor (median of VIIRS/MODIS ratios in months where both
sensors observe) and express the whole series in "VIIRS-equivalent units".
"""

from dataclasses import dataclass

import pandas as pd

from brasa.domain.models import Sensor

MIN_OVERLAP_MONTHS = 6
DEFAULT_FALLBACK_RATIO = 4.28
DEFAULT_SHRINKAGE_MONTHS = 24
VIIRS_START_DATE = pd.Timestamp("2012-01-20")
VIIRS_FULL_START_MONTH = pd.Timestamp("2012-02-01")
JAN_2012 = pd.Timestamp("2012-01-01")
# Days 1-19 of Jan 2012 precede Suomi-NPP VIIRS fire detections (started 2012-01-20).
PRE_VIIRS_JAN_2012_SHARE = 19.0 / 31.0


class InsufficientOverlapError(ValueError):
    """Not enough months with both sensors to calibrate with confidence."""


@dataclass(frozen=True, slots=True)
class SensorRatio:
    """Estimated VIIRS/MODIS factor and its spread (interquartile range)."""

    ratio: float
    q25: float
    q75: float
    overlap_months: int


def _monthly_totals(
    monthly_counts: pd.DataFrame,
    start_month: str | pd.Timestamp | None = None,
    end_month: str | pd.Timestamp | None = None,
) -> pd.DataFrame:
    if monthly_counts.empty:
        return pd.DataFrame(columns=[Sensor.MODIS, Sensor.VIIRS], dtype=float)
    frame = monthly_counts.copy()
    frame["month"] = pd.to_datetime(frame["month"]).dt.to_period("M").dt.to_timestamp()
    totals = frame.pivot_table(
        index="month", columns="sensor", values="count", aggfunc="sum", fill_value=0
    )
    lo = (
        pd.Timestamp(start_month).to_period("M").to_timestamp()
        if start_month is not None
        else totals.index.min()
    )
    hi = (
        pd.Timestamp(end_month).to_period("M").to_timestamp()
        if end_month is not None
        else totals.index.max()
    )
    if lo <= hi:
        full_index = pd.date_range(lo, hi, freq="MS", name="month")
        totals = totals.reindex(full_index, fill_value=0.0)
    return totals


def fit_sensor_ratio(
    monthly_counts: pd.DataFrame,
    min_overlap_months: int = MIN_OVERLAP_MONTHS,
    *,
    fallback_ratio: float | None = None,
    fallback_iqr: tuple[float, float] | None = None,
    shrinkage_months: int = DEFAULT_SHRINKAGE_MONTHS,
) -> SensorRatio:
    """Estimate VIIRS/MODIS using full-overlap months (>= 2012-02) where both sensors detect fires.

    Excludes 2012-01 (partial 12-day VIIRS coverage) from calibration. When `fallback_ratio` is
    provided, applies empirical-Bayes shrinkage toward the prior for AOIs with fewer than
    `shrinkage_months` overlap months.
    """
    totals = _monthly_totals(monthly_counts)
    has_both = Sensor.MODIS in totals and Sensor.VIIRS in totals
    if not has_both:
        if fallback_ratio is not None:
            q25_f, q75_f = fallback_iqr or (fallback_ratio * 0.72, fallback_ratio * 1.35)
            return SensorRatio(ratio=fallback_ratio, q25=q25_f, q75=q75_f, overlap_months=0)
        raise InsufficientOverlapError("Data from both sensors is required.")

    full_viirs_epoch = totals.index >= VIIRS_FULL_START_MONTH
    overlap = totals[full_viirs_epoch & (totals[Sensor.MODIS] > 0) & (totals[Sensor.VIIRS] > 0)]
    n = len(overlap)
    if n == 0:
        if fallback_ratio is not None:
            q25_f, q75_f = fallback_iqr or (fallback_ratio * 0.72, fallback_ratio * 1.35)
            return SensorRatio(ratio=fallback_ratio, q25=q25_f, q75=q75_f, overlap_months=0)
        raise InsufficientOverlapError(f"Only 0 overlap months; {min_overlap_months} are required.")

    if fallback_ratio is None and n < min_overlap_months:
        raise InsufficientOverlapError(
            f"Only {n} overlap months; {min_overlap_months} are required."
        )

    ratios = overlap[Sensor.VIIRS] / overlap[Sensor.MODIS]
    raw_median = float(ratios.median())
    raw_q25 = float(ratios.quantile(0.25))
    raw_q75 = float(ratios.quantile(0.75))

    if fallback_ratio is not None and n < shrinkage_months:
        alpha = n / float(shrinkage_months)
        q25_f, q75_f = fallback_iqr or (fallback_ratio * 0.72, fallback_ratio * 1.35)
        blended = alpha * raw_median + (1.0 - alpha) * fallback_ratio
        q25_b = min(blended, alpha * raw_q25 + (1.0 - alpha) * q25_f)
        q75_b = max(blended, alpha * raw_q75 + (1.0 - alpha) * q75_f)
        return SensorRatio(
            ratio=float(blended), q25=float(q25_b), q75=float(q75_b), overlap_months=n
        )

    return SensorRatio(ratio=raw_median, q25=raw_q25, q75=raw_q75, overlap_months=n)


def harmonize(
    monthly_counts: pd.DataFrame,
    sensor_ratio: SensorRatio,
    *,
    start_month: str | pd.Timestamp | None = None,
    end_month: str | pd.Timestamp | None = None,
    jan2012_modis_pre20: float | None = None,
    jan2012_viirs_post20: float | None = None,
) -> pd.DataFrame:
    """Continuous monthly series in VIIRS-equivalent units across the full observed epoch.

    Preserves zero-detection months as 0.0 instead of omitting them, labels months by sensor
    availability epoch (>= 2012-02 is VIIRS even when 0 detections occurred), and bridges the
    2012-01-20 VIIRS start transition without discarding early-January MODIS fires.
    """
    totals = _monthly_totals(monthly_counts, start_month=start_month, end_month=end_month)
    empty = pd.Series(0.0, index=totals.index)
    modis = totals.get(Sensor.MODIS, empty).astype(float)
    viirs = totals.get(Sensor.VIIRS, empty).astype(float)

    harmonized = pd.DataFrame(index=totals.index)
    harmonized["raw_modis"] = modis
    harmonized["raw_viirs"] = viirs

    idx = pd.DatetimeIndex(totals.index)
    is_full_viirs = idx >= VIIRS_FULL_START_MONTH
    is_jan_2012 = idx == JAN_2012

    values = modis * sensor_ratio.ratio
    sources = pd.Series("MODIS_SCALED", index=totals.index, dtype="object")

    values = values.where(~is_full_viirs, viirs)
    sources = sources.where(~is_full_viirs, "VIIRS")

    if is_jan_2012.any():
        jan_modis = float(modis.loc[JAN_2012])
        jan_viirs = float(viirs.loc[JAN_2012])
        if jan2012_modis_pre20 is not None:
            viirs_part = (
                float(jan2012_viirs_post20) if jan2012_viirs_post20 is not None else jan_viirs
            )
            jan_val = jan2012_modis_pre20 * sensor_ratio.ratio + viirs_part
            jan_src = "VIIRS" if viirs_part > 0 else "MODIS_SCALED"
        elif jan_viirs > 0:
            # Blend pre-20th scaled MODIS estimate with partial-month VIIRS detections.
            modis_scaled = jan_modis * sensor_ratio.ratio
            jan_val = PRE_VIIRS_JAN_2012_SHARE * modis_scaled + jan_viirs
            jan_src = "VIIRS"
        else:
            jan_val = jan_modis * sensor_ratio.ratio
            jan_src = "MODIS_SCALED"
        values = values.where(~is_jan_2012, jan_val)
        sources = sources.where(~is_jan_2012, jan_src)

    harmonized["harmonized"] = values
    harmonized["source"] = sources
    return harmonized.reset_index()
