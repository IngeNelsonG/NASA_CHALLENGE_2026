import pytest

from brasa.domain.models import COLOMBIA, BoundingBox, InvalidBoundingBoxError


def test_parse_valid_bbox() -> None:
    bbox = BoundingBox.parse("-75.5,2.0,-70,6.5")
    assert bbox == BoundingBox(-75.5, 2.0, -70.0, 6.5)
    assert bbox.as_firms_area() == "-75.5,2.0,-70.0,6.5"


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "1,2,3",
        "a,b,c,d",
        "-70,2,-75,6",  # west >= east
        "-75,6,-70,2",  # south >= north
        "-190,0,10,10",
        "0,-95,10,10",
        "nan,0,10,10",
    ],
)
def test_parse_rejects_invalid_input(raw: str) -> None:
    with pytest.raises(InvalidBoundingBoxError):
        BoundingBox.parse(raw)


def test_colombia_default_is_valid() -> None:
    assert COLOMBIA.west < COLOMBIA.east
