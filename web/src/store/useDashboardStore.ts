// Central state for the Reach-Ops dashboard: boot sequence, the wasm engine
// instance, the last computed reachability state, map layer visibility, the
// active view, and the Spatial Intervention Loop road selection. MapCanvas
// subscribes to this and drives MapLibre imperatively; every other panel
// just reads/writes it — this is the coordinated-views hub the interface
// plan in AGENTS.md calls for (brush-linking hangs off the same selection
// state once more views read it).

import { create } from "zustand";
import { loadAll, centroidOf } from "../lib/data";
import { ReachEngine } from "../lib/engine";
import { settlementBuildingLayer, settlementPopulationByCode } from "../lib/duckdb";
import type { BasemapId } from "../lib/mapView";
import type {
  ComputeState,
  CostProfile,
  GeoJSON,
  LayerName,
  SelectedRoad,
  Target,
  ViewMode,
} from "../lib/types";

type SettleSort = "cutoff" | "need" | "name";

type BootPhase = "idle" | "loading" | "graph" | "buildings" | "ready" | "error";

type DashboardState = {
  phase: BootPhase;
  statusText: string;
  errorMessage: string | null;

  roads: GeoJSON | null;
  settlements: GeoJSON | null;
  hubs: GeoJSON | null;
  boundary: GeoJSON | null;
  gik: GeoJSON | null;

  targets: Target[];
  engine: ReachEngine | null;
  lastResult: ComputeState | null;
  recomputeMs: number | null;
  roadIndexByOsmId: Map<number, number>;

  buildingsLayer: GeoJSON | null;
  buildingCountByCode: Map<string, number>;
  buildingsStatus: string;
  gikStatus: string;

  view: ViewMode;
  fullscreen: boolean;
  basemap: BasemapId;
  layerVisibility: Record<LayerName, boolean>;
  settleSort: SettleSort;
  selectedRoad: SelectedRoad | null;

  /** Editable travel-cost assumptions — seeded from the engine's own
   *  defaults at boot (`ReachEngine.getCostModel()`), not duplicated here.
   *  Edits are local until `applyCostProfile()` pushes them to the engine
   *  and recomputes; `costProfileDirty` tracks whether that's pending. */
  costProfile: CostProfile | null;
  costProfileDirty: boolean;

  boot: () => Promise<void>;
  recompute: () => void;
  selectRoad: (info: {
    id?: number | string;
    osm_id: number;
    highway?: string;
    name?: string;
    status: string;
    lon?: number;
    lat?: number;
  }) => void;
  clearSelection: () => void;
  breakSelected: () => void;
  restoreSelected: () => void;
  resetAll: () => void;
  setLayerVisible: (name: LayerName, visible: boolean) => void;
  setView: (v: ViewMode) => void;
  setFullscreen: (v: boolean) => void;
  setBasemap: (id: BasemapId) => void;
  setSettleSort: (v: SettleSort) => void;
  setCostSpeed: (highwayClass: string, kmh: number) => void;
  setCostDefaultSpeed: (kmh: number) => void;
  applyCostProfile: () => void;
  resetCostProfile: () => void;
};

