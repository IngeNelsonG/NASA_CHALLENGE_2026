"""Brasa HTTP API (FastAPI).

Minimal, read-only surface: no users and no writes, which shrinks the threat model.
See docs/security/threat-model.md.
"""

import json
import logging
import re
import threading
import time
from collections import deque
from collections.abc import Awaitable, Callable, Hashable, Mapping
from dataclasses import dataclass
from datetime import date, datetime
from functools import lru_cache, wraps
from pathlib import Path
from typing import Annotated, Any

import httpx
import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, RedirectResponse

from brasa import __version__
from brasa.alerts.detector import evaluate_rows, summarize_alerts
from brasa.alerts.schemas import AlertItem, AlertSeverity, AlertsResponse
from brasa.api.assistant import ASSISTANT_MAX_TOKENS, Assistant
from brasa.api.ember_routes import AoiEntry, _resolve_aoi_id, register_ember_routes
from brasa.api.ember_routes import _slug as aoi_slug
from brasa.api.explain import (
    Summarizer,
    build_facts,
    chat_completion,
    make_claude_summarizer,
    make_openai_compatible_summarizer,
    template_summary,
)
from brasa.api.hotspot_sources import FirmsHotspots
from brasa.api.schemas import (
    CalendarMonth,
    CalendarResponse,
    CountriesResponse,
    Country,
    ExplainFacts,
    ExplainResponse,
    HealthResponse,
    HeatmapRegion,
    HeatmapResponse,
    Lang,
    OutlookResponse,
    RecentResponse,
)
from brasa.api.service import (
    DEPARTMENTS_FILE,
    FORECAST_MODEL,
    HEATMAP_CELL_DEG,
    STATIC_SOURCES,
    WORLD_SUBDIVISIONS,
    CalendarService,
    CountryCalendars,
    heatmap_cells,
    load_forecast_model,
    map_sensor,
    outlook,
    peak_day,
    recent_summary,
)
from brasa.config import Settings, get_settings
from brasa.domain.models import COLOMBIA, BoundingBox, InvalidBoundingBoxError
from brasa.harmonization.calibrate import SensorRatio
from brasa.ingestion.boundaries import geometry_bbox, load_departments, load_world_subdivisions
from brasa.ingestion.firms_client import FirmsClient
from brasa.ingestion.recent import RecentDetections, RecentSource, load_static_cells

logger = logging.getLogger(__name__)

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cache-Control": "no-store",
}
# Production is only served over HTTPS: tell browsers never to try plain HTTP.
HSTS = "max-age=31536000; includeSubDomains"
# The data only changes on a deploy, so browsers may keep successful answers: fewer requests
# reach the small server and moving between places is instant. Errors are never cached.
DATA_CACHE = "public, max-age=3600"
RECENT_CACHE = "public, max-age=300"  # NASA refreshes the near-real-time feed during the day
# Swagger UI (/docs, development only) loads from jsDelivr and boots with an inline script.
DOCS_CSP = (
    "default-src 'none'; script-src https://cdn.jsdelivr.net 'unsafe-inline'; "
    "style-src https://cdn.jsdelivr.net; img-src https://fastapi.tiangolo.com data:; "
    "connect-src 'self'; frame-ancestors 'none'"
)
GZIP_MINIMUM_BYTES = 1000
EXPLAIN_CACHE_SIZE = 512
# Calendars and heat maps scan up to 2 M detections (~50 MB each). FastAPI runs up to 40
# requests in threads at once, which overran the free 512 MB host; this many compute at a time
# (each takes well under a second), the rest wait. Cached answers skip the wait.
HEAVY_CONCURRENCY = 3
# A flood of distinct searches must not park every worker thread in the queue: after this wait
# the request is refused with 503 and the rest of the API keeps answering.
HEAVY_WAIT_SECONDS = 10.0
_heavy = threading.BoundedSemaphore(HEAVY_CONCURRENCY)
# AI summaries cost money per call. Whatever the clients do, at most this many are generated per
# hour (cached answers are free); beyond it /explain serves the deterministic template.
AI_CALLS_PER_HOUR = 120
# The help chat answers free text, so nothing is cached; the same kind of hourly cap applies.
ASSISTANT_CALLS_PER_HOUR = 300
ASSISTANT_TIMEOUT_SECONDS = 20.0
HOUR_SECONDS = 3600.0


