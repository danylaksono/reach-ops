export type GeoJSON = {
  type: "FeatureCollection";
  features: GeoFeature[];
};

export type GeoFeature = {
  type: "Feature";
  id?: number | string;
  properties: Record<string, unknown> | null;
  geometry: {
    type: string;
    coordinates: unknown;
  };
};

/** A settlement snapped into the engine as a reachability target. */
export type Target = {
  id: string;
  name: string;
  kab_kota_name: string;
  code: string;
  lon: number;
  lat: number;
  population: number;
};

export type RoadPiece = {
  feature: number;
  coords: [number, number][];
  reachable: boolean;
  /** Travel time (seconds) to the far end of this piece — the isochrone
   *  banding value. `null` when unreachable. */
  duration_s: number | null;
};

export type RoadBreak = {
  id: string;
  lon: number;
  lat: number;
  osm_id: number;
};

export type RoadState = {
  reachable: number;
  broken: number;
  total: number;
};

export type SettlementResult = {
  id: string;
  /** Travel time from the nearest hub, in seconds — the primary isochrone
   *  metric. `null` when unreachable. */
  duration_s: number | null;
  /** Physical distance along that same fastest-by-time path. */
  distance_m: number | null;
};

/** Configurable travel-cost assumptions — speed (km/h) per OSM `highway`
 *  class, plus a fallback for unlisted classes. Mirrors the Rust
 *  `CostModel` shape (`engine/src/cost.rs`) field-for-field; always read
 *  the engine's own defaults via `ReachEngine.getCostModel()` rather than
 *  hardcoding a second copy here. */
export type CostProfile = {
  speedsKmh: Record<string, number>;
  defaultSpeedKmh: number;
};

/** Parsed `Engine.compute_state()` payload. */
export type ComputeState = {
  settlements: SettlementResult[];
  roads: RoadState[];
  pieces: RoadPiece[];
  breaks: RoadBreak[];
};

export type RoadStatus = "reachable" | "unreachable" | "broken";

/** A road selected on the map for the Spatial Intervention Loop sim panel. */
export type SelectedRoad = {
  id?: number | string;
  osm_id: number;
  highway?: string;
  name?: string;
  status: RoadStatus | string;
  lon?: number;
  lat?: number;
  pointBreakId?: string | null;
};

export type SettlementRow = Target & {
  duration_s: number | null;
  distance_m: number | null;
  reached: boolean;
  buildings: number;
};

export type LayerName =
  | "roads"
  | "buildings"
  | "settlements"
  | "hubs"
  | "breaks"
  | "gik";

export type ViewMode = "overview" | "accessibility" | "dala";

export type HudStats = {
  reachPct: number | null;
  popPct: number | null;
  brokenCount: number;
  recomputeMs: number | null;
};
