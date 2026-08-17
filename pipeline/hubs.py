"""Placeholder aid-hub points for the reachability engine.

AGENTS.md specifies reachability "from designated aid hub points" but does
not name any actual hub locations (airports, ports, warehouses, etc.) —
that's real-world logistics knowledge this pipeline has no source for.
As a placeholder, one hub per regency is generated from the kab_kota
polygon centroid (data already in local-data/, not a guessed coordinate).

This is explicitly NOT a substitute for real aid-hub locations (airstrips,
ports, distribution warehouses) — replace data/<study_area>/hubs.geojson
with real coordinates once a coordinator supplies them.

Run standalone: python -m pipeline.hubs [--study-area flores]
"""

from pipeline.config import SOURCES, STUDY_AREAS, fresh, study_area_dir
from pipeline.db import connect


def run(study_area: str) -> None:
    con = connect()
    out_dir = study_area_dir(study_area)
    out_path = fresh(out_dir / "hubs.geojson")
    codes = STUDY_AREAS[study_area]["kab_kota_codes"]
    codes_sql = ",".join(f"'{c}'" for c in codes)

    con.execute(
        f"""
        COPY (
            SELECT
                code AS kab_kota_code,
                name AS kab_kota_name,
                'placeholder-regency-centroid' AS source,
                ST_Centroid(geom) AS geom
            FROM ST_Read('{SOURCES["kab_kota"]}')
            WHERE code IN ({codes_sql})
        ) TO '{out_path}'
        WITH (FORMAT GDAL, DRIVER 'GeoJSON')
        """
    )

    n = con.execute(f"SELECT COUNT(*) FROM ST_Read('{out_path}')").fetchone()[0]
    print(f"[hubs] {study_area}: {n} PLACEHOLDER hubs (regency centroids, not real aid hubs)")


if __name__ == "__main__":
    from pipeline.cli import study_area_arg

    run(study_area_arg())
