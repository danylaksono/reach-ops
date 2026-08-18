"""Join settlement polygons with building counts and population into a
single damage-and-loss baseline layer — the "prior" that field reports
will later update or override, not real ground-truth damage.

Also joins in GIK (Geoportal Informasi Kebencanaan) field reports when a
snapshot exists (data/<study_area>/gik_reports.geojson, produced by
pipeline.gik), so the baseline carries real reported needs alongside the
building-count/population proxies. The join is a LEFT JOIN on the
settlement polygon containing each report point, so settlements without
reports still appear.

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
    gik_path = out_dir / "gik_reports.geojson"
    out_path = fresh(out_dir / "baseline.geojson")

    # GIK reports are optional — the baseline must build without them.
    gik_join = ""
    if gik_path.exists():
        gik_join = f"""
            LEFT JOIN (
                SELECT
                    g.settlement_code,
                    COUNT(*) AS gik_reports,
                    CAST(SUM(g.households) AS BIGINT) AS gik_households,
                    CAST(SUM(g.people_n) AS BIGINT) AS gik_people,
                    STRING_AGG(g.needs, ' | ') AS gik_needs
                FROM (
                    SELECT
                        r.*,
                        s.code AS settlement_code,
                        TRY_CAST(REGEXP_EXTRACT(r.people, '\\d+') AS BIGINT) AS people_n
                    FROM ST_Read('{gik_path}') r
                    JOIN ST_Read('{settlements_path}') s
                      ON ST_Intersects(r.geom, s.geom)
                ) g
                GROUP BY g.settlement_code
            ) gik ON gik.settlement_code = s.code
        """

    con.execute(
        f"""
        COPY (
            SELECT
                s.code, s.name, s.name_norm,
                s.kab_kota_code, s.kab_kota_name,
                s.kecamatan_code, s.kecamatan_name,
                COALESCE(b.building_count, 0) AS building_count,
                COALESCE(p.population, 0) AS population,
                COALESCE(gik.gik_reports, 0) AS gik_reports,
                COALESCE(gik.gik_households, 0) AS gik_households,
                COALESCE(gik.gik_people, 0) AS gik_people,
                COALESCE(gik.gik_needs, '') AS gik_needs,
                s.geom
            FROM ST_Read('{settlements_path}') s
            LEFT JOIN read_parquet('{buildings_path}') b ON b.settlement_code = s.code
            LEFT JOIN read_parquet('{population_path}') p ON p.settlement_code = s.code
            {gik_join}
        ) TO '{out_path}'
        WITH (FORMAT GDAL, DRIVER 'GeoJSON')
        """
    )

    n = con.execute(f"SELECT COUNT(*) FROM ST_Read('{out_path}')").fetchone()[0]
    print(f"[baseline] {study_area}: {n} settlements in damage-and-loss baseline")


if __name__ == "__main__":
    from pipeline.cli import study_area_arg

    run(study_area_arg())
