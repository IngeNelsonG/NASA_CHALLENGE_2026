"""Direct SMTP newsletter & early-warning fire alert subscription service."""

from __future__ import annotations

import html
import json
import logging
import os
import re
import smtplib
import ssl
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from email.message import EmailMessage
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from brasa.alerts.schemas import AlertItem, AlertSeverity

logger = logging.getLogger(__name__)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DEFAULT_SMTP_PORT = 587
SSL_SMTP_PORT = 465
SMTP_TIMEOUT_SECONDS = 12
SUBSCRIPTIONS_FILENAME = "alert_subscriptions.json"

_FILE_LOCK = threading.Lock()


@dataclass(frozen=True)
class SmtpConfig:
    """SMTP transport settings loaded from environment variables."""

    host: str | None
    port: int
    user: str | None
    password: str | None
    from_email: str | None
    use_tls: bool

    @property
    def configured(self) -> bool:
        return bool(self.host and (self.from_email or self.user))

    @classmethod
    def from_env(cls) -> SmtpConfig:
        host = (os.getenv("SMTP_HOST") or os.getenv("BRASA_SMTP_HOST") or "").strip() or None
        raw_port = (
            os.getenv("SMTP_PORT") or os.getenv("BRASA_SMTP_PORT") or str(DEFAULT_SMTP_PORT)
        ).strip()
        try:
            port = int(raw_port)
        except ValueError:
            port = DEFAULT_SMTP_PORT
        user = (os.getenv("SMTP_USER") or os.getenv("BRASA_SMTP_USER") or "").strip() or None
        password = (
            os.getenv("SMTP_PASSWORD") or os.getenv("BRASA_SMTP_PASSWORD") or ""
        ).strip() or None
        from_email = (
            os.getenv("SMTP_FROM") or os.getenv("BRASA_SMTP_FROM") or user or ""
        ).strip() or None
        tls_raw = (os.getenv("SMTP_USE_TLS") or os.getenv("BRASA_SMTP_USE_TLS") or "true").lower()
        use_tls = tls_raw in {"1", "true", "yes", "on", "starttls", "ssl"}
        return cls(
            host=host,
            port=port,
            user=user,
            password=password,
            from_email=from_email,
            use_tls=use_tls,
        )


class SubscriptionRequest(BaseModel):
    """Request payload for subscribing an email to regional or country fire alerts."""

    email: str = Field(max_length=180)
    name: str = Field(default="", max_length=120)
    aoi_id: str = Field(default="co", max_length=120)
    min_severity: AlertSeverity = "WATCH"
    lang: Literal["es", "en"] = "es"
    send_immediate_report: bool = True

    @field_validator("email")
    @classmethod
    def _validate_email(cls, value: str) -> str:
        cleaned = value.strip()
        if not EMAIL_RE.match(cleaned):
            raise ValueError("Invalid email address format.")
        return cleaned.lower()


class SubscriptionResponse(BaseModel):
    """Response summarizing saved subscription and immediate SMTP bulletin dispatch."""

    status: Literal["sent", "subscribed_smtp_pending", "subscribed_error"]
    email: str
    aoi_id: str
    region_name: str
    severity: AlertSeverity
    smtp_configured: bool
    message_es: str
    message_en: str


class SmtpStatusResponse(BaseModel):
    """Diagnostic status of the SMTP alert mail service."""

    configured: bool
    host: str | None = None
    port: int
    from_email: str | None = None
    subscribers_count: int = 0


def _subscriptions_path(data_dir: Path) -> Path:
    return data_dir / SUBSCRIPTIONS_FILENAME


def count_subscribers(data_dir: Path) -> int:
    path = _subscriptions_path(data_dir)
    if not path.exists():
        return 0
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return len(raw) if isinstance(raw, list) else 0
    except (OSError, json.JSONDecodeError):
        return 0


def save_subscription(
    data_dir: Path, req: SubscriptionRequest, *, region_name: str
) -> dict[str, str]:
    """Persist or update a subscriber record deterministically by (email, aoi_id)."""
    path = _subscriptions_path(data_dir)
    record = {
        "email": req.email,
        "name": req.name.strip(),
        "aoi_id": req.aoi_id,
        "region_name": region_name,
        "min_severity": req.min_severity,
        "lang": req.lang,
        "updated_at": datetime.now(UTC).isoformat(),
    }
    with _FILE_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        entries: list[dict[str, str]] = []
        if path.exists():
            try:
                loaded = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(loaded, list):
                    entries = [item for item in loaded if isinstance(item, dict)]
            except (OSError, json.JSONDecodeError):
                entries = []
        updated = False
        for idx, existing in enumerate(entries):
            if existing.get("email") == req.email and existing.get("aoi_id") == req.aoi_id:
                entries[idx] = record
                updated = True
                break
        if not updated:
            entries.append(record)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    return record


