"""Join settlement polygons with building counts and population into a
single damage-and-loss baseline layer — the "prior" that field reports
will later update or override, not real ground-truth damage.

Run standalone: python -m pipeline.baseline [--study-area flores]
"""

from pipeline.config import fresh, study_area_dir
from pipeline.db import connect


def run(study_area: str) -> None:
    con = connect()
    out_dir = study_area_dir(study_area)
    settlements_path = out_dir / "settlements.geojson"
    buildings_path = out_dir / "buildings_by_settlement.parquet"
    population_path = out_dir / "population_by_settlement.parquet"
    out_path = fresh(out_dir / "baseline.geojson")

    con.execute(
        f"""
        COPY (
            SELECT
                s.code, s.name, s.name_norm,
                s.kab_kota_code, s.kab_kota_name,
                s.kecamatan_code, s.kecamatan_name,
                COALESCE(b.building_count, 0) AS building_count,
                COALESCE(p.population, 0) AS population,
                s.geom
            FROM ST_Read('{settlements_path}') s
            LEFT JOIN read_parquet('{buildings_path}') b ON b.settlement_code = s.code
            LEFT JOIN read_parquet('{population_path}') p ON p.settlement_code = s.code
        ) TO '{out_path}'
        WITH (FORMAT GDAL, DRIVER 'GeoJSON')
        """
    )

    n = con.execute(f"SELECT COUNT(*) FROM ST_Read('{out_path}')").fetchone()[0]
    print(f"[baseline] {study_area}: {n} settlements in damage-and-loss baseline")


if __name__ == "__main__":
    from pipeline.cli import study_area_arg

    run(study_area_arg())
