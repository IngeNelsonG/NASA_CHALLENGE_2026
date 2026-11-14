"""Boundaries: Colombian departments (geoBoundaries ADM1, with a bbox per feature) and
first-level subdivisions of every country (Natural Earth admin-1, simplified for the map)."""

import json
import logging
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

BBOX_DECIMALS = 4


def _points(coordinates: Any) -> Iterator[tuple[float, float]]:
    """Yield (lon, lat) from any GeoJSON nesting (Polygon, MultiPolygon...)."""
    if coordinates and isinstance(coordinates[0], int | float):
        yield float(coordinates[0]), float(coordinates[1])
        return
    for child in coordinates:
        yield from _points(child)


def geometry_bbox(geometry: dict[str, Any]) -> str:
    lons, lats = zip(*_points(geometry["coordinates"]), strict=True)
    west, south, east, north = (
        round(value, BBOX_DECIMALS) for value in (min(lons), min(lats), max(lons), max(lats))
    )
    return f"{west},{south},{east},{north}"


def _rings(geometry: dict[str, Any]) -> list[Any]:
    polygons = (
        [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    )
    return [ring for polygon in polygons for ring in polygon]


def contains(geometry: dict[str, Any], lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Which (lon, lat) points fall inside a GeoJSON Polygon / MultiPolygon (even-odd rule).

    Ray casting, one vectorized pass per edge: holes and multi-part shapes need no special case.
    """
    inside = np.zeros(len(lon), dtype=bool)
    for ring in _rings(geometry):
        xs, ys = np.asarray(ring, dtype=np.float64)[:, :2].T
        for x1, y1, x2, y2 in zip(xs[:-1], ys[:-1], xs[1:], ys[1:], strict=True):
            if y1 == y2:
                continue
            crosses = (y1 > lat) != (y2 > lat)
            crosses &= lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1
            inside ^= crosses
    return inside


def assign_regions(features: list[dict[str, Any]], lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Index of the feature that contains each point, -1 when none does.

    Only the points inside a feature's bounding box are tested against its edges. Where two
    simplified polygons overlap by a sliver, the first feature wins.
    """
    lon = np.asarray(lon, dtype=np.float64)
    lat = np.asarray(lat, dtype=np.float64)
    region = np.full(len(lon), -1, dtype=np.int16)
    for index, feature in enumerate(features):
        west, south, east, north = (float(v) for v in geometry_bbox(feature["geometry"]).split(","))
        candidates = np.flatnonzero(
            (region == -1) & (lon >= west) & (lon <= east) & (lat >= south) & (lat <= north)
        )
        hit = contains(feature["geometry"], lon[candidates], lat[candidates])
        region[candidates[hit]] = index
    return region


# geoBoundaries English or long names -> the names Colombians read.
DEPARTMENT_NAMES = {
    "Bogota Capital District": "Bogotá, D.C.",
    "Archipiélago de San Andrés, Providencia y Santa Catalina": "San Andrés y Providencia",
}


def departments_collection(raw: dict[str, Any]) -> dict[str, Any]:
    """Keep each geometry; replace properties with `name` and `bbox` (west,south,east,north)."""
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "name": DEPARTMENT_NAMES.get(
                        feature["properties"]["shapeName"], feature["properties"]["shapeName"]
                    ),
                    "bbox": geometry_bbox(feature["geometry"]),
                },
                "geometry": feature["geometry"],
            }
            for feature in raw["features"]
        ],
    }


def load_departments(path: Path) -> dict[str, Any]:
    if not path.exists():
        logger.warning("%s not found: serving no departments.", path.name)
        return {"type": "FeatureCollection", "features": []}
    return departments_collection(json.loads(path.read_text(encoding="utf-8")))


DEFAULT_TYPE = "Region"


def load_world_subdivisions(path: Path) -> dict[str, list[dict[str, Any]]]:
    """Country -> its subdivision features (scripts/build_subdivisions.py); {} if missing."""
    if not path.exists():
        logger.warning("%s not found: serving no world subdivisions.", path.name)
        return {}
    by_country: dict[str, list[dict[str, Any]]] = {}
    for feature in json.loads(path.read_text(encoding="utf-8"))["features"]:
        # "COL+99?", "MEX+99?"...: Natural Earth placeholders for unnamed specks (Malpelo island).
        if feature["properties"]["name"].endswith("+99?"):
            continue
        # Natural Earth leaves the type empty for some (Malta, Hong Kong, Seychelles...).
        feature["properties"]["type"] = feature["properties"].get("type") or DEFAULT_TYPE
        by_country.setdefault(feature["properties"]["country"], []).append(feature)
    return by_country
