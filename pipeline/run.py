"""Phase 0 entrypoint: clip and prepare all static base data for a study
area. Run with: python -m pipeline.run [--study-area flores]

Each step runs as its own subprocess (not an in-process function call).
DuckDB's GDAL GeoJSON writer has proven unstable (native-library
segfaults, not Python exceptions) when many ST_Read/COPY-to-GeoJSON
calls run back to back in one long-lived connection/process on this
platform. Process-per-step isolates a crash to a single, identifiable
step instead of corrupting the whole run.
"""

import argparse
import subprocess
import sys
import time

from pipeline.config import STUDY_AREAS

STEPS = ["boundary", "roads", "buildings", "population", "baseline", "hubs"]

# Optional steps that depend on live external feeds (not part of the
# static base-data build). Run them separately, or pass --with-gik.
GIK_STEPS = ["gik", "field"]

# Where the road network comes from. Both write the same `roads.geojson`.
#
# `overture` is the default because it needs nothing on local disk — a
# bbox query against a pinned Overture release, so retargeting at a new
# disaster site has no hand-prepared national extract as a prerequisite.
# `local` clips `local-data/indonesia_roads.gpkg` and stays available for
# an offline rebuild, or to diff a new source against a known one; on
# Flores it turned out to be missing the `service` and `road` classes
# entirely (see the comparison in README.md).
ROADS_SOURCES = {"overture": "roads_overture", "local": "roads"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--study-area",
        default="flores",
        choices=sorted(STUDY_AREAS),
        help="Study area to prepare (default: flores)",
    )
    parser.add_argument(
        "--roads-source",
        default="overture",
        choices=sorted(ROADS_SOURCES),
        help="Where the road network comes from (default: overture, which "
        "needs no local extract; 'local' clips local-data/indonesia_roads.gpkg)",
    )
    parser.add_argument(
        "--with-gik",
        action="store_true",
        help="Also fetch the live UGM GIK field-report feed and build the "
        "field-report store seed (network required)",
    )
    args = parser.parse_args()

    t0 = time.time()
    steps = [ROADS_SOURCES[args.roads_source] if s == "roads" else s for s in STEPS]
    steps += GIK_STEPS if args.with_gik else []
    for step in steps:
        result = subprocess.run(
            [sys.executable, "-m", f"pipeline.{step}", "--study-area", args.study_area]
        )
        if result.returncode != 0:
            print(f"[run] step '{step}' failed (exit {result.returncode}) — stopping")
            sys.exit(result.returncode)

    print(f"[done] {args.study_area} prepared in {round(time.time() - t0, 1)}s")


if __name__ == "__main__":
    main()
