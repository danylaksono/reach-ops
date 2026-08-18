// Reach-Ops dashboard entrypoint.
//
// Loads the static Phase 0 data, boots the wasm engine (snap hubs +
// settlements), spins up DuckDB-WASM for the buildings layer, builds the
// MapLibre map, and wires the Spatial Intervention Loop: pick a road →
// mark broken → recompute → watch settlement cutoff move on the map + list.

import { loadAll, centroidOf, fmt } from "./data.js";
import { ReachEngine } from "./engine.js";
import { MapView } from "./map.js";
import { UI } from "./ui.js";
import { settlementBuildingLayer } from "./duckdb.js";

const mapContainer = document.getElementById("map");
const ui = new UI();

// ------- shared state -------
const state = {
  engine: null,
  map: null,
  roads: null,
  settlements: null,
  hubs: null,
  baseline: null,
  targets: [],
  selectedRoad: null, // { osm_id, highway, name, status, ... }
  lastResult: null,
  buildingCountByCode: new Map(),
};

main().catch((err) => {
  ui.setStatus(`Boot failed: ${err.message}`);
  console.error(err);
});

async function main() {
  ui.setStatus("Loading data…");

  // 1. Static layers
  const { roads, settlements, hubs, baseline, boundary } = await loadAll();

  // 2. wasm engine
  ui.setStatus("Building graph (wasm)…");
  const targets = settlements.features.map((f) => {
    const [lon, lat] = centroidOf(f);
    const p = f.properties ?? {};
    return {
      id: p.code,
      name: p.name,
      kab_kota_name: p.kab_kota_name,
      code: p.code,
      lon,
      lat,
      population: Number(p.population ?? 0),
    };
  });

  const engine = await ReachEngine.create({
    roadsText: JSON.stringify(roads),
    hubs: hubs.features.map((f) => ({ coordinates: f.geometry.coordinates })),
    targets,
  });

  state.engine = engine;
  state.roads = roads;
  state.settlements = settlements;
  state.hubs = hubs;
  state.baseline = baseline;
  state.targets = targets;

  ui.setStatus(
    `Graph: ${fmt(engine.nodeCount())} nodes, ${fmt(engine.edgeCount())} edges — bootstrapping…`,
  );

  // 3. DuckDB-WASM buildings layer (non-fatal)
  let buildingsLayer = null;
  try {
    ui.setStatus("Querying buildings via DuckDB-WASM…");
    buildingsLayer = await settlementBuildingLayer(settlements);
    for (const f of buildingsLayer.features) {
      state.buildingCountByCode.set(
        String(f.properties.code),
        f.properties.building_count,
      );
    }
  } catch (e) {
    console.warn("Buildings layer unavailable:", e);
    ui.buildingsStatusEl.textContent =
      "Buildings layer unavailable — DuckDB-WASM failed to initialise.";
  }

  // 4. Map
  const map = new MapView({
    container: mapContainer,
    onRoadClick: (info) => onRoadSelected(info),
    onHover: onHoverRoad,
    onEmptyClick: () => clearRoadSelection(),
  });

  map.initLayers({
    roadsGeojson: roads,
    settlementsGeojson: settlements,
    hubsGeojson: hubs,
    buildingsLayer,
  });
  state.map = map;

  // 5. Controls
  ui.bindControls({
    onBreak: () => onBreakSelected(),
    onRestore: () => onRestoreSelected(),
    onReset: () => onResetAll(),
    onToggleVisibility,
    onSort: () => renderSettlements(),
  });

  ui.setOnFlyTo((r) => {
    map.map.flyTo({ center: [r.lon, r.lat], zoom: 11, duration: 800 });
  });

  // 6. First recompute + render
  ui.setStatus("Computing reachability…");
  recompute();

  // 7. Initial view
  if (boundary?.features?.[0]?.geometry?.coordinates) {
    map.fitFlores();
  }

  ui.setStatus("Ready");
  ui.resetBtn.disabled = false;
}

// ------- recompute loop -------

function recompute() {
  const t0 = performance.now();
  const result = state.engine.computeState();
  const ms = performance.now() - t0;
  state.lastResult = result;

  // Map road colouring — per-piece (a point break keeps the near side of a
  // long way green while the far side goes dark) + break markers.
  state.map?.updatePieces(result.pieces);
  state.map?.updateBreaks(result.breaks);

  // HUD
  ui.updateHud({
    reachPct: settlementStats(result),
    popPct: populationStats(result),
    brokenCount: state.engine.breakCount() + state.engine.broken.size,
    recomputeMs: ms,
  });

  // Settlement list
  renderSettlements();

  // Sync sim panel with computed status. A point break shows as broken even
  // though the feature state may still be "reachable" (the near side stays
  // usable) — prefer the active break over the whole-feature state.
  if (state.selectedRoad) {
    const osmId = state.selectedRoad.osm_id;
    const roadBreak = (result.breaks ?? []).find((b) => b.osm_id === osmId);
    if (roadBreak) {
      state.selectedRoad.pointBreakId = roadBreak.id;
      state.selectedRoad.status = "broken";
      ui.setSimSelected(state.selectedRoad);
    } else {
      const idx = state.roads.features.findIndex(
        (f) => f.properties?.osm_id === osmId,
      );
      const status = idx >= 0 ? statusFrom(result.roads[idx]) : null;
      if (status && status !== state.selectedRoad.status) {
        state.selectedRoad.status = status;
        ui.setSimSelected(state.selectedRoad);
      }
    }
  }

  ui.setStatus(
    `Recomputed in ${ms.toFixed(0)}ms · ${fmt(state.engine.featureCount())} road features`,
  );
}

