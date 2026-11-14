"""Near-real-time feed: parsing, cleaning, caching and the comparison with the archive.

Nothing here touches the network: `fetch` is always a fake.
"""

from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from datetime import date
from typing import Any

import httpx
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from brasa.api.app import create_app
from brasa.api.service import CalendarService
from brasa.config import Settings
from brasa.domain.models import COLOMBIA
from brasa.ingestion import recent as recent_module
from brasa.ingestion.recent import (
    FEEDS,
    RecentSource,
    complete_days,
    drop_static,
    fetch_lines,
    load_recent,
    parse_feed,
)

HEADER = "latitude,longitude,bright_ti4,acq_date,acq_time,satellite,confidence,version,frp"


def _row(lat: float, lon: float, day: str, confidence: str = "nominal") -> str:
    return f"{lat},{lon},330.1,{day},1830,N20,{confidence},2.0NRT,4.2"


def _square(name: str, west: float, south: float, size: float = 2) -> dict[str, Any]:
    east, north = west + size, south + size
    ring = [[west, south], [east, south], [east, north], [west, north], [west, south]]
    return {"properties": {"name": name}, "geometry": {"type": "Polygon", "coordinates": [ring]}}


DEPARTMENTS = [_square("West", -74, 3), _square("East", -72, 3)]
# 2026-11-05 and 2026-11-09 are the partial first and last days of the rolling week.
FEED = [
    HEADER,
    _row(4.0, -73.0, "2026-11-05"),
    _row(4.0, -73.0, "2026-11-06"),
    _row(4.1, -73.1, "2026-11-06", "high"),
    _row(4.2, -71.0, "2026-11-07"),
    _row(4.0, -73.0, "2026-11-07", "low"),  # low confidence: dropped
    _row(4.5, -73.5, "2026-11-08"),  # on a gas flare: dropped by the mask
    _row(8.0, -73.0, "2026-11-08"),  # inside Colombia's box, in no department: a neighbour
    _row(-15.0, -55.0, "2026-11-08"),  # Brazil
    "not,a,row",
    _row(4.0, -73.0, "2026-11-09"),
]
STATIC = frozenset({(450, -7350)})


def test_parse_feed_keeps_confident_rows_inside_colombias_box() -> None:
    points, dates = parse_feed(FEED)
    assert len(points) == 7  # everything but low confidence, Brazil and the malformed row
    assert pd.api.types.is_datetime64_any_dtype(points["acq_date"])
    assert dates == [date(2026, 11, day) for day in (5, 6, 7, 8, 9)]


def test_complete_days_drops_the_partial_ends_and_refuses_gaps() -> None:
    days = [date(2026, 11, day) for day in (5, 6, 7, 8, 9)]
    assert complete_days(days) == tuple(days[1:-1])
    assert complete_days([days[0], days[1], days[3], days[4]]) == ()  # a day is missing
    assert complete_days(days[:2]) == ()


def test_drop_static_removes_points_on_masked_cells() -> None:
    points = pd.DataFrame({"latitude": [4.505, 4.0], "longitude": [-73.495, -73.0]})
    assert drop_static(points, STATIC)["latitude"].tolist() == [4.0]
    assert len(drop_static(points, frozenset())) == 2


def _fetch(feeds: dict[str, Iterable[str] | Exception]) -> Any:
    def fetch(url: str) -> Iterable[str]:
        feed = feeds.get(url.rsplit("/", 1)[-1], [HEADER])
        if isinstance(feed, Exception):
            raise feed
        return feed

    return fetch


NOAA20 = FEEDS[1][1].rsplit("/", 1)[-1]


def _inline(job: Any) -> None:
    job()


def test_load_recent_uses_the_first_satellite_with_complete_days() -> None:
    # Suomi NPP is empty (as on 2026-11-12), NOAA-20 has data.
    loaded = load_recent(STATIC, DEPARTMENTS, _fetch({NOAA20: FEED}))
    assert loaded is not None
    assert loaded.satellite == "NOAA-20"
    assert loaded.days == (date(2026, 11, 6), date(2026, 11, 7), date(2026, 11, 8))
    # Two in West on the 6th, one in East on the 7th; the flare and the neighbour are gone.
    assert loaded.points["department"].tolist() == ["West", "West", "East"]


