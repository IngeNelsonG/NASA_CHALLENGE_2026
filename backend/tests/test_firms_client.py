from datetime import date

import httpx
import pytest
from pydantic import SecretStr

from brasa.domain.models import COLOMBIA
from brasa.ingestion.firms_client import FirmsClient, FirmsConfigurationError, FirmsSource

FAKE_KEY = "test-key-not-real"
CSV_BODY = "latitude,longitude,acq_date\n4.6,-73.1,2024-01-02\n"


def _client(handler: httpx.MockTransport) -> FirmsClient:
    return FirmsClient(SecretStr(FAKE_KEY), http_client=httpx.Client(transport=handler))


def test_requires_map_key() -> None:
    with pytest.raises(FirmsConfigurationError):
        FirmsClient(None)
    with pytest.raises(FirmsConfigurationError):
        FirmsClient(SecretStr(""))


def test_fetch_area_builds_expected_url_and_tags_sensor() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, text=CSV_BODY)

    frame = _client(httpx.MockTransport(handler)).fetch_area(
        FirmsSource.VIIRS_NOAA20_NRT, COLOMBIA, date(2024, 1, 1), day_range=2
    )
    expected_path = f"/api/area/csv/{FAKE_KEY}/VIIRS_NOAA20_NRT/-79.1,-4.3,-66.8,13.5/2/2024-01-01"
    assert seen[0].endswith(expected_path)
    assert frame["sensor"].tolist() == ["VIIRS"]


def test_errors_do_not_leak_map_key() -> None:
    client = _client(httpx.MockTransport(lambda _: httpx.Response(403, text="denied")))
    with pytest.raises(httpx.HTTPStatusError) as error:
        client.fetch_area(FirmsSource.MODIS_NRT, COLOMBIA, date(2024, 1, 1))
    assert FAKE_KEY not in str(error.value)
    assert FAKE_KEY not in str(error.value.request.url)


@pytest.mark.parametrize("day_range", [0, 6])
def test_rejects_out_of_range_day_range(day_range: int) -> None:
    client = _client(httpx.MockTransport(lambda _: httpx.Response(200, text=CSV_BODY)))
    with pytest.raises(ValueError, match="day_range"):
        client.fetch_area(FirmsSource.MODIS_NRT, COLOMBIA, date(2024, 1, 1), day_range=day_range)


def test_secret_is_masked_in_repr() -> None:
    assert FAKE_KEY not in repr(SecretStr(FAKE_KEY))


def test_availability_reads_each_source_range() -> None:
    body = (
        "data_id,min_date,max_date\n"
        "VIIRS_SNPP_NRT,2026-08-01,2026-11-12\nMODIS_SP,2000-11-01,2026-07-31\n"
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.startswith("/api/data_availability/csv/")
        return httpx.Response(200, text=body)

    ranges = _client(httpx.MockTransport(handler)).availability()
    assert ranges["VIIRS_SNPP_NRT"] == (date(2026, 8, 1), date(2026, 11, 12))
    assert ranges["MODIS_SP"][0] == date(2000, 11, 1)
