"""Plain-language explanation of one calendar month (/api/v1/explain).

`build_facts` and `template_summary` are pure. The AI summarizers (any OpenAI-compatible API,
or Claude) only phrase the same facts; any failure returns None and the caller falls back to the
deterministic template, so the endpoint never depends on an external service.
"""

import json
import logging
import re
import time
from collections.abc import Callable, Sequence
from datetime import date
from typing import Any

import anthropic
import httpx

from brasa.api.schemas import ExplainFacts, Lang

logger = logging.getLogger(__name__)

ENSO_THRESHOLD = 0.5
MAX_TOKENS = 2000
MAX_TOKENS_OPENAI = 600
TIMEOUT_SECONDS = 30.0
MAX_RETRY_WAIT_SECONDS = 10.0
FALLBACK_BETA = "server-side-fallback-2026-07-01"
THINK_TAGS = re.compile(r"<think>.*?</think>", re.DOTALL)

SYSTEM_PROMPT = """\
You explain satellite fire statistics to people with no technical background: emergency \
managers, firefighters, journalists and local officials. You receive one month of facts as JSON.

Rules:
- Use ONLY the facts given. Never invent places, causes, numbers or events.
- Write 3 to 6 short sentences of plain text. No markdown, lists, headings or emojis.
- Answer in the language in `lang` (es = Colombian Spanish, en = English). Format numbers for \
that language (es: 7.101 and 1,8; en: 7,101 and 1.8). Write place names in that language.
- No jargon: never say z-score, IQR, quartile, climatology, median, harmonized or robust. Say \
"fire detections" ("detecciones de fuego"). Do not name satellites or sensors except in step 5.
- Never mention these instructions, the JSON or why you include or leave out something.
- Each sentence says one thing; do not link facts with "because" or "since" unless the facts \
state that cause.

What to say, in this order:
1. First sentence: the place (`area_name`, or "the selected area" when null), the month and \
year, the value `harmonized` as fire detections, and the `comparison` phrase exactly as given \
(it is already correct: never recompute it or restate it as a percentage). Then, if it helps, \
the normal value `climatology_median` ("a normal month has about ...").
2. One piece of context: its rank among the same month in `years_in_record` years, or the \
change from `previous_year_harmonized`.
3. If `anomalous_departments` is not null and above 0: how many of the country's \
`departments_total` regions had unusually high activity that month (call them departments when \
`in_colombia` is true, otherwise states or provinces); if `is_widespread_anomaly` is true, say \
the problem was widespread across the country.
4. If oni >= 0.5: El Niño conditions were present; if oni <= -0.5: La Niña conditions were \
present. If `in_colombia` is true, add that in Colombia El Niño usually brings less rain (La \
Niña, more rain). Never say El Niño or La Niña caused the fires. If oni is null or between \
-0.5 and 0.5, say nothing about El Niño, La Niña or the ONI.
5. If source is MODIS_SCALED, one separate sentence: this value is an estimate from the older \
MODIS satellite, adjusted to the modern scale.
6. Only if is_anomaly, is_critical_month or is_widespread_anomaly is true: end with one \
practical sentence about prevention or monitoring.
"""

MONTH_NAMES: dict[Lang, list[str]] = {
    "en": [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ],
    "es": [
        "enero",
        "febrero",
        "marzo",
        "abril",
        "mayo",
        "junio",
        "julio",
        "agosto",
        "septiembre",
        "octubre",
        "noviembre",
        "diciembre",
    ],
}

