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

# --- Overture Maps (alternative road source; see pipeline/roads_overture.py) ---
#
# Overture publishes its themes as GeoParquet on a public S3 bucket, so the
# road network for a new study area can be pulled by bounding box without a
# Geofabrik download or an osmium extract step first. Releases are monthly
# and immutable; pin one so a rebuild is reproducible rather than silently
# tracking whatever is current. List available releases with:
#   curl -s "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/?list-type=2&prefix=release/&delimiter=/"
OVERTURE_RELEASE = "2026-08-19.0"
OVERTURE_REGION = "us-west-2"
OVERTURE_SEGMENTS = (
    f"s3://overturemaps-{OVERTURE_REGION}/release/{OVERTURE_RELEASE}"
    "/theme=transportation/type=segment/*"
)

# Overture `class` values kept as part of the routable network — the same
# motorised-network intent as ROUTABLE_HIGHWAY_CLASSES above, expressed in
# Overture's vocabulary. Two differences from OSM's `highway` tag:
#   * Overture has no `road` class; an unclassifiable road is `unknown`.
#   * Overture has no `*_link` classes; a link carries `subclass = 'link'`
#     alongside its parent class.
# Both are normalised back to OSM spelling on the way out, so downstream
# consumers (the cost model's per-class speed table, the dashboard legend)
# keep working unchanged.
OVERTURE_ROUTABLE_CLASSES = [
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
    "unknown",
]

# Overture classes that take a `*_link` spelling in OSM when subclass='link'.
OVERTURE_LINKABLE_CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary"]


def study_area_dir(study_area: str) -> Path:
    out = DATA_OUT / study_area
    out.mkdir(parents=True, exist_ok=True)
    return out


def fresh(path: Path) -> Path:
    """Delete an existing file before a GDAL-driven COPY writes it again.

    DuckDB's GDAL GeoJSON writer segfaults (not a clean error) if the
    destination file already exists, so every COPY ... TO output path
    must be unlinked first to make pipeline reruns safe.
    """
    path.unlink(missing_ok=True)
    return path
