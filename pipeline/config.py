"""Study area and source-data configuration for the Phase 0 pipeline.

Study areas are defined by BPS kab_kota (regency) codes so the pipeline can
be re-targeted at a new disaster site by adding an entry here, without
touching the clip/aggregate logic itself.
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
LOCAL_DATA = REPO_ROOT / "local-data"
DATA_OUT = REPO_ROOT / "data"

SOURCES = {
    "roads": LOCAL_DATA / "indonesia_roads.gpkg",
    "buildings": LOCAL_DATA / "indonesia_buildings.parquet",
    "kontur_population": LOCAL_DATA / "kontur_population_ID.gpkg",
    "kab_kota": LOCAL_DATA / "geo" / "kab_kota.geojson",
    "kecamatan": LOCAL_DATA / "geo" / "kecamatan.geojson",
    "kel_desa": LOCAL_DATA / "geo" / "kel_desa.geojson",
}

# Flores island: nine regencies, west to east.
FLORES_KAB_KOTA_CODES = [
    "53.10",  # Manggarai
    "53.15",  # Manggarai Barat
    "53.19",  # Manggarai Timur
    "53.09",  # Ngada
    "53.16",  # Nagekeo
    "53.08",  # Ende
    "53.07",  # Sikka
    "53.06",  # Flores Timur
    "53.13",  # Lembata
]

STUDY_AREAS = {
    "flores": {
        "label": "Flores",
        "kab_kota_codes": FLORES_KAB_KOTA_CODES,
    },
}

# OSM highway values kept as part of the routable network. Excludes
# pedestrian-only, non-motorised, and non-existent/planned ways (footway,
# path, steps, cycleway, proposed, construction, abandoned, razed, ...).
ROUTABLE_HIGHWAY_CLASSES = [
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "residential",
    "service",
    "living_street",
    "track",
    "road",
    "motorway_link",
    "trunk_link",
    "primary_link",
    "secondary_link",
    "tertiary_link",
]


def study_area_dir(study_area: str) -> Path:
    out = DATA_OUT / study_area
    out.mkdir(parents=True, exist_ok=True)
    return out
