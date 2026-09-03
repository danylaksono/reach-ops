// An ALUR operation provider wrapping the Reach-Ops wasm engine.
//
// Lives here rather than in ALUR on purpose. ALUR ships no analytical
// calculation — its `src/providers/index.ts` is empty, and a reviewer can check
// that — so a road-accessibility engine belongs in the repository that owns the
// engine. This file is the whole distributable: plain ESM, no build step, loaded
// by URL at runtime alongside the `pkg/` directory wasm-bindgen produces.
//
// The contract it implements is documented in ALUR's `src/types/operations.ts`.
// Nothing here imports from ALUR: the interface is structural, which is what
// makes an open ecosystem possible in the first place. If the contract is ever
// published as a package, this file should take the types from it; until then
// the JSDoc below is the only coupling.

import init, { Engine } from "../web/pkg/reach_ops_engine.js";

/**
 * Speed assumptions the analyst can override, one number each.
 *
 * A duplicate of the Rust defaults in `engine/src/cost.rs`, and knowingly so:
 * the manifest has to be readable before an engine exists, so the *list of
 * classes* cannot come from `cost_model_json()`. The *values* still do — every
 * instance seeds itself from the engine at create time, so the numbers here are
 * only ever placeholder defaults for the form and can never drift into being a
 * second source of truth.
 */
const SPEED_CLASSES = [
  ["motorway", 70],
  ["trunk", 55],
  ["trunk_link", 35],
  ["primary", 45],
  ["primary_link", 30],
  ["secondary", 35],
  ["secondary_link", 25],
  ["tertiary", 28],
  ["tertiary_link", 20],
  ["unclassified", 20],
  ["residential", 20],
  ["living_street", 12],
  ["service", 15],
  ["track", 12],
  ["path", 5],
  ["footway", 5],
];

const manifest = {
  id: "reach-ops.accessibility",
  label: "Travel time from nearest hub",
  description:
    "Builds a routable graph from a line network and reports travel time from the nearest of a set of origin points, honouring recorded breaks and placements.",
  version: "0.1.0",

  inputs: [
    {
      id: "network",
      label: "Network",
      description: "Routable lines. Segments sharing exact coordinates are treated as connected.",
      geometry: "line",
      fields: [
        { id: "id", label: "Segment id", semanticType: "identifier", required: true },
        { id: "class", label: "Segment class", semanticType: "categorical", required: true,
          description: "Selects a speed from the settings below. Unlisted values take the fallback." },
        { id: "oneway", label: "One-way flag", semanticType: "categorical", required: false },
      ],
    },
    {
      id: "origins",
      label: "Origins",
      description:
        "Places travel is measured from; the nearest one wins. Areas are reduced to a representative point.",
      geometry: "any",
      fields: [],
    },
    {
      id: "destinations",
      label: "Destinations",
      description:
        "Places travel is measured to, one result row each. Areas are reduced to a representative point — a settlement is usually a boundary, not a dot.",
      geometry: "any",
      fields: [{ id: "id", label: "Destination id", semanticType: "identifier", required: true }],
    },
  ],

  parameters: [
    { id: "defaultSpeedKmh", label: "Fallback speed (km/h)", type: "number", defaultValue: 20 },
    ...SPEED_CLASSES.map(([name, speed]) => ({
      id: `speed.${name}`,
      label: `${name} (km/h)`,
      type: "number",
      defaultValue: speed,
    })),
  ],

  accepts: [
    {
      id: "sever",
      label: "Sever the network here",
      description: "Splits the segment under this point, so travel cannot pass it.",
      inputId: "network",
      referent: "point",
      parameters: [],
    },
    {
      id: "place-origin",
      label: "Place an origin",
      description: "Adds an origin at this point, alongside those already in the data.",
      inputId: "origins",
      referent: "point",
      parameters: [],
    },
  ],

  outputs: [
    {
      id: "reach",
      label: "Travel time per destination",
      kind: "join",
      joinInputId: "destinations",
      joinFieldRole: "id",
      fields: [
        { name: "duration_s", type: "DOUBLE" },
        { name: "distance_m", type: "DOUBLE" },
        { name: "reached", type: "BOOLEAN" },
      ],
    },
    {
      id: "network_state",
      label: "Network state",
      kind: "dataset",
      geometry: "line",
      fields: [
        { name: "duration_s", type: "DOUBLE" },
        { name: "reached", type: "BOOLEAN" },
        { name: "segment", type: "BIGINT" },
      ],
    },
  ],

  measure: {
    outputId: "reach",
    field: "duration_s",
    label: "Mean travel time",
    unit: "s",
    aggregation: "mean",
    preferredDirection: "lower",
  },
};

const parseCollection = (input, label) => {
  if (!input?.geojson) throw new Error(`${label} was not supplied as geometry.`);
  const collection = JSON.parse(input.geojson);
  if (!collection?.features) throw new Error(`${label} is not a feature collection.`);
  return collection;
};

const pointOf = (geometry) => {
  if (geometry?.type !== "Point") throw new Error("Expected a point.");
  return { lon: geometry.coordinates[0], lat: geometry.coordinates[1] };
};

/**
 * One coordinate standing for a feature, so an area can be an origin or a
 * destination.
 *
 * Real destination data is rarely points — a settlement arrives as a boundary,
 * and requiring the analyst to convert it first would make the calculation
 * unusable against the data it exists to answer questions about. A vertex
 * average, matching what the Reach-Ops dashboard already does: cheap, stable,
 * and good enough for a graph snap, which then finds the nearest network node
 * anyway. It is not an area-weighted centroid and is not meant to be.
 */
