"""Application settings, read exclusively from environment variables.

Secrets (e.g. the FIRMS MAP_KEY) are never written in code or committed: they are injected
through the environment (locally: a git-ignored `.env` file; CI/production: a secrets manager).
"""

from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="BRASA_", env_file=".env", extra="ignore", env_ignore_empty=True
    )

    environment: Literal["development", "test", "production"] = "development"
    firms_map_key: SecretStr | None = Field(default=None, description="NASA FIRMS MAP_KEY.")
    firms_base_url: str = "https://firms.modaps.eosdis.nasa.gov"
    cors_allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    # Optional pattern for origins that change per deploy (e.g. Vercel preview URLs).
    cors_allowed_origin_regex: str | None = None
    data_dir: str = "data"
    # Keep satellite interpretation 100% deterministic unless generative phrasing is opted in.
    enable_generative_llm: bool = Field(
        default=False,
        description=(
            "Enable external LLM phrasing for /explain; false guarantees deterministic summaries."
        ),
    )
    # Standard Anthropic variable name (no BRASA_ prefix) so platform integrations just work.
    anthropic_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "ANTHROPIC_API_KEY", "BRASA_ANTHROPIC_API_KEY", "anthropic_api_key"
        ),
        description="Server-side only; enables Claude summaries in /api/v1/explain.",
    )
    explain_model: str = "claude-opus-5-5"
    # Any OpenAI-compatible chat API (Groq, xAI Grok...). When all three are set it takes
    # precedence over Anthropic. Operator configuration, never user input.
    llm_base_url: str | None = Field(default=None, pattern=r"^https://")
    llm_api_key: SecretStr | None = Field(default=None, description="Server-side only.")
    llm_model: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