def _limited[**P, R](
    slots: threading.BoundedSemaphore,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Decorator: run the function only while one of `slots` is free; 503 after a long wait."""

    def decorate(compute: Callable[P, R]) -> Callable[P, R]:
        @wraps(compute)
        def run(*args: P.args, **kwargs: P.kwargs) -> R:
            if not slots.acquire(timeout=HEAVY_WAIT_SECONDS):
                raise HTTPException(
                    status_code=503,
                    detail="The server is busy. Try again in a moment.",
                    headers={"Retry-After": "5"},
                )
            try:
                return compute(*args, **kwargs)
            finally:
                slots.release()

        return run

    return decorate


def _bounded[**P, R](compute: Callable[P, R]) -> Callable[P, R]:
    """Run `compute` only while one of the HEAVY_CONCURRENCY slots is free."""
    return _limited(_heavy)(compute)


# A CSV export reads extra columns from disk and builds a file of up to ~15 MB: one at a time.
_one_export = _limited(threading.BoundedSemaphore(1))


UNITS = "VIIRS-equivalent detections"
# One download: about a year of all Colombia, or the whole record of a small department (~15 MB).
HOTSPOTS_MAX_ROWS = 250_000
COUNTRY_MAX_LENGTH = 80
SUBDIVISION_MAX_LENGTH = 100
ISO_A2 = re.compile(r"^[A-Z]{2}$")

# A request targets a Colombian area (a box, or a department by its polygon), a whole country,
# or one of its subdivisions.
# ("area", "w,s,e,n", department | None) | ("country", name, subdivision | None)
Target = tuple[str, str, str | None]
DEPARTMENT_MAX_LENGTH = 60
CachedSummarizer = Callable[[Hashable, ExplainFacts, Lang], tuple[str, str] | None]


def _parse_bbox(raw: str) -> BoundingBox:
    try:
        return BoundingBox.parse(raw)
    except InvalidBoundingBoxError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@dataclass(frozen=True)
class Places:
    """Closed lists every place parameter is checked against (never trust the name itself)."""

    subdivisions: Mapping[str, set[str]]  # country -> its subdivisions with detections
    departments: Mapping[str, str]  # Colombian department -> its bbox "w,s,e,n"

    def resolve(
        self,
        bbox: str | None,
        country: str | None,
        subdivision: str | None,
        department: str | None,
    ) -> Target:
        """`bbox`, `department` and `country` are mutually exclusive; `subdivision` needs a
        country."""
        if sum(value is not None for value in (bbox, country, department)) > 1:
            raise HTTPException(
                status_code=422, detail="Use only one of bbox, department or country."
            )
        if department is not None:
            if department not in self.departments:
                raise HTTPException(status_code=422, detail="Unknown department.")
            return ("area", self.departments[department], department)
        return _resolve(bbox, country, subdivision, self.subdivisions)


def _resolve(
    bbox: str | None,
    country: str | None,
    subdivision: str | None,
    known: Mapping[str, set[str]],
) -> Target:
    if subdivision is not None and country is None:
        raise HTTPException(status_code=422, detail="subdivision requires country.")
    if country is not None:
        if country not in known:
            raise HTTPException(status_code=422, detail="Unknown country.")
        if subdivision is not None and subdivision not in known[country]:
            raise HTTPException(status_code=422, detail="Unknown subdivision for that country.")
        return ("country", country, subdivision)
    return ("area", _parse_bbox(bbox or COLOMBIA.as_firms_area()).as_firms_area(), None)


def _aoi_target(entry: AoiEntry, places: Places) -> Target | None:
    """The calendar behind an area id of the globe, or None when /explain has no record for it
    (a group of regions, or a drawn box outside Colombia's point archive)."""
    country, department = entry.country or "", entry.department or ""
    west, south, east, north = entry.bbox
    in_colombia = (COLOMBIA.west <= west and COLOMBIA.south <= south) and (
        east <= COLOMBIA.east and north <= COLOMBIA.north
    )
    single = entry.subdivisions[0] if len(entry.subdivisions) == 1 else None
    by_kind: dict[str, Target | None] = {
        "world": ("world", "World", None),
        "department": (
            ("area", places.departments[department], department)
            if department in places.departments
            else None
        ),
        "colombia_all": ("area", COLOMBIA.as_firms_area(), None),
        "colombia_box": (
            ("area", BoundingBox(west, south, east, north).as_firms_area(), None)
            if in_colombia
            else None
        ),
        "country": ("country", country, None) if country in places.subdivisions else None,
        "subdivision": (
            ("country", country, single)
            if single in places.subdivisions.get(country, set())
            else None
        ),
    }
    return by_kind.get(entry.kind)


def _explain_target(
    aoi: str, aoi_index: Mapping[str, AoiEntry], places: Places
) -> tuple[Target, str]:
    """Target and display name for an area id; 404 when it has no monthly record."""
    entry = _resolve_aoi_id(aoi, aoi_index)
    target = _aoi_target(entry, places) if entry is not None else None
    if entry is None or target is None:
        raise HTTPException(status_code=404, detail="No monthly record for this area.")
    return target, entry.name


def _parse_month(month: str) -> date:
    try:
        return datetime.strptime(month, "%Y-%m").date()
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Invalid month; use YYYY-MM.") from error


def _extent(features: list[dict[str, Any]]) -> str:
    """west,south,east,north of features, within -180..180 for satellite image services.

    Antimeridian countries arrive with west longitudes shifted past 180 (see the map build);
    keep the wider side: Russia's [west, 180], the USA's [-180, east - 360]."""
    # Not BoundingBox.parse: that validates user input and rejects lon > 180 or empty islets.
    boxes = [[float(v) for v in geometry_bbox(f["geometry"]).split(",")] for f in features]
    west, south = min(b[0] for b in boxes), min(b[1] for b in boxes)
    east, north = max(b[2] for b in boxes), max(b[3] for b in boxes)
    if east > 180:  # noqa: PLR2004
        west, east = (west, 180.0) if 180 - west >= east - 360 + 180 else (-180.0, east - 360)
    return f"{west:.3f},{south:.3f},{east:.3f},{north:.3f}"


def _extents(world: Mapping[str, list[dict[str, Any]]]) -> dict[tuple[str, str | None], str]:
    """(country, None) and (country, subdivision) -> satellite image extent."""
    extents: dict[tuple[str, str | None], str] = {}
    for country, features in world.items():
        extents[(country, None)] = _extent(features)
        for feature in features:
            extents[(country, feature["properties"]["name"])] = _extent([feature])
    return extents


def _heatmap_routes(
    app: FastAPI,
    service: CalendarService,
    countries: CountryCalendars,
    places: Places,
    extents: Mapping[tuple[str, str | None], str],
) -> None:
    """GET /api/v1/heatmap: where it burned in one month, for maps and satellite images."""

    @lru_cache(maxsize=EXPLAIN_CACHE_SIZE)
    @_bounded
    def build(target: Target, month: date) -> HeatmapResponse:
        kind, value, region = target
        start = pd.Timestamp(month)
        if kind == "area":
            points = service.month_points(BoundingBox.parse(value), start, region)
            sensor = map_sensor(points["sensor"])
            return HeatmapResponse(
                month=month,
                sensor=sensor,
                detections=len(points),
                cell_deg=HEATMAP_CELL_DEG,
                cells=heatmap_cells(points, HEATMAP_CELL_DEG),
                regions=[
                    HeatmapRegion(name=n, count=c)
                    for n, c in service.month_departments(start, sensor)
                ],
                peak_day=peak_day(points),
                bbox=value,
            )
        sensor, total = countries.month_total(value, start)
        _, regions = countries.month_regions(value, start, sensor)
        if region is not None:
            total = dict(regions).get(region, 0)
        return HeatmapResponse(
            month=month,
            sensor=sensor,
            detections=total,
            cell_deg=None,
            cells=[],
            regions=[HeatmapRegion(name=n, count=c) for n, c in regions],
            peak_day=None,
            bbox=extents.get((value, region)),
        )

    @app.get("/api/v1/heatmap", response_model=HeatmapResponse)
    def heatmap(
        month: str = Query(max_length=7, pattern=r"^\d{4}-\d{2}$", description="YYYY-MM"),
        bbox: str | None = Query(default=None, max_length=100),
        country: str | None = Query(default=None, max_length=COUNTRY_MAX_LENGTH),
        subdivision: str | None = Query(default=None, max_length=SUBDIVISION_MAX_LENGTH),
        department: str | None = Query(default=None, max_length=DEPARTMENT_MAX_LENGTH),
    ) -> HeatmapResponse:
        target_month = _parse_month(month)
        return build(places.resolve(bbox, country, subdivision, department), target_month)


def _hotspots_routes(app: FastAPI, service: CalendarService, places: Places) -> None:
    """GET /api/v1/hotspots.csv: the detections behind a search, to download."""

    @_one_export
    def hotspots_csv(target: Target, start: date, end: date) -> bytes:
        _, value, department = target
        frame = service.hotspots(BoundingBox.parse(value), department, start, end)
        if len(frame) > HOTSPOTS_MAX_ROWS:
            raise HTTPException(
                status_code=422,
                detail=f"{len(frame)} detections: narrow the dates or the area "
                f"(limit {HOTSPOTS_MAX_ROWS}).",
            )
        if "acq_time" in frame:  # FIRMS writes the UTC time as HHMM
            frame = frame.assign(acq_time=frame["acq_time"].map("{:04d}".format))
        return frame.to_csv(index=False, date_format="%Y-%m-%d").encode()

    @app.get("/api/v1/hotspots.csv", response_class=Response)
    def hotspots(
        *,
        start: Annotated[date, Query(description="First day, YYYY-MM-DD (UTC).")],
        end: Annotated[date, Query(description="Last day, inclusive, YYYY-MM-DD (UTC).")],
        bbox: str | None = Query(default=None, max_length=100),
        department: str | None = Query(default=None, max_length=DEPARTMENT_MAX_LENGTH),
    ) -> Response:
        """The filtered FIRMS detections (vegetation fires, confident) behind a search, as CSV.

        Colombian areas only: the rest of the world has monthly totals, not points."""
        if start > end:
            raise HTTPException(status_code=422, detail="start must not be after end.")
        target = places.resolve(bbox, None, None, department)
        name = f"brasa-hotspots_{start.isoformat()}_{end.isoformat()}.csv"
        return Response(
            content=hotspots_csv(target, start, end),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )


def _recent_source(settings: Settings, departments: dict[str, Any]) -> RecentSource | None:
    """NASA's near-real-time feed; the test environment never touches the network."""
    if settings.environment == "test":
        return None
    static = load_static_cells(Path(settings.data_dir) / STATIC_SOURCES)
    source = RecentSource(static, departments["features"])
    source.get()  # start the first download now: it takes about 30 s
    return source


def _recent_routes(
    app: FastAPI, service: CalendarService, places: Places, source: RecentSource | None
) -> None:
    """GET /api/v1/recent: the last days (NASA's near-real-time feed) against their normal."""
    seen: list[RecentDetections] = []  # the feed the cached answers were built on

    @lru_cache(maxsize=EXPLAIN_CACHE_SIZE)
    @_bounded
    def build(target: Target, recent: RecentDetections) -> RecentResponse:
        _, value, department = target
        summary = recent_summary(service, recent, BoundingBox.parse(value), department)
        return RecentResponse.model_validate(summary)

    @app.get("/api/v1/recent", response_model=RecentResponse)
    def recent(
        bbox: str | None = Query(default=None, max_length=100),
        department: str | None = Query(default=None, max_length=DEPARTMENT_MAX_LENGTH),
    ) -> RecentResponse:
        """Colombian areas only. `available: false` when NASA's feed cannot be read right now."""
        target = places.resolve(bbox, None, None, department)
        latest = source.get() if source is not None else None
        if latest is None:
            return RecentResponse(available=False)
        if seen and seen[0] is not latest:  # a refreshed feed: drop answers built on the old one
            build.cache_clear()
        seen[:] = [latest]
        return build(target, latest)


def _outlook_routes(app: FastAPI, service: CalendarService, data_dir: Path) -> None:
    """GET /api/v1/outlook. The archive changes only with a deploy, so it is computed once."""
    coming = OutlookResponse.model_validate(
        outlook(service, load_forecast_model(data_dir / FORECAST_MODEL))
    )

    @app.get("/api/v1/outlook", response_model=OutlookResponse)
    def outlook_route() -> OutlookResponse:
        """Chance that each Colombian department's next months burn above normal."""
        return coming


def _iso_codes(world: Mapping[str, list[dict[str, Any]]]) -> dict[str, str]:
    """Country -> ISO alpha-2 from its subdivisions (Natural Earth uses -99 when unknown).

    Overseas units FIRMS lists as countries (French Guiana, Reunion...) carry their sovereign's
    code in Natural Earth; a shared code stays with the country that has the most subdivisions."""
    codes: dict[str, str] = {}
    for country, features in sorted(world.items(), key=lambda item: -len(item[1])):
        valid = [f["properties"]["iso_a2"] for f in features]
        valid = [code for code in valid if code and ISO_A2.match(code)]
        code = max(set(valid), key=valid.count) if valid else None
        if code and code not in codes.values():
            codes[country] = code
    return codes


def _world_maps(
    world: Mapping[str, list[dict[str, Any]]], known: Mapping[str, set[str]]
) -> dict[str, bytes]:
    """Country -> its subdivisions map, serialized once at startup; `has_data` marks the
    subdivisions with detections (the only ones the calendar can be asked for)."""
    return {
        country: json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        **f,
                        "properties": {
                            **f["properties"],
                            "has_data": f["properties"]["name"] in known.get(country, set()),
                        },
                    }
                    for f in features
                ],
            },
            separators=(",", ":"),
        ).encode()
        for country, features in world.items()
    }