function statusFromRoadState(roadState: ComputeState["roads"][number] | undefined) {
  if (!roadState) return "unreachable";
  if (roadState.broken === roadState.total && roadState.total > 0) return "broken";
  return roadState.reachable > 0 ? "reachable" : "unreachable";
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  phase: "idle",
  statusText: "Bootstrapping…",
  errorMessage: null,

  roads: null,
  settlements: null,
  hubs: null,
  boundary: null,
  gik: null,

  targets: [],
  engine: null,
  lastResult: null,
  recomputeMs: null,
  roadIndexByOsmId: new Map(),

  buildingsLayer: null,
  buildingCountByCode: new Map(),
  buildingsStatus: "Querying buildings via DuckDB-WASM…",
  gikStatus: "Loading…",

  view: "accessibility",
  fullscreen: false,
  basemap: "dark",
  layerVisibility: {
    roads: true,
    buildings: false,
    settlements: true,
    hubs: true,
    breaks: true,
    gik: true,
  },
  settleSort: "cutoff",
  selectedRoad: null,

  costProfile: null,
  costProfileDirty: false,

  async boot() {
    // Guard against a second concurrent boot — React 18 StrictMode
    // double-invokes mount effects in dev, and re-running this would build
    // a second wasm Engine while the first's finalizer can still tear down
    // shared wasm memory out from under it (crashes as an "unreachable"
    // wasm trap on next use, not a catchable JS error).
    if (get().phase !== "idle") return;
    set({ phase: "loading", statusText: "Loading data…" });
    const { roads, settlements, hubs, baseline: _baseline, boundary, gik } =
      await loadAll();

    const targets: Target[] = settlements.features.map((f) => {
      const [lon, lat] = centroidOf(f);
      const p = f.properties ?? {};
      return {
        id: String(p.code ?? ""),
        name: String(p.name ?? ""),
        kab_kota_name: String(p.kab_kota_name ?? ""),
        code: String(p.code ?? ""),
        lon,
        lat,
        population: Number(p.population ?? 0),
      };
    });

    const roadIndexByOsmId = new Map<number, number>();
    roads.features.forEach((f, idx) => {
      const osmId = f.properties?.osm_id;
      if (typeof osmId === "number") roadIndexByOsmId.set(osmId, idx);
    });

    set({ phase: "graph", statusText: "Building graph (wasm)…" });
    const engine = await ReachEngine.create({
      roadsText: JSON.stringify(roads),
      hubs: hubs.features.map((f) => ({
        coordinates: f.geometry.coordinates as [number, number],
      })),
      targets,
    });

    set({
      roads,
      settlements,
      hubs,
      boundary,
      gik,
      targets,
      engine,
      roadIndexByOsmId,
      costProfile: engine.getCostModel(),
      gikStatus: gik?.features?.length
        ? `${gik.features.length.toLocaleString("en-US")} reports in study area`
        : "No GIK snapshot found — run `python -m pipeline.gik` to fetch.",
      statusText: `Graph: ${engine.nodeCount().toLocaleString("en-US")} nodes, ${engine
        .edgeCount()
        .toLocaleString("en-US")} edges — bootstrapping…`,
    });

    set({ phase: "buildings", statusText: "Querying buildings + population via DuckDB-WASM…" });
    try {
      const [buildingsLayer, populationByCode] = await Promise.all([
        settlementBuildingLayer(settlements),
        settlementPopulationByCode(),
      ]);
      const buildingCountByCode = new Map<string, number>();
      for (const f of buildingsLayer.features) {
        buildingCountByCode.set(
          String(f.properties?.code),
          Number(f.properties?.building_count ?? 0),
        );
      }
      // settlements.geojson carries no population field — patch it in from
      // the parquet join now that it's available.
      const patchedTargets = get().targets.map((t) => ({
        ...t,
        population: populationByCode.get(t.code) ?? t.population,
      }));
      set({ buildingsLayer, buildingCountByCode, targets: patchedTargets, buildingsStatus: "Ready." });
    } catch (e) {
      console.warn("Buildings/population layer unavailable:", e);
      set({ buildingsStatus: "Buildings/population layer unavailable — DuckDB-WASM failed to initialise." });
    }

    get().recompute();
    set({ phase: "ready", statusText: "Ready" });
  },

  recompute() {
    const { engine, roads, roadIndexByOsmId, selectedRoad } = get();
    if (!engine) return;
    const t0 = performance.now();
    const result = engine.computeState();
    const ms = performance.now() - t0;

    let nextSelected = selectedRoad;
    if (selectedRoad) {
      const roadBreak = result.breaks.find((b) => b.osm_id === selectedRoad.osm_id);
      if (roadBreak) {
        nextSelected = { ...selectedRoad, pointBreakId: roadBreak.id, status: "broken" };
      } else {
        const idx = roadIndexByOsmId.get(selectedRoad.osm_id);
        const status = idx !== undefined ? statusFromRoadState(result.roads[idx]) : null;
        if (status && status !== selectedRoad.status) {
          nextSelected = { ...selectedRoad, status };
        }
      }
    }

    set({
      lastResult: result,
      recomputeMs: ms,
      selectedRoad: nextSelected,
      statusText: `Recomputed in ${ms.toFixed(0)}ms · ${(roads?.features.length ?? 0).toLocaleString("en-US")} road features`,
    });
  },

  selectRoad(info) {
    const { roadIndexByOsmId, lastResult } = get();
    const idx = roadIndexByOsmId.get(info.osm_id);
    const status = idx !== undefined ? statusFromRoadState(lastResult?.roads[idx]) : info.status;
    const roadBreak = lastResult?.breaks.find((b) => b.osm_id === info.osm_id);
    set({
      selectedRoad: {
        ...info,
        status,
        pointBreakId: roadBreak?.id ?? null,
      },
    });
  },

  clearSelection() {
    set({ selectedRoad: null });
  },

  breakSelected() {
    const { engine, selectedRoad } = get();
    if (!engine || !selectedRoad?.osm_id || selectedRoad.lon === undefined || selectedRoad.lat === undefined) return;
    try {
      const breakId = engine.breakAt(selectedRoad.lon, selectedRoad.lat);
      set({
        selectedRoad: { ...selectedRoad, pointBreakId: breakId, status: "broken" },
        statusText: `Marked OSM ${selectedRoad.osm_id} broken at the clicked point.`,
      });
      get().recompute();
    } catch (e) {
      set({ statusText: `Break failed: ${(e as Error).message}` });
    }
  },

  restoreSelected() {
    const { engine, selectedRoad } = get();
    if (!engine || !selectedRoad?.osm_id) return;
    let restored = false;
    if (selectedRoad.pointBreakId) {
      restored = engine.restoreBreak(selectedRoad.pointBreakId);
      if (restored) selectedRoad.pointBreakId = null;
    } else {
      restored = engine.restoreRoad(selectedRoad.osm_id) > 0;
    }
    if (restored) {
      set({
        selectedRoad: { ...selectedRoad, status: "reachable" },
        statusText: `Restored OSM ${selectedRoad.osm_id}.`,
      });
      get().recompute();
    }
  },

  resetAll() {
    const { engine } = get();
    engine?.reset();
    set({ selectedRoad: null });
    get().recompute();
  },

  setLayerVisible(name, visible) {
    set((s) => ({ layerVisibility: { ...s.layerVisibility, [name]: visible } }));
  },

  setView(v) {
    set({ view: v });
  },

  setFullscreen(v) {
    set({ fullscreen: v });
  },

  setBasemap(id) {
    set({ basemap: id });
  },

  setSettleSort(v) {
    set({ settleSort: v });
  },

  setCostSpeed(highwayClass, kmh) {
    set((s) =>
      s.costProfile
        ? {
            costProfile: { ...s.costProfile, speedsKmh: { ...s.costProfile.speedsKmh, [highwayClass]: kmh } },
            costProfileDirty: true,
          }
        : {},
    );
  },

  setCostDefaultSpeed(kmh) {
    set((s) =>
      s.costProfile
        ? { costProfile: { ...s.costProfile, defaultSpeedKmh: kmh }, costProfileDirty: true }
        : {},
    );
  },

  applyCostProfile() {
    const { engine, costProfile } = get();
    if (!engine || !costProfile) return;
    engine.setCostModel(costProfile);
    set({ costProfileDirty: false, statusText: "Recomputing with updated cost model…" });
    get().recompute();
  },

  resetCostProfile() {
    const { engine } = get();
    if (!engine) return;
    // The engine's own model is untouched by editing `costProfile` locally
    // (nothing is pushed until applyCostProfile()), so re-reading it here
    // discards local edits back to whatever's actually active.
    set({ costProfile: engine.getCostModel(), costProfileDirty: false });
  },
}));
