"""Build first-level subdivisions (states, provinces, departments...) for every FIRMS country.

Inputs (git-ignored, see docs/data/datasets.md):
- data/raw/firms_global/*.zip: FIRMS yearly "all countries" archives
  (scripts/build_global_dataset.py).
- Natural Earth 10m admin-1 states and provinces (public domain), pinned commit, downloaded here.

Outputs (committed):
- data/processed/subdivision_monthly.parquet: detections per (country, subdivision, month, sensor),
  same filters as the country totals (`clean_archive`: type == 0 + confidence).
- data/context/world_subdivisions.geojson: simplified polygons for the map,
  properties {country, name, type, iso_a2}.

Each detection is snapped to a 0.01 deg cell (~1 km, the MODIS pixel size) and the cell centre is
assigned to the subdivision polygon that contains it, or to the nearest one within 0.1 deg (coastal
detections that fall just outside Natural Earth's coastline). The script prints how much of each
country's total was assigned, so the coverage is checked on every build.

Usage (from backend/): uv run python scripts/build_subdivisions.py [--workers 8]
"""

import argparse
import io
import json
import sys
import zipfile
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import mapping, shape

from brasa.ingestion.archive import clean_archive

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
RAW_GLOBAL = DATA_DIR / "raw" / "firms_global"
NE_FILE = DATA_DIR / "raw" / "boundaries" / "ne_10m_admin_1_states_provinces.geojson"
NE_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/117488d/"
    "geojson/ne_10m_admin_1_states_provinces.geojson"
)
COUNTRY_MONTHLY = DATA_DIR / "processed" / "country_monthly.parquet"
TARGET = DATA_DIR / "processed" / "subdivision_monthly.parquet"
GEOMETRY_TARGET = DATA_DIR / "context" / "world_subdivisions.geojson"

COLUMNS = ["latitude", "longitude", "acq_date", "acq_time", "satellite", "instrument",
           "confidence", "frp", "type"]  # fmt: skip
CELL = 100  # cells per degree: 0.01 deg
NEAREST_MAX_DEG = 0.1
COORD_DECIMALS = 3  # ~100 m, plenty for a country-level map

# FIRMS file-name country -> Natural Earth `admin`, where the names differ. A country takes every
# feature of its `admin` except the overseas units FIRMS ships as countries of their own (France
# without French Guiana, Reunion...); a FIRMS country with no `admin` falls back to `geonunit`.
ALIASES = {
    "Aland Islands": "Aland",
    "Bahamas": "The Bahamas",
    "Brunei Darussalam": "Brunei",
    "Cote d Ivoire": "Ivory Coast",
    "Curacao": "Curaçao",
    "Dem Rep Korea": "North Korea",
    "Faeroe Islands": "Faroe Islands",
    "Guinea-Bissau": "Guinea Bissau",
    "Heard I and McDonald Islands": "Heard Island and McDonald Islands",
    "Hong Kong": "Hong Kong S.A.R.",
    "Lao PDR": "Laos",
    "Macedonia Former Yugoslav Republic of": "Macedonia",
    "Republic of Congo": "Republic of the Congo",
    "Republic of Korea": "South Korea",
    "Russian Federation": "Russia",
    "Saint-Barthelemy": "Saint Barthelemy",
    "Saint-Martin": "Saint Martin",
    "Serbia": "Republic of Serbia",  # geonunit "Serbia" would drop Vojvodina
    "South Sudan": "S. Sudan",
    "Tanzania": "United Republic of Tanzania",  # geonunit "Tanzania" would drop Zanzibar
    "The Gambia": "Gambia",
    "Timor-Leste": "East Timor",
    "United States": "United States of America",
    "Wallis and Futuna Islands": "Wallis and Futuna",
}


def country_name(member: str) -> str:
    # "modis/2000/modis_2000_Cote_d_Ivoire.csv" -> "Cote d Ivoire" (same as build_global_dataset)
    return Path(member).stem.split("_", 2)[2].replace("_", " ")


def match_features(
    country: str, features: list[dict[str, Any]], countries: set[str]
) -> list[dict[str, Any]]:
    admin = ALIASES.get(country, country)
    others = countries - {country}
    by_admin = [
        f
        for f in features
        if f["properties"]["admin"] == admin and f["properties"]["geonunit"] not in others
    ]
    return by_admin or [f for f in features if f["properties"]["geonunit"] == country]


