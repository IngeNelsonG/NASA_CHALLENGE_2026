"""Clean the FIRMS yearly country archive (MODIS C6.1 + VIIRS 375 m) into one detections table.

Filters (docs/data/datasets.md):
- `type == 0`: vegetation fires only. Drops static land sources such as the gas flares of the
  Llanos oil fields, which would otherwise show up as permanent hotspots.
- Confidence: MODIS >= 30 (0-100 scale); VIIRS nominal or high (`n`/`h`), drops `l`.
"""

from pathlib import Path

import numpy as np
import pandas as pd

from brasa.domain.models import Sensor

MIN_MODIS_CONFIDENCE = 30
VIIRS_KEPT_CONFIDENCE = frozenset({"n", "h"})
VEGETATION_FIRE_TYPE = 0
OUTPUT_COLUMNS = ["latitude", "longitude", "acq_date", "acq_time", "sensor", "satellite", "frp"]
STATIC_CELLS_PER_DEGREE = 100  # 0.01 deg, about the 1 km MODIS pixel


def clean_archive(raw: pd.DataFrame) -> pd.DataFrame:
    """Keep confident vegetation-fire detections and tag each row with its sensor family."""
    sensor = raw["instrument"].str.upper().map({"MODIS": Sensor.MODIS, "VIIRS": Sensor.VIIRS})
    if sensor.isna().any():
        raise ValueError("Unknown instrument in archive rows.")

    confidence = raw["confidence"].astype(str).str.strip().str.lower()
    modis_ok = (sensor == Sensor.MODIS) & (
        pd.to_numeric(confidence, errors="coerce") >= MIN_MODIS_CONFIDENCE
    )
    viirs_ok = (sensor == Sensor.VIIRS) & confidence.isin(VIIRS_KEPT_CONFIDENCE)
    keep = (raw["type"] == VEGETATION_FIRE_TYPE) & (modis_ok | viirs_ok)

    clean = raw.loc[keep].assign(
        sensor=sensor[keep].astype(str),
        acq_date=pd.to_datetime(raw.loc[keep, "acq_date"]),
        satellite=raw.loc[keep, "satellite"].astype(str),
    )
    return clean[OUTPUT_COLUMNS].reset_index(drop=True)


def build_detections(raw_dir: Path) -> pd.DataFrame:
    """Read every yearly CSV in `raw_dir` and return the cleaned, date-sorted detections.

    A year fetched through the Area API (`*_api.csv`, scripts/extend_archive.py) is skipped once
    FIRMS publishes its yearly country file, so it is never counted twice."""
    files = [
        path
        for path in sorted(raw_dir.glob("*.csv"))
        if not (path.name.endswith("_api.csv") and path.with_name(path.name[:-8] + ".csv").exists())
    ]
    if not files:
        raise FileNotFoundError(f"No FIRMS CSV files in {raw_dir}.")
    frames = [clean_archive(pd.read_csv(path, dtype={"confidence": str})) for path in files]
    return pd.concat(frames, ignore_index=True).sort_values("acq_date", ignore_index=True)


def cell_index(values: pd.Series | np.ndarray) -> np.ndarray:
    """0.01 deg cell of each coordinate (the key of the static-source mask)."""
    return np.floor(np.asarray(values, dtype=np.float64) * STATIC_CELLS_PER_DEGREE).astype(np.int32)


def static_cells(raw_dir: Path) -> pd.DataFrame:
    """Cells where the archive ever saw a non-vegetation source (`type` 1, 2 or 3).

    Near-real-time FIRMS files have no `type` column, so recent detections on these cells (gas
    flares, volcanoes, industrial sites) are dropped the same way `type == 0` drops them from the
    archive.
    """
    frames = [
        pd.read_csv(path, usecols=["latitude", "longitude", "type"])
        for path in sorted(raw_dir.glob("*.csv"))
    ]
    static = pd.concat(frames).query("type != @VEGETATION_FIRE_TYPE")
    cells = pd.DataFrame(
        {"lat_cell": cell_index(static["latitude"]), "lon_cell": cell_index(static["longitude"])}
    )
    return cells.drop_duplicates().sort_values(["lat_cell", "lon_cell"], ignore_index=True)