def test_load_recent_survives_failures_and_empty_feeds() -> None:
    failing = {name.rsplit("/", 1)[-1]: httpx.ConnectError("down") for _, name in FEEDS}
    assert load_recent(STATIC, DEPARTMENTS, _fetch(failing)) is None
    assert load_recent(STATIC, DEPARTMENTS, _fetch({})) is None  # header only everywhere


def test_recent_source_caches_and_keeps_old_data_when_a_refresh_fails() -> None:
    now = [0.0]
    calls: list[str] = []
    feeds: dict[str, Iterable[str] | Exception] = {NOAA20: FEED}

    def fetch(url: str) -> Iterable[str]:
        calls.append(url)
        return _fetch(feeds)(url)

    source = RecentSource(STATIC, DEPARTMENTS, fetch, clock=lambda: now[0], run=_inline)
    first = source.get()
    assert first is not None and len(calls) == 2  # Suomi NPP (empty), then NOAA-20
    assert source.get() is first and len(calls) == 2  # cached
    now[0] = recent_module.REFRESH_SECONDS + 1
    feeds[NOAA20] = httpx.ReadTimeout("slow")
    assert source.get() is first  # refresh failed: the previous data stays
    retried = len(calls)
    now[0] += recent_module.RETRY_SECONDS - 1
    assert source.get() is first and len(calls) == retried  # not hammering FIRMS
    now[0] += 2
    feeds[NOAA20] = FEED
    assert source.get() is not first  # retried and refreshed


