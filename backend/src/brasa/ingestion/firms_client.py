"""Minimal client for the NASA FIRMS Area API.

Security considerations:
- The MAP_KEY travels in the URL path, so full URLs are never logged.
- Parameters are validated against closed lists before building the request (prevents path
  injection / SSRF towards other endpoints).
- FIRMS limit: 5000 transactions per 10 minutes per MAP_KEY. For long series use the
  historical archive downloads, not this API.
"""

import io
import logging
from datetime import date
from enum import StrEnum

import httpx
import pandas as pd
from pydantic import SecretStr

from brasa.domain.models import BoundingBox, Sensor

logger = logging.getLogger(__name__)

MAX_DAY_RANGE = 5  # Area API limit per request (it was 10 until 2026)
REQUEST_TIMEOUT_SECONDS = 30.0


class FirmsSource(StrEnum):
    MODIS_NRT = "MODIS_NRT"
    MODIS_SP = "MODIS_SP"
    VIIRS_SNPP_NRT = "VIIRS_SNPP_NRT"
    VIIRS_SNPP_SP = "VIIRS_SNPP_SP"
    VIIRS_NOAA20_NRT = "VIIRS_NOAA20_NRT"
    VIIRS_NOAA20_SP = "VIIRS_NOAA20_SP"
    VIIRS_NOAA21_NRT = "VIIRS_NOAA21_NRT"

    @property
    def sensor(self) -> Sensor:
        return Sensor.MODIS if self.value.startswith("MODIS") else Sensor.VIIRS


class FirmsConfigurationError(RuntimeError):
    """Required configuration is missing (e.g. MAP_KEY)."""


class FirmsAuthError(httpx.HTTPStatusError):
    """FIRMS rejected the configured MAP_KEY (e.g. HTTP 400/401/403 'Invalid MAP_KEY.')."""


class FirmsClient:
    def __init__(
        self,
        map_key: SecretStr | None,
        base_url: str = "https://firms.modaps.eosdis.nasa.gov",
        http_client: httpx.Client | None = None,
    ) -> None:
        raw_key = map_key.get_secret_value().strip() if map_key is not None else ""
        if not raw_key:
            raise FirmsConfigurationError("BRASA_FIRMS_MAP_KEY is not configured.")
        self._map_key = SecretStr(raw_key)
        self._base_url = base_url.rstrip("/")
        self._http = http_client or httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS)

    def _area_url(self, source: FirmsSource, area: BoundingBox, day_range: int, start: date) -> str:
        key = self._map_key.get_secret_value()
        return (
            f"{self._base_url}/api/area/csv/{key}/{source.value}/"
            f"{area.as_firms_area()}/{day_range}/{start.isoformat()}"
        )

    def _get(self, url: str) -> str:
        response = self._http.get(url)
        body = response.text
        if response.status_code != httpx.codes.OK:
            # Do not propagate the URL: it contains the MAP_KEY.
            is_auth = (
                response.status_code in {httpx.codes.UNAUTHORIZED, httpx.codes.FORBIDDEN}
                or "Invalid MAP_KEY" in body
            )
            exc_cls = FirmsAuthError if is_auth else httpx.HTTPStatusError
            raise exc_cls(
                f"FIRMS responded {response.status_code}",
                request=httpx.Request("GET", self._base_url),
                response=response,
            )
        if body.lstrip().startswith(("Invalid MAP_KEY", "Invalid API call")):
            raise FirmsAuthError(
                "FIRMS rejected MAP_KEY",
                request=httpx.Request("GET", self._base_url),
                response=response,
            )
        return body

    def availability(self) -> dict[str, tuple[date, date]]:
        """First and last date each source holds (`/api/data_availability`)."""
        key = self._map_key.get_secret_value()
        text = self._get(f"{self._base_url}/api/data_availability/csv/{key}/all")
        frame = pd.read_csv(io.StringIO(text))
        return {
            str(source): (date.fromisoformat(str(first)), date.fromisoformat(str(last)))
            for source, first, last in zip(
                frame["data_id"], frame["min_date"], frame["max_date"], strict=True
            )
        }

    def fetch_area(
        self, source: FirmsSource, area: BoundingBox, start: date, day_range: int = 1
    ) -> pd.DataFrame:
        """Download `day_range` days of detections from `start` and add the `sensor` column."""
        if not 1 <= day_range <= MAX_DAY_RANGE:
            raise ValueError(f"day_range must be between 1 and {MAX_DAY_RANGE}.")

        logger.info("FIRMS request source=%s area=%s start=%s", source, area.as_firms_area(), start)
        frame = pd.read_csv(io.StringIO(self._get(self._area_url(source, area, day_range, start))))
        frame["sensor"] = source.sensor.value
        return frame
