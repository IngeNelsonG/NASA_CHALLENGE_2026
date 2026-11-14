"""NOAA CPC Oceanic Nino Index (ONI): 3-month running SST anomaly in the Nino 3.4 region.

Source file: https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt, a whitespace table with
the header `SEAS YR TOTAL ANOM`. Each season is attributed to its centre month (DJF -> January).
"""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

SEASON_CENTRE_MONTH = {
    season: month
    for month, season in enumerate(
        ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"],
        start=1,
    )
}
EXPECTED_COLUMNS = 4

OniTable = dict[tuple[int, int], float]


def parse_oni(text: str) -> OniTable:
    """Map (year, centre month) -> ONI anomaly. Malformed or unknown rows are skipped."""
    table: OniTable = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) != EXPECTED_COLUMNS or parts[0] not in SEASON_CENTRE_MONTH:
            continue
        try:
            table[(int(parts[1]), SEASON_CENTRE_MONTH[parts[0]])] = float(parts[3])
        except ValueError:
            continue
    return table


def load_oni(path: Path) -> OniTable:
    if not path.exists():
        logger.warning("%s not found: ONI will be null.", path.name)
        return {}
    return parse_oni(path.read_text(encoding="utf-8"))
