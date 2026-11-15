"""The help chat: the AI words the answer, stays on topic, and the deterministic reply backs it."""

import json
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi.testclient import TestClient

from brasa.api.app import _hourly_budget, create_app
from brasa.api.assistant import REFUSAL, read_reply
from brasa.api.service import CalendarService, CountryCalendars
from brasa.config import Settings
from brasa.ingestion.boundaries import load_departments

DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def _client(reply: str | None, seen: list[Any]) -> TestClient:
    def assistant(system: str, messages: list[dict[str, str]]) -> str | None:
        seen.append((system, messages))
        return reply

    depts = load_departments(DATA_DIR / "context" / "colombia_departments.geojson")["features"]
    return TestClient(
        create_app(
            Settings(environment="test", data_dir=str(DATA_DIR)),
            service=CalendarService.from_sample_data(departments=depts),
            countries=CountryCalendars.from_monthly(
                pd.DataFrame(columns=["country", "month", "sensor", "count"])
            ),
            assistant=assistant,
        )
    )


def _ask(client: TestClient, question: str, **extra: Any) -> tuple[str, list[dict[str, str]]]:
    res = client.post(
        "/api/analyst", json={"aoiId": "co", "question": question, "lang": "es", **extra}
    )
    assert res.status_code == 200
    text, highlights = "", []
    for line in res.text.splitlines():
        if line.startswith("data: "):
            payload = json.loads(line[6:])
            text += payload.get("delta", "")
            highlights = payload.get("highlights", highlights)
    return text, highlights


def test_ai_reply_is_grounded_in_the_area_facts_and_keeps_the_conversation() -> None:
    seen: list[Any] = []
    history = [
        {"role": "user", "content": "¿Qué es el calendario?"},
        {"role": "assistant", "content": "Cada fila es un año."},
    ]
    text, highlights = _ask(
        _client("Los meses más inusuales están marcados. [MONTHS]", seen),
        "¿Y qué meses fueron raros?",
        history=history,
    )
    assert text == "Los meses más inusuales están marcados."
    # the reply points at the notable months, so the analyst's highlights stay
    assert highlights == _ask(_client(None, []), "¿Y qué meses fueron raros?")[1]
    system, messages = seen[0]
    assert "Colombia" in system
    assert "Estacionalidad" in system  # the deterministic analyst reply is the facts block
    assert messages == [*history, {"role": "user", "content": "¿Y qué meses fueron raros?"}]


def test_off_topic_questions_get_the_fixed_refusal_without_highlights() -> None:
    text, highlights = _ask(_client("[OFF_TOPIC]", []), "Escríbeme un poema de amor")
    assert text == REFUSAL["es"]
    assert highlights == []


def test_reply_without_months_drops_the_highlights() -> None:
    _, highlights = _ask(_client("Usa el botón ↶ para volver.", []), "¿Cómo deshago?")
    assert highlights == []


def test_without_the_ai_the_deterministic_reply_is_served() -> None:
    text, _ = _ask(_client(None, []), "¿Cuándo es la temporada crítica?")
    assert "Estacionalidad" in text


def test_read_reply_strips_tags() -> None:
    assert read_reply("  [OFF_TOPIC]", "en") == (REFUSAL["en"], False)
    assert read_reply("Peak in March. [MONTHS]", "en") == ("Peak in March.", True)
    assert read_reply("", "en") == ("", False)


def test_history_is_capped() -> None:
    client = _client("ok", [])
    turns = [{"role": "user", "content": "hola"}] * 9
    res = client.post("/api/analyst", json={"aoiId": "co", "question": "x", "history": turns})
    assert res.status_code == 422


def test_hourly_budget_refuses_beyond_the_limit_until_an_hour_passes() -> None:
    now = [0.0]
    within = _hourly_budget(2, clock=lambda: now[0])
    assert within() and within()
    assert not within()
    now[0] = 3600.0
    assert within()
