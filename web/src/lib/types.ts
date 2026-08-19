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
  distance_m: number | null;
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
