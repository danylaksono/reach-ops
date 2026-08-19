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

export const INK = {
  base: "#ede9e2",
  muted: "#9a9690",
  ground: "#14161a",
  panel: "#1b1e23",
  panelRaised: "#22262c",
  line: "#2c3138",
} as const;
