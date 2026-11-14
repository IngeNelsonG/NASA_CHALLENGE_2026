"""Integrity of the committed datasets: they must agree with each other and with the archive.

These read the real files in data/ (committed, ~25 MB) and fail if a rebuild goes wrong.
"""

import json
from pathlib import Path

import pandas as pd
import pytest

from brasa.ingestion.boundaries import load_departments, load_world_subdivisions
from brasa.ingestion.oni import load_oni

DATA = Path(__file__).resolve().parents[1] / "data"
DETECTIONS = DATA / "processed" / "detections.parquet"
COUNTRY = DATA / "processed" / "country_monthly.parquet"
SUBDIVISION = DATA / "processed" / "subdivision_monthly.parquet"
WORLD_MAP = DATA / "context" / "world_subdivisions.geojson"
YEARLY_FILES_END = 2025  # the last year of FIRMS yearly files in the archive


@pytest.fixture(scope="module")
def detections() -> pd.DataFrame:
    return pd.read_parquet(DETECTIONS, columns=["acq_date", "sensor", "satellite"])


@pytest.fixture(scope="module")
def country() -> pd.DataFrame:
    return pd.read_parquet(COUNTRY).astype({"country": str, "sensor": str})


@pytest.fixture(scope="module")
def subdivision() -> pd.DataFrame:
    return pd.read_parquet(SUBDIVISION).astype({"country": str, "subdivision": str, "sensor": str})


def test_colombia_archive_shape(detections: pd.DataFrame) -> None:
    assert len(detections) == 2_126_940
    assert detections["sensor"].value_counts().to_dict() == {"VIIRS": 1_474_460, "MODIS": 652_480}
    assert str(detections["acq_date"].min().date()) == "2000-11-02"
    # Yearly files through 2025, then the Area API up to the last complete month.
    assert str(detections["acq_date"].max().date()) == "2026-10-31"
    # Suomi NPP (N), and NOAA-20 (N20) only on the days Suomi NPP had no data at all.
    year = detections["acq_date"].dt.year
    recent = detections[(year > YEARLY_FILES_END) & (detections["sensor"] == "VIIRS")]
    assert recent["satellite"].astype(str).value_counts().to_dict() == {"N": 64_272, "N20": 2_063}


def test_country_totals_match_colombian_points_exactly(
    detections: pd.DataFrame, country: pd.DataFrame
) -> None:
    """Two independent downloads (Colombia files vs worldwide zips) give the same counts over
    the years both cover (the worldwide zips stop in 2025)."""
    points = (
        detections[detections["acq_date"].dt.year <= YEARLY_FILES_END]
        .assign(month=detections["acq_date"].dt.to_period("M").dt.to_timestamp())
        .groupby(["month", "sensor"], observed=True)
        .size()
    )
    totals = country[country["country"] == "Colombia"].set_index(["month", "sensor"])["count"]
    assert points.sort_index().to_dict() == totals.sort_index().to_dict()


def test_worldwide_totals_cover_both_sensors_and_the_full_period(country: pd.DataFrame) -> None:
    assert country["country"].nunique() == 234
    assert set(country["sensor"]) == {"MODIS", "VIIRS"}
    assert str(country["month"].min().date()) == "2000-11-01"
    assert str(country["month"].max().date()) == "2025-12-01"
    assert (country["count"] > 0).all()


def test_subdivisions_add_up_to_their_country(
    country: pd.DataFrame, subdivision: pd.DataFrame
) -> None:
    national = country.groupby("country")["count"].sum()
    regional = subdivision.groupby("country")["count"].sum()
    share = regional / national.loc[regional.index]
    assert (share <= 1).all()  # a detection is never counted twice
    assert regional.sum() / national.sum() > 0.999
    big = national[national > 1_000_000].index.intersection(share.index)
    assert share.loc[big].min() > 0.98  # Ukraine (Crimea) is the lowest large country


