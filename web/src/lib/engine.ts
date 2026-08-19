// Thin wrapper around the compiled Reach-Ops wasm engine (petgraph Dijkstra
// + spatial index). Handles wasm init, hub/target snapping, point-based
// road breaks (split-at-break-point), whole-way breaks (legacy), and the
// one-shot compute_state used for map + HUD updates.

import init, { Engine } from "../../pkg/reach_ops_engine.js";
import type { ComputeState, Target } from "./types";

export type HubPoint = { coordinates: [number, number] };

export class ReachEngine {
  private _engine!: Engine;
  /** OSM ids broken via the whole-way (legacy) API. */
  broken = new Set<number>();
  /** point break id -> { osm_id, lon, lat } */
  pointBreaks = new Map<string, { lon: number; lat: number }>();

  /** Build + config the engine from raw GeoJSON text. */
  static async create({
    roadsText,
    hubs,
    targets,
  }: {
    roadsText: string;
    hubs: HubPoint[];
    targets: Target[];
  }): Promise<ReachEngine> {
    await init();
    const engine = new ReachEngine();
    engine._engine = new Engine(roadsText);
    engine._engine.set_hubs(JSON.stringify(hubs.map((h) => h.coordinates)));
    engine._engine.set_targets(
      JSON.stringify(targets.map((t) => ({ id: t.id, lon: t.lon, lat: t.lat }))),
    );
    return engine;
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

  /** Break the road under a *point* (split-at-break-point). Returns the
   *  break id, or throws if no road is near the point. */
  breakAt(lon: number, lat: number): string {
    const id = this._engine.set_break(lon, lat);
    this.pointBreaks.set(id, { lon, lat });
    return id;
  }

  /** Restore a point break by id. Returns true if it existed. */
  restoreBreak(id: string): boolean {
    if (this._engine.restore_break(id)) {
      this.pointBreaks.delete(id);
      return true;
    }
    return false;
  }

  /** Number of active point breaks. */
  breakCount(): number {
    return this._engine.break_count();
  }

  /** Mark a road (OSM way) broken — whole-way, legacy API. Returns number
   *  of affected edges. Prefer breakAt() for point breaks. */
  breakRoad(osmId: number): number {
    const n = this._engine.set_edge_status(osmId, false);
    if (n > 0) this.broken.add(osmId);
    return n;
  }

  /** Restore a whole road. Returns number of affected edges. */
  restoreRoad(osmId: number): number {
    const n = this._engine.set_edge_status(osmId, true);
    if (n > 0) this.broken.delete(osmId);
    return n;
  }

  /** Restore every broken road + point break. */
  reset() {
    for (const id of [...this.broken]) this._engine.set_edge_status(id, true);
    this.broken.clear();
    this._engine.reset_breaks();
    this.pointBreaks.clear();
  }

  /** Full recompute: settlement distances + per-feature road state + render
   *  pieces + point break markers. */
  computeState(): ComputeState {
    return JSON.parse(this._engine.compute_state());
  }
}
