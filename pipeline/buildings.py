"""Clip building points to the study area and aggregate counts per
settlement, as a proxy input for the damage-and-loss baseline.

Run standalone: python -m pipeline.buildings [--study-area flores]
"""

from pipeline.boundary import load_boundary_wkt
from pipeline.config import SOURCES, fresh, study_area_dir
from pipeline.db import connect


def run(study_area: str) -> None:
    con = connect()
    boundary_wkt = load_boundary_wkt(con, study_area)

    out_dir = study_area_dir(study_area)
    settlements_path = out_dir / "settlements.geojson"
    out_path = fresh(out_dir / "buildings_by_settlement.parquet")

    con.execute(
        f"""
        COPY (
            WITH clipped AS (
                SELECT osm_id, ST_Point(lon, lat) AS geom
                FROM read_parquet('{SOURCES["buildings"]}')
                WHERE ST_Intersects(ST_Point(lon, lat), ST_GeomFromText('{boundary_wkt}'))
            ),
            settlements AS (
                SELECT code AS settlement_code, name AS settlement_name, geom
                FROM ST_Read('{settlements_path}')
            )
            SELECT s.settlement_code, s.settlement_name,
                   COUNT(b.osm_id) AS building_count
            FROM settlements s
            LEFT JOIN clipped b ON ST_Intersects(b.geom, s.geom)
            GROUP BY s.settlement_code, s.settlement_name
        ) TO '{out_path}' (FORMAT PARQUET)
        """
    )

    total = con.execute(
        f"SELECT SUM(building_count) FROM read_parquet('{out_path}')"
    ).fetchone()[0]
    print(f"[buildings] {study_area}: {total} buildings aggregated across settlements")


if __name__ == "__main__":
    from pipeline.cli import study_area_arg

    run(study_area_arg())
