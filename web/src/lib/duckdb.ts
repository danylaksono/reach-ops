// DuckDB-WASM buildings layer.
//
// Queries the Phase 0 buildings aggregation (buildings_by_settlement.parquet)
// through DuckDB-WASM and joins it onto settlement polygons so the dashboard
// can show building density per settlement as a choropleth. The query runs
// 100% in the browser — no server involved (a static file server is still
// required to serve data/).
//
// Falls back gracefully: if DuckDB-WASM fails to load (CDN blocked, wasm
// unsupported), the dashboard continues without the buildings layer.

import * as duckdb from "@duckdb/duckdb-wasm";
import type { AsyncDuckDB } from "@duckdb/duckdb-wasm";
import { DATA_BASE } from "./data";
import type { GeoJSON } from "./types";

// DuckDB-WASM's read_parquet() only recognises a remote file when the path
// carries an explicit scheme (http://...) — a root-relative path like
// "/data/..." resolves against its own in-browser virtual filesystem
// instead and fails with "No files found that match the pattern". Resolve
// against the page origin so it's unambiguous. DATA_BASE is already
// base-path-aware (see data.ts) so this works unmodified under a GitHub
// Pages project-page subpath too.
function dataUrl(path: string) {
  return new URL(path, window.location.origin).href;
}

const BUILDINGS_PARQUET = dataUrl(`${DATA_BASE}/buildings_by_settlement.parquet`);
const POPULATION_PARQUET = dataUrl(`${DATA_BASE}/population_by_settlement.parquet`);

let _dbPromise: Promise<{ db: AsyncDuckDB }> | null = null;

async function getDb(): Promise<{ db: AsyncDuckDB }> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = (async () => {
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], {
        type: "text/javascript",
      }),
    );
    const worker = new Worker(workerUrl);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);
    return { db };
  })();
  return _dbPromise;
}

/** Count of settlements and total buildings from the parquet (sanity). */
export async function buildingTotals() {
  const { db } = await getDb();
  const conn = await db.connect();
  try {
    const res = await conn.query(
      `SELECT COUNT(*) AS n_settlements, SUM(building_count) AS n_buildings
       FROM read_parquet('${BUILDINGS_PARQUET}')`,
    );
    const row = res.toArray()[0];
    return {
      nSettlements: Number(row.n_settlements),
      nBuildings: Number(row.n_buildings),
    };
  } finally {
    await conn.close();
  }
}

/**
 * Builds a per-settlement building choropleth layer as GeoJSON.
 * Joins the parquet building counts onto settlement polygons by
 * settlement_code. Returns a FeatureCollection.
 */
export async function settlementBuildingLayer(settlementsGeojson: GeoJSON): Promise<GeoJSON> {
  const { db } = await getDb();
  const conn = await db.connect();
  try {
    const res = await conn.query(
      `SELECT settlement_code, building_count FROM read_parquet('${BUILDINGS_PARQUET}')`,
    );
    const counts = new Map<string, number>();
    for (const r of res.toArray()) {
      counts.set(String(r.settlement_code), Number(r.building_count));
    }
    const features = [];
    for (const f of settlementsGeojson.features) {
      const code = f.properties?.code as string | number | undefined;
      if (code === undefined || code === null) continue;
      features.push({
        type: "Feature" as const,
        properties: {
          code,
          name: f.properties?.name ?? "",
          kab_kota_name: f.properties?.kab_kota_name ?? "",
          building_count: counts.get(String(code)) ?? 0,
        },
        geometry: f.geometry,
      });
    }
    return { type: "FeatureCollection", features };
  } finally {
    await conn.close();
  }
}

/**
 * Per-settlement population, keyed by settlement code — settlements.geojson
 * itself carries no population field (that's a Kontur-derived join baked
 * into population_by_settlement.parquet in Phase 0), so this is the source
 * for every population-based KPI and priority-list ranking.
 */
export async function settlementPopulationByCode(): Promise<Map<string, number>> {
  const { db } = await getDb();
  const conn = await db.connect();
  try {
    const res = await conn.query(
      `SELECT settlement_code, population FROM read_parquet('${POPULATION_PARQUET}')`,
    );
    const byCode = new Map<string, number>();
    for (const r of res.toArray()) {
      byCode.set(String(r.settlement_code), Number(r.population));
    }
    return byCode;
  } finally {
    await conn.close();
  }
}
