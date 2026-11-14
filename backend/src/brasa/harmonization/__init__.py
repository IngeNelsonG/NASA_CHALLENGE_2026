"""MODIS/VIIRS harmonization and burning-calendar construction.

Flow: raw detections -> `aggregate_monthly` -> `fit_sensor_ratio` (overlap period)
-> `harmonize` (continuous series in VIIRS-equivalent units) -> `build_calendar`.
See docs/decisions/ADR-003-harmonization-method.md.
"""

from brasa.harmonization.aggregate import aggregate_monthly
from brasa.harmonization.calendar import WIDESPREAD_SHARE, build_calendar, count_anomalous
from brasa.harmonization.calibrate import fit_sensor_ratio, harmonize

__all__ = [
    "WIDESPREAD_SHARE",
    "aggregate_monthly",
    "build_calendar",
    "count_anomalous",
    "fit_sensor_ratio",
    "harmonize",
]
