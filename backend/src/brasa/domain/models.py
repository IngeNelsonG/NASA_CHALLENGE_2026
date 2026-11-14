"""Domain model: sensors, areas of interest and calendar cells."""

from dataclasses import dataclass
from enum import StrEnum

MIN_LATITUDE = -90.0
MAX_LATITUDE = 90.0
MIN_LONGITUDE = -180.0
MAX_LONGITUDE = 180.0

# Approximate box for mainland and insular Colombia; the default area of interest.
COLOMBIA_BBOX = (-79.1, -4.3, -66.8, 13.5)


class Sensor(StrEnum):
    """Active-fire sensor families published by NASA FIRMS."""

    MODIS = "MODIS"  # Terra/Aqua, 1 km, since 2000
    VIIRS = "VIIRS"  # S-NPP / NOAA-20 / NOAA-21, 375 m, since 2012


class InvalidBoundingBoxError(ValueError):
    """The area of interest is not geographically valid."""


@dataclass(frozen=True, slots=True)
class BoundingBox:
    """Area of interest in decimal degrees (WGS84): west, south, east, north."""

    west: float
    south: float
    east: float
    north: float

    def __post_init__(self) -> None:
        if not (MIN_LONGITUDE <= self.west < self.east <= MAX_LONGITUDE):
            raise InvalidBoundingBoxError("Longitudes out of range or west >= east.")
        if not (MIN_LATITUDE <= self.south < self.north <= MAX_LATITUDE):
            raise InvalidBoundingBoxError("Latitudes out of range or south >= north.")

    @classmethod
    def parse(cls, raw: str) -> "BoundingBox":
        """Build the box from 'west,south,east,north' without trusting the input."""
        parts = raw.split(",")
        if len(parts) != 4:  # noqa: PLR2004 - fixed format of 4 coordinates
            raise InvalidBoundingBoxError("Expected 4 values: west,south,east,north.")
        try:
            west, south, east, north = (float(part) for part in parts)
        except ValueError as error:
            raise InvalidBoundingBoxError("Coordinates must be numeric.") from error
        return cls(west, south, east, north)

    def as_firms_area(self) -> str:
        return f"{self.west},{self.south},{self.east},{self.north}"


COLOMBIA = BoundingBox(*COLOMBIA_BBOX)
