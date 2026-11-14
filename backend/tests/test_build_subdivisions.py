"""The parts of scripts/build_subdivisions.py that decide where a detection is counted."""

import sys
from pathlib import Path
from typing import Any

import numpy as np
import shapely
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_subdivisions as build


def _feature(admin: str, geonunit: str, name: str, geometry: Any = None) -> dict[str, Any]:
    return {
        "properties": {
            "admin": admin,
            "geonunit": geonunit,
            "name": name,
            "adm1_code": f"{admin[:3]}-{name}",
            "type_en": "Region",
            "iso_a2": "XX",
        },
        "geometry": shapely.geometry.mapping(geometry or box(0, 0, 1, 1)),
    }


FEATURES = [
    _feature("France", "France", "Bretagne"),
    _feature("France", "French Guiana", "Guyane"),
    _feature("Republic of Serbia", "Serbia", "Belgrade"),
    _feature("Republic of Serbia", "Vojvodina", "Novi Sad"),
    _feature("Bosnia and Herzegovina", "Republic Srpska", "Banja Luka"),
    _feature("Bosnia and Herzegovina", "Federation of B. and H.", "Sarajevo"),
]
FIRMS_COUNTRIES = {"France", "French Guiana", "Serbia", "Bosnia and Herzegovina"}


def _names(country: str) -> list[str]:
    return [
        f["properties"]["name"] for f in build.match_features(country, FEATURES, FIRMS_COUNTRIES)
    ]


def test_country_keeps_its_admin_but_not_overseas_units_published_apart() -> None:
    assert _names("France") == ["Bretagne"]
    assert _names("French Guiana") == ["Guyane"]  # falls back to geonunit


def test_aliases_and_every_geonunit_of_the_admin() -> None:
    assert _names("Serbia") == ["Belgrade", "Novi Sad"]
    assert _names("Bosnia and Herzegovina") == ["Banja Luka", "Sarajevo"]
    assert _names("Atlantis") == []


def test_repeated_names_are_made_unique() -> None:
    twins = [_feature("Land", "Land", "North"), _feature("Land", "Land", "North")]
    twins[1]["properties"]["adm1_code"] = "LAN-2"
    names = [s["name"] for s in build.subdivisions(["Land"], twins)["Land"]]
    assert names == ["North (Lan-North)", "North (LAN-2)"]


def test_assigner_inside_coastal_and_far_points() -> None:
    assigner = build.Assigner([box(0, 0, 1, 1), box(1, 0, 2, 1)])
    cells = build.CELL
    lat = np.array([0.5, 0.5, 0.5, 5.0]) * cells
    lon = np.array([0.5, 1.5, 2.05, 5.0]) * cells  # inside A, inside B, 0.05 deg off B, far
    assert assigner.assign(lat.astype(int), lon.astype(int)).tolist() == [0, 1, 1, -1]
    assert len(assigner.cache) == 4
    assert assigner.assign(lat[:1].astype(int), lon[:1].astype(int)).tolist() == [0]  # cached


def test_antimeridian_countries_are_drawn_in_one_piece() -> None:
    east, west = box(170, 60, 180, 70), box(-180, 60, -170, 70)
    shifted = build.unwrap_antimeridian([east, west])
    assert shapely.total_bounds(shifted).tolist() == [170, 60, 190, 70]
    assert build.unwrap_antimeridian([box(0, 0, 1, 1)])[0].equals(box(0, 0, 1, 1))


def test_country_name_from_member() -> None:
    assert build.country_name("modis/2000/modis_2000_Cote_d_Ivoire.csv") == "Cote d Ivoire"
