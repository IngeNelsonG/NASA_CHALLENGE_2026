"""Bring the archive up to the last complete month with the FIRMS Area API (needs a MAP_KEY).

The yearly country files (scripts/download_firms_archive.py) only exist for past years, so the
current year comes from the Area API in 5-day requests over Colombia's box:

- VIIRS: Suomi NPP, as in the archive. Standard processing (SP) where FIRMS has it, near real
  time (NRT) after that. Days Suomi NPP does not cover at all are taken from NOAA-20 (same
  instrument, ~50 minutes apart on the same orbit), so an outage is not read as a quiet month.
- MODIS: SP, then NRT, while FIRMS still has it.

The API rows carry no `type`, so static sources are removed with the archive's own mask
(data/context/static_sources.csv) and the rest marked as vegetation fires; points outside every
Colombian department (the box also holds parts of the neighbours) are dropped.

Writes data/raw/firms/<family>_<year>_Colombia_api.csv; then run scripts/build_dataset.py.

Usage (from backend/, with BRASA_FIRMS_MAP_KEY in backend/.env):
    uv run python scripts/extend_archive.py
"""

from datetime import date, timedelta
from pathlib import Path

import pandas as pd

from brasa.config import get_settings
from brasa.domain.models import COLOMBIA
from brasa.ingestion.archive import VEGETATION_FIRE_TYPE
from brasa.ingestion.boundaries import load_departments
from brasa.ingestion.firms_client import MAX_DAY_RANGE, FirmsClient, FirmsSource
from brasa.ingestion.recent import drop_static, in_colombia, load_static_cells

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
RAW_DIR = DATA_DIR / "raw" / "firms"
# (sources in order of preference, backup for the days the first ones have no row at all)
FAMILIES: dict[str, tuple[list[FirmsSource], list[FirmsSource]]] = {
    "viirs-snpp": (
        [FirmsSource.VIIRS_SNPP_SP, FirmsSource.VIIRS_SNPP_NRT],
        [FirmsSource.VIIRS_NOAA20_SP, FirmsSource.VIIRS_NOAA20_NRT],
    ),
    # A day without MODIS detections is plausible in the wet season: no backup.
    "modis": ([FirmsSource.MODIS_SP, FirmsSource.MODIS_NRT], []),
}
INSTRUMENT = {"viirs-snpp": "VIIRS", "modis": "MODIS"}


def plan(
    sources: list[FirmsSource], ranges: dict[str, tuple[date, date]], start: date, end: date
) -> list[tuple[FirmsSource, date, int]]:
    """(source, first day, days) requests covering start..end with the preferred source per day."""
    requests: list[tuple[FirmsSource, date, int]] = []
    day = start
    while day <= end:
        held = [s for s in sources if s.value in ranges]
        source = next((s for s in held if ranges[s.value][0] <= day <= ranges[s.value][1]), None)
        if source is None:
            day += timedelta(days=1)
            continue
        last = min(end, ranges[source.value][1], day + timedelta(days=MAX_DAY_RANGE - 1))
        requests.append((source, day, (last - day).days + 1))
        day = last + timedelta(days=1)
    return requests


def main() -> None:
    today = date.today()
    end = today.replace(day=1) - timedelta(days=1)  # last day of the last complete month
    start = date(end.year, 1, 1)
    client = FirmsClient(get_settings().firms_map_key)
    ranges = client.availability()
    static = load_static_cells(DATA_DIR / "context" / "static_sources.csv")
    departments = load_departments(DATA_DIR / "context" / "colombia_departments.geojson")[
        "features"
    ]
    for family, (sources, backup) in FAMILIES.items():
        requests = plan(sources, ranges, start, end)
        if not requests:
            print(f"{family}: FIRMS has nothing between {start} and {end}")
            continue
        frames = [client.fetch_area(s, COLOMBIA, first, days) for s, first, days in requests]
        raw = pd.concat([f for f in frames if not f.empty], ignore_index=True)
        # Not one detection over the whole box (Colombia and its neighbours) is an outage.
        seen = set(raw["acq_date"].astype(str))
        gaps = [d.date() for d in pd.date_range(start, end) if d.strftime("%Y-%m-%d") not in seen]
        patches = [r for day in gaps for r in plan(backup, ranges, day, day)]
        filled = [client.fetch_area(s, COLOMBIA, first, days) for s, first, days in patches]
        raw = pd.concat([raw, *[f for f in filled if not f.empty]], ignore_index=True)
        requests += patches
        raw = in_colombia(drop_static(raw, static), departments).drop(columns="department")
        # Standard-processing rows may carry `type`; near-real-time ones do not.
        kind = raw["type"] if "type" in raw else pd.Series(VEGETATION_FIRE_TYPE, index=raw.index)
        raw["type"] = kind.fillna(VEGETATION_FIRE_TYPE).astype(int)
        raw["instrument"] = INSTRUMENT[family]
        target = RAW_DIR / f"{family}_{end.year}_Colombia_api.csv"
        raw.to_csv(target, index=False)
        used = pd.Series([s.value for s, _, d in requests for _ in range(d)]).value_counts()
        daily = (
            raw.groupby("acq_date")
            .size()
            .reindex(pd.date_range(start, end).strftime("%Y-%m-%d"), fill_value=0)
        )
        print(f"{family}: {len(raw):,} detections {start}..{end} -> {target.name}")
        print(f"  days per source: {used.to_dict()}")
        print(f"  outage days filled from the backup: {[str(r[1]) for r in patches]}")
        print(f"  days still with no detection: {int((daily == 0).sum())} of {len(daily)}")


if __name__ == "__main__":
    main()
