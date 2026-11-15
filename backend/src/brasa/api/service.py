"""Use cases: harmonized calendar for a Colombian area of interest or for any country.

- Areas use the Colombian point archive (data/processed/detections.parquet, built by
  scripts/build_dataset.py), or the synthetic sample when it is missing: any box, or one
  department by its polygon.
- Countries use monthly totals per country (data/processed/country_monthly.parquet, built by
  scripts/build_global_dataset.py), each with its own VIIRS/MODIS ratio.
- Their first-level subdivisions (states, provinces...) use data/processed/
  subdivision_monthly.parquet (scripts/build_subdivisions.py) with the country's ratio.
"""

import json
import logging
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from brasa.api.schemas import Dataset, MapSensor
from brasa.domain.models import BoundingBox
from brasa.harmonization import (
    WIDESPREAD_SHARE,
    aggregate_monthly,
    build_calendar,
    count_anomalous,
    fit_sensor_ratio,
    harmonize,
)
from brasa.harmonization.calibrate import InsufficientOverlapError, SensorRatio
from brasa.harmonization.forecast import (
    climatology,
    features,
    last_complete_month,
    monthly_panel,
    predict,
)
from brasa.ingestion.boundaries import assign_regions, load_departments
from brasa.ingestion.oni import OniTable, load_oni
from brasa.ingestion.recent import RecentDetections

logger = logging.getLogger(__name__)

PROCESSED_DETECTIONS = Path("processed") / "detections.parquet"
COUNTRY_MONTHLY = Path("processed") / "country_monthly.parquet"
SUBDIVISION_MONTHLY = Path("processed") / "subdivision_monthly.parquet"
WORLD_SUBDIVISIONS = Path("context") / "world_subdivisions.geojson"
ONI_FILE = Path("context") / "oni.ascii.txt"
DEPARTMENTS_FILE = Path("context") / "colombia_departments.geojson"
STATIC_SOURCES = Path("context") / "static_sources.csv"
# Weights and backtest skill of the outlook (scripts/backtest_forecast.py).
FORECAST_MODEL = Path("context") / "forecast_model.json"
SAMPLE_DATA_PATH = Path(__file__).resolve().parents[3] / "data" / "sample" / "detections.csv"

HEATMAP_CELL_DEG = 0.1  # ~11 km: fine enough to see fire fronts, coarse enough to stay small

ROW_COLUMNS = [
    "month",
    "raw_modis",
    "raw_viirs",
    "harmonized",
    "source",
    "robust_z",
    "is_anomaly",
    "is_critical_month",
    "climatology_median",
    "climatology_q25",
    "climatology_q75",
]


def _jan2012_split(detections: pd.DataFrame) -> tuple[float | None, float | None]:
    """Split Jan 2012 detections around VIIRS first-light (2012-01-20) when dates exist."""
    if detections.empty or "acq_date" not in detections:
        return None, None
    dates = detections["acq_date"]
    jan2012 = (dates >= pd.Timestamp("2012-01-01")) & (dates < pd.Timestamp("2012-02-01"))
    if not jan2012.any():
        return None, None
    sub = detections.loc[jan2012, ["acq_date", "sensor"]]
    modis_pre20 = float(
        ((sub["sensor"] == "MODIS") & (sub["acq_date"] < pd.Timestamp("2012-01-20"))).sum()
    )
    viirs_post20 = float(
        ((sub["sensor"] == "VIIRS") & (sub["acq_date"] >= pd.Timestamp("2012-01-20"))).sum()
    )
    return modis_pre20, viirs_post20


def _calendar(
    monthly_counts: pd.DataFrame,
    ratio: SensorRatio,
    *,
    start_month: pd.Timestamp | None = None,
    end_month: pd.Timestamp | None = None,
    jan2012_modis_pre20: float | None = None,
    jan2012_viirs_post20: float | None = None,
) -> pd.DataFrame:
    return build_calendar(
        harmonize(
            monthly_counts,
            ratio,
            start_month=start_month,
            end_month=end_month,
            jan2012_modis_pre20=jan2012_modis_pre20,
            jan2012_viirs_post20=jan2012_viirs_post20,
        )
    ).rename(
        columns={
            "median": "climatology_median",
            "q25": "climatology_q25",
            "q75": "climatology_q75",
            "mean": "climatology_mean",
            "p10": "climatology_p10",
            "p90": "climatology_p90",
        }
    )