function resultMap(result = state.lastResult) {
  if (!result) return null;
  return new Map(result.settlements.map((s) => [s.id, s.distance_m]));
}

function settlementStats(result) {
  const total = result.settlements.length;
  const reached = result.settlements.filter(
    (s) => s.distance_m !== null,
  ).length;
  return total ? Math.round((reached / total) * 100) : null;
}

function populationStats(result) {
  const byId = resultMap(result);
  let popTotal = 0;
  let popReached = 0;
  for (const t of state.targets) {
    popTotal += t.population;
    const d = byId.get(t.id);
    if (d !== undefined && d !== null) popReached += t.population;
  }
  return popTotal ? Math.round((popReached / popTotal) * 100) : null;
}

// ---------------- settlement list ----------------

function renderSettlements() {
  const byId = resultMap();
  if (!byId) return;
  const sort = ui.settleSortEl.value;

  const rows = state.targets
    .map((t) => {
      const d = byId.get(t.id);
      const reached = d !== undefined && d !== null;
      return {
        ...t,
        distance_m: d ?? null,
        reached,
        bld: state.buildingCountByCode.get(String(t.code)) ?? 0,
      };
    })
    .filter((r) => r.name && r.code);

  const sorters = {
    cutoff: (a, b) =>
      Number(a.reached) - Number(b.reached) ||
      (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity),
    need: (a, b) => b.population - a.population || sorters.cutoff(a, b),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  rows.sort(sorters[sort] ?? sorters.cutoff);

  ui.renderSettlements(rows.slice(0, 50));
}

// ---------------- sim panel / road selection ----------------

function statusFrom(roadState) {
  if (!roadState) return "unreachable";
  if (roadState.broken === roadState.total && roadState.total > 0)
    return "broken";
  return roadState.reachable > 0 ? "reachable" : "unreachable";
}

function onRoadSelected(info) {
  const idx = state.roads.features.findIndex(
    (f) => f.properties?.osm_id === info.osm_id,
  );
  const status =
    idx >= 0 ? statusFrom(state.lastResult?.roads?.[idx]) : info.status;
  // Resolve an active point break on this road (if any), so restoring works
  // even after re-selecting the same road.
  const roadBreak = state.lastResult?.breaks?.find(
    (b) => b.osm_id === info.osm_id,
  );
  state.selectedRoad = {
    ...info,
    status,
    pointBreakId: roadBreak?.id,
  };
  ui.setSimSelected(state.selectedRoad);
}

function clearRoadSelection() {
  state.selectedRoad = null;
  state.map?.clearSelection();
  ui.setSimSelected(null);
}

function onBreakSelected() {
  const road = state.selectedRoad;
  if (!road?.osm_id) return;
  try {
    const breakId = state.engine.breakAt(road.lon, road.lat);
    road.pointBreakId = breakId;
    road.status = "broken";
    ui.setSimSelected(road);
    ui.setStatus(`Marked OSM ${road.osm_id} broken at the clicked point.`);
    recompute();
  } catch (e) {
    ui.setStatus(`Break failed: ${e.message}`);
  }
}

function onRestoreSelected() {
  const road = state.selectedRoad;
  if (!road?.osm_id) return;
  let restored = false;
  if (road.pointBreakId) {
    restored = state.engine.restoreBreak(road.pointBreakId);
    if (restored) road.pointBreakId = null;
  } else {
    restored = state.engine.restoreRoad(road.osm_id) > 0;
  }
  if (restored) {
    road.status = "reachable";
    ui.setSimSelected(road);
    ui.setStatus(`Restored OSM ${road.osm_id}.`);
    recompute();
  }
}

function onResetAll() {
  state.engine.reset();
  clearRoadSelection();
  recompute();
}

function onToggleVisibility(name, visible) {
  if (!state.map) return;
  switch (name) {
    case "roads":
      state.map.setRoadsVisible(visible);
      break;
    case "buildings":
      state.map.setLayerVisibility("buildings", visible);
      break;
    case "settlements":
      state.map.setLayerVisibility("settlements", visible);
      state.map.setLayerVisibility("settle-labels", visible);
      break;
    case "hubs":
      state.map.setLayerVisibility("hubs", visible);
      state.map.setLayerVisibility("hub-labels", visible);
      break;
    case "break":
      state.map?.setBreakVisible(visible);
      break;
  }
}

// ---------------- tooltip ----------------

function onHoverRoad(feature, e) {
  if (!feature || !e) {
    ui.showTooltip(null);
    return;
  }
  const p = feature.properties ?? {};
  const html = `<div class="tt-title">${p.name || "Unnamed road"}</div>
    <div class="tt-sub">${p.highway || "unknown"} · OS ID ${p.osm_id}</div>`;
  ui.showTooltip(html, e.point.x, e.point.y, mapContainer);
}

// Fly-to from the settlement list is registered in main() via
// ui.setOnFlyTo — no additional handler needed here.
