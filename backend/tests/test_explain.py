import json
from datetime import date
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx
import httpx2  # the anthropic SDK's own HTTP client
import pandas as pd
import pytest

from brasa.api.explain import (
    SYSTEM_PROMPT,
    build_facts,
    claude_summary,
    make_openai_compatible_summarizer,
    openai_compatible_summary,
    template_summary,
)
from brasa.api.schemas import ExplainFacts


def _row(month: str, harmonized: float, **extra: Any) -> dict[str, Any]:
    return {
        "month": pd.Timestamp(month),
        "raw_modis": 10,
        "raw_viirs": round(harmonized),
        "harmonized": harmonized,
        "source": "VIIRS",
        "robust_z": 0.5,
        "is_anomaly": False,
        "is_critical_month": False,
        "climatology_median": 100.0,
        "climatology_q25": 80.0,
        "climatology_q75": 120.0,
        "oni": None,
        **extra,
    }


ROWS = [
    _row("2022-01-01", 90.0),
    _row("2022-02-01", 500.0),
    _row("2023-01-01", 150.0),
    _row("2024-01-01", 31250.0, robust_z=2.4, is_anomaly=True, is_critical_month=True, oni=1.8),
]


def _facts(**overrides: Any) -> ExplainFacts:
    facts = build_facts(ROWS, date(2024, 1, 1), sensor_ratio=4.28)
    assert facts is not None
    return facts.model_copy(update=overrides)


def test_build_facts_rank_and_years() -> None:
    facts = build_facts(ROWS, date(2023, 1, 1), sensor_ratio=4.28)
    assert facts is not None
    assert facts.rank_in_month_of_year == 2  # 31250 (2024) > 150 (2023) > 90 (2022)
    assert facts.years_in_record == 3
    assert facts.sensor_ratio == 4.28
    assert _facts().rank_in_month_of_year == 1


def test_years_count_only_those_with_that_month() -> None:
    """The record starts in November 2000, so January is ranked among fewer years than November."""
    rows = [_row("2021-11-01", 50.0), *ROWS]
    january = build_facts(rows, date(2024, 1, 1), sensor_ratio=4.28)
    november = build_facts(rows, date(2021, 11, 1), sensor_ratio=4.28)
    assert january is not None and january.years_in_record == 3  # 2022, 2023, 2024
    assert november is not None and november.years_in_record == 1


def test_build_facts_missing_month() -> None:
    assert build_facts(ROWS, date(2030, 1, 1), sensor_ratio=4.28) is None


def test_build_facts_percent_previous_year_and_context() -> None:
    rows = [
        _row("2023-01-01", 150.0),
        _row("2024-01-01", 31250.0, anomalous_departments=9, is_widespread_anomaly=True),
    ]
    facts = build_facts(
        rows,
        date(2024, 1, 1),
        sensor_ratio=4.28,
        area_name="Meta",
        departments_total=32,
    )
    assert facts is not None
    assert facts.percent_of_normal == 31250.0
    assert facts.previous_year_harmonized == 150.0
    assert facts.area_name == "Meta"
    assert (facts.anomalous_departments, facts.departments_total) == (9, 32)
    assert facts.is_widespread_anomaly is True


def test_build_facts_hides_departments_total_without_regional_context() -> None:
    facts = build_facts(ROWS, date(2022, 1, 1), sensor_ratio=4.28, departments_total=32)
    assert facts is not None
    assert facts.previous_year_harmonized is None
    assert facts.departments_total is None


def test_template_english_peak_month() -> None:
    text = template_summary(_facts(area_name="Meta"), "en")
    assert text.startswith("In Meta, January 2024 had 31,250 satellite fire detections")
    assert "about 312.5 times the usual (a normal January has about 100)" in text
    assert "It is the 1st highest January in 3 years of records (the year before: 150)." in text
    assert "clearly outside what usually happens" in text
    assert "El Niño conditions were present (ONI +1.8), which in Colombia usually" in text
    assert text.endswith("deserve extra attention in this period.")
    assert "MODIS" not in text


def test_template_spanish_modis_scaled_la_nina_quiet_month() -> None:
    facts = _facts(
        source="MODIS_SCALED",
        oni=-0.7,
        harmonized=100.0,
        percent_of_normal=100.0,
        is_anomaly=False,
        is_critical_month=False,
    )
    text = template_summary(facts, "es")
    assert text.startswith("En el área seleccionada, enero de 2024 tuvo 100 detecciones de fuego")
    assert "cerca de lo normal para enero" in text
    assert "Es el 1.º enero con más fuego en 3 años de registro" in text
    assert "La Niña (ONI -0,7)" in text
    assert "satélite MODIS" in text
    assert "vigilancia" not in text


@pytest.mark.parametrize(
    ("percent", "expected"),
    [(140.0, "un 40 % más que un enero típico"), (60.0, "un 40 % menos que un enero típico")],
)
def test_template_spanish_percent_comparisons(percent: float, expected: str) -> None:
    assert expected in template_summary(_facts(percent_of_normal=percent), "es")


def test_template_regional_and_widespread_departments() -> None:
    regional = template_summary(_facts(anomalous_departments=3, departments_total=32), "es")
    assert "3 de 32 departamentos tuvieron actividad" in regional
    assert "generalizado" not in regional
    widespread = _facts(anomalous_departments=13, departments_total=32, is_widespread_anomaly=True)
    assert "the problem was widespread" in template_summary(widespread, "en")


