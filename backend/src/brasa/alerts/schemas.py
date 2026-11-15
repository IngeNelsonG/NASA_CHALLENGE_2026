"""Schemas for deterministic unusual-trend detection and institutional alerting."""

from datetime import date
from typing import Literal

from pydantic import BaseModel

AlertSeverity = Literal["CRITICAL", "WARNING", "WATCH", "NORMAL"]
TrendDirection = Literal["ACCELERATING", "PERSISTENT", "STABLE", "RECEDING"]
EnsoPhase = Literal["EL_NINO", "LA_NINA", "NEUTRAL", "UNKNOWN"]


class AuthorityContact(BaseModel):
    """Government risk-management or environmental authority responsible for an AOI."""

    code: str
    name: str
    level: Literal["national", "departmental", "regional_environmental", "international"]
    role_es: str
    role_en: str
    portal: str | None = None


class AlertItem(BaseModel):
    """Deterministic early-warning assessment for a geographical area of interest."""

    id: str
    aoi_id: str
    region_name: str
    department: str | None = None
    country: str | None = None
    bbox: tuple[float, float, float, float] | None = None
    severity: AlertSeverity
    severity_rank: int  # CRITICAL=3, WARNING=2, WATCH=1, NORMAL=0
    severity_label_es: str
    severity_label_en: str
    reference_month: date
    latest_harmonized: float
    climatology_median: float
    climatology_q25: float
    climatology_q75: float
    climatology_p90: float
    anomaly_ratio: float
    z_score: float
    robust_z: float
    persistence_months: int
    trend_direction: TrendDirection
    unseasonal: bool
    oni_value: float | None = None
    enso_phase: EnsoPhase
    enso_relevant: bool = True
    nrt_detections: int | None = None
    nrt_percent_of_normal: float | None = None
    active_subalerts_count: int = 0
    max_subalert_severity: AlertSeverity | None = None
    headline_es: str
    headline_en: str
    technical_summary_es: str
    technical_summary_en: str
    recommended_actions_es: list[str]
    recommended_actions_en: list[str]
    authorities: list[AuthorityContact]
    protocol: str = "CAP-1.2-deterministic"


class AlertsResponse(BaseModel):
    """Collection of unusual-trend alerts sorted by severity and anomaly magnitude."""

    reference_month: date | None = None
    scope: Literal["aoi", "colombia-departments"]
    total_evaluated: int
    active_alerts: int
    critical_count: int
    warning_count: int
    watch_count: int
    alerts: list[AlertItem]
