# Reach-Ops

Prototype disaster-response accessibility dashboard, built in response to
the 15 August 2026 Flores earthquake. Scope is the whole of Flores
island, with East Nusa Tenggara (NTT) province as a possible further
expansion.

See [AGENTS.md](AGENTS.md) for full project context, architecture, data
sources, and the phased implementation plan.

Raw and derived geodata lives in `local-data/` and is not version
controlled (see `.gitignore`).

## Phase 0 — data preparation

`pipeline/` clips the national-scale source data in `local-data/` down to
a study area using DuckDB's `spatial` extension, and writes prepared
outputs to `data/<study_area>/`:

```sh
uv run python -m pipeline.run --study-area flores
```

Outputs per study area: `boundary.geojson`, `settlements.geojson`,
`roads.geojson` (routable road network), `buildings_by_settlement.parquet`,
`population_by_settlement.parquet`, `baseline.geojson` (the joined
damage-and-loss baseline), and `hubs.geojson` — **placeholder** aid-hub
points (one per regency centroid; AGENTS.md never specified real hub
locations, so replace this with actual airstrip/port/warehouse
coordinates once a coordinator supplies them). Study areas are defined in
`pipeline/config.py` — currently just `flores` (nine regencies); add an
`ntt` entry there if/when scope expands to the full province.

Each step (`boundary`, `roads`, `buildings`, `population`, `baseline`,
`hubs`) runs as its own subprocess via `pipeline/run.py` — DuckDB's GDAL
GeoJSON writer proved unstable (native-library segfaults) when many
`ST_Read`/`COPY`-to-GeoJSON calls ran back to back in one long-lived
connection on this platform, so each step gets a fresh process. Steps are
also runnable standalone, e.g. `uv run python -m pipeline.roads
--study-area flores`. Even with process isolation, a step occasionally
fails on first try with `Invalid Input Error: Unsupported geometry type
in WKB` — a rerun of that step has always succeeded so far, with output
counts identical to a clean run. Looks like an intermittent extension/GDAL
load hiccup on this platform, not a data problem; hasn't been worth
chasing further given it self-heals on retry.

## Phase 1 — client-side accessibility engine

`engine/` is a Rust crate (petgraph + wasm-bindgen) that builds a routable
graph directly from Phase 0's `roads.geojson` — nodes are deduplicated by
exact coincident coordinates (OSM's shared node coordinates survive the
Phase 0 extraction unchanged), edges carry a `passable` flag, and
reachability is a multi-source Dijkstra from aid hubs that respects that
flag. Nearest-node lookups (snapping a hub or settlement to the graph) go
through a uniform grid spatial index — a first pass using a linear scan
took over a minute to snap 1,619 settlements against Flores's ~840k graph
nodes; the grid index brings that under 100ms.

Build for the browser:

```sh
cd engine
cargo test                                                        # native unit tests
cargo build --release --target wasm32-unknown-unknown --lib
cargo install wasm-bindgen-cli --version 0.2.127                  # match the wasm-bindgen crate version in Cargo.toml
wasm-bindgen --target web --out-dir ../web/pkg \
  target/wasm32-unknown-unknown/release/reach_ops_engine.wasm
```

Then serve the repo root (fetch() of local files needs an HTTP server,
not file://) and open `/web/index.html`:

```sh
uv run python -m http.server 8731
```

The page loads the wasm engine plus Flores's `roads.geojson`,
`hubs.geojson`, and `settlements.geojson`, computes reachability, and
lets you mark a road broken/restored and watch it recompute (~200-400ms
for the full Flores network after the initial hub/settlement snap).

## Dashboard (web/)

`web/` is a React + TypeScript + Vite operational dashboard built on the
same wasm engine, with MapLibre GL as the map and DuckDB-WASM for the
buildings/population layers. State (boot sequence, the wasm engine
instance, layer visibility, the active view, road selection) lives in a
single Zustand store (`web/src/store/useDashboardStore.ts`) so every panel
reads/writes the same source of truth — the coordinated-views hub the
Phase 3 interface plan calls for. Settlement/priority tables use
TanStack Table; UI primitives (`web/src/components/ui/`) are hand-rolled
Radix + CVA components in the shadcn idiom, styled from design tokens in
`web/src/index.css` rather than shadcn's default theme.

Run from the repo root:

```sh
cd web
npm install
npm run dev
```

Then open `http://localhost:8731/`. The Vite dev server serves `web/`
itself and proxies `/data/...` to the sibling `data/<study_area>/`
directory (see `serve-repo-data` in `web/vite.config.ts`) so it needs no
separate static server. For a production build, `npm run build` outputs
`web/dist/`; serving the repo root with any static file server (e.g.
`python -m http.server`) then works the same way, since `/data` and
`web/dist` are siblings and the app fetches data by absolute path.

Three coordinated views (nav rail, far left):

- **Overview** — KPI-forward situational picture (settlements cut off,
  population affected, roads broken, buildings surveyed) plus the same
  priority list, for a five-second read of the state of play.
- **Accessibility** — the interactive map: OSM road network coloured by
  isochrone band (travel time from the nearest of 9 placeholder aid hubs,
  time-weighted multi-source Dijkstra in the browser via wasm — see the
  Phase 4 notes in AGENTS.md), a **Cost** tab exposing every road class's
  assumed speed as an editable, engine-backed number (Apply recomputes
  live), the Spatial Intervention Loop sim panel (pick a road → mark
  broken → recompute → restore), and per-settlement building-count
  choropleth (DuckDB-WASM, 100% in-browser; the dashboard still works if
  DuckDB-WASM is blocked). A basemap switcher (top-right of the map) swaps
  between dark/light CARTO and Esri World Imagery satellite tiles — no API
  key for any of them. Has a fullscreen toggle that collapses all chrome
  to a minimal corner HUD.
- **Damage & Loss (DALA)** — a lightweight severity-proxy report page,
  explicitly not a full DaLA/PDNA assessment; see the Phase 3 notes in
  AGENTS.md for the scope decision and what each sector still needs.

The map itself (`web/src/lib/mapView.ts`, wrapped by
`web/src/components/MapCanvas.tsx`) mounts once and stays mounted across
view switches — switching views only toggles visibility, never remounts
MapLibre — which is what makes cross-view brush-linking (AGENTS.md, Phase
3) buildable later without a rearchitecture.

The dashboard needs the same static data files as Phase 1:
`data/flores/{roads,settlements,hubs,baseline,boundary}.geojson` plus
`buildings_by_settlement.parquet` and `population_by_settlement.parquet`
(all generated by `pipeline.run`). Data lives in `data/flores/` and is
not version controlled.

### Rebuilding the wasm (after engine changes)

```sh
cd engine
cargo build --release --target wasm32-unknown-unknown --lib
wasm-bindgen --target web --out-dir ../web/pkg \
  target/wasm32-unknown-unknown/release/reach_ops_engine.wasm
```
