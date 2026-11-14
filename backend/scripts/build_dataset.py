"""Build data/processed/detections.parquet from the raw FIRMS archive in data/raw/firms/.

Each detection is tagged with the Colombian department whose polygon contains it (the same
geoBoundaries polygons the map draws), so a department's numbers are its own and not those of the
rectangle around it. It also writes data/context/static_sources.csv, the 0.01 deg cells where
the archive saw non-vegetation sources, used to clean near-real-time detections.

Usage (from backend/): uv run python scripts/build_dataset.py
Run scripts/download_firms_archive.py first.
"""

from pathlib import Path

import pandas as pd

from brasa.ingestion.archive import build_detections, static_cells
from brasa.ingestion.boundaries import assign_regions, load_departments

DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def main() -> None:
    raw_dir = DATA_DIR / "raw" / "firms"
    detections = build_detections(raw_dir)
    departments = load_departments(DATA_DIR / "context" / "colombia_departments.geojson")[
        "features"
    ]
    index = assign_regions(
        departments, detections["longitude"].to_numpy(), detections["latitude"].to_numpy()
    )
    detections["department"] = pd.Categorical.from_codes(
        index, categories=[feature["properties"]["name"] for feature in departments]
    )
    target = DATA_DIR / "processed" / "detections.parquet"
    target.parent.mkdir(parents=True, exist_ok=True)
    # Compact encoding so the file can live in git (~20 MB): float32 keeps FIRMS' 4 decimals.
    compact = detections.astype(
        {"latitude": "float32", "longitude": "float32", "frp": "float32", "acq_time": "int16"}
    ).astype({"sensor": "category", "satellite": "category"})
    compact.to_parquet(target, index=False, compression="zstd", compression_level=19)
    print(f"{len(detections):,} detections -> {target}")
    print(detections.groupby("sensor")["acq_date"].agg(["count", "min", "max"]).to_string())
    outside = int(detections["department"].isna().sum())
    print(f"{outside:,} detections outside every department polygon (coast and border slivers)")

    cells = static_cells(raw_dir)
    cells.to_csv(DATA_DIR / "context" / "static_sources.csv", index=False)
    print(f"{len(cells):,} static-source cells -> data/context/static_sources.csv")


if __name__ == "__main__":
    main()
