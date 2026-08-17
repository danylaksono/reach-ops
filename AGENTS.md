# AGENTS.md — Reach-Ops (Accessibility Dashboard Prototype)

## Context

On 15 August 2026, a magnitude 7.7 earthquake struck off the coast of Flores,
Indonesia, epicentre roughly 68 km north-northwest of Ende in East Nusa
Tenggara province. Landslides and damaged infrastructure cut off roads to
several communities, including Nagekeo near the epicentre, delaying rescue
and aid teams. Cell towers were damaged, disrupting communication for
thousands of residents. A 14-day state of emergency was declared.

This project, named Reach-Ops, is a prototype disaster-response dashboard
built in response to that event. Scope is the whole of Flores island
(Manggarai, Manggarai Barat, Manggarai Timur, Ngada, Nagekeo, Ende, Sikka,
Flores Timur, and Lembata regencies), with East Nusa Tenggara (NTT)
province — Flores plus Sumba, Timor, Alor, and the smaller islands — as a
likely further expansion, not yet committed. OpenStreetMap data is the
primary input. The pipeline and engine are meant to generalise beyond NTT
too — the same approach should apply to any future disaster with a
similar accessibility problem, not just this one.

## Problem statement

Most operational disaster dashboards report where damage has occurred
(damaged buildings, affected population counts) but do not report
accessibility: whether the roads needed to reach an affected area are
actually usable. This is a real gap in current practice. A village can be
flagged as high-need and still be effectively invisible to aid planners if
nobody has modelled whether it can currently be reached.

This project fills that gap with a reachability/accessibility model that:
- uses OSM road network data for Flores as its base
- lets field coordinators mark specific road segments as broken (or
  restored) based on ground reports
- recomputes accessibility from aid hubs to settlements whenever the
  network changes
- joins that reachability output against damage-and-loss data (population
  affected, buildings damaged, facility needs) so that priority and
  cutoff can be seen together, not separately

## Guiding concept: the Spatial Intervention Loop (SIL)

This prototype is framed as a working instance of the Spatial Intervention
Loop, an existing research construct: filter, prioritise, intervene,
evaluate, refine.

- Filter: narrow to affected villages/settlements in the Flores study area.
- Prioritise: rank by a combination of need (population, damage, facility
  gaps) and current cutoff (poor or no accessibility).
- Intervene: a coordinator marks a road segment broken, damaged, or
  restored, based on a field report.
- Evaluate: the accessibility model recomputes reachability from aid hubs
  under the new network state.
- Refine: repeat as new field reports come in, refining the aid routing
  picture over time.

This prototype is intentionally small, but is meant to seed a longer-term,
more ambitious goal: a fuller operational dashboard, digital-twin-like,
capable of simulating both real-time and hypothetical ("what if this road
breaks") conditions to continuously refine aid distribution.

## Cloud-native data sources

Prefer cloud-native, queryable-in-place datasets over local downloads
where they are available and sufficient — faster to prepare, easier to
refresh, and easier to re-target at a future disaster site without
re-running a full extract-and-clean pipeline each time.

- **Kontur Population** — global population dataset on a 400m H3 hexagon
  grid, fusing GHSL, Meta High Resolution Settlement Layer, and Microsoft
  Building Footprints, free under CC BY. Already H3-indexed, so it joins
  naturally with H3-based work elsewhere (see [[spatial-analytical-intent]]
  stack, which already uses H3). Preferred population source over a
  bespoke population layer, unless a higher-resolution local source is
  needed.
- **Source.coop** — hosts cloud-native geospatial datasets (e.g. Google
  Open Buildings) as GeoParquet, queryable directly via DuckDB's `httpfs`
  and `spatial` extensions without downloading the full dataset — query
  by bounding box for the study area and pull only what's needed. Worth
  checking for a buildings dataset here, since OSM building coverage in
  rural areas like Flores may be sparse.
- General pattern: use DuckDB's `spatial` and `httpfs` extensions (locally
  or via DuckDB-WASM in-browser) to query remote GeoParquet/COG data in
  place, rather than defaulting to a full download-then-process step,
  wherever the dataset and query pattern make that efficient.

## Architecture (three tiers)

Lean on existing WASM/Rust/DuckDB functionality rather than building from
scratch where a solid option already exists:
- DuckDB-WASM with the `spatial` and `httpfs` extensions, for in-browser
  querying of local and cloud-native (Source.coop-hosted) geospatial data.
