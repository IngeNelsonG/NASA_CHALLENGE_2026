"""Reproduce the validation table of ADR-003: does "many departments unusual at once" track ENSO?

For each share of departments (15 %...40 %), a month is "widespread" when at least that share
of Colombia's departments has an above-normal anomaly. The table counts how many NOAA El Nino /
La Nina episodes since 2002 contain at least one widespread month.

An episode is a run of >= 5 consecutive 3-month seasons with |ONI| >= 0.5; its window is the
episode plus the following 3 months (fire responds with a lag).

Usage (from backend/): uv run python scripts/validate_enso.py
"""

from pathlib import Path

import pandas as pd

from brasa.api.service import ONI_FILE, CalendarService
from brasa.harmonization import WIDESPREAD_SHARE
from brasa.ingestion.oni import load_oni

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
ENSO_THRESHOLD = 0.5
MIN_SEASONS = 5
LAG_MONTHS = 3
FIRST_YEAR = 2002  # the first full years of MODIS Terra + Aqua
SHARES = (0.15, 0.20, WIDESPREAD_SHARE, 0.33, 0.40)


def episodes(oni: pd.Series, sign: int) -> list[tuple[pd.Timestamp, pd.Timestamp]]:
    """(first month, last month + lag) of each El Nino (sign=1) or La Nina (sign=-1) episode."""
    active = (oni * sign) >= ENSO_THRESHOLD
    runs = (active != active.shift()).cumsum()
    windows = []
    for _, run in oni[active].groupby(runs[active]):
        if len(run) >= MIN_SEASONS:
            windows.append((run.index[0], run.index[-1] + pd.DateOffset(months=LAG_MONTHS)))
    return windows


def main() -> None:
    service = CalendarService.from_data_dir(DATA_DIR)
    table = load_oni(DATA_DIR / ONI_FILE)
    oni = pd.Series({pd.Timestamp(year=y, month=m, day=1): v for (y, m), v in table.items()})
    oni = oni.sort_index()[f"{FIRST_YEAR}-01-01" : "2025-12-01"]
    counts = service.anomalous_regions.reindex(oni.index, fill_value=0)
    nino, nina = episodes(oni, 1), episodes(oni, -1)
    base_rate = (oni >= ENSO_THRESHOLD).mean()

    print(f"Departments with data: {service.regions_total}")
    print(f"Episodes since {FIRST_YEAR}: {len(nino)} El Nino, {len(nina)} La Nina")
    print(f"Base rate: {base_rate:.0%} of months have ONI >= {ENSO_THRESHOLD}\n")
    print("share  El Nino  La Nina  widespread months  of which ONI >= 0.5")
    for share in SHARES:
        widespread = counts[counts >= share * service.regions_total].index
        hit = [
            sum(any(a <= m <= b for m in widespread) for a, b in group) for group in (nino, nina)
        ]
        during = (oni[widespread] >= ENSO_THRESHOLD).mean() if len(widespread) else float("nan")
        print(
            f"{share:>5.0%}  {hit[0]}/{len(nino)}      {hit[1]}/{len(nina)}      "
            f"{len(widespread):>3}                {during:.0%}"
        )


if __name__ == "__main__":
    main()