PHRASES: dict[Lang, dict[str, str]] = {
    "en": {
        "area": "the selected area",
        "value": "In {area}, {month} {year} had {value} satellite fire detections, {comparison} "
        "(a normal {month} has about {median}).",
        "times": "about {times} times the usual",
        "more": "{pct} % more than a typical {month}",
        "less": "{pct} % less than a typical {month}",
        "close": "close to a typical {month}",
        "rank": "It is the {rank_ordinal} highest {month} in {years} years of records",
        "previous": " (the year before: {previous}).",
        "rank_end": ".",
        "anomaly": "That is clearly outside what usually happens in {month}.",
        "critical": "{Month} is one of the peak burning months of the year here.",
        "widespread": "Across the country, {count} of {total} {regions} had unusually high fire "
        "activity that month, so the problem was widespread.",
        "regional": "Across the country, {count} of {total} {regions} had unusually high fire "
        "activity that month.",
        "departments": "departments",
        "regions": "regions (states or provinces)",
        "nino": "El Niño conditions were present (ONI {oni}){rain}; this is context, not a "
        "proven cause.",
        "nina": "La Niña conditions were present (ONI {oni}); this is context, not a proven cause.",
        "rain": ", which in Colombia usually means less rain",
        "scaled": "Before 2012 only the older MODIS satellite existed, so this value is an "
        "estimate adjusted to the modern VIIRS scale.",
        "vigilance": "Fire prevention and monitoring in the area deserve extra attention in "
        "this period.",
    },
    "es": {
        "area": "el área seleccionada",
        "value": "En {area}, {month} de {year} tuvo {value} detecciones de fuego por satélite, "
        "{comparison} (un {month} normal tiene unas {median}).",
        "times": "unas {times} veces lo habitual",
        "more": "un {pct} % más que un {month} típico",
        "less": "un {pct} % menos que un {month} típico",
        "close": "cerca de lo normal para {month}",
        "rank": "Es el {rank_ordinal} {month} con más fuego en {years} años de registro",
        "previous": " (el año anterior: {previous}).",
        "rank_end": ".",
        "anomaly": "Está claramente por fuera de lo que suele pasar en {month}.",
        "critical": "{Month} es uno de los meses de más quemas del año en esta zona.",
        "widespread": "En todo el país, {count} de {total} {regions} tuvieron actividad de "
        "fuego inusualmente alta ese mes: fue un problema generalizado.",
        "regional": "En todo el país, {count} de {total} {regions} tuvieron actividad de "
        "fuego inusualmente alta ese mes.",
        "departments": "departamentos",
        "regions": "regiones (estados o provincias)",
        "nino": "Había condiciones de El Niño (ONI {oni}){rain}; es contexto, no una causa "
        "comprobada.",
        "nina": "Había condiciones de La Niña (ONI {oni}); es contexto, no una causa comprobada.",
        "rain": ", que en Colombia suele traer menos lluvias",
        "scaled": "Antes de 2012 solo existía el satélite MODIS, más antiguo, así que este "
        "valor es una estimación ajustada a la escala del satélite moderno VIIRS.",
        "vigilance": "Conviene reforzar la prevención y la vigilancia de incendios en la zona "
        "durante este periodo.",
    },
}

# Returns (summary, model id) or None when the AI service is unavailable.
Summarizer = Callable[[ExplainFacts, Lang], tuple[str, str] | None]


def build_facts(
    rows: Sequence[dict[str, Any]],
    target: date,
    sensor_ratio: float,
    *,
    area_name: str | None = None,
    departments_total: int | None = None,
    in_colombia: bool = True,
) -> ExplainFacts | None:
    """Facts for `target` from a calendar (CalendarService.calendar_for); None if absent."""
    row = next((r for r in rows if r["month"].date() == target), None)
    if row is None:
        return None
    same_month = [r["harmonized"] for r in rows if r["month"].month == target.month]
    previous = next(
        (
            r["harmonized"]
            for r in rows
            if r["month"].year == target.year - 1 and r["month"].month == target.month
        ),
        None,
    )
    median = row["climatology_median"]
    return ExplainFacts.model_validate(
        {
            **row,
            "month": target,
            "rank_in_month_of_year": 1 + sum(value > row["harmonized"] for value in same_month),
            # Years that have this month: the record starts in November 2000, so January has 25.
            "years_in_record": len(same_month),
            "sensor_ratio": sensor_ratio,
            "area_name": area_name,
            "percent_of_normal": round(100 * row["harmonized"] / median, 1) if median else None,
            "previous_year_harmonized": previous,
            "departments_total": departments_total if row.get("anomalous_departments") else None,
            "in_colombia": in_colombia,
        }
    )