def test_every_subdivision_with_data_is_on_the_map(subdivision: pd.DataFrame) -> None:
    features = json.loads(WORLD_MAP.read_text(encoding="utf-8"))["features"]
    on_map = {(f["properties"]["country"], f["properties"]["name"]) for f in features}
    with_data = set(subdivision[["country", "subdivision"]].itertuples(index=False, name=None))
    assert with_data <= on_map
    assert len(features) == len(on_map)  # names are unique within each country


def test_every_subdivision_has_a_type_once_loaded() -> None:
    """347 Natural Earth features have no type (Malta, Seychelles...); the map needs one."""
    world = load_world_subdivisions(WORLD_MAP)
    types = [f["properties"]["type"] for features in world.values() for f in features]
    assert len(types) == 4541  # 4,548 minus 7 unnamed "+99?" placeholders
    assert all(isinstance(kind, str) and kind for kind in types)
    malta = {f["properties"]["type"] for f in world["Malta"]}
    assert malta == {"Region"}


def test_every_detection_is_tagged_with_a_department_on_the_map() -> None:
    """Departments are counted by polygon. Their boxes overlap: Boyacá's box holds 6x its fire."""
    departments = load_departments(DATA / "context" / "colombia_departments.geojson")
    names = {f["properties"]["name"] for f in departments["features"]}
    tagged = pd.read_parquet(DETECTIONS, columns=["sensor", "department"])
    assert set(tagged["department"].cat.categories) == names
    assert {"Bogotá, D.C.", "San Andrés y Providencia"} <= names
    # Coast and border slivers of the simplified polygons: well under 0.1 %.
    assert tagged["department"].isna().sum() == 1_464
    viirs = tagged[tagged["sensor"] == "VIIRS"]["department"].value_counts()
    assert viirs.index[0] == "Vichada"
    assert viirs["Boyacá"] < 10_000  # its bounding box would give 47,158


def test_department_polygons_agree_with_natural_earth(subdivision: pd.DataFrame) -> None:
    """Two independent boundary sets (geoBoundaries here, Natural Earth worldwide) within 5 %."""
    stored = pd.read_parquet(DETECTIONS, columns=["acq_date", "department"])
    ours = stored.loc[stored["acq_date"].dt.year <= YEARLY_FILES_END, "department"].value_counts()
    theirs = subdivision[subdivision["country"] == "Colombia"].groupby("subdivision")["count"].sum()
    for name in ("Meta", "Vichada", "Casanare", "Caquetá", "Antioquia", "Cesar"):
        assert abs(ours[name] - theirs[name]) / theirs[name] < 0.05, name


def test_static_source_mask_covers_the_llanos_oil_fields() -> None:
    cells = pd.read_csv(DATA / "context" / "static_sources.csv")
    assert list(cells.columns) == ["lat_cell", "lon_cell"]
    assert len(cells) == 2_340
    assert not cells.duplicated().any()
    # 0.01 deg cells inside Colombia, San Andrés (81.7 W) included.
    assert cells["lat_cell"].between(-430, 1350).all()
    assert cells["lon_cell"].between(-8200, -6680).all()


def test_known_regions_look_right(subdivision: pd.DataFrame) -> None:
    """Sanity: the Llanos lead Colombia and Mato Grosso / Pará lead Brazil."""
    top = (
        subdivision.groupby(["country", "subdivision"], observed=True)["count"]
        .sum()
        .groupby(level=0, group_keys=False)
        .nlargest(2)
    )
    assert {name for _, name in top.loc[["Colombia"]].index} == {"Vichada", "Meta"}
    assert {name for _, name in top.loc[["Brazil"]].index} == {"Mato Grosso", "Pará"}


def test_oni_has_the_pitch_value() -> None:
    oni = load_oni(DATA / "context" / "oni.ascii.txt")
    assert oni[(2026, 9)] == pytest.approx(2.46)  # ASO 2026, centred on September
    assert oni[(2016, 1)] > 2  # DJF 2015-16, strong El Niño
