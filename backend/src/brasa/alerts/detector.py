"""Deterministic unusual-trend detector for active-fire early warning."""

from collections.abc import Mapping, Sequence
from datetime import date
from typing import Any, Literal

import numpy as np
import pandas as pd

from brasa.alerts.authorities import get_authorities_for_aoi
from brasa.alerts.schemas import AlertItem, AlertSeverity, AlertsResponse, EnsoPhase, TrendDirection

SEVERITY_RANK: dict[AlertSeverity, int] = {
    "CRITICAL": 3,
    "WARNING": 2,
    "WATCH": 1,
    "NORMAL": 0,
}

SEVERITY_LABELS: dict[AlertSeverity, tuple[str, str]] = {
    "CRITICAL": ("ALERTA ROJA", "CRITICAL ALERT"),
    "WARNING": ("ALERTA NARANJA", "WARNING"),
    "WATCH": ("VIGILANCIA", "WATCH"),
    "NORMAL": ("NORMAL", "NORMAL"),
}

ENSO_THRESHOLD = 0.5
ONI_LOOKBACK_MONTHS = 3
MONTHS_IN_YEAR = 12
LAT_TROPIC_BAND = 30.0
LAT_MED_AFRICA_MIN = 20.0
LON_EURO_AFRICA_MIN = -25.0
LON_EURO_AFRICA_MAX = 65.0

ENSO_AFFECTED_COUNTRIES: frozenset[str] = frozenset(
    {
        # South America
        "Argentina",
        "Bolivia",
        "Brazil",
        "Chile",
        "Colombia",
        "Ecuador",
        "French Guiana",
        "Guyana",
        "Paraguay",
        "Peru",
        "Suriname",
        "Uruguay",
        "Venezuela",
        # Central & North America + Caribbean (US southwest/southeast coast/tropics only)
        "Bahamas",
        "Belize",
        "Costa Rica",
        "Cuba",
        "Dominican Republic",
        "El Salvador",
        "Guatemala",
        "Haiti",
        "Honduras",
        "Jamaica",
        "Mexico",
        "Nicaragua",
        "Panama",
        "Puerto Rico",
        "Trinidad and Tobago",
        "United States",
        # Southeast / South Asia & Oceania (excludes Japan, China, Korea, Russia)
        "Australia",
        "Bangladesh",
        "Bhutan",
        "Brunei",
        "Cambodia",
        "Fiji",
        "India",
        "Indonesia",
        "Laos",
        "Malaysia",
        "Myanmar",
        "Nepal",
        "New Caledonia",
        "New Zealand",
        "Pakistan",
        "Papua New Guinea",
        "Philippines",
        "Solomon Islands",
        "Sri Lanka",
        "Thailand",
        "Timor-Leste",
        "Vanuatu",
        "Vietnam",
        # Sub-Saharan / Southern / Eastern Africa
        "Angola",
        "Botswana",
        "Burundi",
        "Democratic Republic of the Congo",
        "Eritrea",
        "Eswatini",
        "Ethiopia",
        "Kenya",
        "Lesotho",
        "Madagascar",
        "Malawi",
        "Mozambique",
        "Namibia",
        "Republic of the Congo",
        "Rwanda",
        "Somalia",
        "South Africa",
        "South Sudan",
        "Tanzania",
        "Uganda",
        "Zambia",
        "Zimbabwe",
    }
)


def is_enso_relevant(
    *,
    country: str | None = None,
    in_colombia: bool = False,
    bbox: tuple[float, float, float, float] | None = None,
) -> bool:
    """Return True if the AOI lies inside the Pacific ENSO fire teleconnection regime."""
    if in_colombia:
        return True
    if country:
        if country.strip().lower() == "world":
            return True
        return country in ENSO_AFFECTED_COUNTRIES
    if bbox is not None:
        lon_mid = (bbox[0] + bbox[2]) / 2.0
        lat_mid = (bbox[1] + bbox[3]) / 2.0
        if abs(lat_mid) > LAT_TROPIC_BAND:
            return False
        if (
            lat_mid >= LAT_MED_AFRICA_MIN
            and LON_EURO_AFRICA_MIN <= lon_mid <= LON_EURO_AFRICA_MAX
        ):
            return False
    return True
