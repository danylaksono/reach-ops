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
- **UGM GIK (Geoportal Informasi Kebencanaan)** — a public,
  crowdsourced field-report feed for disaster response
  (`https://geoportal.science/gik/get_data.php` returns a GeoJSON
  FeatureCollection of needs reports: location, households affected,
  people affected, needs, reporter contact, photo, status). Run by the
  Faculty of Geography UGM + KLHK + SNC; data is explicitly opened for
  situational response during disasters. Fetched by `pipeline.gik`
  (server-side, avoids CORS), clipped to the study area, and used in
  three places: the web dashboard overlay, the baseline needs join, and
  the field-report store seed. **Important: the feed is live and
  crowdsourced — re-run `python -m pipeline.gik` to refresh the
  snapshot; also note it contains personal data (reporter names, phone
  numbers) so treat it as operational, not a redistributable dataset.**
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
  field reports will later update or override. Now also joined with GIK
  needs reports when a snapshot exists (`pipeline.gik`), so the baseline
  carries reported needs (`gik_reports`, `gik_households`, `gik_people`,
  `gik_needs`) alongside the proxies.
- **Field reports** — road status changes and damage/needs updates
  submitted by coordinators, stored in the external database, referencing
  specific road segments or settlement units. The GIK snapshot is the
  initial seed (`pipeline.field` writes `field_reports.ndjson`, loadable
  with `mongoimport` or `python -m pipeline.field --import` when a local
  MongoDB is up).
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

A third, optional, live step — `pipeline.gik` (fetched with
`python -m pipeline.gik`, or `python -m pipeline.run --with-gik`) —
pulls the UGM GIK field-report feed, clips it to the study area, and
produces `gik_reports.geojson`; `pipeline.field` then normalises that
snapshot into the field-report store seed (`field_reports.ndjson`). These
are not part of the static base-data build (the feed changes as field
reports arrive), so they run on demand, not in the default `run.py`
sequence.

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

### Phase 3 — Operational dashboard interface

**Status: layout revamp built.** The original `web/` UI was a single-view
accessibility instrument (one map, one HUD strip, one sim panel, a 3-tab
sidebar) that read as an accessibility-engine demo, not an operational
dashboard. It's been rebuilt as a React + TypeScript + Vite app (Zustand
for shared state, TanStack Table for the priority list, Radix +
class-variance-authority UI primitives in the shadcn idiom rather than
shadcn's default theme, Tailwind v4, IBM Plex type) — see the "Dashboard
(web/)" section in README.md for the run command and file layout. The
plan below (informed by a short study of EOC/incident-dashboard practice,
the DALA/PDNA methodology, and humanitarian logistics-cluster GIS
practice) is marked done/pending per item; treat this as the current
state, not just a proposal.