def _hourly_budget(limit: int, clock: Callable[[], float] = time.monotonic) -> Callable[[], bool]:
    """True while fewer than `limit` calls were allowed in the last hour (and counts this one)."""
    calls: deque[float] = deque()
    lock = threading.Lock()

    def within_budget() -> bool:
        with lock:
            now = clock()
            while calls and now - calls[0] >= HOUR_SECONDS:
                calls.popleft()
            if len(calls) >= limit:
                return False
            calls.append(now)
            return True

    return within_budget


def _pick_assistant(settings: Settings) -> Assistant | None:
    """Help chat on the OpenAI-compatible provider (Groq) when configured, within a budget."""
    base_url, model, key = settings.llm_base_url, settings.llm_model, settings.llm_api_key
    if not (base_url and model and key and key.get_secret_value()):
        return None
    http = httpx.Client(
        timeout=ASSISTANT_TIMEOUT_SECONDS,
        headers={"Authorization": f"Bearer {key.get_secret_value()}"},
    )
    within_budget = _hourly_budget(ASSISTANT_CALLS_PER_HOUR)

    def assistant(system: str, messages: list[dict[str, str]]) -> str | None:
        if not within_budget():
            logger.warning("Assistant: hourly budget reached, serving the deterministic reply.")
            return None
        return chat_completion(
            http,
            base_url,
            model,
            [{"role": "system", "content": system}, *messages],
            max_tokens=ASSISTANT_MAX_TOKENS,
            temperature=0.2,
        )

    return assistant


