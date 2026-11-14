from pathlib import Path

import pandas as pd
import pytest

from brasa.ingestion.archive import build_detections, cell_index, clean_archive, static_cells

ROWS = [
    # instrument, confidence, type, satellite -> expected kept?
    ("MODIS", "80", 0, "Terra"),  # kept
    ("MODIS", "20", 0, "Aqua"),  # low confidence
    ("MODIS", "90", 2, "Terra"),  # static source (gas flare)
    ("VIIRS", "h", 0, "N"),  # kept
    ("VIIRS", "n", 0, "N"),  # kept
    ("VIIRS", "l", 0, "N"),  # low confidence
    ("VIIRS", "h", 2, "N"),  # static source
]


def _raw() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "latitude": [4.0] * len(ROWS),
            "longitude": [-72.0] * len(ROWS),
            "acq_date": ["2015-02-01"] * len(ROWS),
            "acq_time": [1830] * len(ROWS),
            "instrument": [row[0] for row in ROWS],
            "confidence": [row[1] for row in ROWS],
            "type": [row[2] for row in ROWS],
            "satellite": [row[3] for row in ROWS],
            "frp": [10.0] * len(ROWS),
        }
    )


def test_clean_archive_keeps_confident_vegetation_fires() -> None:
    clean = clean_archive(_raw())
    assert clean["sensor"].tolist() == ["MODIS", "VIIRS", "VIIRS"]
    assert pd.api.types.is_datetime64_any_dtype(clean["acq_date"])


def test_clean_archive_rejects_unknown_instrument() -> None:
    raw = _raw()
    raw.loc[0, "instrument"] = "AVHRR"
    with pytest.raises(ValueError, match="Unknown instrument"):
        clean_archive(raw)


def test_build_detections_reads_every_csv(tmp_path: Path) -> None:
    _raw().to_csv(tmp_path / "modis_2015_Colombia.csv", index=False)
    _raw().to_csv(tmp_path / "viirs-snpp_2015_Colombia.csv", index=False)
    assert len(build_detections(tmp_path)) == 6


def test_build_detections_skips_an_api_year_once_its_yearly_file_exists(tmp_path: Path) -> None:
    _raw().to_csv(tmp_path / "modis_2026_Colombia_api.csv", index=False)
    assert len(build_detections(tmp_path)) == 3
    _raw().to_csv(tmp_path / "modis_2026_Colombia.csv", index=False)
    assert len(build_detections(tmp_path)) == 3  # not 6: the yearly file replaces the API one


def test_build_detections_requires_files(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        build_detections(tmp_path)


def test_static_cells_lists_each_non_vegetation_cell_once(tmp_path: Path) -> None:
    raw = _raw()
    raw.loc[6, ["latitude", "longitude"]] = [4.257, -72.503]  # a second static source
    raw.to_csv(tmp_path / "modis_2015_Colombia.csv", index=False)
    raw.to_csv(tmp_path / "viirs-snpp_2015_Colombia.csv", index=False)
    cells = static_cells(tmp_path)
    assert cells.to_dict("records") == [
        {"lat_cell": 400, "lon_cell": -7200},
        {"lat_cell": 425, "lon_cell": -7251},
    ]
    assert cell_index([4.257, -72.503, -0.001]).tolist() == [425, -7251, -1]
