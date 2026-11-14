import json
from pathlib import Path

import numpy as np

from brasa.ingestion.boundaries import (
    assign_regions,
    contains,
    departments_collection,
    geometry_bbox,
    load_departments,
)
from brasa.ingestion.oni import load_oni, parse_oni

ONI_SAMPLE = """ SEAS  YR   TOTAL   ANOM
  DJF 1950  25.01  -1.32
  JFM 1950  25.36  -1.20
  NDJ 2023  28.70   1.95
  XYZ 2023  28.70   9.99
  DJF 2024  28.62  oops
"""


def test_parse_oni_maps_season_to_centre_month() -> None:
    table = parse_oni(ONI_SAMPLE)
    assert table == {(1950, 1): -1.32, (1950, 2): -1.20, (2023, 12): 1.95}


def test_load_oni_missing_file_is_empty(tmp_path: Path) -> None:
    assert load_oni(tmp_path / "missing.txt") == {}


def test_geometry_bbox_handles_polygon_and_multipolygon() -> None:
    polygon = {"type": "Polygon", "coordinates": [[[-75.123456, 4.0], [-74.0, 5.987654]]]}
    assert geometry_bbox(polygon) == "-75.1235,4.0,-74.0,5.9877"
    multi = {
        "type": "MultiPolygon",
        "coordinates": [[[[-80, 12], [-81, 13]]], [[[-75, 1], [-74, 2]]]],
    }
    assert geometry_bbox(multi) == "-81.0,1.0,-74.0,13.0"


def test_departments_collection_keeps_geometry_and_adds_name_bbox() -> None:
    geometry = {"type": "Polygon", "coordinates": [[[-75, 4], [-74, 5], [-75, 5], [-75, 4]]]}
    raw = {"features": [{"properties": {"shapeName": "Caldas", "x": 1}, "geometry": geometry}]}
    feature = departments_collection(raw)["features"][0]
    assert feature["properties"] == {"name": "Caldas", "bbox": "-75.0,4.0,-74.0,5.0"}
    assert feature["geometry"] == geometry


def test_load_departments(tmp_path: Path) -> None:
    assert load_departments(tmp_path / "missing.geojson")["features"] == []
    path = tmp_path / "d.geojson"
    path.write_text(json.dumps({"features": []}))
    assert load_departments(path) == {"type": "FeatureCollection", "features": []}


def _ring(west: float, south: float, east: float, north: float) -> list[list[float]]:
    return [[west, south], [east, south], [east, north], [west, north], [west, south]]


def test_contains_handles_holes_and_multipolygons() -> None:
    donut = {"type": "Polygon", "coordinates": [_ring(0, 0, 10, 10), _ring(4, 4, 6, 6)]}
    lon = np.array([1.0, 5.0, 11.0, 9.5])
    lat = np.array([1.0, 5.0, 5.0, 9.5])
    assert contains(donut, lon, lat).tolist() == [True, False, False, True]
    islands = {
        "type": "MultiPolygon",
        "coordinates": [[_ring(0, 0, 1, 1)], [_ring(5, 5, 6, 6)]],
    }
    assert contains(islands, np.array([0.5, 5.5, 3.0]), np.array([0.5, 5.5, 3.0])).tolist() == [
        True,
        True,
        False,
    ]


def test_assign_regions_gives_each_point_its_polygon() -> None:
    features = [
        {"geometry": {"type": "Polygon", "coordinates": [_ring(0, 0, 2, 2)]}},
        {"geometry": {"type": "Polygon", "coordinates": [_ring(2, 0, 4, 2)]}},
    ]
    lon = np.array([1.0, 3.0, 9.0, 1.9])
    lat = np.array([1.0, 1.0, 1.0, 0.1])
    assert assign_regions(features, lon, lat).tolist() == [0, 1, -1, 0]
    assert assign_regions([], lon, lat).tolist() == [-1, -1, -1, -1]