- **DALA (Damage and Loss Assessment) layer — thin, explicit proxy, not
  full PDNA.** Real DALA (UN-ECLAC/GFDRR methodology) organises impact
  into sectors (social: housing/education/health; infrastructure:
  energy/water/transport; economic: agriculture/trade/tourism) and
  distinguishes *damage* (replacement cost of destroyed/damaged assets)
  from *loss* (disrupted flows — lost production/income/access) —
  Post-Disaster Needs Assessment (PDNA) adds a recovery-needs layer on
  top. Full macroeconomic loss modelling is out of scope here — decided:
  build a lightweight severity-proxy layer instead (using what's
  actually available: GIK reports + OSM building counts + Kontur
  population), and say so explicitly in the UI rather than imply
  PDNA-grade rigour. Useful realisation: the existing road-break state
  already **is** the DALA transport-infrastructure-damage layer, and
  `baseline.geojson` already **is** a proxy for the housing/social
  sector — DALA is mostly the existing baseline reorganised into the
  standard sector taxonomy, plus a severity dimension (destroyed / major
  / minor) that field reports don't currently carry and would need to
  add. **Decision: DALA sector data lives on its own report page**
  (matches how PDNA output is inherently tabular/report-shaped, not a
  map layer), not as an overlay bolted onto the accessibility map. —
  **Done**: `DalaView` (`web/src/components/views/DalaView.tsx`) is built
  as an honest not-yet-computed state (what proxy each sector will use,
  what's missing) rather than fake data; the severity choropleth overlay
  and sector table itself are still pending the severity field described
  above.
- **Information architecture: split into coordinated views, not one
  map trying to encode everything.** — **Done**: three views behind a nav
  rail (`web/src/components/NavRail.tsx`), switched via
  `useDashboardStore`'s `view` state.
  - *Overview* (`OverviewView.tsx`) — KPI tiles (settlements cut off,
    population affected, roads broken, buildings surveyed) + the same
    priority list — the "walk in and see the situation in 5 seconds"
    screen. The H3 density overview map (prior Open notes entry) is not
    built yet — Overview currently reuses the existing population/
    building aggregates, not an H3 layer.
  - *Accessibility* (`MapCanvas.tsx` + `RightPanel.tsx`) — today's map,
    kept as its own view so it isn't cluttered with damage data an
    operator didn't ask for. Reframing toward the logistics-cluster
    "access constraints map" convention (explicit passability/closure
    styling) is a visual-polish item, not yet done beyond the existing
    reachable/cutoff/broken colouring.
  - *Damage & Loss (DALA)* — see above; report page built, sector data
    itself pending.
  - A single ranked priority/triage list — **done** as
    `useSettlementRows()` (`web/src/lib/useSettlementRows.ts`), reused by
    both the Accessibility sidebar's Priority tab and Overview. Still
    need-only (population + cutoff); folding in a DALA sector score once
    that exists is the next step, not a DuckDB SQL rewrite — it's a small
    TS module today, not worth moving into SQL until the join gets
    genuinely relational (multiple sector tables).
- **KPI strip stays secondary to the map.** — **Done**:
  `TelemetryStrip.tsx` is a thin instrument-readout strip (not stat
  cards), shown only in the Accessibility view; Overview gets its own
  larger KPI tiles since being KPI-forward is its whole point.
- **Fullscreen map toggle.** — **Done**: `fullscreen` state in the store,
  collapses top bar/nav rail/right panel/telemetry strip to a minimal
  corner HUD (`FullscreenHud.tsx`).
- **Brush-linking across coordinated views.** — **Not done.** The map
  now stays mounted across every view switch (visibility toggle, not
  remount — see `MapCanvas.tsx`) specifically so this is buildable
  without a rearchitecture later, but no cross-view highlight wiring
  exists yet beyond the Priority list's "click a row → fly the map to
  it" (one-directional, same as before).
- **Push more computation into DuckDB/Rust, less into hand-rolled JS.**
  Partially done: settlement population (previously missing entirely —
  `settlements.geojson` carries no population field) now comes from a
  DuckDB-WASM query over `population_by_settlement.parquet`
  (`settlementPopulationByCode()` in `web/src/lib/duckdb.ts`), alongside
  the existing buildings query. Ranking/sorting logic stays in TS
  (`useSettlementRows.ts`) — see note above on why. Rust/wasm
  (`engine/src/reachability.rs`) still owns all graph-shaped computation.

### Phase 4 — Time-weighted isochrones & a configurable cost model

**Status: built.** Accessibility was distance-based (raw haversine edge
length) until now — true isochrones need travel *time*, and Flores'
terrain makes that a real distinction, not a rounding error. Architecture,
deliberately split into two layers so terrain can be added later without
touching the algorithm again:

- **Physical graph** (`engine/src/graph.rs`) — `EdgeData` now carries
  `highway: String` (the OSM class, parsed from `RoadProperties`, `#[serde(default)]`
  so a missing tag doesn't fail the load) and `terrain_multiplier: f64`,
  currently uniformly `1.0` for every edge and not populated from anywhere.
  This field is the terrain hook: wiring in a real slope/terrain layer
  later means joining a per-edge multiplier onto this field at graph-build
  time (e.g. from a DEM), not changing Dijkstra or the wasm API.
- **Cost model** (`engine/src/cost.rs`, new) — `CostModel` holds a
  `speeds_kmh: HashMap<String, f64>` (per OSM `highway` class) plus a
  `default_speed_kmh` fallback, with defaults checked against every class
  actually present in `data/flores/roads.geojson` (residential, track,
  tertiary, trunk, secondary, primary, unclassified, living_street, and
  the three `_link` classes — confirmed via a quick DuckDB `DESCRIBE`/
  `GROUP BY`, not guessed). `time_seconds(edge)` converts an edge's
  length + class (+ terrain multiplier) into a travel-time weight. Kept
  separate from `RoadGraph` on purpose: the same physical network can be
  re-costed at runtime (an operator tuning assumptions, or later a
  terrain layer) without rebuilding the graph — only Dijkstra needs to
  rerun. Configured speeds are floored at 0.5 km/h
  (`cost.rs::MIN_SPEED_KMH`) so a bad input (0, negative) can never
  produce an infinite/NaN travel time — `serde_json` refuses to serialize
  either, so an unguarded bad value would crash the whole
  `compute_state()` call, not just make one road very slow.
- **Dijkstra** (`engine/src/reachability.rs`) — `multi_source_times`
  replaces the old `multi_source_distances`; weights by
  `cost_model.time_seconds(edge)` instead of raw `length_m`, and returns
  `TravelCost { time_s, distance_m }` per node — `distance_m` is
  accumulated along the *same* time-optimal path, not an independently
  shortest route, so it describes the path actually taken, not a
  different one. Point-break/blocked-node semantics unchanged (still
  "arrive at but don't traverse through").
- **wasm API** (`engine/src/lib.rs`) — `Engine::set_cost_model(json)`
  replaces the model wholesale (not a merge); `Engine::cost_model_json()`
  reads the engine's own current model back, specifically so the
  dashboard's config panel never hardcodes a second copy of the Rust
  defaults. `SettlementResult` and `PieceResult` both gained `duration_s`
  alongside the existing `distance_m`.
- **Dashboard** — the map's road-piece colouring is now a `step`
  expression over `duration_min` (5-band ramp, ≤30min/≤1h/≤2h/≤4h/>4h,
  reusing the existing status-colour vocabulary read as fast→slow — see
  `ISOCHRONE_BANDS` in `web/src/lib/palette.ts`), with unreachable pieces
  styled separately via `!has` rather than a null-comparison (MapLibre
  expressions on a missing vs. `null` property are not the same thing —
  the property is omitted entirely for unreachable pieces, not set to
  `null`). The priority list sorts and displays by `duration_s`, not
  `distance_m`. A new **Cost** tab (`CostModelPanel.tsx`) exposes every
  class's speed as an editable number input, seeded from
  `engine.getCostModel()`; Apply pushes the edited profile back via
  `engine.setCostModel()` and recomputes — this is the "configurable
  assumptions" the isochrone plan asked for, not just a backend flag.

Not done: any actual terrain/slope data — `terrain_multiplier` is real
and wired through, but every edge is `1.0` today. Also not done: using
OSM `maxspeed` where it's present in the data (`data/flores/roads.geojson`
already carries a `maxspeed` property) instead of always falling back to
the class-based table — worth doing since the data's already there, but
skipped for now to avoid the unit-parsing edge cases (e.g. `"50"` vs
`"50 mph"` vs `"national"`) rather than get it subtly wrong.

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

### Frontend (React/Vite/MapLibre/DuckDB-WASM)

- **DuckDB-WASM's `read_parquet()` needs an explicit scheme.** A
  root-relative path like `/data/flores/x.parquet` fails with `IO Error:
  No files found that match the pattern` — without `http://`/`https://`,
  DuckDB resolves it against its own in-browser virtual filesystem
  instead of fetching it. Resolve to an absolute URL first
  (`new URL(path, window.location.origin).href`) before passing it into
  any `read_parquet('...')` call — see `dataUrl()` in
  `web/src/lib/duckdb.ts`.
- **MapLibre sets its own container's `position`, overriding an
  `absolute inset-0` utility class on that element.** Sizing a MapLibre
  container via "absolute, inset 0, let the positioned ancestor's height
  win" silently collapses to 0 height, because MapLibre's own JS ends up
  controlling that element's `position` (confirmed via computed style:
  `position: relative` despite an `absolute` class present) — `inset-0`
  has no sizing effect on a `relative`-positioned element. Fix: give the
  element MapLibre mounts into real `h-full w-full` sizing instead, and
  put the `absolute inset-0` positioning on a wrapper *around* it. Only
  found by comparing `getBoundingClientRect()` down the DOM chain in a
  live browser — the dev-server boot looked fine (data loaded, HUD
  numbers populated) while the map canvas stayed a black rectangle.
