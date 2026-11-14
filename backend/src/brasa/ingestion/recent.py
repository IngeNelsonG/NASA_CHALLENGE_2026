"""Near-real-time VIIRS detections of the last days, from NASA FIRMS' public 7-day files.

These files need no MAP_KEY: fixed URLs on firms.modaps.eosdis.nasa.gov, refreshed by NASA
several times a day. They are near-real-time (NRT) data, not the archive: no `type` column, so
static sources are removed with the mask built from the archive (`static_cells`), and they are
preliminary until FIRMS reprocesses them. They are never mixed into the calendar.

Security: the URLs are constants (nothing user-controlled reaches the request), the download is
streamed with a size cap, and any failure leaves the feature unavailable instead of raising.
"""

import csv
import itertools
import logging
import threading
import time
from collections.abc import Callable, Iterable, Iterator, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pandas as pd

from brasa.domain.models import COLOMBIA
from brasa.ingestion.archive import cell_index
from brasa.ingestion.boundaries import assign_regions

logger = logging.getLogger(__name__)

BASE_URL = "https://firms.modaps.eosdis.nasa.gov/data/active_fire"
# VIIRS 375 m satellites, the archive's own (Suomi NPP) first; NOAA-20 and NOAA-21 carry the same
# instrument and step in when Suomi NPP has no recent data.
FEEDS = (
    ("Suomi NPP", "suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_South_America_7d.csv"),
    ("NOAA-20", "noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_America_7d.csv"),
    ("NOAA-21", "noaa-21-viirs-c2/csv/J2_VIIRS_C2_South_America_7d.csv"),
)
TIMEOUT_SECONDS = 20.0  # per read; the whole file takes about 30 s
MAX_BYTES = 150_000_000  # the file peaks near 60 MB in the Amazon's fire season
REFRESH_SECONDS = 3 * 3600
RETRY_SECONDS = 600  # after a failure, do not hammer FIRMS
MIN_COMPLETE_DAYS = 3
KEPT_CONFIDENCE = frozenset({"n", "h"})  # nominal and high, as in the archive

Fetch = Callable[[str], Iterable[str]]


@dataclass(frozen=True, eq=False)  # compared by identity: one object per download
class RecentDetections:
    """Confident detections inside Colombia on the complete UTC days of one feed."""

    satellite: str
    days: tuple[date, ...]  # complete days, oldest first
    points: pd.DataFrame  # latitude, longitude, acq_date (datetime64), department
    fetched_at: datetime


def fetch_lines(url: str) -> Iterator[str]:
    """Stream a text file line by line, refusing anything larger than MAX_BYTES."""
    with httpx.stream("GET", url, timeout=TIMEOUT_SECONDS) as response:
        response.raise_for_status()
        received = 0
        for line in response.iter_lines():
            received += len(line) + 1
            if received > MAX_BYTES:
                raise ValueError("FIRMS file larger than expected.")
            yield line


def parse_feed(lines: Iterable[str]) -> tuple[pd.DataFrame, list[date]]:
    """(confident rows inside Colombia's box, every date present in the whole file).

    Rows are filtered while streaming, so South America's file never sits in memory whole."""
    rows: list[tuple[float, float, str]] = []
    dates: set[str] = set()
    for record in csv.DictReader(lines):
        try:
            latitude, longitude = float(record["latitude"]), float(record["longitude"])
            day, confidence = record["acq_date"], record["confidence"]
        except (KeyError, TypeError, ValueError):
            continue  # a malformed row is skipped, never trusted
        dates.add(day)
        if (
            confidence[:1].lower() in KEPT_CONFIDENCE
            and COLOMBIA.west <= longitude <= COLOMBIA.east
            and COLOMBIA.south <= latitude <= COLOMBIA.north
        ):
            rows.append((latitude, longitude, day))
    frame = pd.DataFrame(rows, columns=["latitude", "longitude", "acq_date"])
    frame["acq_date"] = pd.to_datetime(frame["acq_date"], errors="coerce")
    parsed = sorted(
        d.date() for d in pd.to_datetime(list(dates), errors="coerce") if not pd.isna(d)
    )
    return frame.dropna(subset=["acq_date"]), parsed


