"""Fetch the UGM GIK (Geoportal Informasi Kebencanaan) field-report feed.

The geoportal exposes a public GeoJSON endpoint (get_data.php) of
crowdsourced disaster-needs reports (location, households affected, needs,
reporter contact, photo, status). This step fetches it, normalises the
property names, and writes:

  - data/gik_reports.geojson                 full feed (all of Indonesia)
  - data/<study_area>/gik_reports.geojson    clipped to the study area

The feed is live and crowdsourced, so this step is meant to be re-run to
refresh the snapshot (it is not part of the static Phase 0 base data, but
is fetched on demand). Fetching server-side avoids relying on the
geoportal's CORS headers from the browser.

Run standalone: python -m pipeline.gik [--study-area flores]
"""

import json
import urllib.request

from pipeline.config import REPO_ROOT, fresh, study_area_dir
from pipeline.db import connect

GIK_URL = "https://geoportal.science/gik/get_data.php"

# GIK property key -> normalised key.
PROP_MAP = {
    "drh": "region",
    "dtldrh": "location",
    "kk": "households",
    "jw": "people",
    "kbthn": "needs",
    "nama": "reporter",
    "kntk": "contact",
    "cor": "coord_text",
    "FOTO": "photo",
    "stat": "status",
    "notes": "notes",
}


def fetch_feed() -> dict:
    """Download and parse the GIK GeoJSON feed."""
    with urllib.request.urlopen(GIK_URL, timeout=60) as r:
        return json.load(r)


def normalise(fc: dict) -> dict:
    """Rename GIK properties to stable, snake_case keys."""
    features = []
    for f in fc.get("features", []):
        props = {}
        for k, v in (f.get("properties") or {}).items():
            props[PROP_MAP.get(k, k)] = v
        features.append(
            {
                "type": "Feature",
                "geometry": f.get("geometry"),
                "properties": props,
            }
        )
    return {"type": "FeatureCollection", "features": features}


def write_json(path, fc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, ensure_ascii=False)


def clip_to_study_area(full_path, study_area: str) -> None:
    """Clip the full feed to the study-area boundary via DuckDB spatial."""
    out_dir = study_area_dir(study_area)
    boundary_path = out_dir / "boundary.geojson"
    out_path = fresh(out_dir / "gik_reports.geojson")

    con = connect()
    con.execute(
        f"""
        COPY (
            SELECT
                g.region, g.location, g.households, g.people, g.needs,
                g.reporter, g.contact, g.photo, g.status, g.notes,
                g.geom
            FROM ST_Read('{full_path}') g
            JOIN ST_Read('{boundary_path}') b
              ON ST_Intersects(g.geom, b.geom)
        ) TO '{out_path}'
        WITH (FORMAT GDAL, DRIVER 'GeoJSON')
        """
    )
    n = con.execute(f"SELECT COUNT(*) FROM ST_Read('{out_path}')").fetchone()[0]
    print(f"[gik] {study_area}: {n} reports inside study area")


def run(study_area: str) -> None:
    print("[gik] fetching feed…")
    fc = normalise(fetch_feed())
    n = len(fc["features"])
    print(f"[gik] fetched {n} reports")

    full_path = REPO_ROOT / "data" / "gik_reports.geojson"
    write_json(full_path, fc)
    print(f"[gik] wrote full feed -> {full_path}")

    clip_to_study_area(full_path, study_area)


if __name__ == "__main__":
    from pipeline.cli import study_area_arg

    run(study_area_arg())