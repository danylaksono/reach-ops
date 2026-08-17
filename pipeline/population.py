"""Clip Kontur population hexagons (H3, 400m) to the study area, reproject
from the source EPSG:3857 to EPSG:4326, and aggregate population per
settlement by joining each hex's centroid to the containing settlement
polygon."""

import duckdb

from pipeline.config import SOURCES, study_area_dir


def run(con: duckdb.DuckDBPyConnection, study_area: str, boundary_wkt: str) -> None:
    out_dir = study_area_dir(study_area)
    settlements_path = out_dir / "settlements.geojson"
    out_path = out_dir / "population_by_settlement.parquet"

    con.execute(
        f"""
        COPY (
            WITH reprojected AS (
                SELECT
                    h3,
                    population,
                    ST_Transform(geom, 'EPSG:3857', 'EPSG:4326', always_xy := true) AS geom
                FROM ST_Read('{SOURCES["kontur_population"]}')
            ),
            clipped AS (
                SELECT h3, population, ST_Centroid(geom) AS centroid
                FROM reprojected
                WHERE ST_Intersects(geom, ST_GeomFromText('{boundary_wkt}'))
            ),
            settlements AS (
                SELECT code AS settlement_code, name AS settlement_name, geom
                FROM ST_Read('{settlements_path}')
            )
            SELECT s.settlement_code, s.settlement_name,
                   COALESCE(SUM(c.population), 0) AS population
            FROM settlements s
            LEFT JOIN clipped c ON ST_Intersects(c.centroid, s.geom)
            GROUP BY s.settlement_code, s.settlement_name
        ) TO '{out_path}' (FORMAT PARQUET)
        """
    )

    total = con.execute(
        f"SELECT SUM(population) FROM read_parquet('{out_path}')"
    ).fetchone()[0]
    print(f"[population] {study_area}: {round(total):,} people aggregated across settlements")
