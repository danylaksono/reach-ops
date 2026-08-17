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
`population_by_settlement.parquet`, and `baseline.geojson` (the joined
damage-and-loss baseline consumed by later phases). Study areas are
defined in `pipeline/config.py` — currently just `flores` (nine
regencies); add an `ntt` entry there if/when scope expands to the full
province.