MIN_PERSISTENCE_MONTHS = 2
MIN_PERSISTENCE_COUNT = 3.0
TREND_ACCEL_DZ = 0.4
TREND_DECEL_DZ = -0.4
UNSEASONAL_Z_MIN = 1.5
UNSEASONAL_RATIO_CAP = 0.25
UNSEASONAL_COUNT_FLOOR = 5.0
NRT_SURGE_PCT = 200.0
NRT_SURGE_MIN_DET = 5
NRT_CRIT_PCT = 250.0
NRT_CRIT_MIN_DET = 8
CRIT_Z = 2.0
CRIT_RATIO = 2.5
CRIT_Z_DIRECT = 2.5
CRIT_COUNT = 10.0
WARN_COUNT = 5.0
WARN_Z = 1.5
WARN_RATIO = 1.8
WATCH_COUNT = 3.0
WATCH_Z = 1.0
WATCH_RATIO = 1.35

MONTH_ES = (
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
)
MONTH_EN = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)


def _enso_phase(oni: float | None) -> EnsoPhase:
    if oni is None:
        return "UNKNOWN"
    if oni >= ENSO_THRESHOLD:
        return "EL_NINO"
    if oni <= -ENSO_THRESHOLD:
        return "LA_NINA"
    return "NEUTRAL"


def _resolve_oni(ordered: Sequence[Mapping[str, Any]], latest_ts: pd.Timestamp) -> float | None:
    """Return latest ONI, falling back to the most recent non-null value within 3 prior months."""
    for row in reversed(ordered):
        ts = pd.Timestamp(row["month"])
        months_ago = (latest_ts.year - ts.year) * MONTHS_IN_YEAR + (latest_ts.month - ts.month)
        if months_ago < 0:
            continue
        if months_ago > ONI_LOOKBACK_MONTHS:
            break
        val = row.get("oni")
        if val is not None and not pd.isna(val):
            return float(val)
    return None


def _fmt_es(val: float, decimals: int = 0) -> str:
    s = f"{val:,.{decimals}f}"
    return s.replace(",", "_").replace(".", ",").replace("_", ".")


def _empty_alert_item(
    *,
    aoi_id: str,
    region_name: str,
    department: str | None,
    country: str | None,
    in_colombia: bool,
    as_of: date | None,
    enso_rel: bool = True,
    bbox: tuple[float, float, float, float] | None = None,
) -> AlertItem:
    authorities = get_authorities_for_aoi(
        department=department,
        country=country,
        in_colombia=in_colombia,
        region_name=region_name,
    )
    return AlertItem(
        id=f"alert-{aoi_id}-empty",
        aoi_id=aoi_id,
        region_name=region_name,
        department=department,
        country=country,
        bbox=bbox,
        severity="NORMAL",
        severity_rank=0,
        severity_label_es=SEVERITY_LABELS["NORMAL"][0],
        severity_label_en=SEVERITY_LABELS["NORMAL"][1],
        reference_month=as_of or date.today().replace(day=1),
        latest_harmonized=0.0,
        climatology_median=0.0,
        climatology_q25=0.0,
        climatology_q75=0.0,
        climatology_p90=0.0,
        anomaly_ratio=1.0,
        z_score=0.0,
        robust_z=0.0,
        persistence_months=0,
        trend_direction="STABLE",
        unseasonal=False,
        oni_value=None,
        enso_phase="UNKNOWN",
        enso_relevant=enso_rel,
        headline_es=f"{region_name}: sin detecciones históricas registradas en el periodo.",
        headline_en=f"{region_name}: no historical fire detections recorded in period.",
        technical_summary_es=(
            "Sin serie activa de puntos de calor en el archivo satelital NASA FIRMS "
            "para esta área."
        ),
        technical_summary_en=(
            "No active hotspot series recorded in the NASA FIRMS satellite archive "
            "for this area."
        ),
        recommended_actions_es=["Mantener monitoreo satelital de rutina vía FIRMS NRT."],
        recommended_actions_en=["Maintain routine FIRMS NRT satellite monitoring."],
        authorities=authorities,
    )


