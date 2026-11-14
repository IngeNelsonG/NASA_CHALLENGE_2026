"""Build data/processed/country_monthly.parquet: monthly detections per country and sensor.

Downloads the FIRMS yearly "all countries" archives (public, no MAP_KEY; MODIS 2000-2025 ~2 GB,
VIIRS S-NPP 2012-2025 ~5.4 GB) into data/raw/firms_global/ (git-ignored, resumable), applies the
same filters as the Colombian archive (`clean_archive`: type == 0 + confidence) and keeps only
counts per (country, month, sensor). The result is under 1 MB, so it is committed.

Usage (from backend/): uv run python scripts/build_global_dataset.py [--first 2000 --last 2025]
"""

import argparse
import io
import sys
import zipfile
from pathlib import Path

import httpx
import pandas as pd

from brasa.ingestion.archive import clean_archive

BASE_URL = "https://firms.modaps.eosdis.nasa.gov/data/country/zips"
SENSORS = {"modis": 2000, "viirs-snpp": 2012}  # closed list: archive prefix -> first year
DATA_DIR = Path(__file__).resolve().parents[1] / "data"
RAW_DIR = DATA_DIR / "raw" / "firms_global"
TARGET = DATA_DIR / "processed" / "country_monthly.parquet"
COLUMNS = ["latitude", "longitude", "acq_date", "acq_time", "satellite", "instrument",
           "confidence", "frp", "type"]  # fmt: skip


def download(name: str) -> Path:
    target = RAW_DIR / name
    if target.exists() and target.stat().st_size > 0:
        return target
    partial = target.with_suffix(".part")
    with httpx.stream("GET", f"{BASE_URL}/{name}", timeout=600, follow_redirects=True) as r:
        r.raise_for_status()
        with partial.open("wb") as out:
            for chunk in r.iter_bytes(1 << 20):
                out.write(chunk)
    partial.rename(target)
    return target


def country_name(member: str) -> str:
    # "modis/2000/modis_2000_Cote_d_Ivoire.csv" -> "Cote d Ivoire"
    return Path(member).stem.split("_", 2)[2].replace("_", " ")


def aggregate_zip(path: Path) -> pd.DataFrame:
    frames = []
    with zipfile.ZipFile(path) as archive:
        for member in archive.namelist():
            if not member.endswith(".csv"):
                continue
            with archive.open(member) as raw:
                frame = pd.read_csv(
                    io.TextIOWrapper(raw), usecols=COLUMNS, dtype={"confidence": str}
                )
            if frame.empty:
                continue
            clean = clean_archive(frame)
            counts = (
                clean.assign(month=clean["acq_date"].dt.to_period("M").dt.to_timestamp())
                .groupby(["month", "sensor"], as_index=False)
                .size()
                .rename(columns={"size": "count"})
            )
            frames.append(counts.assign(country=country_name(member)))
    return pd.concat(frames, ignore_index=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--first", type=int, default=2000)
    parser.add_argument("--last", type=int, default=2025)
    args = parser.parse_args()
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    frames = []
    for prefix, since in SENSORS.items():
        for year in range(max(args.first, since), args.last + 1):
            name = f"{prefix}_{year}_all_countries.zip"
            try:
                frames.append(aggregate_zip(download(name)))
                print(f"ok   {name}", flush=True)
            except (httpx.HTTPError, OSError, zipfile.BadZipFile) as error:
                print(f"FAIL {name}: {error}", file=sys.stderr, flush=True)
                return 1

    result = pd.concat(frames, ignore_index=True).astype(
        {"country": "category", "sensor": "category"}
    )
    result = result[["country", "month", "sensor", "count"]].sort_values(
        ["country", "month", "sensor"]
    )
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    result.to_parquet(TARGET, index=False, compression="zstd", compression_level=19)
    print(f"{len(result):,} rows, {result['country'].nunique()} countries -> {TARGET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
