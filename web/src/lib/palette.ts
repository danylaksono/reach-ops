// MapLibre paint expressions need literal colour values (they can't read
// CSS custom properties), so the status palette is duplicated here — keep
// these in sync with the --color-status-* tokens in src/index.css. This is
// the one status-colour vocabulary used everywhere: map, HUD, badges, list.

export const STATUS = {
  reachable: "#5fa980",
  cutoff: "#d7a24a",
  broken: "#c6524a",
  hub: "#4fa8c9",
  report: "#a988d9",
} as const;

/**
 * Isochrone bands: travel time (minutes) from the nearest hub, at the
 * currently configured cost model. Sequential ramp from the existing
 * "reachable" green through to "broken" red — same status vocabulary as
 * the rest of the app, read as fast→slow instead of good→bad. A road
 * with no value (unreachable) is styled separately, not part of this ramp.
 */
export const ISOCHRONE_BANDS: { maxMinutes: number; color: string; label: string }[] = [
  { maxMinutes: 30, color: "#5fa980", label: "≤ 30 min" },
  { maxMinutes: 60, color: "#94a85a", label: "≤ 1 h" },
  { maxMinutes: 120, color: "#d7a24a", label: "≤ 2 h" },
  { maxMinutes: 240, color: "#c17a45", label: "≤ 4 h" },
  { maxMinutes: Infinity, color: "#c6524a", label: "> 4 h" },
];

export const UNREACHABLE_COLOR = "#4a4d54";

export const INK = {
  base: "#ede9e2",
  muted: "#9a9690",
  ground: "#14161a",
  panel: "#1b1e23",
  panelRaised: "#22262c",
  line: "#2c3138",
} as const;