def _baseline_stats(ordered: Sequence[Mapping[str, Any]]) -> tuple[
    dict[int, float], dict[int, float], dict[int, float], float
]:
    by_moy: dict[int, list[float]] = {m: [] for m in range(1, MONTHS_IN_YEAR + 1)}
    for r in ordered:
        moy = pd.Timestamp(r["month"]).month
        by_moy[moy].append(float(r["harmonized"]))

    log_mu: dict[int, float] = {}
    log_sd: dict[int, float] = {}
    p90_by_moy: dict[int, float] = {}
    max_moy_median = 0.0
    for moy, vals in by_moy.items():
        if not vals:
            continue
        arr = np.asarray(vals, dtype=float)
        logs = np.log1p(np.clip(arr, 0.0, None))
        log_mu[moy] = float(logs.mean())
        log_sd[moy] = max(0.25, float(logs.std(ddof=1)) if len(logs) > 1 else 0.25)
        p90_by_moy[moy] = float(np.percentile(arr, 90))
        max_moy_median = max(max_moy_median, float(np.median(arr)))
    return log_mu, log_sd, p90_by_moy, max_moy_median


def _compute_persistence_and_trend(
    window: Sequence[Mapping[str, Any]], zs: Sequence[float]
) -> tuple[int, TrendDirection]:
    persistence = 0
    for r, rz in reversed(list(zip(window, zs, strict=True))):
        h_val = float(r["harmonized"])
        if rz >= WATCH_Z or (
            h_val > float(r["climatology_q75"]) and h_val >= MIN_PERSISTENCE_COUNT
        ):
            persistence += 1
        else:
            break

    z = zs[-1]
    z_prev = zs[-2] if len(zs) >= MIN_PERSISTENCE_MONTHS else 0.0
    dz = z - z_prev
    if z >= WATCH_Z and dz >= TREND_ACCEL_DZ:
        trend: TrendDirection = "ACCELERATING"
    elif persistence >= MIN_PERSISTENCE_MONTHS:
        trend = "PERSISTENT"
    elif dz <= TREND_DECEL_DZ:
        trend = "RECEDING"
    else:
        trend = "STABLE"
    return persistence, trend


def _classify_severity(
    *,
    latest_h: float,
    z: float,
    anomaly_ratio: float,
    persistence: int,
    trend: TrendDirection,
    unseasonal: bool,
    enso: EnsoPhase,
    nrt_detections: int | None,
    nrt_percent_of_normal: float | None,
) -> AlertSeverity:
    nrt_det = nrt_detections or 0
    nrt_surge = (
        nrt_percent_of_normal is not None
        and nrt_percent_of_normal >= NRT_SURGE_PCT
        and nrt_det >= NRT_SURGE_MIN_DET
    )
    nrt_crit = (
        nrt_percent_of_normal is not None
        and nrt_percent_of_normal >= NRT_CRIT_PCT
        and nrt_det >= NRT_CRIT_MIN_DET
    )
    crit_signal = z >= CRIT_Z or anomaly_ratio >= CRIT_RATIO or nrt_crit
    crit_context = (
        persistence >= MIN_PERSISTENCE_MONTHS
        or trend == "ACCELERATING"
        or unseasonal
        or enso == "EL_NINO"
        or z >= CRIT_Z_DIRECT
    )
    if crit_signal and crit_context and (latest_h >= CRIT_COUNT or nrt_surge):
        return "CRITICAL"
    if latest_h >= WARN_COUNT and (
        z >= WARN_Z
        or anomaly_ratio >= WARN_RATIO
        or persistence >= MIN_PERSISTENCE_MONTHS
        or nrt_surge
    ):
        return "WARNING"
    watch_signal = (
        z >= WATCH_Z
        or anomaly_ratio >= WATCH_RATIO
        or (trend == "ACCELERATING" and enso == "EL_NINO")
    )
    if (latest_h >= WATCH_COUNT and watch_signal) or nrt_surge:
        return "WATCH"
    return "NORMAL"


