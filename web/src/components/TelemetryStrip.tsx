import { useDashboardStore } from "../store/useDashboardStore";
import { pct } from "../lib/format";
import { Separator } from "./ui/separator";

function Readout({ label, value, tone }: { label: string; value: string; tone?: "cutoff" | "broken" }) {
  return (
    <div className="flex items-baseline gap-1.5 px-3 py-1.5">
      <span
        key={value}
        className={`animate-flash font-mono text-[13px] font-medium tabular-nums ${
          tone === "broken" ? "text-status-broken" : tone === "cutoff" ? "text-status-cutoff" : "text-ink"
        }`}
      >
        {value}
      </span>
      <span className="font-display text-[9.5px] uppercase tracking-wider text-ink-faint">{label}</span>
    </div>
  );
}

/**
 * A thin telemetry readout, not a KPI card row — deliberately secondary to
 * the map beneath it. Reads like an instrument strip (seismograph channel
 * labels), not a marketing stat block.
 */
export function TelemetryStrip() {
  const lastResult = useDashboardStore((s) => s.lastResult);
  const recomputeMs = useDashboardStore((s) => s.recomputeMs);
  const targets = useDashboardStore((s) => s.targets);
  const engine = useDashboardStore((s) => s.engine);

  const total = lastResult?.settlements.length ?? 0;
  const reached = lastResult?.settlements.filter((s) => s.duration_s !== null).length ?? 0;
  const reachPct = total ? Math.round((reached / total) * 100) : null;

  const byId = new Map((lastResult?.settlements ?? []).map((s) => [s.id, s.duration_s]));
  let popTotal = 0;
  let popReached = 0;
  for (const t of targets) {
    popTotal += t.population;
    const d = byId.get(t.id);
    if (d !== undefined && d !== null) popReached += t.population;
  }
  const popPct = popTotal ? Math.round((popReached / popTotal) * 100) : null;
  const brokenCount = (engine?.breakCount() ?? 0) + (engine?.broken.size ?? 0);

  return (
    <div className="flex h-9 shrink-0 items-center divide-x divide-line border-b border-line bg-panel-sunken">
      <Readout label="Settlements reached" value={pct(reachPct)} tone={reachPct !== null && reachPct < 70 ? "cutoff" : undefined} />
      <Readout label="Population reached" value={pct(popPct)} tone={popPct !== null && popPct < 70 ? "cutoff" : undefined} />
      <Readout label="Roads broken" value={String(brokenCount)} tone={brokenCount > 0 ? "broken" : undefined} />
      <Readout label="Recompute" value={recomputeMs === null ? "—" : `${Math.round(recomputeMs)}ms`} />
      <Separator orientation="vertical" className="mx-1 h-4" />
    </div>
  );
}
