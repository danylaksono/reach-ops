/** Human-readable distance. */
export function metersLabel(m: number | null | undefined): string | null {
  if (m === null || m === undefined || Number.isNaN(m)) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
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