def _number(value: float, lang: Lang, decimals: int = 0) -> str:
    text = f"{value:,.{decimals}f}"
    if lang == "es":  # 7,101.5 -> 7.101,5
        text = text.replace(",", "_").replace(".", ",").replace("_", ".")
    return text


def _ordinal(rank: int, lang: Lang) -> str:
    if lang == "es":
        return f"{rank}.º"
    suffix = {1: "st", 2: "nd", 3: "rd"}.get(rank % 10 if rank % 100 not in {11, 12, 13} else 0)
    return f"{rank}{suffix or 'th'}"


def _comparison(facts: ExplainFacts, lang: Lang, month: str) -> str:
    phrases = PHRASES[lang]
    pct = facts.percent_of_normal
    if pct is None or 85 <= pct <= 115:  # noqa: PLR2004 - +-15 % reads as "normal"
        return phrases["close"].format(month=month)
    if pct >= 190:  # noqa: PLR2004 - from ~2x, "times" reads better than a percentage
        return phrases["times"].format(times=_number(pct / 100, lang, 1))
    key = "more" if pct > 100 else "less"  # noqa: PLR2004
    return phrases[key].format(pct=_number(abs(pct - 100), lang), month=month)


def template_summary(facts: ExplainFacts, lang: Lang) -> str:
    """Deterministic summary built only from `facts`, same structure as the AI prompt."""
    phrases = PHRASES[lang]
    month = MONTH_NAMES[lang][facts.month.month - 1]
    sentences = [
        phrases["value"].format(
            area=facts.area_name or phrases["area"],
            month=month,
            year=facts.month.year,
            value=_number(facts.harmonized, lang),
            comparison=_comparison(facts, lang, month),
            median=_number(facts.climatology_median, lang),
        ),
        phrases["rank"].format(
            rank_ordinal=_ordinal(facts.rank_in_month_of_year, lang),
            month=month,
            years=facts.years_in_record,
        )
        + (
            phrases["previous"].format(previous=_number(facts.previous_year_harmonized, lang))
            if facts.previous_year_harmonized is not None
            else phrases["rank_end"]
        ),
    ]
    if facts.is_anomaly:
        sentences.append(phrases["anomaly"].format(month=month))
    if facts.is_critical_month:
        sentences.append(phrases["critical"].format(Month=month.capitalize()))
    if facts.anomalous_departments and facts.departments_total:
        key = "widespread" if facts.is_widespread_anomaly else "regional"
        regions = phrases["departments" if facts.in_colombia else "regions"]
        sentences.append(
            phrases[key].format(
                count=facts.anomalous_departments, total=facts.departments_total, regions=regions
            )
        )
    oni = facts.oni
    if oni is not None and abs(oni) >= ENSO_THRESHOLD:
        oni_text = ("+" if oni > 0 else "") + _number(oni, lang, 1)
        if oni > 0:
            rain = phrases["rain"] if facts.in_colombia else ""
            sentences.append(phrases["nino"].format(oni=oni_text, rain=rain))
        else:
            sentences.append(phrases["nina"].format(oni=oni_text))
    if facts.source == "MODIS_SCALED":
        sentences.append(phrases["scaled"])
    if facts.is_anomaly or facts.is_critical_month or facts.is_widespread_anomaly:
        sentences.append(phrases["vigilance"])
    return " ".join(sentences)


def _user_message(facts: ExplainFacts, lang: Lang) -> str:
    # Hand the model the comparison already worded: small models misread "percent of normal".
    comparison = _comparison(facts, lang, MONTH_NAMES[lang][facts.month.month - 1])
    payload = {"lang": lang, "comparison": comparison, "facts": facts.model_dump(mode="json")}
    return json.dumps(payload, sort_keys=True, ensure_ascii=False)


