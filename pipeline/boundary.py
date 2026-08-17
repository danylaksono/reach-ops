"""Study area boundary and settlement extraction.

Dissolves the configured kab_kota (regency) polygons into a single study
area boundary, and pulls the kel_desa (village/settlement) polygons that
fall inside those regencies — this is the spatial join target used later
for buildings and population aggregation.

Run standalone: python -m pipeline.boundary [--study-area flores]
"""

import duckdb

from pipeline.config import SOURCES, STUDY_AREAS, fresh, study_area_dir
from pipeline.db import connect


def load_boundary_wkt(con: duckdb.DuckDBPyConnection, study_area: str) -> str:
    codes = STUDY_AREAS[study_area]["kab_kota_codes"]
    codes_sql = ",".join(f"'{c}'" for c in codes)
    row = con.execute(
        f"""
        SELECT ST_AsText(ST_Union_Agg(geom))
        FROM ST_Read('{SOURCES["kab_kota"]}')
        WHERE code IN ({codes_sql})
        """
    ).fetchone()
    return row[0]


def run(study_area: str) -> str:
    con = connect()
    out_dir = study_area_dir(study_area)
    codes = STUDY_AREAS[study_area]["kab_kota_codes"]
    codes_sql = ",".join(f"'{c}'" for c in codes)

    boundary_wkt = load_boundary_wkt(con, study_area)

    con.execute(
        f"""
        COPY (
            SELECT ST_GeomFromText('{boundary_wkt}') AS geom
        ) TO '{fresh(out_dir / "boundary.geojson")}'
        WITH (FORMAT GDAL, DRIVER 'GeoJSON')
        """
    )

    settlements_path = fresh(out_dir / "settlements.geojson")
    con.execute(
        f"""
        COPY (
            SELECT code, name, name_norm,
                   kab_kota_code, kab_kota_name,
                   kecamatan_code, kecamatan_name,
                   geom
            FROM ST_Read('{SOURCES["kel_desa"]}')
            WHERE kab_kota_code IN ({codes_sql})
        ) TO '{settlements_path}'
        WITH (FORMAT GDAL, DRIVER 'GeoJSON')
        """
    )

    n_settlements = con.execute(
        f"SELECT COUNT(*) FROM ST_Read('{settlements_path}')"
    ).fetchone()[0]
    print(f"[boundary] {study_area}: {n_settlements} settlements in {len(codes)} regencies")

    return boundary_wkt


if __name__ == "__main__":
    from pipeline.cli import study_area_arg

    run(study_area_arg())