def subdivisions(countries: list[str], features: list[dict[str, Any]]) -> dict[str, list[dict]]:
    """Country -> [{name, type, iso_a2, geometry}], names made unique within the country."""
    result = {}
    for country in countries:
        matched = [f for f in match_features(country, features, set(countries)) if f["geometry"]]
        if not matched:
            continue
        names = [f["properties"]["name"] or f["properties"]["adm1_code"] for f in matched]
        repeated = {n for n, k in Counter(names).items() if k > 1}
        result[country] = [
            {
                "name": f"{n} ({f['properties']['adm1_code']})" if n in repeated else n,
                "type": f["properties"]["type_en"] or "Region",
                "iso_a2": f["properties"]["iso_a2"],
                "geometry": shape(f["geometry"]),
            }
            for n, f in zip(names, matched, strict=True)
        ]
    return result


class Assigner:
    """Cell -> subdivision index for one country, with a cache across years."""

    def __init__(self, geometries: list[Any]) -> None:
        self.tree = shapely.STRtree(geometries)
        self.cache: dict[tuple[int, int], int] = {}

    def assign(self, ilat: np.ndarray, ilon: np.ndarray) -> np.ndarray:
        keys = list(zip(ilat.tolist(), ilon.tolist(), strict=True))
        new = [k for k in dict.fromkeys(keys) if k not in self.cache]
        if new:
            lat = np.array([k[0] for k in new]) / CELL
            lon = np.array([k[1] for k in new]) / CELL
            points = shapely.points(lon, lat)
            found = np.full(len(new), -1)
            point_idx, geom_idx = self.tree.query(points, predicate="intersects")
            found[point_idx] = geom_idx  # a point on a shared border keeps either side
            missing = np.flatnonzero(found < 0)
            if missing.size:
                near_idx, near_geom = self.tree.query_nearest(
                    points[missing], max_distance=NEAREST_MAX_DEG
                )
                found[missing[near_idx]] = near_geom
            self.cache.update(zip(new, found.tolist(), strict=True))
        return np.array([self.cache[k] for k in keys])


_STATE: dict[str, Any] = {}


def _init_worker(countries: list[str]) -> None:
    features = json.loads(NE_FILE.read_text(encoding="utf-8"))["features"]
    subs = subdivisions(countries, features)
    _STATE["names"] = {c: [s["name"] for s in items] for c, items in subs.items()}
    _STATE["assigners"] = {c: Assigner([s["geometry"] for s in items]) for c, items in subs.items()}


def aggregate_zip(path: Path) -> tuple[pd.DataFrame, Counter[str], Counter[str]]:
    """Counts per (country, subdivision, month, sensor), plus assigned/total per country."""
    frames, assigned, total = [], Counter[str](), Counter[str]()
    with zipfile.ZipFile(path) as archive:
        for member in archive.namelist():
            country = country_name(member) if member.endswith(".csv") else ""
            if country not in _STATE["assigners"]:
                continue
            with archive.open(member) as raw:
                frame = pd.read_csv(
                    io.TextIOWrapper(raw), usecols=COLUMNS, dtype={"confidence": str}
                )
            if frame.empty:
                continue
            clean = clean_archive(frame)
            cells = (
                clean.assign(
                    month=clean["acq_date"].dt.to_period("M").dt.to_timestamp(),
                    ilat=np.round(clean["latitude"].to_numpy() * CELL).astype(int),
                    ilon=np.round(clean["longitude"].to_numpy() * CELL).astype(int),
                )
                .groupby(["ilat", "ilon", "month", "sensor"], as_index=False, observed=True)
                .size()
            )
            index = _STATE["assigners"][country].assign(
                cells["ilat"].to_numpy(), cells["ilon"].to_numpy()
            )
            total[country] += int(cells["size"].sum())
            cells = cells[index >= 0].assign(subdivision=index[index >= 0])
            assigned[country] += int(cells["size"].sum())
            counts = cells.groupby(["subdivision", "month", "sensor"], as_index=False)["size"].sum()
            names = _STATE["names"][country]
            frames.append(
                counts.assign(
                    country=country,
                    subdivision=[names[i] for i in counts["subdivision"]],
                ).rename(columns={"size": "count"})
            )
    empty = pd.DataFrame(columns=["country", "subdivision", "month", "sensor", "count"])
    return pd.concat(frames, ignore_index=True) if frames else empty, assigned, total