def _with_cache(
    summarizer: Summarizer | None, clock: Callable[[], float] = time.monotonic
) -> CachedSummarizer:
    """Cache only successful AI answers (a transient API error must not pin the template) and
    cap how many are generated per hour, so no pattern of requests can run up the AI bill."""
    cache: dict[Hashable, tuple[str, str]] = {}
    within_budget = _hourly_budget(AI_CALLS_PER_HOUR, clock)

    def summarize(key: Hashable, facts: ExplainFacts, lang: Lang) -> tuple[str, str] | None:
        if key in cache or summarizer is None:
            return cache.get(key)
        if not within_budget():
            logger.warning("AI summaries: hourly budget reached, serving the template.")
            return None
        generated = summarizer(facts, lang)
        if generated is not None and len(cache) < EXPLAIN_CACHE_SIZE:
            cache[key] = generated
        return generated

    return summarize


def _pick_summarizer(settings: Settings) -> Summarizer | None:
    """OpenAI-compatible provider if fully configured, else Claude, else template only."""
    llm_key = settings.llm_api_key
    if settings.llm_base_url and settings.llm_model and llm_key and llm_key.get_secret_value():
        return make_openai_compatible_summarizer(
            settings.llm_base_url, llm_key.get_secret_value(), settings.llm_model
        )
    claude_key = settings.anthropic_api_key
    if claude_key is not None and claude_key.get_secret_value():
        return make_claude_summarizer(claude_key.get_secret_value(), settings.explain_model)
    return None