def _build_narratives(
    *,
    severity: AlertSeverity,
    region_name: str,
    latest_ts: pd.Timestamp,
    latest_h: float,
    med: float,
    q25: float,
    q75: float,
    p90: float,
    z: float,
    robust_z: float,
    anomaly_ratio: float,
    persistence: int,
    unseasonal: bool,
    enso: EnsoPhase,
    oni_val: float | None,
    authorities: Sequence[Any],
) -> tuple[str, str, str, str, list[str], list[str]]:
    m_es = MONTH_ES[latest_ts.month - 1]
    m_en = MONTH_EN[latest_ts.month - 1]
    ratio_en = f"{anomaly_ratio:.2f}\u00d7"
    ratio_es = f"{_fmt_es(anomaly_ratio, 2)}\u00d7"
    z_en = f"{z:+.2f}\u03c3"
    z_es = f"{'+' if z >= 0 else ''}{_fmt_es(z, 2)}\u03c3"
    rz_es = f"{'+' if robust_z >= 0 else ''}{_fmt_es(robust_z, 2)}"

    oni_str_es = ""
    oni_str_en = ""
    if oni_val is not None and enso in {"EL_NINO", "LA_NINA"}:
        phase_es = "El Niño" if enso == "EL_NINO" else "La Niña"
        oni_es = f"{'+' if oni_val >= 0 else ''}{_fmt_es(oni_val, 2)}"
        oni_str_es = f" Bajo condiciones de {phase_es} (ONI {oni_es} °C)."
        oni_str_en = f" Concurrent with {phase_es} conditions (ONI {oni_val:+.2f} °C)."

    unseasonal_es = " Actividad atípica fuera de temporada seca." if unseasonal else ""
    unseasonal_en = " Unseasonal surge during a historically wet month." if unseasonal else ""

    sev_es, sev_en = SEVERITY_LABELS[severity]
    if severity == "NORMAL":
        headline_es = (
            f"{sev_es} \u2014 {region_name}: actividad térmica dentro del rango histórico "
            f"({m_es} {latest_ts.year})."
        )
        headline_en = (
            f"{sev_en} \u2014 {region_name}: fire activity within historical range "
            f"({m_en} {latest_ts.year})."
        )
    else:
        headline_es = (
            f"{sev_es} \u2014 {region_name}: tendencia inusual ({z_es}, {ratio_es} sobre "
            f"mediana climatológica) en {m_es} {latest_ts.year}."
        )
        headline_en = (
            f"{sev_en} \u2014 {region_name}: unusual upward trend ({z_en}, {ratio_en} above "
            f"climatological median) in {m_en} {latest_ts.year}."
        )

    persist_es = "1 mes consecutivo" if persistence == 1 else f"{persistence} meses consecutivos"
    persist_en = "1 consecutive month" if persistence == 1 else f"{persistence} consecutive months"
    tech_es = (
        f"Evaluación determinista NASA FIRMS para {region_name} ({m_es} {latest_ts.year}): "
        f"{_fmt_es(latest_h)} detecciones armonizadas frente a mediana histórica de "
        f"{_fmt_es(med)} (RIC Q1\u2013Q3: {_fmt_es(q25)}\u2013{_fmt_es(q75)}; p90: "
        f"{_fmt_es(p90)}). Desviación: {z_es} (z robusto: {rz_es}); razón: {ratio_es}; "
        f"persistencia: {persist_es} sobre umbral."
        f"{unseasonal_es}{oni_str_es}"
    )
    tech_en = (
        f"Deterministic NASA FIRMS evaluation for {region_name} ({m_en} {latest_ts.year}): "
        f"{latest_h:,.0f} harmonized detections vs. historical median {med:,.0f} "
        f"(IQR Q1\u2013Q3: {q25:,.0f}\u2013{q75:,.0f}; p90: {p90:,.0f}). "
        f"Departure: {z_en} (robust z: {robust_z:+.2f}); ratio: {ratio_en}; "
        f"persistence: {persist_en} above threshold."
        f"{unseasonal_en}{oni_str_en}"
    )

    codes3 = ", ".join(a.code for a in authorities[:3])
    actions_map_es: dict[AlertSeverity, list[str]] = {
        "CRITICAL": [
            f"Activar sala de crisis y Puesto de Mando Unificado (PMU) en {region_name} "
            f"con {codes3}.",
            "Desplegar verificación en campo prioritaria sobre celdas VIIRS/MODIS activas y "
            "restringir quemas agrícolas o de limpieza.",
            "Preposicionar brigadas forestales (DNBC) y solicitar seguimiento horario "
            "mediante boletines LANCE/FIRMS NRT.",
        ],
        "WARNING": [
            f"Emitir aviso preventivo a {codes3} ante persistencia o aceleración de focos.",
            "Intensificar patrullaje y prohibición temporal de quemas controladas en áreas "
            "rurales y de amortiguación.",
            "Contrastar conglomerados persistentes con cobertura vegetal y focos estáticos "
            "en la ventana NRT de los últimos 7 días.",
        ],
        "WATCH": [
            f"Notificar vigilancia preventiva a {authorities[0].code} por incremento sobre "
            "el percentil 75.",
            "Monitorear evolución semanal y variables meteorológicas locales (humedad, "
            "viento y fase ONI).",
        ],
        "NORMAL": [
            "Mantener seguimiento operativo rutinario de detecciones activas MODIS/VIIRS.",
        ],
    }
    actions_map_en: dict[AlertSeverity, list[str]] = {
        "CRITICAL": [
            f"Activate Unified Command (PMU) and crisis room in {region_name} involving "
            f"{codes3}.",
            "Dispatch urgent field verification to active VIIRS/MODIS clusters and "
            "suspend authorized agricultural burns.",
            "Pre-position wildland firefighting crews and track hourly FIRMS NRT updates.",
        ],
        "WARNING": [
            f"Issue preventive warning to {codes3} due to sustained or accelerating "
            "hotspot anomaly.",
            "Strengthen rural patrol enforcement and temporary restrictions on open burning.",
            "Cross-check active clusters against the 7-day NRT baseline and land cover.",
        ],
        "WATCH": [
            f"Notify {authorities[0].code} for preventive monitoring following "
            "above-75th-percentile fire activity.",
            "Track weekly trajectory alongside meteorological drivers and ENSO/ONI phase.",
        ],
        "NORMAL": [
            "Maintain routine MODIS/VIIRS satellite active-fire monitoring.",
        ],
    }
    return (
        headline_es,
        headline_en,
        tech_es,
        tech_en,
        actions_map_es[severity],
        actions_map_en[severity],
    )


