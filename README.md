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