- **React 18 StrictMode double-invokes a mount effect with no cleanup,
  and a wasm engine boot is not safe to run twice.** Booting the
  `ReachEngine` (wraps a wasm-bindgen `Engine`) from a bare `useEffect`
  let StrictMode's dev-only double-invocation build two wasm `Engine`
  instances; one's finalizer freeing shared wasm linear memory while the
  other was still in use crashed as a wasm `unreachable` trap
  (`RuntimeError: unreachable` at `__rdl_dealloc`) the next time
  `compute_state()`/`break_count()` ran — an uncaught exception that blew
  away the whole React tree with no on-screen explanation (no error
  boundary existed yet). Fixed at the source with an idempotency guard
  (`if (get().phase !== "idle") return;` at the top of the store's
  `boot()`), plus added an `ErrorBoundary` around the app as
  defense-in-depth so a future wasm panic degrades to a message instead
  of a blank page. General lesson: any wasm object with explicit
  lifetime/finalization is not safe to construct from an effect body
  without a re-entrancy guard, specifically because of StrictMode's dev
  double-invocation — this class of bug won't reproduce in a production
  build, only in dev, which is exactly when it's cheapest to catch.

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
- **A live external feed is a snapshot, not a dependency.** The UGM GIK
  feed (`pipeline.gik`) changes as field reports arrive, so it must not
  be part of the default static base-data build — it runs on demand
  (`python -m pipeline.gik` / `--with-gik`). Everything downstream
  (baseline join, web overlay, field-report seed) treats a missing GIK
  snapshot as a graceful no-op, never a hard failure. Also note: DuckDB's
  `SUM()` over BIGINT aggregates produces HUGEINT, which the GDAL
  GeoJSON writer rejects (`Not implemented Error: Unsupported type for
OGR: HUGEINT`) — cast aggregates to BIGINT explicitly.

