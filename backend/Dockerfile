# syntax=docker/dockerfile:1
# Multi-stage image: dependencies resolved from uv.lock (reproducible build) and a minimal
# runtime without build tools, running as an unprivileged user.

FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev --no-editable

FROM python:3.12-slim AS runtime
RUN groupadd --system brasa && useradd --system --gid brasa --no-create-home brasa
WORKDIR /app
COPY --from=build --chown=brasa:brasa /app /app
COPY --chown=brasa:brasa data ./data
# MALLOC_ARENA_MAX: glibc gives each request thread its own heap and keeps freed memory there;
# without the cap, bursts of requests ratcheted RAM past the free host's 512 MB (ADR-007).
ENV PATH="/app/.venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    BRASA_ENVIRONMENT=production MALLOC_ARENA_MAX=2
USER brasa
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request,sys; sys.exit(urllib.request.urlopen('http://127.0.0.1:8000/health').status != 200)"
CMD ["uvicorn", "brasa.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