def _rows(calendar: pd.DataFrame, oni: OniTable) -> list[dict[str, Any]]:
    rows = [
        {str(key): value for key, value in record.items()}
        for record in calendar[ROW_COLUMNS].to_dict(orient="records")
    ]
    for row in rows:
        row["oni"] = oni.get((row["month"].year, row["month"].month))
    return rows


def map_sensor(sensors: pd.Series) -> MapSensor | None:
    """The sensor whose raw detections maps show: VIIRS when it exists that month (finer)."""
    if sensors.empty:
        return None
    return "VIIRS" if (sensors == "VIIRS").any() else "MODIS"


def heatmap_cells(points: pd.DataFrame, cell_deg: float) -> list[tuple[float, float, int]]:
    """(lon, lat, count) of each cell centre with detections, densest first."""
    lon = (np.floor(points["longitude"].to_numpy() / cell_deg) + 0.5) * cell_deg
    lat = (np.floor(points["latitude"].to_numpy() / cell_deg) + 0.5) * cell_deg
    cells = pd.DataFrame({"lon": lon.round(4), "lat": lat.round(4)})
    counts = cells.groupby(["lon", "lat"]).size().sort_values(ascending=False).reset_index()
    return list(
        zip(counts["lon"].tolist(), counts["lat"].tolist(), counts[0].tolist(), strict=True)
    )


def peak_day(points: pd.DataFrame) -> date | None:
    """Day with the most detections (the best day to look at a satellite image)."""
    if points.empty:
        return None
    day: pd.Timestamp = points["acq_date"].dt.normalize().value_counts().idxmax()
    return day.date()


def _with_regions(rows: list[dict[str, Any]], anomalous: pd.Series, total: int) -> None:
    """Add the nationwide context: how many regions were unusually high that month."""
    counts = dict(zip(pd.to_datetime(anomalous.index), anomalous.astype(int).tolist(), strict=True))
    for row in rows:
        count = counts.get(row["month"], 0) if total else None
        row["anomalous_departments"] = count
        row["is_widespread_anomaly"] = None if count is None else count >= WIDESPREAD_SHARE * total


EXPORT_COLUMNS = ["latitude", "longitude", "acq_date", "acq_time", "sensor", "satellite", "frp"]
# What every calendar, map and comparison needs. The rest of the archive's columns (time,
# satellite, FRP) only matter to the CSV export and are read from disk when one is asked for:
# keeping them in memory cost ~70 MB of the 512 MB host's headroom under load.
CORE_COLUMNS = ["latitude", "longitude", "acq_date", "sensor", "department"]


