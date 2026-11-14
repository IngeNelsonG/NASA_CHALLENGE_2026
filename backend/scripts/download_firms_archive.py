"""Download the NASA FIRMS yearly country archive for Colombia (standard/science-quality data).

These public yearly files need no MAP_KEY and no download request, unlike the API or the
create.php form. Each file is the full year of MODIS C6.1 or VIIRS S-NPP 375 m detections
inside Colombia, including the `type` column (0 = vegetation fire, 2 = static land source).

It also fetches two small context files into data/context/ (committed): the NOAA CPC Oceanic
Nino Index
(El Nino / La Nina) and the Colombian department boundaries (geoBoundaries ADM1, ODbL, simplified).

Usage (from backend/): uv run python scripts/download_firms_archive.py [--first 2000 --last 2025]
Files land in data/raw/firms/ (git-ignored). Existing files are skipped, so it is resumable.
"""

import argparse
import sys
from pathlib import Path

import httpx

BASE_URL = "https://firms.modaps.eosdis.nasa.gov/data/country"
COUNTRY = "Colombia"
# Closed list: sensor directory -> first year with data. NOAA-20/21 are not published per country.
SENSORS = {"modis": 2000, "viirs-snpp": 2012}
RAW_DIR = Path(__file__).resolve().parents[1] / "data" / "raw"
CONTEXT_FILES = {
    "oni.ascii.txt": "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt",
    # Pinned commit so the geometry never changes under us.
    "colombia_departments.geojson": "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/"
    "releaseData/gbOpen/COL/ADM1/geoBoundaries-COL-ADM1_simplified.geojson",
}
TIMEOUT_SECONDS = 120


def download(url: str, target: Path) -> str:
    name = target.name
    if target.exists() and target.stat().st_size > 0:
        return f"skip {name}"
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(".part")
    response = httpx.get(url, timeout=TIMEOUT_SECONDS, follow_redirects=True)
    response.raise_for_status()
    partial.write_bytes(response.content)
    partial.rename(target)
    return f"ok   {name} ({target.stat().st_size / 1e6:.1f} MB)"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--first", type=int, default=2000)
    parser.add_argument("--last", type=int, default=2025)
    args = parser.parse_args()

    jobs = {RAW_DIR.parent / "context" / name: url for name, url in CONTEXT_FILES.items()}
    for sensor, since in SENSORS.items():
        for year in range(max(args.first, since), args.last + 1):
            name = f"{sensor}_{year}_{COUNTRY}.csv"
            jobs[RAW_DIR / "firms" / name] = f"{BASE_URL}/{sensor}/{year}/{name}"

    failures = 0
    for target, url in jobs.items():
        try:
            print(download(url, target), flush=True)
        except (httpx.HTTPError, OSError) as error:
            failures += 1
            print(f"FAIL {target.name}: {error}", file=sys.stderr, flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
