"""Aggregation of raw detections into monthly counts per grid cell and sensor."""

from collections.abc import Callable

import numpy as np
import pandas as pd

REQUIRED_COLUMNS = frozenset({"latitude", "longitude", "acq_date", "sensor"})
DEFAULT_CELL_SIZE_DEG = 0.25


def aggregate_monthly(
    detections: pd.DataFrame, cell_size_deg: float = DEFAULT_CELL_SIZE_DEG
) -> pd.DataFrame:
    """Count detections per (cell, month, sensor).

    Comparing individual 1 km and 375 m pixels point by point is not valid, so the
    harmonization works on aggregated counts over a common grid.
    """
    missing = REQUIRED_COLUMNS - set(detections.columns)
    if missing:
        raise ValueError(f"Missing required columns: {sorted(missing)}")

    if cell_size_deg <= 0:
        raise ValueError("cell_size_deg must be positive.")
    # One int64 key per detection, counted with np.unique: a 4-column groupby over 2 M points
    # peaked near 200 MB, more than the free 512 MB host can spare per request. The key is a
    # mixed-radix number (latitude cell, longitude cell, month, sensor), built one part at a time
    # so only a couple of full-length arrays are alive at once.
    sensor = pd.Categorical(detections["sensor"])
    parts: list[Callable[[], np.ndarray]] = [
        lambda: _cell_index(detections["latitude"], cell_size_deg),
        lambda: _cell_index(detections["longitude"], cell_size_deg),
        lambda: _months(detections["acq_date"]),
        lambda: sensor.codes.astype(np.int64),
    ]
    key = np.zeros(len(detections), dtype=np.int64)
    radix: list[tuple[int, int]] = []  # (lowest value, span) of each part
    for part in parts:
        values = part()
        low = int(values.min()) if values.size else 0
        span = (int(values.max()) - low + 1) if values.size else 1
        values -= low
        key *= span
        key += values
        radix.append((low, span))
        del values
    keys, counts = np.unique(key, return_counts=True)
    del key
    digits = []
    for low, span in reversed(radix):
        keys, digit = np.divmod(keys, span)
        digits.append(digit + low)
    code, month, lon, lat = digits
    return pd.DataFrame(
        {
            "cell_lat": np.round(lat * cell_size_deg, 6),
            "cell_lon": np.round(lon * cell_size_deg, 6),
            "month": pd.to_datetime(month.astype("datetime64[M]")),
            "sensor": pd.Index(sensor.categories.astype(str))[code],
            "count": counts,
        }
    )


def _cell_index(values: pd.Series, cell_size_deg: float) -> np.ndarray:
    """Index of each coordinate's cell: its lower edge is index * `cell_size_deg`."""
    cells = values.to_numpy(dtype=np.float64) / cell_size_deg
    np.floor(cells, out=cells)
    return cells.astype(np.int64)


def _months(dates: pd.Series) -> np.ndarray:
    """Months since 1970 of each date."""
    return pd.to_datetime(dates).to_numpy().astype("datetime64[M]").view(np.int64)