@dataclass
class CalendarService:
    """Colombian point archive: any box, or a department by its polygon (`department` column)."""

    detections: pd.DataFrame
    sensor_ratio: SensorRatio
    # Default to "synthetic" so nothing is ever labelled real by accident.
    dataset: Dataset = "synthetic-sample"
    oni: OniTable = field(default_factory=dict)
    # Nationwide context: per month, how many departments are unusually high (see
    # `count_anomalous`). Empty when the detections carry no department.
    anomalous_regions: pd.Series = field(default_factory=lambda: pd.Series(dtype="int64"))
    regions_total: int = 0
    # Harmonized monthly count per department (columns department, month, harmonized): what the
    # outlook for the coming months is computed from.
    department_months: pd.DataFrame = field(default_factory=pd.DataFrame)
    # Full observation span so zero-detection months inside individual AOIs stay explicit zeros.
    record_start: pd.Timestamp | None = None
    record_end: pd.Timestamp | None = None
    # Parquet with the same rows, in the same order, holding the export-only columns.
    export_path: Path | None = None

    @classmethod
    def from_detections(
        cls,
        detections: pd.DataFrame,
        dataset: Dataset = "synthetic-sample",
        oni: OniTable | None = None,
        departments: Sequence[dict[str, Any]] = (),
    ) -> "CalendarService":
        """`departments` (GeoJSON features with a `name`) tag detections that carry no
        `department` column yet: the synthetic sample, or tests. The real archive is tagged at
        build time (scripts/build_dataset.py)."""
        if not pd.api.types.is_datetime64_any_dtype(detections["acq_date"]):
            detections = detections.assign(acq_date=pd.to_datetime(detections["acq_date"]))
        if "department" not in detections:
            index = assign_regions(
                list(departments),
                detections["longitude"].to_numpy(),
                detections["latitude"].to_numpy(),
            )
            names = pd.Index([feature["properties"]["name"] for feature in departments], dtype=str)
            detections = detections.assign(
                department=pd.Categorical.from_codes(index, categories=names)
            )
        # Calibrate national prior on all detections; individual AOIs shrink toward this prior.
        ratio = fit_sensor_ratio(aggregate_monthly(detections))
        record_start = (
            detections["acq_date"].min().to_period("M").to_timestamp()
            if not detections.empty
            else None
        )
        record_end = (
            detections["acq_date"].max().to_period("M").to_timestamp()
            if not detections.empty
            else None
        )
        service = cls(
            detections=detections,
            sensor_ratio=ratio,
            dataset=dataset,
            oni=oni or {},
            record_start=record_start,
            record_end=record_end,
        )
        # Nationwide count of unusually high departments per month (~2 s on the full archive).
        by_department: dict[str, pd.DataFrame] = {}
        for name, group in detections.groupby("department", observed=True):
            agg = aggregate_monthly(group)
            dept_ratio = fit_sensor_ratio(
                agg,
                fallback_ratio=ratio.ratio,
                fallback_iqr=(ratio.q25, ratio.q75),
            )
            pre20, post20 = _jan2012_split(group)
            by_department[str(name)] = _calendar(
                agg,
                dept_ratio,
                start_month=record_start,
                end_month=record_end,
                jan2012_modis_pre20=pre20,
                jan2012_viirs_post20=post20,
            )
        calendars = list(by_department.values())
        service.anomalous_regions = count_anomalous(calendars)
        service.regions_total = len(calendars)
        if calendars:
            service.department_months = pd.concat(
                [c[["month", "harmonized"]].assign(department=n) for n, c in by_department.items()],
                ignore_index=True,
            ).assign(month=lambda f: pd.to_datetime(f["month"]))
        return service

    @classmethod
    def from_sample_data(
        cls,
        path: Path = SAMPLE_DATA_PATH,
        oni: OniTable | None = None,
        departments: Sequence[dict[str, Any]] = (),
    ) -> "CalendarService":
        return cls.from_detections(pd.read_csv(path), oni=oni, departments=departments)

    @classmethod
    def from_data_dir(cls, data_dir: Path) -> "CalendarService":
        oni = load_oni(data_dir / ONI_FILE)
        departments = load_departments(data_dir / DEPARTMENTS_FILE)["features"]
        parquet = data_dir / PROCESSED_DETECTIONS
        if parquet.exists():
            # An archive built before departments were tagged gets them here, as the sample does.
            try:
                frame = pd.read_parquet(parquet, columns=CORE_COLUMNS)
            except ValueError:  # pyarrow's ArrowInvalid: no `department` column stored
                frame = pd.read_parquet(parquet, columns=CORE_COLUMNS[:-1])
            service = cls.from_detections(
                frame,
                dataset="firms-archive",
                oni=oni,
                departments=departments,
            )
            service.export_path = parquet
            return service
        logger.warning("%s not found: serving the SYNTHETIC sample dataset.", parquet)
        return cls.from_sample_data(oni=oni, departments=departments)

    def _inside(self, area: BoundingBox, department: str | None) -> pd.Series:
        """Row mask: the department's own polygon when given, otherwise the box."""
        d = self.detections
        if department is not None:
            mask: pd.Series = d["department"] == department
            return mask
        return d["longitude"].between(area.west, area.east) & d["latitude"].between(
            area.south, area.north
        )

    def _calendar_with_ratio(
        self, area: BoundingBox, department: str | None
    ) -> tuple[pd.DataFrame, SensorRatio]:
        inside = self.detections[self._inside(area, department)]
        if inside.empty:
            return pd.DataFrame(), self.sensor_ratio
        agg = aggregate_monthly(inside)
        local_ratio = fit_sensor_ratio(
            agg,
            fallback_ratio=self.sensor_ratio.ratio,
            fallback_iqr=(self.sensor_ratio.q25, self.sensor_ratio.q75),
        )
        pre20, post20 = _jan2012_split(inside)
        cal = _calendar(
            agg,
            local_ratio,
            start_month=self.record_start,
            end_month=self.record_end,
            jan2012_modis_pre20=pre20,
            jan2012_viirs_post20=post20,
        )
        return cal, local_ratio

    def _calendar(self, area: BoundingBox, department: str | None) -> pd.DataFrame:
        cal, _ = self._calendar_with_ratio(area, department)
        return cal

    def month_points(
        self, area: BoundingBox, month: pd.Timestamp, department: str | None = None
    ) -> pd.DataFrame:
        """Detections of `map_sensor` in the area during `month` (for the heat map)."""
        d = self.detections
        inside = d[
            (d["acq_date"] >= month)
            & (d["acq_date"] < month + pd.offsets.MonthBegin(1))
            & self._inside(area, department)
        ]
        return inside[inside["sensor"] == map_sensor(inside["sensor"])]

    def month_departments(
        self, month: pd.Timestamp, sensor: MapSensor | None
    ) -> list[tuple[str, int]]:
        """(department, raw detections of `sensor`) for one month, densest first."""
        d = self.detections
        rows = d[
            (d["acq_date"] >= month)
            & (d["acq_date"] < month + pd.offsets.MonthBegin(1))
            & (d["sensor"] == sensor)
        ]
        counts = rows["department"].value_counts()
        return [(str(name), int(n)) for name, n in counts[counts > 0].items()]

    def hotspots(
        self, area: BoundingBox, department: str | None, start: date, end: date
    ) -> pd.DataFrame:
        """Every detection in the area from `start` to `end` (inclusive), oldest first."""
        d = self.detections
        mask = (
            (d["acq_date"] >= pd.Timestamp(start))
            & (d["acq_date"] < pd.Timestamp(end) + pd.Timedelta(days=1))
            & self._inside(area, department)
        )
        found = d.loc[mask, [column for column in EXPORT_COLUMNS if column in d]]
        if self.export_path is None:  # sample data and tests: whatever columns they carry
            return found
        try:
            rest = pd.read_parquet(
                self.export_path, columns=[c for c in EXPORT_COLUMNS if c not in found]
            ).iloc[np.flatnonzero(mask.to_numpy())]
        except ValueError:  # an archive without the export columns (tests): what we have
            return found
        merged = pd.concat([found.reset_index(drop=True), rest.reset_index(drop=True)], axis=1)
        return merged[[column for column in EXPORT_COLUMNS if column in merged]]

    def same_days_by_year(
        self, area: BoundingBox, department: str | None, days: Sequence[date]
    ) -> pd.Series:
        """VIIRS archive detections in the area on the same calendar days, one value per year.

        The baseline for near-real-time counts: same sensor family, same days of the year. Every
        full VIIRS year counts, also those with no fire on these days (0)."""
        d = self.detections
        dates = d["acq_date"].dt
        wanted = [day.month * 100 + day.day for day in days]
        mask = (
            (d["sensor"] == "VIIRS")
            & (dates.month * 100 + dates.day).isin(wanted)
            & self._inside(area, department)
        )
        hits = d.loc[mask, "acq_date"].dt
        # A window that crosses New Year belongs to the year it starts in.
        crosses = days[0].month > days[-1].month
        season = hits.year - ((hits.month < days[0].month) & crosses)
        viirs_years = d.loc[d["sensor"] == "VIIRS", "acq_date"].dt.year
        # Only years the archive covers to the window's last day: the current, partial year
        # (extended through the Area API) would otherwise count as a year without fire.
        last = pd.Timestamp(d["acq_date"].max())
        last_season = last.year - int(crosses)
        if (last.month, last.day) < (days[-1].month, days[-1].day):
            last_season -= 1
        years = range(int(viirs_years.min()) + 1, last_season + 1)
        counts: pd.Series = season.value_counts().reindex(years, fill_value=0).astype(int)
        return counts

    def calendar_and_ratio_for(
        self, area: BoundingBox, department: str | None = None
    ) -> tuple[list[dict[str, Any]], SensorRatio]:
        calendar, local_ratio = self._calendar_with_ratio(area, department)
        if calendar.empty:
            return [], local_ratio
        rows = _rows(calendar, self.oni)
        _with_regions(rows, self.anomalous_regions, self.regions_total)
        return rows, local_ratio

    def calendar_for(
        self, area: BoundingBox, department: str | None = None
    ) -> list[dict[str, Any]]:
        rows, _ = self.calendar_and_ratio_for(area, department)
        return rows


