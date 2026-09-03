"""Build the routable road network from Overture Maps instead of a
hand-prepared national OSM extract.

Same contract as `pipeline.roads` -- a `roads.geojson` of routable
segments carrying the attributes the engine needs -- but sourced by
bounding box from Overture's public GeoParquet on S3, so retargeting the
pipeline at a new disaster site needs no Geofabrik download and no
osmium extract step first (AGENTS.md Phase 0, step 1). That closes the
reproducibility gap; it does not change what Phase 0 produces.

Overture's transportation theme is overwhelmingly OSM-derived (every
segment sampled over Flores carries an `OpenStreetMap`/ODbL source), so
this is a different *delivery* of the same underlying survey data, not a
second opinion about where the roads are. What it buys is addressability:
a bbox query against a pinned, immutable release, rather than a national
file someone prepared by hand.

Run standalone: python -m pipeline.roads_overture [--study-area flores]
                                                  [--out roads.geojson]
"""

import argparse
import time

from pipeline.boundary import load_boundary_wkt
from pipeline.config import (
    OVERTURE_LINKABLE_CLASSES,
    OVERTURE_REGION,
    OVERTURE_RELEASE,
    OVERTURE_ROUTABLE_CLASSES,
    OVERTURE_SEGMENTS,
    STUDY_AREAS,
    fresh,
    study_area_dir,
)
from pipeline.db import connect

# Attribute set written out, in the same order pipeline.roads uses, so the
# two sources are drop-in interchangeable for the engine and the dashboard.
# `segment_id` is the one addition -- see the note on break identity below.
OUTPUT_COLUMNS = (
    "osm_id, segment_id, highway, name, oneway, maxspeed, surface, "
    "ref, lanes, bridge, tunnel, geom"
)

# Oneway: Overture has no `oneway` field. A one-way street is a segment
# carrying an access restriction that *denies* travel in one heading.
# Only unscoped restrictions count -- a `between` means the rule covers
# part of the segment, and a `mode` that excludes cars (a contraflow
# cycle lane, say) is not a oneway for our purposes. `when` is a SQL
# keyword, hence the quoting on every struct access.
ONEWAY_DENIED = (
    "a.access_type = 'denied' AND a.\"when\".heading = '{heading}' "
    "AND a.between IS NULL "
    "AND (a.\"when\".mode IS NULL OR list_contains(a.\"when\".mode, 'car'))"
)


