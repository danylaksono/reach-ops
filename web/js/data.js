// Data loading + helpers for the Reach-Ops dashboard.
// Served from the repo root, so data lives under /data/flores/.

export const DATA_BASE = "/data/flores";

export async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

/** Load all static layers used by the dashboard. */
export async function loadAll() {
  const [roads, settlements, hubs, baseline, boundary, gik] = await Promise.all(
    [
      fetchJson(`${DATA_BASE}/roads.geojson`),
      fetchJson(`${DATA_BASE}/settlements.geojson`),
      fetchJson(`${DATA_BASE}/hubs.geojson`),
      fetchJson(`${DATA_BASE}/baseline.geojson`),
      fetchJson(`${DATA_BASE}/boundary.geojson`),
      // GIK field reports are optional — the dashboard must boot without
      // them (e.g. before pipeline.gik has been run).
      fetchJson(`${DATA_BASE}/gik_reports.geojson`).catch(() => null),
    ],
  );
  return { roads, settlements, hubs, baseline, boundary, gik };
}

/** Rough centroid for GeoJSON Polygon/MultiPolygon (vertex-average). */
export function centroidOf(feature) {
  const { type, coordinates } = feature.geometry;
  const ring =
    type === "Polygon"
      ? coordinates[0]
      : type === "MultiPolygon"
        ? coordinates[0][0]
        : (coordinates[0] ?? coordinates);
  // ring may be MultiPolygon first polygon's outer ring
  let sx = 0,
    sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  return [sx / ring.length, sy / ring.length];
}

/** Rough property accessor — GDAL exports empty strings, not null. */
export function prop(feature, key, fallback = "") {
  const v = feature?.properties?.[key];
  return v === undefined || v === null || v === "" ? fallback : v;
}

/** Human-readable distance. */
export function metersLabel(m) {
  if (m === null || m === undefined || Number.isNaN(m)) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** Format a number with thousands separators. */
export function fmt(n) {
  return Number(n).toLocaleString("en-US");
}