def map_geometry(geometry: Any, tolerance: float) -> Any:
    simple = shapely.simplify(geometry, tolerance, preserve_topology=True)
    return shapely.transform(simple, lambda xy: np.round(xy, COORD_DECIMALS))


def unwrap_antimeridian(geometries: list[Any]) -> list[Any]:
    """Shift west longitudes by +360 for countries that straddle 180 deg (Russia, USA, Fiji)
    so the map draws them in one piece. Display only: assignment uses the original shapes."""
    west, _, east, _ = shapely.total_bounds(geometries)
    if east - west <= 180:  # noqa: PLR2004
        return geometries
    shift = lambda xy: np.column_stack([np.where(xy[:, 0] < 0, xy[:, 0] + 360, xy[:, 0]), xy[:, 1]])  # noqa: E731
    return [shapely.transform(g, shift) for g in geometries]


def write_geometry(subs: dict[str, list[dict]]) -> None:
    features = []
    for country, items in sorted(subs.items()):
        geoms = [s["geometry"] for s in items]
        west, south, east, north = shapely.total_bounds(geoms)
        tolerance = max(0.005, 0.002 * max(min(east - west, 180), north - south))
        drawn = unwrap_antimeridian([map_geometry(g, tolerance) for g in geoms])
        features += [
            {
                "type": "Feature",
                "properties": {
                    "country": country,
                    "name": s["name"],
                    "type": s["type"],
                    "iso_a2": s["iso_a2"],
                },
                "geometry": mapping(g),
            }
            for s, g in zip(items, drawn, strict=True)
            if not g.is_empty
        ]
    text = json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":"))
    GEOMETRY_TARGET.write_text(text, encoding="utf-8")
    print(f"{len(features):,} subdivisions, {len(text) / 1e6:.1f} MB -> {GEOMETRY_TARGET}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    if not NE_FILE.exists():
        NE_FILE.parent.mkdir(parents=True, exist_ok=True)
        NE_FILE.write_bytes(httpx.get(NE_URL, timeout=120, follow_redirects=True).content)
    zips = sorted(RAW_GLOBAL.glob("*_all_countries.zip"))
    if not zips or not COUNTRY_MONTHLY.exists():
        print("Run scripts/build_global_dataset.py first.", file=sys.stderr)
        return 1

    countries = sorted(pd.read_parquet(COUNTRY_MONTHLY)["country"].astype(str).unique())
    subs = subdivisions(countries, json.loads(NE_FILE.read_text(encoding="utf-8"))["features"])
    print(f"{len(subs)} of {len(countries)} countries have Natural Earth subdivisions")
    write_geometry(subs)

    frames, assigned, total = [], Counter[str](), Counter[str]()
    with ProcessPoolExecutor(args.workers, initializer=_init_worker, initargs=(countries,)) as pool:
        for path, (frame, a, t) in zip(zips, pool.map(aggregate_zip, zips), strict=True):
            frames.append(frame)
            assigned.update(a)
            total.update(t)
            print(f"ok   {path.name}", flush=True)

    result = pd.concat(frames, ignore_index=True)
    result = (
        result.groupby(["country", "subdivision", "month", "sensor"], as_index=False)["count"]
        .sum()
        .astype(
            {
                "country": "category",
                "subdivision": "category",
                "sensor": "category",
                "count": "int32",
            }
        )
    )
    result.to_parquet(TARGET, index=False, compression="zstd", compression_level=19)
    print(f"{len(result):,} rows -> {TARGET} ({TARGET.stat().st_size / 1e6:.1f} MB)")

    share = sum(assigned.values()) / sum(total.values())
    print(f"assigned to a subdivision: {share:.2%} of {sum(total.values()):,} detections")
    worst = sorted(total, key=lambda c: assigned[c] / total[c])[:10]
    for country in worst:
        print(f"  {country}: {assigned[country] / total[country]:.1%} of {total[country]:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