def complete_days(dates: list[date]) -> tuple[date, ...]:
    """The file covers a rolling week, so its first and last dates are partial days: drop them
    and keep the run of consecutive days in between."""
    inner = dates[1:-1]
    if any(b - a != timedelta(days=1) for a, b in itertools.pairwise(inner)):
        return ()
    return tuple(inner)


def drop_static(points: pd.DataFrame, static: frozenset[tuple[int, int]]) -> pd.DataFrame:
    """Remove detections on cells where the archive saw gas flares or other static sources."""
    if points.empty or not static:
        return points
    cells = zip(cell_index(points["latitude"]), cell_index(points["longitude"]), strict=True)
    keep = np.fromiter(
        ((lat, lon) not in static for lat, lon in cells), dtype=bool, count=len(points)
    )
    return points[keep]


def load_static_cells(path: Path) -> frozenset[tuple[int, int]]:
    if not path.exists():
        logger.warning("%s not found: recent detections keep static sources.", path.name)
        return frozenset()
    cells = pd.read_csv(path)
    return frozenset(zip(cells["lat_cell"].tolist(), cells["lon_cell"].tolist(), strict=True))


def in_colombia(points: pd.DataFrame, departments: Sequence[dict[str, Any]]) -> pd.DataFrame:
    """Tag each point with its department and drop those in no department: the box around
    Colombia also holds parts of its neighbours, which the Colombian archive does not."""
    index = assign_regions(
        list(departments), points["longitude"].to_numpy(), points["latitude"].to_numpy()
    )
    names = pd.Index([feature["properties"]["name"] for feature in departments], dtype=str)
    tagged = points.assign(department=pd.Categorical.from_codes(index, categories=names))
    return tagged[index >= 0]


def load_recent(
    static: frozenset[tuple[int, int]],
    departments: Sequence[dict[str, Any]],
    fetch: Fetch = fetch_lines,
) -> RecentDetections | None:
    """The first satellite with at least MIN_COMPLETE_DAYS complete days; None if none has."""
    for satellite, path in FEEDS:
        try:
            points, dates = parse_feed(fetch(f"{BASE_URL}/{path}"))
        except (httpx.HTTPError, ValueError, csv.Error) as error:
            logger.warning("FIRMS recent feed %s failed: %s", satellite, type(error).__name__)
            continue
        days = complete_days(dates)
        if len(days) < MIN_COMPLETE_DAYS:
            continue
        inside = points[points["acq_date"].dt.date.isin(days)]
        return RecentDetections(
            satellite=satellite,
            days=days,
            points=in_colombia(drop_static(inside, static), departments).reset_index(drop=True),
            fetched_at=datetime.now(UTC),
        )
    return None


def in_background(job: Callable[[], None]) -> None:
    threading.Thread(target=job, name="firms-recent", daemon=True).start()


class RecentSource:
    """The latest feed, refreshed every REFRESH_SECONDS without making anyone wait.

    FIRMS serves the file slowly (about 30 s), so `get` never downloads: it returns what is
    cached (None until the first download ends) and, when a refresh is due, starts one in the
    background. `run` exists so tests can refresh inline."""

    def __init__(
        self,
        static: frozenset[tuple[int, int]],
        departments: Sequence[dict[str, Any]],
        fetch: Fetch = fetch_lines,
        clock: Callable[[], float] = time.monotonic,
        run: Callable[[Callable[[], None]], None] = in_background,
    ) -> None:
        self._static = static
        self._departments = departments
        self._fetch = fetch
        self._clock = clock
        self._run = run
        self._lock = threading.Lock()
        self._value: RecentDetections | None = None
        self._next_refresh = 0.0
        self._refreshing = False

    def get(self) -> RecentDetections | None:
        with self._lock:
            due = not self._refreshing and self._clock() >= self._next_refresh
            self._refreshing = self._refreshing or due
        if due:
            self._run(self._refresh)
        return self._value

    def _refresh(self) -> None:
        fresh = None
        try:
            fresh = load_recent(self._static, self._departments, self._fetch)
        except Exception:  # a background thread must never die silently mid-refresh
            logger.exception("FIRMS recent feed: unexpected error")
        with self._lock:
            # A failed refresh keeps the previous data and retries sooner.
            self._value = fresh or self._value
            self._next_refresh = self._clock() + (REFRESH_SECONDS if fresh else RETRY_SECONDS)
            self._refreshing = False