- An existing Rust graph/pathfinding crate as a starting point rather than
  writing Dijkstra from zero — **not** `routx` as originally suggested
  here; see [Lessons learned](#lessons-learned) for why. `petgraph`
  (`DiGraph` + hand-rolled Dijkstra respecting a per-edge `passable` flag)
  is what Phase 1 actually used.
- H3 (already part of the [[spatial-analytical-intent]] stack) as the
  common spatial index tying Kontur population data, damage-and-loss
  aggregation, and reachability output together.

1. **Static base data** — prepared offline, not recomputed at runtime.
   The road network graph and the damage-and-loss baseline layer for
   Flores, built once from OSM and auxiliary datasets, then shipped as
   flat files
   (GeoJSON / PMTiles / similar).

2. **Client-side accessibility engine** — runs in the browser, no server
   required for the core reachability computation (a static file server
   is still needed to serve the page and data — browsers block `fetch()`
   of local files under `file://`). Loads the prepared graph, runs
   shortest-path / reachability queries, and recomputes when a road's
   status changes (broken/restored). Implementation: Rust compiled to
   WebAssembly via `wasm-bindgen`, on `petgraph` rather than an
   OSM-specific routing crate (see [Lessons learned](#lessons-learned)).
   DuckDB (or DuckDB-WASM) is a good fit for tabular and spatial queries
   (e.g. joining damage data to settlements) but should NOT be used to
   walk the graph itself — keep graph traversal in the dedicated routing
   engine.

3. **Field report store** — a proper database, external to the
   client-side layer, because field reporting is inherently multi-user,
   may include photos, and needs to persist and sync outside a single
   browser session. MongoDB (or a similar document store) is a reasonable
   choice, since reports are naturally document-shaped: location,
   timestamp, status (e.g. road broken / bridge down / restored), photo,
   coordinator notes. Assume intermittent connectivity in the field
   (damaged cell towers, possible reliance on radio/satellite relay) —
   design sync as batched and delayed, not assumed-live. A simple
   last-write-wins-by-timestamp approach, with a manual conflict view for
   a coordinator, is enough for the prototype stage.

Keep raw OSM data, field observations, and derived network state as
separate layers/scenarios rather than editing OSM data in place. This
preserves provenance and allows rolling back a bad or superseded field
report.

## Data layers needed

- **Road network** — OSM ways for Flores (roads, tracks, bridges), cleaned
  and converted into a routable graph (nodes, edges, one-way flags, road
  class/speed). Source: Geofabrik extract or Overpass API for the Flores
  region (Indonesia national extract already on hand locally, clipped to
  the Flores boundary; extend the clip to all of NTT if scope expands
  there).
- **Buildings layer** — OSM building footprints/counts, aggregated per
  settlement or administrative unit, as a proxy input for damage-and-loss
  baseline.
- **Administrative boundaries / settlements** — village or admin-unit
  polygons for Flores, used as the spatial join target for population,
  buildings, and facility-needs data.
- **Population data** — gridded or admin-unit-level population figures
  (e.g. official Indonesian village boundary + population sources, or a
  gridded population dataset), joined to settlements.
- **Damage-and-loss baseline** — derived from OSM building counts plus
  population, before any field reports arrive; this is the "prior" that
  field reports will later update or override.
- **Field reports** — road status changes and damage/needs updates
  submitted by coordinators, stored in the external database, referencing
  specific road segments or settlement units.
- **Facility needs** — data on what each settlement needs (water,
  medical, shelter, etc.), attached to the settlement/admin-unit layer
  alongside population and building damage — not part of the road graph.

## Phased implementation plan

### Phase 0 — Data preparation
Two sub-steps, only the second of which is built so far:

1. **Raw extraction (osmium) — not yet implemented as code.** Pull roads
   and buildings out of a raw `.osm.pbf` (Geofabrik/Overpass) into the
   national- or region-scale layers Phase 0 clips from. Skipped so far
   only because `local-data/` already had `indonesia_roads.gpkg` and
   `indonesia_buildings.parquet` on hand, pre-extracted by hand outside
   this repo. That's a reproducibility gap: retargeting this pipeline at
   a new disaster site (or rebuilding from a bare `.osm.pbf`) needs this
   step written as an actual osmium/pyosmium script, not assumed to
   pre-exist. Keep this step distinct from step 2 rather than folding
   raw-PBF parsing into the DuckDB clip job — osmium is the right tool
   for OSM-native extraction; DuckDB `spatial` is the right tool for
   clipping/joining already-tabular geodata.
2. **Study-area clip (DuckDB `spatial`) — implemented in `pipeline/`.**
   Filters the (step 1) national-scale roads/buildings layers down to
   the study area boundary, and joins in cloud-native sources (Kontur
   Population, Source.coop building data) via DuckDB where they improve
   coverage or save a download step. Outputs:
- a clean, routable road network file (GeoJSON or similar graph-ready
  format)
- a buildings-per-settlement aggregation (OSM and/or Source.coop)
- a damage-and-loss baseline layer joining building counts and Kontur
  population data to settlement/admin-unit polygons (this is a
  placeholder baseline, not real ground-truth damage, until field
  reports arrive)
- placeholder aid-hub points (regency centroids — AGENTS.md never
  specified real hub locations; swap in real airstrip/port/warehouse
  coordinates once a coordinator supplies them)

To run locally first, before any server or database is involved. See
[Lessons learned](#lessons-learned) for why each pipeline step runs as
its own subprocess rather than sharing one long-lived connection.

### Phase 1 — Client-side accessibility engine
Build the Rust/WASM routing engine using the Phase 0 road network.
Implement:
- shortest-path / reachability computation from designated aid hub points
  to settlements
- ability to mark an edge as broken/restored and recompute
- (optional, lower priority) bridges/articulation-point detection as a
  cheap way to flag structurally critical roads before running full
  accessibility-loss computations on every edge

Run locally against a simple web page loading the WASM module and the
Phase 0 output — no server needed yet.

### Phase 2 — Field reports and the join
Stand up the external database (e.g. local MongoDB instance) to hold
field reports (road status, damage updates, photos, notes). Build the
logic that:
- applies field reports to update road status in the accessibility engine
- joins population/needs/damage data against reachability output, so a
  settlement's priority (need) and its cutoff (accessibility) are visible
  together

### Future direction (not in scope for the prototype)
A fuller operational dashboard, digital-twin-like, capable of simulating
both real-time and hypothetical network conditions ("if this road
breaks...") to continuously refine aid routing. The prototype described
above is meant to be a credible seed for this, not a finished version of
it.

## Lessons learned

Concrete problems hit while building Phase 0 and Phase 1, and how they
were resolved — read this before repeating the same investigation.

### Data pipeline (DuckDB spatial / GDAL)

- **Unlink before every GDAL-driven `COPY ... TO ... GeoJSON`.** DuckDB's
  GDAL GeoJSON writer segfaults (a native crash, not a catchable Python
  exception) if the destination file already exists. Every pipeline
  output path goes through a `fresh()` helper (`pipeline/config.py`) that
  deletes the file first — without it, a second run of the same step
  reliably crashes.
- **Run each pipeline step in its own process.** Even with the overwrite
  fix, repeated `ST_Read`/GDAL-backed `COPY TO` calls inside one
  long-lived DuckDB connection segfaulted intermittently, in a different
  step each time — looked like corrupted GDAL driver state carried across
  calls, not a DuckDB/SQL bug. `pipeline/run.py` now shells out to
  `python -m pipeline.<step>` per step; each gets a fresh connection, and
  a crash is isolated and attributable instead of corrupting the whole
  run.
- **A step can still fail once with `Invalid Input Error: Unsupported
  geometry type in WKB`.** Seen even with process isolation, on
  `spatial`-extension load. A bare rerun of that step has always
  succeeded, with output counts identical to a clean run — treat it as a
  platform/extension-load flake to retry, not a data problem, as long as
  the retry's counts match.
- **`&&` (bbox overlap) is not defined for `GEOMETRY`** in this DuckDB
  spatial version — only for arrays. Use `ST_Intersects` directly rather
  than assuming a bbox pre-filter shortcut compiles; check the error
  message (`Candidate functions: &&(T[], T[])`) rather than guessing at
  a workaround.
- **`ST_Transform` defaults to EPSG-authoritative axis order** (lat, lon
  for geographic CRSs), not the GIS-conventional (lon, lat) — pass
  `always_xy := true` or coordinates come out swapped with no error to
  flag it. Don't assume a source is EPSG:4326; check with
  `st_read_meta()` (Kontur population ships in EPSG:3857, everything
  else here happened to already be EPSG:4326).
- **GDAL-exported GeoJSON uses `""` for missing string properties, not
  `null`.** Matters for downstream parsers — e.g. the Rust side uses
  `#[serde(default)]` on `String` fields, not `Option<String>`.

### Engine (Rust / WebAssembly)

- **Check a suggested crate against the actual requirement before
  scaffolding around it.** This doc originally pointed at `routx` for
  the routing engine. A five-minute check (crates.io + docs.rs) showed
  it only parses raw `.osm.pbf` (file I/O, plus `flate2`/`bzip2`/
  `protobuf` dependencies that are awkward for `wasm32`) and has no API
  for disabling/restoring an edge — the one thing Phase 1 actually
  needs. Cheaper to verify a dependency's fit up front than to discover
  it mid-scaffold.
- **Coordinate-based node deduplication is only safe if verified on the
  real data.** The engine merges graph nodes by exact matching lon/lat,
  which only works if the extraction upstream preserved OSM's shared
  node coordinates bit-for-bit. Checked before relying on it: ~21% of
  endpoints in `roads.geojson` are shared by 2+ segments, confirming
  exact matches survive. Don't assume this holds for a new source
  dataset — recheck it the same way.
- **A linear-scan nearest-node lookup does not scale.** Snapping 1,619
  settlement centroids against Flores's ~838k graph nodes with a linear
  scan took over a minute in-browser (still hadn't returned). A uniform
  grid spatial index (`engine/src/spatial_index.rs`) brought the same
  query under 100ms. Benchmark spatial lookups against real data
  volumes, not a handful of test points — 9 hub lookups looked instant
  and hid the problem until settlement-scale snapping was tried.
- **Design the wasm API around what's actually called repeatedly.** The
  first cut re-passed and re-snapped every hub/target coordinate on
  every `compute_reachability()` call, so each road break/restore paid
  the full snap cost again. Splitting into one-time `set_hubs`/
  `set_targets` (cached) plus a cheap `compute_reachability()` (just
  Dijkstra plus O(1) lookups) brought a recompute down to ~300ms in the
  browser.
- **Verify in the actual target environment, not just `cargo test`.**
  The nearest-node slowness only surfaced once the compiled wasm module
  was driven in a real browser tab — native benchmarks looked fine
  because they only exercised 9 hub lookups, not 1,619 settlement
  lookups at the scale the web page actually needed.

### Tooling / process

- **`LNK1104: cannot open file ...exe` from `cargo build`/`cargo test`
  on Windows has always been transient** (looks like antivirus or a
  file-handle lock on the freshly-built binary) — an immediate retry has
  always cleared it. Don't debug it as a code problem.
- **Browser-automation tooling can drop artifacts into the repo root.**
  Playwright MCP wrote snapshot/console logs to `.playwright-mcp/` in
  the working directory during manual testing — gitignored now, but
  check for and ignore whatever directory your browser-testing tool
  uses before it ends up in a commit.
- **"No server needed" (Phase 1, above) means no backend/API**, not no
  server at all — a static file server is still required, since browsers
  block `fetch()` of local files under `file://`. `python -m
  http.server` from the repo root is enough.

## Open notes / things not yet resolved

- User has other ideas for this project not yet detailed — to be added
  as they come up.
- Scope confirmed as all of Flores island (nine regencies); NTT province
  is a likely but not-yet-committed further expansion — treat "Flores"
  as the working boundary until that's decided.
- HOT (Humanitarian OpenStreetMap Team) may have an active mapping
  activation for this earthquake — worth checking, as it would likely
  improve OSM road/building coverage quality for the Flores study area
  faster than waiting on default OSM data.
- Field-report submission form for ground teams should be kept as simple
  as possible (location, status, optional photo) — usability in the
  field matters more than analytical sophistication at the reporting end.
- The raw-extraction step (osmium, from `.osm.pbf` to national/regional
  roads+buildings layers) is not yet written as code — see Phase 0 above.
  Needed before this pipeline can be run reproducibly from scratch (a new
  disaster site, or a clean checkout without the current `local-data/`
  already populated).
