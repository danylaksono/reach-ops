// Drives the ALUR provider the way ALUR's worker host would, against the real
// Flores data and the real wasm. Run it after rebuilding the engine:
//
//   node alur-provider/verify.mjs
//
// Not a unit test — reach-ops has no JS test runner — but it exercises the whole
// contract end to end, which is the part worth checking: manifest shape, column
// renaming, the create/setChanges/evaluate lifecycle, both output kinds, and
// that replaying a change list lands where it did before.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const data = (name) => readFileSync(join(here, "..", "data", "flores", name), "utf8");

// wasm-bindgen's web target fetches its own .wasm by URL, which node cannot do
// for a file path. Initialising it here with bytes first means the provider's
// own `await init()` returns the already-loaded module untouched.
const init = (await import("../web/pkg/reach_ops_engine.js")).default;
await init(readFileSync(join(here, "..", "web", "pkg", "reach_ops_engine_bg.wasm")));

const { provider } = await import("./index.js");

const inputs = [
  { inputId: "network", fields: { id: "osm_id", class: "highway", oneway: "oneway" }, geojson: data("roads.geojson") },
  { inputId: "origins", fields: {}, geojson: data("hubs.geojson") },
  { inputId: "destinations", fields: { id: "code" }, geojson: data("settlements.geojson") },
];

const reachedCount = (result) => result.outputs.reach.rows.filter((row) => row.reached).length;
const meanDuration = (result) => {
  const values = result.outputs.reach.rows.map((row) => row.duration_s).filter((value) => value !== null);
  return values.reduce((total, value) => total + value, 0) / values.length;
};

const check = (label, condition) => {
  console.log(`${condition ? "ok  " : "FAIL"}  ${label}`);
  if (!condition) process.exitCode = 1;
};

console.log("building engine from the Flores network…");
const started = Date.now();
const instance = await provider.create({ inputs, parameters: {} });
console.log(`built in ${Date.now() - started}ms\n`);

await instance.setChanges([]);
const baseline = await instance.evaluate();
console.log(`baseline: ${reachedCount(baseline)} of ${baseline.outputs.reach.rows.length} destinations reached, ` +
  `mean ${Math.round(meanDuration(baseline))}s, ${baseline.outputs.network_state.geojson.features.length} pieces`);

check("every destination has a row", baseline.outputs.reach.rows.length > 1000);
check("the join output is keyed", baseline.outputs.reach.rows.every((row) => typeof row.key === "string"));
check("the network state carries geometry", baseline.outputs.network_state.geojson.features[0].geometry.type === "LineString");
check("the measure field is populated", baseline.outputs.reach.rows.some((row) => typeof row.duration_s === "number"));

// Both changes are located from the data rather than guessed. A first pass used
// hand-picked coordinates and moved the numbers by a second, which proved only
// that nothing crashed.

// Sever a road that actually carries traffic: the *longest* trunk or primary
// way. Taking the first one in file order used to pass, but only by luck —
// nothing makes feature order meaningful, and when the network moved to
// Overture (which splits ways into ~2 segments each, and whose output is
// ordered by GERS id) the first arterial in the file became a stub that
// carries no shortest path, so severing it moved nothing. Length is a
// source-independent proxy for "this road matters".
//
// Aggregate by osm_id first: a severance breaks every segment sharing that
// id, so the way, not the segment, is the unit being removed.
const network = JSON.parse(data("roads.geojson"));
const ways = new Map();
for (const feature of network.features) {
  if (!["trunk", "primary"].includes(feature.properties?.highway)) continue;
  const line = feature.geometry?.coordinates;
  if (!(line?.length > 2)) continue;
  let length = 0;
  for (let i = 1; i < line.length; i++) {
    length += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  }
  const way = ways.get(feature.properties.osm_id) ?? { total: 0, longest: 0, midpoint: null };
  way.total += length;
  if (length > way.longest) {
    way.longest = length;
    way.midpoint = line[Math.floor(line.length / 2)];
  }
  ways.set(feature.properties.osm_id, way);
}
const arterial = [...ways.values()].sort((a, b) => b.total - a.total)[0];
if (!arterial) throw new Error("no arterial road found to sever");
const severPoint = arterial.midpoint;

// Place an origin at the worst-served destination, where it must do the most good.
const settlements = JSON.parse(data("settlements.geojson"));
const centroids = new Map(settlements.features.map((feature) => {
  const positions = [];
  const walk = (value) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") positions.push(value);
    else for (const entry of value) walk(entry);
  };
  walk(feature.geometry.coordinates);
  const total = positions.reduce((sum, [lon, lat]) => [sum[0] + lon, sum[1] + lat], [0, 0]);
  return [String(feature.properties.code), [total[0] / positions.length, total[1] / positions.length]];
}));

const worst = baseline.outputs.reach.rows
  .filter((row) => row.duration_s !== null)
  .sort((a, b) => b.duration_s - a.duration_s)[0];
const placePoint = centroids.get(worst.key);
console.log(`\nsevering an arterial at ${severPoint.map((v) => v.toFixed(4)).join(", ")}`);
console.log(`placing an origin at the worst-served destination (${worst.key}, ${Math.round(worst.duration_s)}s)`);

const sever = {
  id: "op-1", changeId: "sever", sequence: 0,
  target: { kind: "geometry", geometry: { type: "Point", coordinates: severPoint } },
  values: {},
};
const place = {
  id: "op-2", changeId: "place-origin", sequence: 1,
  target: { kind: "geometry", geometry: { type: "Point", coordinates: placePoint } },
  values: {},
};

await instance.setChanges([sever]);
const severed = await instance.evaluate();
console.log(`\nafter one severance: ${reachedCount(severed)} reached, mean ${Math.round(meanDuration(severed))}s`);
for (const warning of severed.warnings ?? []) console.log(`  warning: ${warning}`);
check("severing an arterial changes the result",
  meanDuration(severed) !== meanDuration(baseline) || reachedCount(severed) !== reachedCount(baseline));
check("a severance on a real road reports no warning", !severed.warnings);

await instance.setChanges([sever, place]);
const withOrigin = await instance.evaluate();
console.log(`after placing an origin: ${reachedCount(withOrigin)} reached, mean ${Math.round(meanDuration(withOrigin))}s`);
check("placing an origin at the worst-served place lowers mean travel time", meanDuration(withOrigin) < meanDuration(severed));

// The property the contract rests on: state is a function of the list, so
// going back to an earlier list must reproduce it exactly.
await instance.setChanges([]);
const replayed = await instance.evaluate();
check("replaying the empty list reproduces the baseline exactly",
  JSON.stringify(replayed.outputs.reach.rows) === JSON.stringify(baseline.outputs.reach.rows));

await instance.setChanges([sever]);
const replayedSevered = await instance.evaluate();
check("replaying a severance reproduces its result exactly",
  JSON.stringify(replayedSevered.outputs.reach.rows) === JSON.stringify(severed.outputs.reach.rows));

// Settings are a separate channel and must not disturb recorded changes.
await instance.setParameters({ defaultSpeedKmh: 5, "speed.primary": 5, "speed.secondary": 5 });
const slowed = await instance.evaluate();
check("lowering speeds raises travel time", meanDuration(slowed) > meanDuration(replayedSevered));
check("lowering speeds does not change what is reachable", reachedCount(slowed) === reachedCount(replayedSevered));

instance.dispose();
console.log(process.exitCode ? "\nsomething failed" : "\nall checks passed");
