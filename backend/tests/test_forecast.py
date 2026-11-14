import numpy as np
import pandas as pd
import pytest

from brasa.harmonization.forecast import (
    FEATURES,
    auc,
    brier,
    climatology,
    features,
    fit_logistic,
    last_complete_month,
    monthly_panel,
    predict,
)


def _series(counts: dict[str, list[float]], start: str = "2001-01-01") -> pd.DataFrame:
    frames = [
        pd.DataFrame(
            {
                "department": name,
                "month": pd.date_range(start, periods=len(values), freq="MS"),
                "harmonized": values,
            }
        )
        for name, values in counts.items()
    ]
    return pd.concat(frames, ignore_index=True)


def test_last_complete_month() -> None:
    assert last_complete_month(pd.Timestamp("2025-12-31")) == pd.Timestamp("2025-12-01")
    assert last_complete_month(pd.Timestamp("2026-11-12")) == pd.Timestamp("2026-10-01")


def test_panel_fills_months_without_detections_with_zero() -> None:
    series = _series({"A": [5.0, 7.0]}).drop(index=1)
    panel = monthly_panel(series, pd.Timestamp("2001-04-01"))
    assert panel["count"].tolist() == [5.0, 0.0, 0.0, 0.0]
    assert panel["log"].iloc[0] == pytest.approx(np.log1p(5.0))


def test_features_use_known_data_only_and_mark_the_outcome() -> None:
    # Ten years of 10 detections every month, then one hot month (index 120 = January 2011).
    values = [10.0] * 120 + [100.0, 10.0]
    panel = monthly_panel(_series({"A": values}), pd.Timestamp("2011-02-01"))
    clim = climatology(panel, (2001, 2010))
    assert clim.loc[("A", 1), "normal"] == 10.0
    oni = {(2010, 12): 1.5}
    rows = features(panel, clim, oni, lead=1)
    january = rows[rows["issue"] == pd.Timestamp("2011-01-01")].iloc[0]
    # The anomaly of the issue month is known; the ONI is the season centred a month before.
    assert january["a0"] == pytest.approx(np.log1p(100.0) - np.log1p(10.0))
    assert january["oni"] == 1.5
    assert january["target"] == pd.Timestamp("2011-02-01")
    assert january["y"] == 0.0  # February was normal
    december = rows[rows["issue"] == pd.Timestamp("2010-12-01")]
    assert december.empty  # no ONI for November 2010 in this table: no forecast
    # A target month beyond the data has no outcome yet.
    ahead = features(panel, clim, {(2011, 1): 0.0}, lead=1)
    assert ahead[ahead["issue"] == pd.Timestamp("2011-02-01")]["y"].isna().all()


def test_sparse_months_are_not_forecast() -> None:
    panel = monthly_panel(_series({"A": [1.0] * 24}), pd.Timestamp("2002-12-01"))
    clim = climatology(panel, (2001, 2002))
    oni = {(y, m): 0.0 for y in (2001, 2002) for m in range(1, 13)}
    assert features(panel, clim, oni, lead=1).empty


def test_logistic_regression_learns_the_direction_and_predicts_probabilities() -> None:
    rng = np.random.default_rng(0)
    x = pd.DataFrame(rng.normal(size=(2000, len(FEATURES))), columns=list(FEATURES))
    truth = 1 / (1 + np.exp(-(-0.7 + 1.5 * x["a0"] + 0.5 * x["oni"])))
    y = (rng.random(2000) < truth).astype(float)
    weights = fit_logistic(x, y)
    assert weights[1] == pytest.approx(1.5, abs=0.25)  # a0
    assert weights[4] == pytest.approx(0.5, abs=0.2)  # oni
    p = predict(weights, x)
    assert ((p > 0) & (p < 1)).all()
    assert auc(p, y.to_numpy()) > 0.75
    only_a0 = fit_logistic(x, y, ["a0"])
    assert len(only_a0) == 2
    assert predict(only_a0, x, ["a0"]).shape == (2000,)


def test_scores() -> None:
    y = np.array([0.0, 0.0, 1.0, 1.0])
    assert auc(np.array([0.1, 0.2, 0.8, 0.9]), y) == 1.0
    assert auc(np.array([0.9, 0.8, 0.2, 0.1]), y) == 0.0
    assert brier(np.array([0.0, 0.0, 1.0, 1.0]), y) == 0.0
    assert brier(np.full(4, 0.5), y) == 0.25