@dataclass
class CountryCalendars:
    """Harmonized calendars from monthly totals per country and per subdivision (worldwide)."""

    monthly: pd.DataFrame  # columns: country, month, sensor, count
    oni: OniTable = field(default_factory=dict)
    fallback_ratio: SensorRatio | None = None
    # columns: country, subdivision, month, sensor, count
    subdivisions: pd.DataFrame = field(
        default_factory=lambda: pd.DataFrame(
            columns=["country", "subdivision", "month", "sensor", "count"]
        )
    )
    record_start: pd.Timestamp | None = None
    record_end: pd.Timestamp | None = None

    @classmethod
    def from_data_dir(cls, data_dir: Path) -> "CountryCalendars":
        parquet = data_dir / COUNTRY_MONTHLY
        if not parquet.exists():
            logger.warning("%s not found: no country calendars.", parquet)
            return cls(pd.DataFrame(columns=["country", "month", "sensor", "count"]))
        # Categorical columns stay categorical: as strings, the ~1 M subdivision rows took
        # ~100 MB more, a lot on a 512 MB host. pandas 3 groups by observed categories only.
        monthly = pd.read_parquet(parquet)
        regional = data_dir / SUBDIVISION_MONTHLY
        subdivisions = pd.read_parquet(regional) if regional.exists() else None
        return cls.from_monthly(
            monthly, oni=load_oni(data_dir / ONI_FILE), subdivisions=subdivisions
        )

    @classmethod
    def from_monthly(
        cls,
        monthly: pd.DataFrame,
        oni: OniTable | None = None,
        subdivisions: pd.DataFrame | None = None,
    ) -> "CountryCalendars":
        # Worldwide ratio, used for countries with too few overlap months of their own.
        try:
            fallback = fit_sensor_ratio(monthly) if not monthly.empty else None
        except InsufficientOverlapError:
            logger.warning("Country archive has no MODIS/VIIRS overlap: no country calendars.")
            fallback = None
        record_start = pd.to_datetime(monthly["month"]).min() if not monthly.empty else None
        record_end = pd.to_datetime(monthly["month"]).max() if not monthly.empty else None
        service = cls(
            monthly=monthly,
            oni=oni or {},
            fallback_ratio=fallback,
            record_start=record_start,
            record_end=record_end,
        )
        if subdivisions is not None:
            service.subdivisions = subdivisions
        return service

    def totals(self) -> dict[str, int]:
        """Country name -> total detections in the archive, sorted by name."""
        if self.fallback_ratio is None:
            return {}
        sums = self.monthly.groupby("country")["count"].sum()
        return {str(name): int(total) for name, total in sums.sort_index().items()}

    def subdivision_names(self) -> dict[str, set[str]]:
        """Country -> names of its subdivisions with detections."""
        pairs = self.subdivisions[["country", "subdivision"]].drop_duplicates()
        return {
            str(country): set(group["subdivision"].astype(str))
            for country, group in pairs.groupby("country")
        }

    def month_regions(
        self, country: str, month: pd.Timestamp, sensor: MapSensor | None = None
    ) -> tuple[MapSensor | None, list[tuple[str, int]]]:
        """(sensor, [(subdivision, raw detections)]) for one month, densest first.

        `sensor` defaults to `map_sensor` over the country's detections that month."""
        sub = self.subdivisions
        rows = sub[(sub["country"] == country) & (sub["month"] == month)]
        sensor = sensor or map_sensor(rows["sensor"])
        counts = rows[rows["sensor"] == sensor].groupby("subdivision")["count"].sum()
        ranked = counts[counts > 0].sort_values(ascending=False)
        return sensor, [(str(name), int(n)) for name, n in ranked.items()]

    def month_total(self, country: str, month: pd.Timestamp) -> tuple[MapSensor | None, int]:
        """(sensor, raw national detections of that sensor) for one month."""
        rows = self.monthly[(self.monthly["country"] == country) & (self.monthly["month"] == month)]
        sensor = map_sensor(rows["sensor"])
        return sensor, int(rows.loc[rows["sensor"] == sensor, "count"].sum())

    def calendar_for(
        self, country: str, subdivision: str | None = None
    ) -> tuple[list[dict[str, Any]], SensorRatio, int] | None:
        """(rows, ratio, regions_total) for a country or one of its subdivisions; None if absent.

        Subdivisions use the country's ratio (a small region has too few overlap months to fit
        its own). Every row carries how many of the country's regions were unusually high.
        """
        counts = self.monthly[self.monthly["country"] == country]
        if counts.empty or self.fallback_ratio is None:
            return None
        try:
            ratio = fit_sensor_ratio(counts)
        except InsufficientOverlapError:
            ratio = self.fallback_ratio
        regional = self.subdivisions[self.subdivisions["country"] == country]
        calendars = {
            str(name): _calendar(
                group, ratio, start_month=self.record_start, end_month=self.record_end
            )
            for name, group in regional.groupby("subdivision")
        }
        if subdivision is not None and subdivision not in calendars:
            return None
        base = (
            calendars[subdivision]
            if subdivision is not None
            else _calendar(counts, ratio, start_month=self.record_start, end_month=self.record_end)
        )
        rows = _rows(base, self.oni)
        _with_regions(rows, count_anomalous(calendars.values()), len(calendars))
        return rows, ratio, len(calendars)

    def world_calendar(self) -> tuple[list[dict[str, Any]], SensorRatio, int | None] | None:
        """Summed global monthly archive for `world` AOI, with its fitted VIIRS/MODIS ratio."""
        if self.monthly.empty or self.fallback_ratio is None:
            return None
        world = (
            self.monthly.groupby(["month", "sensor"], observed=True)["count"].sum().reset_index()
        )
        try:
            ratio = fit_sensor_ratio(world)
        except InsufficientOverlapError:
            ratio = self.fallback_ratio
        base = _calendar(world, ratio, start_month=self.record_start, end_month=self.record_end)
        return _rows(base, self.oni), ratio, None