## Open notes / things not yet resolved

- User has other ideas for this project not yet detailed — to be added
  as they come up.
- **Islands / structurally isolated segments.** Some settlements (small
  islands, islets off Flores) have no road connection to the mainland
  network at all — not cut off by the earthquake, just never
  road-connected. Today's multi-source Dijkstra from hubs already can't
  cross water, so these already render as "unreachable," but that's
  indistinguishable from a mainland settlement cut off by damage — one
  needs road repair, the other needs a different logistics mode
  (maritime/air) entirely, and an operator needs to tell them apart at a
  glance. Plan: precompute connected components of the undamaged graph
  once (union-find over `graph.rs`, no hub involved) and tag each
  settlement with a component ID. A settlement whose component never
  contains a hub is **structurally unreachable by road** (baseline, not
  event-caused). A settlement in a hub's component but currently
  unreached (because a field report marked a segment broken) is **cut
  off by damage**. Render these as distinct states, not one
  "unreachable" bucket.
- **Reachability as an origin-destination problem; distribution points
  as a second hub tier.** Reachability here is fundamentally
  origin(hub)-destination(settlement), and future work should add
  "titik penyaluran bantuan" (aid distribution/coordination points) as
  additional origins, adjusting distribution accordingly. This mirrors
  how humanitarian logistics (e.g. the WFP-style Logistics Cluster
  model) usually structures it: a tiered hub-and-spoke —
  warehouses/ports/airstrips → forward distribution points → last-mile
  settlements — with each settlement assigned to its *nearest* serving
  point, not just flagged "reachable from any hub." The existing
  multi-source Dijkstra in `reachability.rs` already computes distance
  from the nearest hub; extending it to also track *which source won*
  during relaxation gives a nearest-distribution-point assignment per
  settlement at no extra algorithmic cost. A distribution point then is
  just another hub with a `hub_type` field (warehouse vs. distribution
  point), added/moved through the same `set_hubs` + recompute flow
  already built for the Spatial Intervention Loop's road-break
  interaction — no new interaction pattern needed, just a second hub
  category and per-settlement "assigned to" output instead of a boolean.
- **Buildings layer: overview → filter → detail-on-demand (Shneiderman's
  mantra), backed by GeoParquet + DuckDB.** Current dashboard already
  does the middle tier (settlement-level building-count choropleth from
  `buildings_by_settlement.parquet` via DuckDB-WASM). Plan to complete
  the pattern:
  - **Overview** — H3 (res ~7–8) population/building-density hexes from
    Kontur (already H3-indexed, see [[spatial-analytical-intent]]) as a
    cheap vector layer at low zoom, no parquet queried yet.
  - **Filter** — today's settlement-level choropleth, unchanged.
  - **Detail on demand** — past a zoom threshold, query individual
    building footprints by viewport bounding box from a GeoParquet
    (local `indonesia_buildings.parquet`, or Source.coop's Google Open
    Buildings via `httpfs` for better rural coverage than OSM alone).
    DuckDB's row-group pruning plus a spatial bbox filter means this
    never loads the full buildings dataset into browser memory —
    cheapness comes from querying in place, not from a smaller file.
    Not yet built; needs per-building geometry, which the current
    pre-aggregated settlement parquet doesn't carry.
  Worth checking whether a terrain/slope layer (also H3-joinable) adds
  useful signal at the overview tier, e.g. for landslide-risk context
  alongside population/building density.
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
