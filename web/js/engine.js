// Thin wrapper around the compiled Reach-Ops wasm engine (petgraph Dijkstra
// + spatial index). Handles wasm init, hub/target snapping, road
// break/restore, and the one-shot compute_state used for map + HUD updates.

import init, { Engine } from "../pkg/reach_ops_engine.js";

export class ReachEngine {
  /** Build + config the engine from raw GeoJSON text. */
  static async create({ roadsText, hubs, targets }) {
    await init();
    const engine = new ReachEngine();
    engine._engine = new Engine(roadsText);
    engine._engine.set_hubs(JSON.stringify(hubs.map((h) => h.coordinates)));
    engine._engine.set_targets(
      JSON.stringify(
        targets.map((t) => ({ id: t.id, lon: t.lon, lat: t.lat })),
      ),
    );
    return engine;
  }

  constructor() {
    /** Map of broken osm_id -> true, for the reset button. */
    this.broken = new Set();
  }

  nodeCount() {
    return this._engine.node_count();
  }
  edgeCount() {
    return this._engine.edge_count();
  }
  featureCount() {
    return this._engine.feature_count();
  }

  /** Mark a road (OSM way) broken. Returns number of affected edges. */
  breakRoad(osmId) {
    const n = this._engine.set_edge_status(osmId, false);
    if (n > 0) this.broken.add(osmId);
    return n;
  }

  /** Restore a road. Returns number of affected edges. */
  restoreRoad(osmId) {
    const n = this._engine.set_edge_status(osmId, true);
    if (n > 0) this.broken.delete(osmId);
    return n;
  }

  /** Restore every broken road. */
  reset() {
    for (const id of [...this.broken]) this._engine.set_edge_status(id, true);
    this.broken.clear();
  }

  /** Full recompute: settlement distances + per-feature road state. */
  computeState() {
    return JSON.parse(this._engine.compute_state());
  }
}