def recent_summary(
    service: CalendarService, recent: RecentDetections, area: BoundingBox, department: str | None
) -> dict[str, Any]:
    """The last complete days in an area against the same days of every archive year."""
    points = recent.points
    inside = (
        points[points["department"] == department]
        if department is not None
        else points[
            points["longitude"].between(area.west, area.east)
            & points["latitude"].between(area.south, area.north)
        ]
    )
    per_day = inside["acq_date"].dt.date.value_counts()
    history = service.same_days_by_year(area, department, recent.days)
    median = float(history.median()) if len(history) else None
    return {
        "available": True,
        "satellite": recent.satellite,
        "start": recent.days[0],
        "end": recent.days[-1],
        "detections": len(inside),
        "daily": [{"day": day, "count": int(per_day.get(day, 0))} for day in recent.days],
        "normal_median": median,
        "normal_q25": float(history.quantile(0.25)) if len(history) else None,
        "normal_q75": float(history.quantile(0.75)) if len(history) else None,
        "baseline_years": len(history),
        "percent_of_normal": round(100 * len(inside) / median, 1) if median else None,
        "fetched_at": recent.fetched_at,
    }


def load_forecast_model(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        logger.warning("%s not found: no outlook.", path.name)
        return None
    model: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return model


def outlook(service: CalendarService, model: dict[str, Any] | None) -> dict[str, Any]:
    """Chance that each department's next months burn above normal, issued from the last complete
    month in the archive (method and skill: harmonization/forecast.py, ADR-008)."""
    months = service.department_months
    if model is None or months.empty:
        return {"available": False}
    issued = last_complete_month(pd.Timestamp(service.detections["acq_date"].max()))
    panel = monthly_panel(months, issued)
    clim = climatology(panel, tuple(model["baseline_years"]))
    leads: list[dict[str, Any]] = []
    forecasts: dict[str, list[dict[str, Any]]] = {}
    for lead, entry in sorted(model["leads"].items(), key=lambda item: int(item[0])):
        rows = features(panel, clim, service.oni, int(lead))
        rows = rows[rows["issue"] == issued]
        target = issued + pd.DateOffset(months=int(lead))
        leads.append({"lead": int(lead), "month": target.date(), **entry})
        probability = predict(entry["weights"], rows)
        for name, p, normal, threshold in zip(
            rows["department"],
            probability.tolist(),
            rows["normal"].tolist(),
            rows["threshold"].tolist(),
            strict=True,
        ):
            forecasts.setdefault(str(name), []).append(
                {
                    "month": target.date(),
                    "probability": round(p, 3),
                    "normal": round(normal),
                    "threshold": round(threshold),
                }
            )
    previous = issued - pd.DateOffset(months=1)
    if not forecasts:
        logger.warning("No outlook from %s: is the ONI table current?", issued.date())
    return {
        "available": bool(forecasts),
        "dataset": service.dataset,
        "issued": issued.date(),
        "oni": service.oni.get((previous.year, previous.month)),
        "leads": leads,
        "departments": [
            {"department": name, "months": items} for name, items in sorted(forecasts.items())
        ],
    }