def evaluate_rows(
    rows: Sequence[Mapping[str, Any]],
    *,
    aoi_id: str,
    region_name: str,
    department: str | None = None,
    country: str | None = None,
    in_colombia: bool = True,
    as_of: date | None = None,
    nrt_detections: int | None = None,
    nrt_percent_of_normal: float | None = None,
    bbox: tuple[float, float, float, float] | None = None,
) -> AlertItem:
    """Compute a 100% deterministic unusual-trend alert from harmonized monthly rows."""
    enso_rel = is_enso_relevant(country=country, in_colombia=in_colombia, bbox=bbox)
    if not rows:
        return _empty_alert_item(
            aoi_id=aoi_id,
            region_name=region_name,
            department=department,
            country=country,
            in_colombia=in_colombia,
            as_of=as_of,
            enso_rel=enso_rel,
            bbox=bbox,
        )

    ordered = sorted(rows, key=lambda r: pd.Timestamp(r["month"]))
    if as_of is not None:
        cutoff = pd.Timestamp(as_of).to_period("M").to_timestamp()
        filtered = [r for r in ordered if pd.Timestamp(r["month"]) <= cutoff]
        if filtered:
            ordered = filtered

    log_mu, log_sd, p90_by_moy, max_moy_median = _baseline_stats(ordered)

    def _log_z(r: Mapping[str, Any]) -> float:
        moy = pd.Timestamp(r["month"]).month
        h = max(0.0, float(r["harmonized"]))
        mu = log_mu.get(moy, 0.0)
        sd = log_sd.get(moy, 0.25)
        return float((np.log1p(h) - mu) / sd)

    latest = ordered[-1]
    latest_ts = pd.Timestamp(latest["month"])
    latest_h = float(latest["harmonized"])
    med = float(latest["climatology_median"])
    q25 = float(latest["climatology_q25"])
    q75 = float(latest["climatology_q75"])
    p90 = float(p90_by_moy.get(latest_ts.month, q75))
    robust_z = float(latest["robust_z"])
    z = _log_z(latest)
    anomaly_ratio = (
        latest_h / med if med > 0.0 else (1.0 if latest_h == 0.0 else 1.0 + latest_h)
    )

    window = ordered[-6:]
    zs = [_log_z(r) for r in window]
    persistence, trend = _compute_persistence_and_trend(window, zs)

    unseasonal = bool(
        max_moy_median > 0
        and med < UNSEASONAL_RATIO_CAP * max_moy_median
        and z >= UNSEASONAL_Z_MIN
        and latest_h > max(q75, UNSEASONAL_COUNT_FLOOR)
    )
    oni_val = _resolve_oni(ordered, latest_ts) if enso_rel else None
    enso = _enso_phase(oni_val) if enso_rel else "NEUTRAL"

    severity = _classify_severity(
        latest_h=latest_h,
        z=z,
        anomaly_ratio=anomaly_ratio,
        persistence=persistence,
        trend=trend,
        unseasonal=unseasonal,
        enso=enso,
        nrt_detections=nrt_detections,
        nrt_percent_of_normal=nrt_percent_of_normal,
    )
    authorities = get_authorities_for_aoi(
        department=department,
        country=country,
        in_colombia=in_colombia,
        region_name=region_name,
    )
    h_es, h_en, tech_es, tech_en, act_es, act_en = _build_narratives(
        severity=severity,
        region_name=region_name,
        latest_ts=latest_ts,
        latest_h=latest_h,
        med=med,
        q25=q25,
        q75=q75,
        p90=p90,
        z=z,
        robust_z=robust_z,
        anomaly_ratio=anomaly_ratio,
        persistence=persistence,
        unseasonal=unseasonal,
        enso=enso,
        oni_val=oni_val,
        authorities=authorities,
    )

    sev_es, sev_en = SEVERITY_LABELS[severity]
    return AlertItem(
        id=f"alert-{aoi_id}-{latest_ts.strftime('%Y%m')}",
        aoi_id=aoi_id,
        region_name=region_name,
        department=department,
        country=country,
        bbox=bbox,
        severity=severity,
        severity_rank=SEVERITY_RANK[severity],
        severity_label_es=sev_es,
        severity_label_en=sev_en,
        reference_month=latest_ts.date(),
        latest_harmonized=round(latest_h, 1),
        climatology_median=round(med, 1),
        climatology_q25=round(q25, 1),
        climatology_q75=round(q75, 1),
        climatology_p90=round(p90, 1),
        anomaly_ratio=round(anomaly_ratio, 2),
        z_score=round(z, 2),
        robust_z=round(robust_z, 2),
        persistence_months=persistence,
        trend_direction=trend,
        unseasonal=unseasonal,
        oni_value=oni_val,
        enso_phase=enso,
        enso_relevant=enso_rel,
        nrt_detections=nrt_detections,
        nrt_percent_of_normal=nrt_percent_of_normal,
        headline_es=h_es,
        headline_en=h_en,
        technical_summary_es=tech_es,
        technical_summary_en=tech_en,
        recommended_actions_es=act_es,
        recommended_actions_en=act_en,
        authorities=authorities,
    )


def summarize_alerts(
    items: Sequence[AlertItem],
    *,
    scope: Literal["aoi", "colombia-departments"] = "colombia-departments",
    min_severity: AlertSeverity = "NORMAL",
) -> AlertsResponse:
    """Filter and rank evaluated AlertItems from highest urgency downward."""
    min_rank = SEVERITY_RANK[min_severity]
    filtered = [item for item in items if item.severity_rank >= min_rank]
    filtered.sort(key=lambda a: (a.severity_rank, a.z_score, a.anomaly_ratio), reverse=True)
    ref = max((a.reference_month for a in items), default=None)
    return AlertsResponse(
        reference_month=ref,
        scope="aoi" if scope == "aoi" else "colombia-departments",
        total_evaluated=len(items),
        active_alerts=sum(1 for a in items if a.severity != "NORMAL"),
        critical_count=sum(1 for a in items if a.severity == "CRITICAL"),
        warning_count=sum(1 for a in items if a.severity == "WARNING"),
        watch_count=sum(1 for a in items if a.severity == "WATCH"),
        alerts=filtered,
    )
