/** Human-readable distance. */
export function metersLabel(m: number | null | undefined): string | null {
  if (m === null || m === undefined || Number.isNaN(m)) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** Human-readable travel time — the isochrone label. */
export function durationLabel(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** Format a number with thousands separators. */
export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US");
}

/** Format a percentage (0-100), or an em dash while unknown. */
export function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${n}%`;
}
