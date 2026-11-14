import pandas as pd
import pytest

from brasa.harmonization import aggregate_monthly, build_calendar, fit_sensor_ratio, harmonize
from brasa.harmonization.calibrate import InsufficientOverlapError, SensorRatio


def _monthly(rows: list[tuple[str, str, int]]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {"cell_lat": 0.0, "cell_lon": 0.0, "month": pd.Timestamp(m), "sensor": s, "count": c}
            for m, s, c in rows
        ]
    )


def test_aggregate_monthly_places_points_on_the_lower_cell_edge() -> None:
    detections = pd.DataFrame(
        {
            "latitude": [-0.1, 4.6, 0.0],
            "longitude": [-73.1, -73.1, 0.0],
            "acq_date": ["2015-01-03"] * 3,
            "sensor": ["VIIRS"] * 3,
        }
    )
    cells = aggregate_monthly(detections)[["cell_lat", "cell_lon"]].values.tolist()
    assert cells == [[-0.25, -73.25], [0.0, 0.0], [4.5, -73.25]]


def test_aggregate_monthly_rejects_non_positive_cell() -> None:
    detections = pd.DataFrame(
        {"latitude": [1.0], "longitude": [1.0], "acq_date": ["2015-01-03"], "sensor": ["VIIRS"]}
    )
    with pytest.raises(ValueError, match="positive"):
        aggregate_monthly(detections, cell_size_deg=0)


def test_aggregate_monthly_handles_no_detections() -> None:
    empty = pd.DataFrame(columns=["latitude", "longitude", "acq_date", "sensor"])
    assert aggregate_monthly(empty).empty


def test_aggregate_monthly_counts_by_cell_month_and_sensor() -> None:
    detections = pd.DataFrame(
        {
            "latitude": [4.6, 4.61, 4.6],
            "longitude": [-73.1, -73.11, -73.1],
            "acq_date": ["2015-01-03", "2015-01-20", "2015-02-01"],
            "sensor": ["VIIRS", "VIIRS", "MODIS"],
        }
    )
    result = aggregate_monthly(detections)
    assert result["count"].sum() == 3
    january = result[result["month"] == pd.Timestamp("2015-01-01")]
    assert january.iloc[0]["count"] == 2


def test_aggregate_monthly_requires_columns() -> None:
    with pytest.raises(ValueError, match="Missing required columns"):
        aggregate_monthly(pd.DataFrame({"latitude": [1.0]}))


def test_fit_sensor_ratio_uses_only_overlap_months() -> None:
    rows = [(f"2013-{m:02d}-01", "MODIS", 10) for m in range(1, 7)]
    rows += [(f"2013-{m:02d}-01", "VIIRS", 30) for m in range(1, 7)]
    rows += [("2010-01-01", "MODIS", 999)]  # no VIIRS: must not influence the ratio
    ratio = fit_sensor_ratio(_monthly(rows))
    assert ratio.ratio == pytest.approx(3.0)
    assert ratio.overlap_months == 6


def test_fit_sensor_ratio_requires_enough_overlap() -> None:
    rows = [("2013-01-01", "MODIS", 10), ("2013-01-01", "VIIRS", 30)]
    with pytest.raises(InsufficientOverlapError):
        fit_sensor_ratio(_monthly(rows))


def test_fit_sensor_ratio_requires_both_sensors() -> None:
    with pytest.raises(InsufficientOverlapError):
        fit_sensor_ratio(_monthly([("2013-01-01", "MODIS", 10)]))


def test_harmonize_scales_modis_only_months_and_keeps_viirs() -> None:
    rows = [("2010-01-01", "MODIS", 10), ("2014-01-01", "MODIS", 10), ("2014-01-01", "VIIRS", 28)]
    result = harmonize(_monthly(rows), SensorRatio(ratio=3.0, q25=2.5, q75=3.5, overlap_months=6))
    by_month = result.set_index("month")
    assert by_month.loc[pd.Timestamp("2010-01-01"), "harmonized"] == pytest.approx(30.0)
    assert by_month.loc[pd.Timestamp("2010-01-01"), "source"] == "MODIS_SCALED"
    assert by_month.loc[pd.Timestamp("2014-01-01"), "harmonized"] == 28
    assert by_month.loc[pd.Timestamp("2014-01-01"), "source"] == "VIIRS"


def test_build_calendar_flags_critical_months_and_anomalies() -> None:
    months = pd.date_range("2010-01-01", "2019-12-01", freq="MS")
    values = [100.0 if m.month in (1, 2, 3) else 5.0 for m in months]
    # History without spread (IQR = 0): the Poisson floor must still catch the anomaly.
    frame = pd.DataFrame({"month": months, "harmonized": values})
    frame.loc[frame["month"] == pd.Timestamp("2016-02-01"), "harmonized"] = 400.0  # El Niño

    calendar = build_calendar(frame, baseline_years=(2010, 2019))

    critical = set(calendar.loc[calendar["is_critical_month"], "month_of_year"])
    assert {1, 2, 3} <= critical
    anomalies = calendar.loc[calendar["is_anomaly"], "month"].tolist()
    assert anomalies == [pd.Timestamp("2016-02-01")]
