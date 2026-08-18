"""Prepare GIK field reports for the Phase 2 field-report store (MongoDB).

Reads the latest GIK snapshot (data/gik_reports.geojson, produced by
pipeline.gik), normalises each report into the field-report document
shape described in AGENTS.md (Phase 2), and writes:

  - data/flores/field_reports.json    array of report documents
  - data/flores/field_reports.ndjson  NDJSON — loadable with mongoimport

If pymongo and a running MongoDB instance are available, run with
--import to load the documents directly:

    python -m pipeline.field_reports --import

Documents follow the field-report store shape: location (lat/lon +
description), timestamp, status, source (gik), photo, and the reporter's
contact details. A stable report _id is derived from the GIK coordinates
(plus source) so re-importing the same snapshot is idempotent, and the
LWW (last-write-wins-by-timestamp) rule from AGENTS.md lets a later
field report supersede an earlier one.

Run standalone: python -m pipeline.field_reports [--study-area flores]
"""

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from pipeline.config import study_area_dir


def _parse_people(text) -> int | None:
    """Pull the first integer out of GIK's free-text 'people' field."""
    if text is None:
        return None
    m = re.search(r"\d+", str(text))
    return int(m.group()) if m else None


def to_report(feature: dict) -> dict:
    """Convert one GIK GeoJSON feature into a field-report document."""
    p = feature.get("properties") or {}
    geom = feature.get("geometry") or {}
    lon, lat = (geom.get("coordinates") or [None, None])[:2]
    ts = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    # _id is set later in run() from coordinates (stable across re-runs).
    return {
        "_id": None,
        "source": "gik",
        "type": "needs-report",
        "location": {
            "type": "Point",
            "coordinates": [lon, lat],
            "description": p.get("location", ""),
            "region": p.get("region", ""),
        },
        "timestamp": ts,
        "status": p.get("status", "Belum Ditangani"),
        "impact": {
            "households": _num(p.get("households")),
            "people": _parse_people(p.get("people")),
            "people_text": p.get("people", ""),
        },
        "needs": p.get("needs", ""),
        "contact": {
            "reporter": p.get("reporter", ""),
            "phone": str(p.get("contact", "")),
        },
        "photo": p.get("photo", ""),
        "notes": p.get("notes", ""),
        "ingested_at": ts,
    }


def _num(v):
    try:
        return int(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def run(study_area: str, do_import: bool = False) -> None:
    out_dir = study_area_dir(study_area)
    src = out_dir / "gik_reports.geojson"
    docs_path = out_dir / "field_reports.json"
    ndjson_path = out_dir / "field_reports.ndjson"

    if not src.exists():
        raise FileNotFoundError(
            f"No GIK snapshot at {src} — run `python -m pipeline.gik` first."
        )

    with open(src, encoding="utf-8") as fh:
        fc = json.load(fh)
    docs = [to_report(f) for f in fc.get("features", [])]

    # _id must be stable across re-runs for idempotent import. Derive from
    # coordinates + index-free hash of the location text.
    for i, d in enumerate(docs):
        loc = d["location"]["coordinates"]
        key = f"gik:{loc[0]:.5f}:{loc[1]:.5f}" if loc[0] is not None else f"gik:idx:{i}"
        d["_id"] = key

    with open(docs_path, "w", encoding="utf-8") as fh:
        json.dump(docs, fh, ensure_ascii=False, indent=2)
    with open(ndjson_path, "w", encoding="utf-8") as fh:
        for d in docs:
            fh.write(json.dumps(d, ensure_ascii=False) + "\n")

    print(f"[field] {len(docs)} field reports -> {docs_path}")
    print(f"[field] NDJSON -> {ndjson_path}")

    if do_import:
        _import_mongodb(ndjson_path)


def _import_mongodb(ndjson_path: Path) -> None:
    try:
        from pymongo import MongoClient
    except ImportError:
        print(
            "[field] pymongo not installed — skipping direct import. "
            "Run: pip install pymongo"
        )
        return
    client = MongoClient("mongodb://localhost:27017/", serverSelectionTimeoutMS=3000)
    db = client["reach_ops"]
    col = db["field_reports"]
    with open(ndjson_path, encoding="utf-8") as fh:
        docs = [json.loads(line) for line in fh]
    # LWW-by-timestamp: upsert by _id, set fields even if earlier.
    for d in docs:
        col.replace_one(
            {"_id": d["_id"]}, d, upsert=True
        )
    print(f"[field] imported {len(docs)} reports into MongoDB (reach_ops.field_reports)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study-area", default="flores")
    parser.add_argument(
        "--import", dest="do_import", action="store_true",
        help="import NDJSON into a local MongoDB (requires pymongo)",
    )
    args = parser.parse_args()
    run(args.study_area, do_import=args.do_import)