def test_template_outside_colombia_has_no_rain_claim_and_ordinals() -> None:
    text = template_summary(_facts(in_colombia=False, rank_in_month_of_year=12), "en")
    assert "less rain" not in text
    assert "12th highest" in text
    assert "22nd" in template_summary(_facts(rank_in_month_of_year=22), "en")


def test_template_neutral_oni() -> None:
    text = template_summary(_facts(oni=0.2), "es")
    assert "Niño" not in text and "Niña" not in text


class FakeMessages:
    def __init__(self, response: Any = None, error: Exception | None = None) -> None:
        self.response, self.error, self.calls = response, error, []

    def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.response


def _client(messages: FakeMessages) -> Any:
    return SimpleNamespace(beta=SimpleNamespace(messages=messages))


def _response(stop_reason: str, *texts: str) -> SimpleNamespace:
    blocks = [SimpleNamespace(type="thinking", thinking="...")]
    blocks += [SimpleNamespace(type="text", text=text) for text in texts]
    return SimpleNamespace(content=blocks, stop_reason=stop_reason, model="claude-opus-5-5")


def test_claude_summary_returns_text_blocks_and_model() -> None:
    messages = FakeMessages(_response("end_turn", "En enero ", "hubo más fuego."))
    result = claude_summary(_client(messages), "claude-opus-5-5", _facts(), "es")
    assert result == ("En enero hubo más fuego.", "claude-opus-5-5")
    call = messages.calls[0]
    assert call["system"] == SYSTEM_PROMPT
    assert call["fallbacks"] == "default"
    payload = json.loads(call["messages"][0]["content"])
    assert payload["lang"] == "es"
    assert payload["facts"]["rank_in_month_of_year"] == 1


@pytest.mark.parametrize("response", [_response("refusal", "no"), _response("end_turn")])
def test_claude_summary_refusal_or_empty_is_none(response: SimpleNamespace) -> None:
    assert claude_summary(_client(FakeMessages(response)), "m", _facts(), "en") is None


REQUEST = httpx2.Request("POST", "https://example.invalid")


@pytest.mark.parametrize(
    "error",
    [
        anthropic.APIConnectionError(request=REQUEST),
        anthropic.APITimeoutError(request=REQUEST),
        anthropic.InternalServerError(
            "boom", response=httpx2.Response(500, request=REQUEST), body=None
        ),
    ],
)
def test_claude_summary_api_errors_are_none(error: Exception) -> None:
    assert claude_summary(_client(FakeMessages(error=error)), "m", _facts(), "en") is None


def _openai_http(handler: Any) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _completion(content: str | None, finish_reason: str = "stop") -> dict[str, Any]:
    message = {"role": "assistant", "content": content}
    return {"choices": [{"message": message, "finish_reason": finish_reason}]}


def test_openai_compatible_summary_sends_prompt_and_strips_think_tags() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=_completion("<think>plan</think> Resumen claro."))

    result = openai_compatible_summary(
        _openai_http(handler), "https://api.example.test/v1/", "free-model", _facts(), "es"
    )
    assert result == ("Resumen claro.", "free-model")
    body = json.loads(seen[0].content)
    assert str(seen[0].url) == "https://api.example.test/v1/chat/completions"
    assert body["model"] == "free-model"
    assert body["messages"][0] == {"role": "system", "content": SYSTEM_PROMPT}
    payload = json.loads(body["messages"][1]["content"])
    assert payload["lang"] == "es"
    assert "312,5" in payload["comparison"]  # worded for the model, never recomputed by it


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(429, json={"error": "rate limited"}),
        httpx.Response(200, json={"unexpected": True}),
        httpx.Response(200, text="not json"),
        httpx.Response(200, json=_completion(None)),
        httpx.Response(200, json=_completion("Cut mid sen", finish_reason="length")),
    ],
)
def test_openai_compatible_summary_failures_are_none(response: httpx.Response) -> None:
    http = _openai_http(lambda _request: response)
    assert openai_compatible_summary(http, "https://x.test/v1", "m", _facts(), "en") is None


def test_openai_compatible_summary_retries_once_after_a_short_rate_limit() -> None:
    replies = iter(
        [
            httpx.Response(429, headers={"retry-after": "0"}),
            httpx.Response(200, json=_completion("Listo.")),
        ]
    )
    http = _openai_http(lambda _request: next(replies))
    assert openai_compatible_summary(http, "https://x.test", "m", _facts(), "es") == ("Listo.", "m")


def test_openai_compatible_summary_network_error_is_none() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    assert (
        openai_compatible_summary(_openai_http(handler), "https://x.test", "m", _facts(), "en")
        is None
    )


def test_make_openai_compatible_summarizer_sends_bearer_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[httpx.Request] = []

    def fake_post(self: httpx.Client, url: str, **kwargs: Any) -> httpx.Response:
        request = self.build_request("POST", url, **kwargs)
        seen.append(request)
        return httpx.Response(200, json=_completion("Ok."), request=request)

    monkeypatch.setattr(httpx.Client, "post", fake_post)
    summarize = make_openai_compatible_summarizer("https://x.test/v1", "secret-key", "m")
    assert summarize(_facts(), "en") == ("Ok.", "m")
    assert seen[0].headers["Authorization"] == "Bearer secret-key"
