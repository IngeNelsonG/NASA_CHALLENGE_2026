"""Generate a SYNTHETIC, reproducible detections dataset for development and tests.

This is not real FIRMS data. It mimics two traits that matter for harmonization:
- Seasonality of the Colombian Orinoquia/Caribbean (January-March peak, smaller second peak in
  August-September).
- VIIRS detects ~3x more than MODIS over the same period (375 m vs 1 km resolution effect).

Usage: python scripts/generate_sample_data.py > data/sample/detections.csv
"""

import csv
import sys
from datetime import date

import numpy as np

SEED = 2026
START_YEAR = 2008
END_YEAR = 2016
VIIRS_START_YEAR = 2012
VIIRS_TO_MODIS_RATIO = 3.0
# Expected MODIS detections per month of year (January = index 0).
MONTHLY_BASE = [40, 55, 45, 15, 6, 4, 5, 12, 14, 8, 6, 20]
# Approximate Llanos Orientales (Eastern Plains).
WEST, SOUTH, EAST, NORTH = -73.5, 3.0, -69.5, 7.0
EL_NINO_BOOST = {2010: 1.8, 2016: 2.0}  # strong El Niño years (first quarter)


def main() -> None:
    rng = np.random.default_rng(SEED)
    writer = csv.writer(sys.stdout)
    writer.writerow(["latitude", "longitude", "acq_date", "sensor"])
    for year in range(START_YEAR, END_YEAR + 1):
        for month_index, base in enumerate(MONTHLY_BASE):
            boost = EL_NINO_BOOST.get(year, 1.0) if month_index < 3 else 1.0  # noqa: PLR2004
            sensors = [("MODIS", 1.0)]
            if year >= VIIRS_START_YEAR:
                sensors.append(("VIIRS", VIIRS_TO_MODIS_RATIO))
            for sensor, factor in sensors:
                count = rng.poisson(base * boost * factor)
                for _ in range(count):
                    day = int(rng.integers(1, 29))
                    writer.writerow(
                        [
                            round(float(rng.uniform(SOUTH, NORTH)), 4),
                            round(float(rng.uniform(WEST, EAST)), 4),
                            date(year, month_index + 1, day).isoformat(),
                            sensor,
                        ]
                    )


if __name__ == "__main__":
    main()