def _build_alert_email(
    cfg: SmtpConfig, req: SubscriptionRequest, alert: AlertItem
) -> EmailMessage:
    is_es = req.lang == "es"
    sev_label = alert.severity_label_es if is_es else alert.severity_label_en
    headline = alert.headline_es if is_es else alert.headline_en
    actions = alert.recommended_actions_es if is_es else alert.recommended_actions_en
    auth = alert.authorities[0] if alert.authorities else None
    ratio_pct = round((alert.anomaly_ratio - 1.0) * 100)
    if is_es:
        pct_desc = (
            f"{abs(ratio_pct)}% por encima de lo habitual"
            if ratio_pct >= 0
            else f"{abs(ratio_pct)}% por debajo de lo habitual"
        )
        subject = f"[Ember Calendar · {sev_label}] Reporte de quemas — {alert.region_name}"
        greeting = f"Hola {req.name.strip()}," if req.name.strip() else "Hola,"
        plain = (
            f"{greeting}\n\n"
            f"Te confirmamos tu suscripción al servicio de alertas tempranas de Ember Calendar "
            f"para: {alert.region_name}.\n\n"
            f"Estado actual ({alert.reference_month.strftime('%Y-%m')}): {sev_label}\n"
            f"Resumen: {headline}\n"
            f"• Focos detectados este mes (eq-MODIS): {alert.latest_harmonized:,.0f}\n"
            f"• Promedio típico del mes (26 años): {alert.climatology_median:,.0f}\n"
            f"• Comparación frente a lo normal: {alert.anomaly_ratio:.2f}\u00d7 ({pct_desc})\n"
            f"• Nivel de rareza estadística: {alert.z_score:+.2f} z\n\n"
            + (
                f"Autoridad competente local: {auth.code} — {auth.name}\n"
                + (f"Portal oficial: {auth.portal}\n\n" if auth.portal else "\n")
                if auth
                else ""
            )
            + "Acciones recomendadas:\n"
            + "\n".join(f"- {step}" for step in actions)
            + "\n\nDatos satelitales reales NASA FIRMS (MODIS + VIIRS) · Protocolo CAP-1.2."
        )
        actions_html = "".join(f"<li>{html.escape(step)}</li>" for step in actions)
        auth_html = (
            f"<p><strong>Autoridad local:</strong> {html.escape(auth.code)} — "
            f"{html.escape(auth.name)}"
            + (
                f' · <a href="{html.escape(auth.portal)}">Contactar / Portal oficial ↗</a>'
                if auth.portal
                else ""
            )
            + "</p>"
            if auth
            else ""
        )
        title_esc = html.escape(alert.region_name)
        sev_esc = html.escape(sev_label)
        obs_str = f"{alert.latest_harmonized:,.0f}"
        med_str = f"{alert.climatology_median:,.0f}"
        ratio_str = f"{alert.anomaly_ratio:.2f}\u00d7"
        z_str = f"{alert.z_score:+.2f} z"
        pct_esc = html.escape(pct_desc)
        body_html = f"""
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;
                    margin:0 auto;padding:20px;background:#f7f4ec;color:#171411;
                    border:1px solid #d8cfc0;border-radius:12px;">
          <p style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#685d51;">
            Ember Calendar · NASA FIRMS Early Warning (CAP-1.2)
          </p>
          <h2 style="margin:6px 0 12px;">{title_esc} — {sev_esc}</h2>
          <p>{html.escape(greeting)}</p>
          <p>{html.escape(headline)}</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#ffffff;">
            <tr>
              <td style="padding:8px 12px;border:1px solid #e2d5c2;">Focos del periodo</td>
              <td style="padding:8px 12px;border:1px solid #e2d5c2;">
                <strong>{obs_str}</strong> vs. {med_str} habituales
              </td>
            </tr>
            <tr>
              <td style="padding:8px 12px;border:1px solid #e2d5c2;">Razón frente a lo normal</td>
              <td style="padding:8px 12px;border:1px solid #e2d5c2;">
                <strong>{ratio_str}</strong> ({pct_esc})
              </td>
            </tr>
            <tr>
              <td style="padding:8px 12px;border:1px solid #e2d5c2;">Rareza estadística (z)</td>
              <td style="padding:8px 12px;border:1px solid #e2d5c2;">
                <strong>{z_str}</strong>
              </td>
            </tr>
          </table>
          {auth_html}
          <p><strong>Acciones recomendadas:</strong></p>
          <ul>{actions_html}</ul>
          <p style="font-size:12px;color:#685d51;margin-top:20px;">
            Recibirás boletines desde nivel <strong>{req.min_severity}</strong>.
          </p>
        </div>
        """
    else:
        pct_desc = (
            f"{abs(ratio_pct)}% above typical levels"
            if ratio_pct >= 0
            else f"{abs(ratio_pct)}% below typical levels"
        )
        subject = f"[Ember Calendar · {sev_label}] Wildfire Alert Report — {alert.region_name}"
        greeting = f"Hello {req.name.strip()}," if req.name.strip() else "Hello,"
        plain = (
            f"{greeting}\n\n"
            f"Your subscription to the Ember Calendar fire early-warning service is active "
            f"for: {alert.region_name}.\n\n"
            f"Current status ({alert.reference_month.strftime('%Y-%m')}): {sev_label}\n"
            f"Summary: {headline}\n"
            f"• Harmonized detections this month: {alert.latest_harmonized:,.0f}\n"
            f"• Typical 26-year monthly median: {alert.climatology_median:,.0f}\n"
            f"• Comparison vs. normal: {alert.anomaly_ratio:.2f}\u00d7 ({pct_desc})\n"
            f"• Statistical departure: {alert.z_score:+.2f} z\n\n"
            + (
                f"Competent government authority: {auth.code} — {auth.name}\n"
                + (f"Official portal: {auth.portal}\n\n" if auth.portal else "\n")
                if auth
                else ""
            )
            + "Recommended actions:\n"
            + "\n".join(f"- {step}" for step in actions)
            + "\n\nGrounded in NASA FIRMS (MODIS + VIIRS) data · Deterministic CAP-1.2."
        )
        actions_html = "".join(f"<li>{html.escape(step)}</li>" for step in actions)
        auth_html = (
            f"<p><strong>Local authority:</strong> {html.escape(auth.code)} — "
            f"{html.escape(auth.name)}"
            + (
                f' · <a href="{html.escape(auth.portal)}">Official contact portal ↗</a>'
                if auth.portal
                else ""
            )
            + "</p>"
            if auth
            else ""
        )
        title_esc = html.escape(alert.region_name)
        sev_esc = html.escape(sev_label)
        obs_str = f"{alert.latest_harmonized:,.0f}"
        med_str = f"{alert.climatology_median:,.0f}"
        ratio_str = f"{alert.anomaly_ratio:.2f}\u00d7"
        z_str = f"{alert.z_score:+.2f} z"
        pct_esc = html.escape(pct_desc)
        body_html = f"""
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;
                    margin:0 auto;padding:20px;background:#f7f4ec;color:#171411;
                    border:1px solid #d8cfc0;border-radius:12px;">
          <p style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#685d51;">
            Ember Calendar · NASA FIRMS Early Warning (CAP-1.2)
          </p>
          <h2 style="margin:6px 0 12px;">{title_esc} — {sev_esc}</h2>
          <p>{html.escape(greeting)}</p>
          <p>{html.escape(headline)}</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#ffffff;">
            <tr>
              <td style="padding:8px 12px;border:1px solid #e2d5c2;">Observed fires</td>
              <td style="padding:8px 12px;border:1px solid #e2d5c2;">
                <strong>{obs_str}</strong> vs. {med_str} normal
              </td>
            </tr>
            <tr>
              <td style="padding:8px 12px;border:1px solid #e2d5c2;">Comparison ratio</td>
              <td style="padding:8px 12px;border:1px solid #e2d5c2;">
                <strong>{ratio_str}</strong> ({pct_esc})
              </td>
            </tr>
            <tr>
              <td style="padding:8px 12px;border:1px solid #e2d5c2;">Statistical departure (z)</td>
              <td style="padding:8px 12px;border:1px solid #e2d5c2;">
                <strong>{z_str}</strong>
              </td>
            </tr>
          </table>
          {auth_html}
          <p><strong>Recommended actions:</strong></p>
          <ul>{actions_html}</ul>
          <p style="font-size:12px;color:#685d51;margin-top:20px;">
            You will receive alerts from severity <strong>{req.min_severity}</strong>.
          </p>
        </div>
        """

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = cfg.from_email or cfg.user or "alerts@embercalendar.org"
    msg["To"] = req.email
    msg.set_content(plain)
    msg.add_alternative(body_html, subtype="html")
    return msg


