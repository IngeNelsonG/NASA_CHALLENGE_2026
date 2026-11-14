"""API response contracts (versioned under /api/v1)."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str


class CalendarMonth(BaseModel):
    month: date
    raw_modis: int
    raw_viirs: int
    harmonized: float
    source: Literal["VIIRS", "MODIS_SCALED"]
    robust_z: float
    is_anomaly: bool
    is_critical_month: bool
    climatology_median: float
    climatology_q25: float
    climatology_q75: float
    oni: float | None
    # Nationwide context: regions (departments, states...) with unusually high activity.
    anomalous_departments: int | None = None
    is_widespread_anomaly: bool | None = None


Dataset = Literal["firms-archive", "synthetic-sample"]
Lang = Literal["es", "en"]


Scope = Literal["area", "country", "subdivision"]


class CalendarResponse(BaseModel):
    scope: Scope
    bbox: str | None
    country: str | None
    subdivision: str | None = None
    department: str | None = None
    area_name: str | None
    units: str
    dataset: Dataset
    sensor_ratio: float
    sensor_ratio_q25: float
    sensor_ratio_q75: float
    overlap_months: int
    departments_total: int | None
    months: list[CalendarMonth]


class Country(BaseModel):
    name: str
    detections_total: int
    # ISO 3166-1 alpha-2 (for localized names in the browser), when Natural Earth has one.
    iso_a2: str | None = None
    subdivisions_total: int = 0


class CountriesResponse(BaseModel):
    countries: list[Country]


class ExplainFacts(BaseModel):
    """Exactly what the language model sees; the summary may state nothing beyond this."""

    month: date
    harmonized: float
    raw_modis: int
    raw_viirs: int
    source: Literal["VIIRS", "MODIS_SCALED"]
    climatology_median: float
    climatology_q25: float
    climatology_q75: float
    robust_z: float
    is_anomaly: bool
    is_critical_month: bool
    oni: float | None
    rank_in_month_of_year: int
    years_in_record: int
    sensor_ratio: float
    area_name: str | None
    percent_of_normal: float | None
    previous_year_harmonized: float | None
    anomalous_departments: int | None = None
    departments_total: int | None = None
    is_widespread_anomaly: bool | None = None
    in_colombia: bool = True


class ExplainResponse(BaseModel):
    month: date
    lang: Lang
    summary: str
    generated_by: Literal["ai", "template"]
    model: str | None
    facts: ExplainFacts


MapSensor = Literal["VIIRS", "MODIS"]


class HeatmapRegion(BaseModel):
    name: str
    count: int


class HeatmapResponse(BaseModel):
    month: date
    # Raw detections of one sensor (VIIRS when it exists that month), not harmonized values.
    sensor: MapSensor | None
    detections: int
    cell_deg: float | None
    cells: list[tuple[float, float, int]]  # (lon, lat, count) cell centres, densest first
    regions: list[HeatmapRegion]  # the country's departments/states that month, densest first
    peak_day: date | None
    bbox: str | None  # extent for a satellite image: west,south,east,north within -180..180


class RecentDay(BaseModel):
    day: date
    count: int


class RecentResponse(BaseModel):
    """The last complete days (near real time, preliminary) against the same days in history."""

    available: bool
    satellite: str | None = None  # the VIIRS satellite the recent counts come from
    start: date | None = None
    end: date | None = None
    detections: int | None = None
    daily: list[RecentDay] = []
    # VIIRS archive, same calendar days, across `baseline_years` years.
    normal_median: float | None = None
    normal_q25: float | None = None
    normal_q75: float | None = None
    baseline_years: int | None = None
    percent_of_normal: float | None = None
    fetched_at: datetime | None = None


class OutlookLead(BaseModel):
    """How well the outlook did `lead` months ahead in the backtest (2010 onwards)."""

    lead: int
    month: date
    n: int
    base_rate: float  # share of above-normal months: about 1/3 by construction
    brier_skill: float  # 0 = no better than the calendar alone, 1 = perfect
    persistence_brier_skill: float  # the same with last month's anomaly alone
    auc: float
    hit_rate_at_half: float  # share of months called at >= 50 % that were above normal


class OutlookMonth(BaseModel):
    month: date
    probability: float  # of more detections than in two years out of three
    normal: float  # median harmonized detections of that month of the year
    threshold: float  # the count above which the month is above normal


class OutlookDepartment(BaseModel):
    department: str
    months: list[OutlookMonth]


class OutlookResponse(BaseModel):
    """Chance that each department's coming months burn above normal."""

    available: bool
    dataset: Dataset | None = None
    issued: date | None = None  # first day of the last month the forecast knows
    oni: float | None = None
    leads: list[OutlookLead] = []
    departments: list[OutlookDepartment] = []
