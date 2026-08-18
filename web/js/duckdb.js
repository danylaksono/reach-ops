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

const PARQUET = "/data/flores/buildings_by_settlement.parquet";

let _dbPromise = null;

/**
 * Returns a Promise<{ db }> — lazily initialised DuckDB-WASM instance.
 */
async function getDb() {
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
       FROM read_parquet('${PARQUET}')`,
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
export async function settlementBuildingLayer(settlementsGeojson) {
  const { db } = await getDb();
  const conn = await db.connect();
  try {
    const res = await conn.query(
      `SELECT settlement_code, building_count FROM read_parquet('${PARQUET}')`,
    );
    const counts = new Map();
    for (const r of res.toArray()) {
      counts.set(String(r.settlement_code), Number(r.building_count));
    }
    const features = [];
    for (const f of settlementsGeojson.features) {
      const code = f.properties?.code;
      if (code === undefined || code === null) continue;
      features.push({
        type: "Feature",
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