def _world(
    data_dir: Path, countries: CountryCalendars, country_totals: Mapping[str, int]
) -> tuple[
    dict[str, set[str]],
    dict[str, str],
    dict[str, bytes],
    dict[tuple[str, str | None], str],
    dict[str, list[dict[str, Any]]],
]:
    """Known subdivision names per country, ISO codes, pre-encoded maps, extents and features."""
    regions = countries.subdivision_names()
    known = {country: regions.get(country, set()) for country in country_totals}
    world = load_world_subdivisions(data_dir / WORLD_SUBDIVISIONS)
    return known, _iso_codes(world), _world_maps(world, known), _extents(world), world


def _base_app(settings: Settings) -> FastAPI:
    """FastAPI with CORS, gzip, security headers and a generic 500."""
    is_production = settings.environment == "production"
    app = FastAPI(
        title="Brasa API",
        version=__version__,
        docs_url=None if is_production else "/docs",
        redoc_url=None,
        openapi_url=None if is_production else "/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_origin_regex=settings.cors_allowed_origin_regex,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.add_middleware(GZipMiddleware, minimum_size=GZIP_MINIMUM_BYTES, compresslevel=6)

    @app.middleware("http")
    async def add_security_headers(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        response.headers.update(SECURITY_HEADERS)
        path = request.url.path
        if path == "/docs":  # the route only exists outside production
            response.headers["Content-Security-Policy"] = DOCS_CSP
        if is_production:
            response.headers["Strict-Transport-Security"] = HSTS
        # Not /explain: a template served during an AI hiccup must not stick in the browser.
        cacheable = path.startswith("/api/v1/") and path != "/api/v1/explain"
        if cacheable and response.status_code == httpx.codes.OK:
            is_recent = path in {"/api/v1/recent", "/api/v1/alerts"}
            response.headers["Cache-Control"] = RECENT_CACHE if is_recent else DATA_CACHE
        return response

    @app.exception_handler(Exception)
    async def unhandled_error(_: Request, error: Exception) -> JSONResponse:
        # Log the details internally and return a generic message (no stack trace).
        logger.exception("Unhandled error", exc_info=error)
        return JSONResponse(status_code=500, content={"detail": "Internal server error."})

    @app.get("/", include_in_schema=False, response_model=None)
    def root() -> RedirectResponse | dict[str, str]:
        # Opening the bare API URL should not look broken: docs in development, a pointer in prod.
        if is_production:
            return {"name": "Brasa API", "health": "/health"}
        return RedirectResponse("/docs")

    return app


def _alerts_routes(
    app: FastAPI,
    service: CalendarService,
    places: Places,
    recent_src: RecentSource | None,
    *,
    rows_for: Callable[[Target], tuple[list[dict[str, Any]], SensorRatio, int | None]],
    name_of: Callable[[Target], str | None],
) -> None:
    @app.get("/api/v1/alerts", response_model=AlertsResponse)
    def alerts(
        *,
        bbox: str | None = Query(default=None, max_length=100),
        country: str | None = Query(default=None, max_length=COUNTRY_MAX_LENGTH),
        subdivision: str | None = Query(default=None, max_length=SUBDIVISION_MAX_LENGTH),
        department: str | None = Query(default=None, max_length=DEPARTMENT_MAX_LENGTH),
        as_of: Annotated[
            date | None,
            Query(description="Evaluate alert status as of YYYY-MM-DD."),
        ] = None,
        min_severity: Annotated[AlertSeverity, Query()] = "NORMAL",
    ) -> AlertsResponse:
        """Deterministic unusual-trend early-warning alerts routed to responsible agencies."""
        latest_recent = recent_src.get() if recent_src is not None else None

        def _evaluate_target(target: Target, *, aoi_id: str, region_name: str) -> AlertItem:
            kind, value, sub = target
            rows, _, _ = rows_for(target)
            in_col = kind == "area" or value == "Colombia"
            nrt_det: int | None = None
            nrt_pct: float | None = None
            if latest_recent is not None and kind == "area":
                nrt = recent_summary(service, latest_recent, BoundingBox.parse(value), sub)
                nrt_det = nrt.get("detections")
                nrt_pct = nrt.get("percent_of_normal")
            return evaluate_rows(
                rows,
                aoi_id=aoi_id,
                region_name=region_name,
                department=sub if kind == "area" else None,
                country=value if kind == "country" else ("Colombia" if kind == "area" else None),
                in_colombia=in_col,
                as_of=as_of,
                nrt_detections=nrt_det,
                nrt_percent_of_normal=nrt_pct,
            )

        has_specific = any(v is not None for v in (bbox, country, subdivision, department))
        if has_specific:
            target = places.resolve(bbox, country, subdivision, department)
            kind, value, sub = target
            label = name_of(target) or value
            if kind == "area" and sub:
                aoi_id = f"co-{aoi_slug(sub)}"
            elif kind == "area":
                aoi_id = f"bbox:{value}"
            else:
                aoi_id = aoi_slug(label)
            item = _evaluate_target(target, aoi_id=aoi_id, region_name=label)
            return summarize_alerts([item], scope="aoi", min_severity=min_severity)

        # Nationwide scan across all 33 Colombian departments (or Colombia fallback if empty).
        items: list[AlertItem] = []
        if places.departments:
            for dept_name, dept_bbox in places.departments.items():
                items.append(
                    _evaluate_target(
                        ("area", dept_bbox, dept_name),
                        aoi_id=f"co-{aoi_slug(dept_name)}",
                        region_name=dept_name,
                    )
                )
        else:
            col_box = COLOMBIA.as_firms_area()
            items.append(
                _evaluate_target(("area", col_box, None), aoi_id="co", region_name="Colombia")
            )
        return summarize_alerts(items, scope="colombia-departments", min_severity=min_severity)


def _geo_routes(
    app: FastAPI,
    *,
    departments: bytes,
    iso_codes: dict[str, str],
    country_totals: dict[str, int],
    known: dict[str, set[str]],
    world_maps: dict[str, bytes],
) -> None:
    @app.get("/api/v1/departments")
    def list_departments() -> Response:
        # Serialized once at startup: re-encoding ~1 MB of coordinates per request is wasteful.
        return Response(content=departments, media_type="application/json")

    @app.get("/api/v1/countries", response_model=CountriesResponse)
    def list_countries() -> CountriesResponse:
        return CountriesResponse(
            countries=[
                Country(
                    name=name,
                    detections_total=total,
                    iso_a2=iso_codes.get(name),
                    subdivisions_total=len(known[name]),
                )
                for name, total in country_totals.items()
            ]
        )

    @app.get("/api/v1/subdivisions")
    def list_subdivisions(
        country: str = Query(max_length=COUNTRY_MAX_LENGTH),
    ) -> Response:
        """Map of a country's first-level subdivisions (Natural Earth admin-1, simplified)."""
        if country not in known:
            raise HTTPException(status_code=422, detail="Unknown country.")
        empty = b'{"type":"FeatureCollection","features":[]}'
        return Response(content=world_maps.get(country, empty), media_type="application/json")


def _firms_hotspots(settings: Settings) -> FirmsHotspots | None:
    """Live FIRMS points for areas outside the local archive; off without a MAP_KEY and in
    the test environment, which never touches the network."""
    key = settings.firms_map_key
    if settings.environment == "test" or key is None or not key.get_secret_value():
        return None
    return FirmsHotspots(FirmsClient(key, settings.firms_base_url))


def _rows_for_target(
    target: Target, service: CalendarService, countries: CountryCalendars
) -> tuple[list[dict[str, Any]], SensorRatio, int | None]:
    kind, value, subdivision = target
    if kind == "world":
        return countries.world_calendar() or ([], service.sensor_ratio, None)
    if kind == "country":
        result = countries.calendar_for(value, subdivision)
        if result is None:
            return [], service.sensor_ratio, None
        rows, ratio, regions_total = result
        return rows, ratio, regions_total or None
    if hasattr(service, "calendar_and_ratio_for"):
        rows, local_ratio = service.calendar_and_ratio_for(BoundingBox.parse(value), subdivision)
        return rows, local_ratio, service.regions_total or None
    rows = service.calendar_for(BoundingBox.parse(value), subdivision)
    return rows, service.sensor_ratio, service.regions_total or None


def create_app(
    settings: Settings | None = None,
    *,
    service: CalendarService | None = None,
    summarizer: Summarizer | None = None,
    countries: CountryCalendars | None = None,
    recent: RecentSource | None = None,
    assistant: Assistant | None = None,
) -> FastAPI:
    """Dependencies default to the data in `settings.data_dir`; tests inject their own.

    Without `recent`, the near-real-time feed is read from NASA except in the test environment,
    which never touches the network."""
    settings = settings or get_settings()
    data_dir = Path(settings.data_dir)
    service = service or CalendarService.from_data_dir(data_dir)
    countries = countries or CountryCalendars.from_data_dir(data_dir)
    # Deterministic templates are the default; generative LLM is opt-in only.
    explicit_summarizer = (
        summarizer
        if summarizer is not None
        else (_pick_summarizer(settings) if settings.enable_generative_llm else None)
    )
    summarize = _with_cache(explicit_summarizer)

    department_collection = load_departments(data_dir / DEPARTMENTS_FILE)
    departments = json.dumps(department_collection, separators=(",", ":")).encode()
    country_totals = countries.totals()
    known, iso_codes, world_maps, extents, world_features = _world(
        data_dir, countries, country_totals
    )
    places = Places(
        subdivisions=known,
        departments={
            f["properties"]["name"]: f["properties"]["bbox"]
            for f in department_collection["features"]
        },
    )
    recent_src = recent or _recent_source(settings, department_collection)

    app = _base_app(settings)
    _heatmap_routes(app, service, countries, places, extents)
    _hotspots_routes(app, service, places)
    _recent_routes(app, service, places, recent_src)
    _outlook_routes(app, service, data_dir)

    @lru_cache(maxsize=EXPLAIN_CACHE_SIZE)
    @_bounded
    def rows_for(target: Target) -> tuple[list[dict[str, Any]], SensorRatio, int | None]:
        return _rows_for_target(target, service, countries)

    def name_of(target: Target) -> str | None:
        kind, value, region = target
        if kind == "area":  # a department, all of Colombia, or an unnamed box
            return region or ("Colombia" if BoundingBox.parse(value) == COLOMBIA else None)
        return f"{region}, {value}" if region else value

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok", version=__version__)

    @app.get("/api/v1/calendar", response_model=CalendarResponse)
    def calendar(
        bbox: str | None = Query(
            default=None,
            max_length=100,
            description="Colombian area of interest: west,south,east,north (WGS84). "
            "Default: all of Colombia.",
        ),
        country: str | None = Query(
            default=None,
            max_length=COUNTRY_MAX_LENGTH,
            description="Any country in /api/v1/countries (monthly national totals).",
        ),
        subdivision: str | None = Query(
            default=None,
            max_length=SUBDIVISION_MAX_LENGTH,
            description="A first-level subdivision of `country` (see /api/v1/subdivisions).",
        ),
        department: str | None = Query(
            default=None,
            max_length=DEPARTMENT_MAX_LENGTH,
            description="A Colombian department from /api/v1/departments, by its polygon.",
        ),
    ) -> CalendarResponse:
        target = places.resolve(bbox, country, subdivision, department)
        rows, ratio, regions_total = rows_for(target)
        kind, value, region = target
        is_area = kind == "area"
        return CalendarResponse(
            scope="area" if is_area else ("subdivision" if region else "country"),
            bbox=value if is_area else None,
            country=None if is_area else value,
            subdivision=None if is_area else region,
            department=region if is_area else None,
            area_name=name_of(target),
            units=UNITS,
            dataset=service.dataset if is_area else "firms-archive",
            sensor_ratio=ratio.ratio,
            sensor_ratio_q25=ratio.q25,
            sensor_ratio_q75=ratio.q75,
            overlap_months=ratio.overlap_months,
            departments_total=regions_total,
            months=[CalendarMonth.model_validate(row) for row in rows],
        )

    _geo_routes(
        app,
        departments=departments,
        iso_codes=iso_codes,
        country_totals=country_totals,
        known=known,
        world_maps=world_maps,
    )

    # ponytail: per-process caches and unbounded distinct bboxes, so AI cost abuse is bounded
    # only by edge rate limiting; upgrade to a shared cache + app-level rate limit if needed.
    @lru_cache(maxsize=EXPLAIN_CACHE_SIZE)
    def facts_for(target: Target, month: date, name: str | None = None) -> ExplainFacts | None:
        rows, ratio, regions_total = rows_for(target)
        kind, value, _ = target
        return build_facts(
            rows,
            month,
            ratio.ratio,
            area_name=name_of(target) or name,  # `name`: a named box such as Orinoquía
            departments_total=regions_total,
            in_colombia=kind == "area" or value == "Colombia",
        )

    @app.get("/api/v1/explain", response_model=ExplainResponse)
    def explain(
        *,
        month: str = Query(max_length=7, pattern=r"^\d{4}-\d{2}$", description="YYYY-MM"),
        bbox: str | None = Query(default=None, max_length=100),
        country: str | None = Query(default=None, max_length=COUNTRY_MAX_LENGTH),
        subdivision: str | None = Query(default=None, max_length=SUBDIVISION_MAX_LENGTH),
        department: str | None = Query(default=None, max_length=DEPARTMENT_MAX_LENGTH),
        aoi: str | None = Query(
            default=None, max_length=120, description="An area id of the globe (/api/aoi)."
        ),
        lang: Lang = "es",
    ) -> ExplainResponse:
        target_month = _parse_month(month)
        target, name = (
            _explain_target(aoi, aoi_index, places)
            if aoi is not None
            else (places.resolve(bbox, country, subdivision, department), None)
        )
        facts = facts_for(target, target_month, name)
        if facts is None:
            raise HTTPException(status_code=404, detail="No data for that month in this area.")
        generated = summarize((target, target_month, lang), facts, lang)
        summary, model = generated or (template_summary(facts, lang), None)
        return ExplainResponse(
            month=target_month,
            lang=lang,
            summary=summary,
            generated_by="ai" if generated else "template",
            model=model,
            facts=facts,
        )

    _alerts_routes(app, service, places, recent_src, rows_for=rows_for, name_of=name_of)

    # the globe's area ids, for /explain?aoi= (requests only arrive once this is assigned)
    aoi_index = register_ember_routes(
        app,
        service=service,
        countries=countries,
        department_collection=department_collection,
        world_collection=world_features,
        recent_src=recent_src,
        data_dir=data_dir,
        firms=_firms_hotspots(settings),
        warm_up=settings.environment != "test",
        # the test environment never calls the AI provider unless a test injects one
        assistant=assistant
        or (_pick_assistant(settings) if settings.environment != "test" else None),
    )

    return app