def build_sql(boundary_wkt: str, bbox: tuple[float, float, float, float]) -> str:
    xmin, ymin, xmax, ymax = bbox
    classes = ",".join(f"'{c}'" for c in OVERTURE_ROUTABLE_CLASSES)
    linkable = ",".join(f"'{c}'" for c in OVERTURE_LINKABLE_CLASSES)

    return f"""
    WITH raw AS (
        SELECT id, class, subclass, names, sources, access_restrictions,
               speed_limits, road_surface, road_flags, routes,
               -- DuckDB's spatial extension reads GeoParquet natively, so
               -- `geometry` already arrives as GEOMETRY; no WKB decode step.
               geometry AS geom
        FROM read_parquet('{OVERTURE_SEGMENTS}', hive_partitioning = 1)
        WHERE subtype = 'road'
          AND class IN ({classes})
          -- Row-group pruning on Overture's own bbox struct: this is what
          -- keeps a study-area query off the full planetary scan.
          AND bbox.xmin <= {xmax} AND bbox.xmax >= {xmin}
          AND bbox.ymin <= {ymax} AND bbox.ymax >= {ymin}
    ),
    clipped AS (
        SELECT * FROM raw
        WHERE ST_Intersects(geom, ST_GeomFromText('{boundary_wkt}'))
    ),
    derived AS (
        SELECT
            id, class, subclass, names, routes, geom,
            list_filter(sources, s -> s.dataset = 'OpenStreetMap'
                        AND starts_with(s.record_id, 'w'))[1].record_id
                AS osm_record_id,
            coalesce(flatten(list_transform(road_flags, f -> f.values)), [])
                AS flag_values,
            list_filter(speed_limits, s -> s."when" IS NULL
                        AND s.between IS NULL
                        AND s.max_speed IS NOT NULL)[1].max_speed
                AS speed,
            coalesce(list_filter(road_surface, s -> s.between IS NULL)[1].value,
                     road_surface[1].value) AS surface_value,
            coalesce(len(list_filter(access_restrictions,
                     a -> {ONEWAY_DENIED.format(heading="backward")})), 0)
                AS deny_backward,
            coalesce(len(list_filter(access_restrictions,
                     a -> {ONEWAY_DENIED.format(heading="forward")})), 0)
                AS deny_forward
        FROM clipped
    )
    SELECT
        -- Break identity. The engine keys road breaks on osm_id
        -- (engine/src/graph.rs `set_passable`), and field reports
        -- reference it across rebuilds, so the OSM way id stays the
        -- primary id wherever Overture carries one. Segments with no OSM
        -- source get a negative synthetic id, which cannot collide with a
        -- real one. `segment_id` carries Overture's own stable GERS id
        -- alongside it -- see the granularity note in the README.
        coalesce(
            TRY_CAST(regexp_extract(osm_record_id, '^w([0-9]+)', 1) AS BIGINT),
            -row_number() OVER (ORDER BY id)
        ) AS osm_id,
        id AS segment_id,
        CASE
            WHEN class = 'unknown' THEN 'road'
            WHEN subclass = 'link' AND class IN ({linkable}) THEN class || '_link'
            ELSE class
        END AS highway,
        coalesce(names.primary, '') AS name,
        CASE
            WHEN deny_backward > 0 THEN 'yes'
            WHEN deny_forward > 0 THEN '-1'
            ELSE ''
        END AS oneway,
        coalesce(CAST(CAST(round(
            CASE WHEN lower(speed.unit) = 'mph' THEN speed.value * 1.609344
                 ELSE speed.value END) AS BIGINT) AS VARCHAR), '') AS maxspeed,
        coalesce(surface_value, '') AS surface,
        coalesce(routes[1].ref, '') AS ref,
        -- Overture's segment schema carries no lane count. Held as an
        -- empty column rather than dropped, so the two sources stay
        -- schema-compatible; only 69 of 25,360 OSM segments had one.
        '' AS lanes,
        CASE WHEN list_contains(flag_values, 'is_bridge') THEN 'yes' ELSE '' END AS bridge,
        CASE WHEN list_contains(flag_values, 'is_tunnel') THEN 'yes' ELSE '' END AS tunnel,
        geom
    FROM derived
    """


def run(study_area: str, out_name: str = "roads.geojson") -> None:
    con = connect()
    con.execute(f"SET s3_region = '{OVERTURE_REGION}';")
    boundary_wkt = load_boundary_wkt(con, study_area)

    bbox = con.execute(
        f"""
        SELECT ST_XMin(g), ST_YMin(g), ST_XMax(g), ST_YMax(g)
        FROM (SELECT ST_GeomFromText('{boundary_wkt}') AS g)
        """
    ).fetchone()

    out_dir = study_area_dir(study_area)
    out_path = fresh(out_dir / out_name)

    label = STUDY_AREAS[study_area]["label"]
    print(
        f"[roads-overture] {label}: querying release {OVERTURE_RELEASE} "
        f"over bbox {tuple(round(v, 3) for v in bbox)}"
    )
    t0 = time.time()

    # ORDER BY is not cosmetic: the S3 parquet scan is parallel and
    # returns rows in whatever order the threads finish, so two builds of
    # the identical release produce identical features in different
    # order. `data/` is committed, so without a total order every rebuild
    # would land as a whole-file diff. segment_id is Overture's GERS id
    # and unique, so it gives one.
    con.execute(
        f"""
        COPY (
            SELECT {OUTPUT_COLUMNS} FROM ({build_sql(boundary_wkt, bbox)})
            ORDER BY segment_id
        )
        TO '{out_path}' WITH (FORMAT GDAL, DRIVER 'GeoJSON')
        """
    )

    n = con.execute(f"SELECT COUNT(*) FROM ST_Read('{out_path}')").fetchone()[0]
    print(
        f"[roads-overture] {study_area}: {n} road segments "
        f"in {round(time.time() - t0, 1)}s -> {out_path.name}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study-area", default="flores", choices=sorted(STUDY_AREAS))
    parser.add_argument(
        "--out",
        default="roads.geojson",
        help="Output filename inside data/<study-area>/ (default: roads.geojson). "
        "Use a different name to build alongside an existing extract for comparison.",
    )
    args = parser.parse_args()
    run(args.study_area, args.out)
