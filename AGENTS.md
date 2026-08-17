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
- An existing Rust OSM-routing crate (e.g. routx) as a starting point for
  the graph engine, rather than writing A*/Dijkstra and OSM parsing from
  zero.
- H3 (already part of the [[spatial-analytical-intent]] stack) as the
  common spatial index tying Kontur population data, damage-and-loss
  aggregation, and reachability output together.

1. **Static base data** — prepared offline, not recomputed at runtime.
   The road network graph and the damage-and-loss baseline layer for
   Flores, built once from OSM and auxiliary datasets, then shipped as
   flat files
   (GeoJSON / PMTiles / similar).

2. **Client-side accessibility engine** — runs in the browser, no server
   required for the core reachability computation. Loads the prepared
   graph, runs shortest-path / reachability queries, and recomputes when
   a road's status changes (broken/restored). Candidate implementation:
   Rust compiled to WebAssembly (e.g. via wasm-pack), potentially building
   on an existing OSM routing crate such as routx rather than writing a
   router from scratch. DuckDB (or DuckDB-WASM) is a good fit for tabular
   and spatial queries (e.g. joining damage data to settlements) but
   should NOT be used to walk the graph itself — keep graph traversal in
   the dedicated routing engine.

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
Python pipeline using osmium to pull and filter the OSM extract for
Flores down to roads and buildings, supplemented with cloud-native
sources (Kontur Population, Source.coop building data) queried directly
via DuckDB where they improve coverage or save a download step. Outputs:
- a clean, routable road network file (GeoJSON or similar graph-ready
  format)
- a buildings-per-settlement aggregation (OSM and/or Source.coop)
- a damage-and-loss baseline layer joining building counts and Kontur
  population data to settlement/admin-unit polygons (this is a
  placeholder baseline, not real ground-truth damage, until field
  reports arrive)

To run locally first, before any server or database is involved.

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