def send_alert_email(
    cfg: SmtpConfig, req: SubscriptionRequest, alert: AlertItem
) -> tuple[bool, str | None]:
    """Send immediate subscription confirmation + current CAP-1.2 alert bulletin via SMTP."""
    if not cfg.configured or not cfg.host:
        return False, "SMTP host or sender not configured"
    msg = _build_alert_email(cfg, req, alert)
    try:
        context = ssl.create_default_context()
        if cfg.port == SSL_SMTP_PORT:
            with smtplib.SMTP_SSL(
                cfg.host, cfg.port, timeout=SMTP_TIMEOUT_SECONDS, context=context
            ) as smtp:
                if cfg.user and cfg.password:
                    smtp.login(cfg.user, cfg.password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(cfg.host, cfg.port, timeout=SMTP_TIMEOUT_SECONDS) as smtp:
                smtp.ehlo()
                if cfg.use_tls:
                    smtp.starttls(context=context)
                    smtp.ehlo()
                if cfg.user and cfg.password:
                    smtp.login(cfg.user, cfg.password)
                smtp.send_message(msg)
    except Exception as exc:
        logger.warning("Failed to dispatch SMTP bulletin to %s: %s", req.email, exc)
        return False, str(exc)
    return True, None


def subscribe_and_notify(
    data_dir: Path, req: SubscriptionRequest, alert: AlertItem
) -> SubscriptionResponse:
    """Save subscription in data_dir and attempt direct SMTP bulletin delivery."""
    save_subscription(data_dir, req, region_name=alert.region_name)
    cfg = SmtpConfig.from_env()
    if not cfg.configured:
        return SubscriptionResponse(
            status="subscribed_smtp_pending",
            email=req.email,
            aoi_id=alert.aoi_id,
            region_name=alert.region_name,
            severity=alert.severity,
            smtp_configured=False,
            message_es=(
                f"Suscripción registrada para {alert.region_name}. "
                "Configura SMTP_HOST, SMTP_PORT, SMTP_USER y SMTP_PASSWORD en el backend/.env "
                "para activar el envío directo por correo."
            ),
            message_en=(
                f"Subscription saved for {alert.region_name}. "
                "Configure SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASSWORD in backend/.env "
                "to enable direct email dispatch."
            ),
        )

    if not req.send_immediate_report:
        return SubscriptionResponse(
            status="sent",
            email=req.email,
            aoi_id=alert.aoi_id,
            region_name=alert.region_name,
            severity=alert.severity,
            smtp_configured=True,
            message_es=(
                f"Suscripción confirmada para recibir alertas de "
                f"{alert.region_name} en {req.email}."
            ),
            message_en=(
                f"Subscription confirmed to receive {alert.region_name} "
                f"alerts at {req.email}."
            ),
        )

    ok, err = send_alert_email(cfg, req, alert)
    if ok:
        return SubscriptionResponse(
            status="sent",
            email=req.email,
            aoi_id=alert.aoi_id,
            region_name=alert.region_name,
            severity=alert.severity,
            smtp_configured=True,
            message_es=(
                f"Suscripción activa y boletín actual de {alert.region_name} "
                f"enviado por SMTP a {req.email}."
            ),
            message_en=(
                f"Subscription active and current bulletin for {alert.region_name} "
                f"sent via SMTP to {req.email}."
            ),
        )
    return SubscriptionResponse(
        status="subscribed_error",
        email=req.email,
        aoi_id=alert.aoi_id,
        region_name=alert.region_name,
        severity=alert.severity,
        smtp_configured=True,
        message_es=(
            f"Suscripción guardada para {alert.region_name}, pero falló el envío SMTP ({err}). "
            "Verifica las credenciales SMTP."
        ),
        message_en=(
            f"Subscription saved for {alert.region_name}, but SMTP delivery failed ({err}). "
            "Check SMTP credentials."
        ),
    )
