"""Unusual-trend early-warning alert engine and institutional notification registry."""

from brasa.alerts.authorities import get_authorities_for_aoi
from brasa.alerts.detector import SEVERITY_RANK, evaluate_rows, summarize_alerts
from brasa.alerts.schemas import AlertItem, AlertSeverity, AlertsResponse, AuthorityContact

__all__ = [
    "SEVERITY_RANK",
    "AlertItem",
    "AlertSeverity",
    "AlertsResponse",
    "AuthorityContact",
    "evaluate_rows",
    "get_authorities_for_aoi",
    "summarize_alerts",
]