const representativePoint = (geometry) => {
  if (!geometry) return null;
  if (geometry.type === "Point") return geometry.coordinates.slice(0, 2);

  const positions = [];
  const walk = (value) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") positions.push(value);
    else for (const entry of value) walk(entry);
  };
  walk(geometry.coordinates);
  if (!positions.length) return null;

  const total = positions.reduce((sum, [lon, lat]) => [sum[0] + lon, sum[1] + lat], [0, 0]);
  return [total[0] / positions.length, total[1] / positions.length];
};

/**
 * Rename the analyst's columns to the property names the graph builder reads.
 *
 * The Rust side takes `osm_id`, `highway` and `oneway` off each feature by name,
 * so something has to bridge between those and whatever the analyst's data calls
 * them. Doing it here rather than in the engine keeps the engine honest about
 * its own input format and keeps ALUR free of any knowledge of it.
 */
const toEngineNetwork = (collection, fields) => ({
  type: "FeatureCollection",
  features: collection.features.map((feature, index) => {
    const properties = feature.properties ?? {};
    const rawId = properties[fields.id];
    const numericId = Number(rawId);
    return {
      ...feature,
      properties: {
        osm_id: Number.isFinite(numericId) ? numericId : index,
        highway: String(properties[fields.class] ?? ""),
        oneway: fields.oneway ? String(properties[fields.oneway] ?? "") : "",
      },
    };
  }),
});

const costProfileFrom = (values, seed) => {
  const speedsKmh = { ...seed.speedsKmh };
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith("speed.")) continue;
    const speed = Number(value);
    if (Number.isFinite(speed)) speedsKmh[key.slice("speed.".length)] = speed;
  }
  const fallback = Number(values.defaultSpeedKmh);
  return {
    speedsKmh,
    defaultSpeedKmh: Number.isFinite(fallback) ? fallback : seed.defaultSpeedKmh,
  };
};

class ReachOpsInstance {
  constructor(engine, baseOrigins, defaults) {
    this.engine = engine;
    this.baseOrigins = baseOrigins;
    this.defaults = defaults;
    this.warnings = [];
  }

  async setParameters(values) {
    this.engine.set_cost_model(JSON.stringify(costProfileFrom(values, this.defaults)));
  }

  /**
   * Rebuild the whole change state from the given list.
   *
   * Replayed rather than applied incrementally, because the contract says the
   * state equals exactly this list. The engine supports incremental edits and
   * diffing against the previous list would be faster, but a replay of a few
   * dozen severances costs a fraction of the Dijkstra that follows, and getting
   * undo provably right is worth more than that.
   */
  async setChanges(changes) {
    const ordered = [...changes].sort((a, b) => a.sequence - b.sequence);
    this.warnings = [];

    this.engine.reset_breaks();
    const placed = [];

    for (const change of ordered) {
      if (change.changeId === "sever") {
        const { lon, lat } = pointOf(change.target.geometry);
        try {
          this.engine.set_break(lon, lat);
        } catch (error) {
          // A severance nowhere near the network is a mistake worth reporting
          // rather than a reason to abandon every other change in the list.
          this.warnings.push(
            `No network within reach of the severance at ${lon.toFixed(4)}, ${lat.toFixed(4)} — it had no effect.`,
          );
        }
      } else if (change.changeId === "place-origin") {
        const { lon, lat } = pointOf(change.target.geometry);
        placed.push([lon, lat]);
      }
    }

    // `set_hubs` replaces the set outright, so placements are re-added to the
    // originals every time rather than accumulated onto the engine's state.
    this.engine.set_hubs(JSON.stringify([...this.baseOrigins, ...placed]));
  }

  async evaluate() {
    const state = JSON.parse(this.engine.compute_state());

    const rows = state.settlements.map((settlement) => ({
      key: settlement.id,
      duration_s: settlement.duration_s,
      distance_m: settlement.distance_m,
      reached: settlement.duration_s !== null,
    }));

    const features = state.pieces.map((piece) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: piece.coords },
      properties: {
        duration_s: piece.duration_s,
        reached: piece.reachable,
        segment: piece.feature,
      },
    }));

    return {
      outputs: {
        reach: { kind: "join", rows },
        network_state: { kind: "dataset", geojson: { type: "FeatureCollection", features } },
      },
      warnings: this.warnings.length ? [...this.warnings] : undefined,
    };
  }

  dispose() {
    this.engine.free?.();
    this.engine = null;
    this.baseOrigins = [];
  }
}

export const provider = {
  manifest,

  async create({ inputs, parameters }) {
    await init();

    const byId = Object.fromEntries(inputs.map((input) => [input.inputId, input]));
    const network = parseCollection(byId.network, "The network");
    const origins = parseCollection(byId.origins, "The origins");
    const destinations = parseCollection(byId.destinations, "The destinations");

    const engine = new Engine(JSON.stringify(toEngineNetwork(network, byId.network.fields)));

    const baseOrigins = origins.features
      .map((feature) => representativePoint(feature.geometry))
      .filter(Boolean);

    const destinationKey = byId.destinations.fields.id;
    const targets = destinations.features
      .map((feature) => ({
        id: String(feature.properties?.[destinationKey]),
        point: representativePoint(feature.geometry),
      }))
      .filter((target) => target.point)
      .map((target) => ({ id: target.id, lon: target.point[0], lat: target.point[1] }));

    if (!targets.length) throw new Error("No destination carried usable geometry.");
    engine.set_targets(JSON.stringify(targets));
    engine.set_hubs(JSON.stringify(baseOrigins));

    // Seed from the engine's own defaults so this file never becomes a second
    // copy of them, then apply whatever the analyst has already set.
    const defaults = JSON.parse(engine.cost_model_json());
    const instance = new ReachOpsInstance(engine, baseOrigins, defaults);
    if (parameters && Object.keys(parameters).length) await instance.setParameters(parameters);

    return instance;
  },
};

export default provider;
