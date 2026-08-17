"""Phase 0 entrypoint: clip and prepare all static base data for a study
area. Run with: python -m pipeline.run [--study-area flores]"""

import argparse
import time

from pipeline import baseline, boundary, buildings, population, roads
from pipeline.config import STUDY_AREAS
from pipeline.db import connect


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--study-area",
        default="flores",
        choices=sorted(STUDY_AREAS),
        help="Study area to prepare (default: flores)",
    )
    args = parser.parse_args()

    con = connect()
    t0 = time.time()

    boundary_wkt = boundary.run(con, args.study_area)
    roads.run(con, args.study_area, boundary_wkt)
    buildings.run(con, args.study_area, boundary_wkt)
    population.run(con, args.study_area, boundary_wkt)
    baseline.run(con, args.study_area)

    print(f"[done] {args.study_area} prepared in {round(time.time() - t0, 1)}s")


if __name__ == "__main__":
    main()
