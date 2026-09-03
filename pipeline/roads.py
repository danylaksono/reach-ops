"""Clip the national road network down to the study area and drop
non-routable highway classes, keeping the attributes a routing engine
needs (highway class, oneway, speed, surface, bridge/tunnel flags).

No longer the default source — `pipeline.roads_overture` is, because it
needs nothing on local disk. This step stays for offline rebuilds and as
the known-quantity side of a source diff. Note that on Flores the
national extract it reads turned out to be missing the `service` and
`road` highway classes outright (README.md, "Roads from Overture Maps"),
so `local-data/indonesia_roads.gpkg` is not a complete OSM road layer.

Run standalone: python -m pipeline.roads [--study-area flores]
Via the full run: python -m pipeline.run --roads-source local
"""

from pipeline.boundary import load_boundary_wkt
from pipeline.config import ROUTABLE_HIGHWAY_CLASSES, SOURCES, fresh, study_area_dir
from pipeline.db import connect


def run(study_area: str) -> None:
    con = connect()
    boundary_wkt = load_boundary_wkt(con, study_area)

    out_dir = study_area_dir(study_area)
    out_path = fresh(out_dir / "roads.geojson")
    classes_sql = ",".join(f"'{c}'" for c in ROUTABLE_HIGHWAY_CLASSES)

    con.execute(
        f"""
        COPY (
            SELECT osm_id, highway, name, oneway, maxspeed, surface,
                   ref, lanes, bridge, tunnel, geom
            FROM ST_Read('{SOURCES["roads"]}')
            WHERE highway IN ({classes_sql})
              AND ST_Intersects(geom, ST_GeomFromText('{boundary_wkt}'))
        ) TO '{out_path}'
        WITH (FORMAT GDAL, DRIVER 'GeoJSON')
        """
    )

    n = con.execute(f"SELECT COUNT(*) FROM ST_Read('{out_path}')").fetchone()[0]
    print(f"[roads] {study_area}: {n} road segments")


if __name__ == "__main__":
    from pipeline.cli import study_area_arg

    run(study_area_arg())