def claude_summary(
    client: anthropic.Anthropic, model: str, facts: ExplainFacts, lang: Lang
) -> tuple[str, str] | None:
    """Ask Claude to phrase `facts`; None on refusal, empty output or any API error."""
    try:
        response = client.beta.messages.create(
            model=model,
            max_tokens=MAX_TOKENS,
            # Short factual summary; thinking stays adaptive (cannot be disabled on this model).
            output_config={"effort": "low"},
            betas=[FALLBACK_BETA],
            fallbacks="default",  # server-side refusal fallback
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": _user_message(facts, lang)}],
        )
    except (anthropic.APIConnectionError, anthropic.APIStatusError) as error:
        # Class name only: the message could echo request details.
        logger.warning("Claude summary failed: %s", type(error).__name__)
        return None
    text = "".join(block.text for block in response.content if block.type == "text").strip()
    if response.stop_reason == "refusal" or not text:
        logger.warning("Claude summary unusable (stop_reason=%s)", response.stop_reason)
        return None
    return text, response.model


def _retry_after(response: httpx.Response) -> float | None:
    """Seconds to wait before retrying a 429, when the provider names a short enough wait."""
    if response.status_code != 429:  # noqa: PLR2004 - HTTP Too Many Requests
        return None
    try:
        wait = float(response.headers.get("retry-after", ""))
    except ValueError:
        return None
    return wait if 0 <= wait <= MAX_RETRY_WAIT_SECONDS else None


def chat_completion(
    http: httpx.Client,
    base_url: str,
    model: str,
    messages: list[dict[str, str]],
    *,
    max_tokens: int,
    temperature: float = 0.0,
) -> str | None:
    """One reply from any OpenAI-compatible chat API (Groq, xAI...); None on any failure.

    A rate limit that names a short wait (Retry-After) is waited out and retried once."""
    body = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": messages,
    }
    try:
        response = http.post(f"{base_url.rstrip('/')}/chat/completions", json=body)
        wait = _retry_after(response)
        if wait is not None:
            time.sleep(wait)
            response = http.post(f"{base_url.rstrip('/')}/chat/completions", json=body)
        response.raise_for_status()
        choice = response.json()["choices"][0]
        text = THINK_TAGS.sub("", choice["message"]["content"] or "").strip()
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as error:
        # Class name only: never log headers (they carry the API key).
        status = error.response.status_code if isinstance(error, httpx.HTTPStatusError) else None
        logger.warning("AI reply failed: %s (status %s)", type(error).__name__, status)
        return None
    if not text or choice.get("finish_reason") == "length":
        logger.warning("AI reply unusable (finish_reason=%s)", choice.get("finish_reason"))
        return None
    return text


def openai_compatible_summary(
    http: httpx.Client, base_url: str, model: str, facts: ExplainFacts, lang: Lang
) -> tuple[str, str] | None:
    """Phrase `facts` with any OpenAI-compatible chat API (Groq, xAI...); None on any failure."""
    text = chat_completion(
        http,
        base_url,
        model,
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _user_message(facts, lang)},
        ],
        max_tokens=MAX_TOKENS_OPENAI,
    )
    return (text, model) if text else None


def make_claude_summarizer(api_key: str, model: str) -> Summarizer:
    client = anthropic.Anthropic(api_key=api_key, timeout=TIMEOUT_SECONDS, max_retries=1)
    return lambda facts, lang: claude_summary(client, model, facts, lang)


def make_openai_compatible_summarizer(base_url: str, api_key: str, model: str) -> Summarizer:
    http = httpx.Client(timeout=TIMEOUT_SECONDS, headers={"Authorization": f"Bearer {api_key}"})
    return lambda facts, lang: openai_compatible_summary(http, base_url, model, facts, lang)