def test_fetch_lines_streams_and_refuses_oversized_files(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []

    @contextmanager
    def stream(method: str, url: str, timeout: float) -> Iterator[Any]:
        seen.append(f"{method} {url} {timeout}")

        class Response:
            def raise_for_status(self) -> None:
                return None

            def iter_lines(self) -> Iterator[str]:
                yield from ["a,b", "1,2"]

        yield Response()

    monkeypatch.setattr(httpx, "stream", stream)
    assert list(fetch_lines("https://example.test/file.csv")) == ["a,b", "1,2"]
    assert seen == ["GET https://example.test/file.csv 20.0"]
    monkeypatch.setattr(recent_module, "MAX_BYTES", 5)
    with pytest.raises(ValueError, match="larger than expected"):
        list(fetch_lines("https://example.test/file.csv"))


def _detections(rows: list[tuple[str, str, float]]) -> pd.DataFrame:
    """(date, sensor, longitude) rows plus a full MODIS/VIIRS overlap so calibration works."""
    overlap = [
        (f"{year}-{month:02d}-15", sensor, -73.0)
        for year in (2013, 2014, 2015, 2016)
        for month in range(1, 13)
        for sensor in ("MODIS", "VIIRS")
    ]
    frame = pd.DataFrame(overlap + rows, columns=["acq_date", "sensor", "longitude"])
    return frame.assign(latitude=4.0)


def test_same_days_by_year_counts_viirs_on_the_same_calendar_days() -> None:
    service = CalendarService.from_detections(
        _detections(
            [
                ("2014-11-06", "VIIRS", -73.0),
                ("2014-11-07", "VIIRS", -73.0),
                ("2014-11-07", "MODIS", -73.0),  # another sensor
                ("2014-11-09", "VIIRS", -73.0),  # another day
                ("2015-11-06", "VIIRS", -71.0),  # East
            ]
        ),
        departments=DEPARTMENTS,
    )
    days = [date(2026, 11, 6), date(2026, 11, 7)]
    assert service.same_days_by_year(COLOMBIA, None, days).to_dict() == {2014: 2, 2015: 1, 2016: 0}
    assert service.same_days_by_year(COLOMBIA, "West", days).to_dict() == {
        2014: 2,
        2015: 0,
        2016: 0,
    }


def test_same_days_by_year_leaves_out_a_year_the_archive_does_not_reach_yet() -> None:
    # The archive ends on 2016-12-15: November 2016 counts, late December 2016 does not.
    service = CalendarService.from_detections(_detections([]))
    assert list(service.same_days_by_year(COLOMBIA, None, [date(2026, 11, 6)]).index) == [
        2014,
        2015,
        2016,
    ]
    assert list(service.same_days_by_year(COLOMBIA, None, [date(2026, 12, 20)]).index) == [
        2014,
        2015,
    ]


def test_same_days_by_year_keeps_a_new_year_window_together() -> None:
    service = CalendarService.from_detections(
        _detections([("2014-12-31", "VIIRS", -73.0), ("2015-01-01", "VIIRS", -73.0)])
    )
    days = [date(2026, 12, 31), date(2027, 1, 1)]
    # Dec 31 2014 + Jan 1 2015 are one window, counted in 2014; 2016 has no following January.
    assert service.same_days_by_year(COLOMBIA, None, days).to_dict() == {2014: 2, 2015: 0}


TEST_SETTINGS = Settings(
    environment="test", anthropic_api_key=None, llm_base_url=None, llm_api_key=None, llm_model=None
)


def test_recent_endpoint_compares_the_last_days_with_their_normal() -> None:
    service = CalendarService.from_detections(
        _detections(
            [("2014-11-06", "VIIRS", -73.0)] * 2
            + [("2015-11-07", "VIIRS", -73.0)] * 4
            + [("2016-11-08", "VIIRS", -71.0)] * 6
        ),
        departments=DEPARTMENTS,
    )
    source = RecentSource(STATIC, DEPARTMENTS, _fetch({NOAA20: FEED}), run=_inline)
    client = TestClient(create_app(TEST_SETTINGS, service=service, recent=source))
    body = client.get("/api/v1/recent").json()
    assert body["available"] is True
    assert (body["satellite"], body["start"], body["end"]) == (
        "NOAA-20",
        "2026-11-06",
        "2026-11-08",
    )
    assert body["detections"] == 3
    assert [day["count"] for day in body["daily"]] == [2, 1, 0]
    # Same days in 2014, 2015, 2016: 2, 4, 6 detections.
    assert (body["normal_median"], body["baseline_years"]) == (4.0, 3)
    assert body["percent_of_normal"] == 75.0
    box = client.get("/api/v1/recent", params={"bbox": "-74,3,-72,5"}).json()
    assert box["detections"] == 2  # only the West half


def test_recent_endpoint_says_unavailable_instead_of_failing() -> None:
    offline = TestClient(create_app(TEST_SETTINGS))  # the test environment has no feed
    assert offline.get("/api/v1/recent").json()["available"] is False
    down = RecentSource(
        STATIC, DEPARTMENTS, _fetch({NOAA20: httpx.ConnectError("down")}), run=_inline
    )
    client = TestClient(create_app(TEST_SETTINGS, recent=down))
    body = client.get("/api/v1/recent").json()
    assert body == {**body, "available": False, "detections": None, "daily": []}
    assert client.get("/api/v1/recent", params={"department": "Atlantis"}).status_code == 422
    assert client.get("/api/v1/recent", params={"bbox": "1,2"}).status_code == 422


def test_recent_source_never_makes_a_caller_wait_for_the_download() -> None:
    """FIRMS takes ~30 s: the first callers get None while one background refresh runs."""
    jobs: list[Any] = []
    source = RecentSource(STATIC, DEPARTMENTS, _fetch({NOAA20: FEED}), run=jobs.append)
    assert source.get() is None
    assert source.get() is None
    assert len(jobs) == 1  # one refresh, not one per caller
    jobs[0]()
    loaded = source.get()
    assert loaded is not None and loaded.satellite == "NOAA-20"
    assert len(jobs) == 1


def test_recent_source_survives_an_unexpected_error_in_the_background() -> None:
    def broken(url: str) -> Iterable[str]:
        raise RuntimeError("boom")

    source = RecentSource(STATIC, DEPARTMENTS, broken, clock=lambda: 0.0, run=_inline)
    assert source.get() is None
    assert source.get() is None  # no retry storm: the next attempt waits RETRY_SECONDS


def test_in_background_runs_the_job_on_another_thread() -> None:
    done = recent_module.threading.Event()
    recent_module.in_background(done.set)
    assert done.wait(timeout=5)
