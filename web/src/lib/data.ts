// Data loading for the Reach-Ops dashboard. In dev, vite.config.ts's
// serve-repo-data middleware serves /data straight from the repo root; in
// a build, scripts/copy-data.mjs copies it into web/public/data so it
// ships inside dist/. Both are rooted at import.meta.env.BASE_URL (Vite's
// configured `base`, "/" locally, "/<repo-name>/" on GitHub Pages) so the
// same code works unmodified at either path.
import type { GeoFeature, GeoJSON } from "./types";

export const DATA_BASE = `${import.meta.env.BASE_URL}data/flores`;

export async function fetchJson<T = GeoJSON>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

export type StaticLayers = {
  roads: GeoJSON;
  settlements: GeoJSON;
  hubs: GeoJSON;
  baseline: GeoJSON;
  boundary: GeoJSON;
  gik: GeoJSON | null;
};

/** Load all static layers used by the dashboard. */
export async function loadAll(): Promise<StaticLayers> {
  const [roads, settlements, hubs, baseline, boundary, gik] = await Promise.all([
    fetchJson(`${DATA_BASE}/roads.geojson`),
    fetchJson(`${DATA_BASE}/settlements.geojson`),
    fetchJson(`${DATA_BASE}/hubs.geojson`),
    fetchJson(`${DATA_BASE}/baseline.geojson`),
    fetchJson(`${DATA_BASE}/boundary.geojson`),
    // GIK field reports are optional — the dashboard must boot without
    // them (e.g. before pipeline.gik has been run).
    fetchJson(`${DATA_BASE}/gik_reports.geojson`).catch(() => null),
  ]);
  return { roads, settlements, hubs, baseline, boundary, gik };
}

/** Rough centroid for GeoJSON Polygon/MultiPolygon (vertex-average). */
export function centroidOf(feature: GeoFeature): [number, number] {
  const { type, coordinates } = feature.geometry as {
    type: string;
    coordinates: unknown;
  };
  const ring = (
    type === "Polygon"
      ? (coordinates as number[][][])[0]
      : type === "MultiPolygon"
        ? (coordinates as number[][][][])[0][0]
        : (((coordinates as number[][])[0] as unknown) ?? coordinates)
  ) as number[][];
  let sx = 0;
  let sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  return [sx / ring.length, sy / ring.length];
}

/** Rough property accessor — GDAL exports empty strings, not null. */
export function prop(
  feature: GeoFeature | undefined,
  key: string,
  fallback: string | number = "",
) {
  const v = feature?.properties?.[key];
  return v === undefined || v === null || v === "" ? fallback : v;
}
