import { useDashboardStore } from "../../store/useDashboardStore";
import { fmt, pct } from "../../lib/format";
import { STATUS } from "../../lib/palette";
import { SettlementTable } from "../panels/SettlementTable";
import { ScrollArea } from "../ui/scroll-area";

function Tile({
  label,
  value,
  accent,
  detail,
}: {
  label: string;
  value: string;
  accent?: string;
  detail?: string;
}) {
  return (
    <div className="graticule relative overflow-hidden rounded-sm border border-line bg-panel px-4 py-3">
      <div
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{ background: accent ?? "var(--color-line-strong)" }}
      />
      <div className="font-mono text-[26px] font-medium leading-none tabular-nums text-ink">{value}</div>
      <div className="mt-1.5 font-display text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </div>
      {detail && <div className="mt-0.5 font-mono text-[10px] text-ink-faint">{detail}</div>}
    </div>
  );
}

/** The "walk in and see the situation in 5 seconds" screen — see AGENTS.md
 *  Phase 3. KPI-forward by design, unlike the Accessibility view where the
 *  map is the instrument and the KPIs stay in a thin secondary strip. */
export function OverviewView() {
  const lastResult = useDashboardStore((s) => s.lastResult);
  const targets = useDashboardStore((s) => s.targets);
  const engine = useDashboardStore((s) => s.engine);
  const buildingCountByCode = useDashboardStore((s) => s.buildingCountByCode);
  const gik = useDashboardStore((s) => s.gik);

  const total = lastResult?.settlements.length ?? 0;
  const reached = lastResult?.settlements.filter((s) => s.duration_s !== null).length ?? 0;
  const cutoff = total - reached;
  const reachPct = total ? Math.round((reached / total) * 100) : null;

  const byId = new Map((lastResult?.settlements ?? []).map((s) => [s.id, s.duration_s]));
  let popTotal = 0;
  let popAffected = 0;
  for (const t of targets) {
    popTotal += t.population;
    const d = byId.get(t.id);
    if (d === undefined || d === null) popAffected += t.population;
  }

  const brokenCount = (engine?.breakCount() ?? 0) + (engine?.broken.size ?? 0);
  const buildingsTotal = [...buildingCountByCode.values()].reduce((a, b) => a + b, 0);
  const gikCount = gik?.features?.length ?? 0;

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-5">
          <h1 className="font-display text-[17px] font-bold text-ink">Situational overview — Flores</h1>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            M7.7 earthquake, 15 Aug 2026 · nine regencies · accessibility computed from 9 placeholder aid hubs
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile
            label="Settlements cut off"
            value={fmt(cutoff)}
            accent={cutoff > 0 ? STATUS.cutoff : STATUS.reachable}
            detail={`${pct(reachPct)} of ${fmt(total)} reached`}
          />
          <Tile
            label="Population affected"
            value={fmt(popAffected)}
            accent={popAffected > 0 ? STATUS.cutoff : STATUS.reachable}
            detail={`of ${fmt(popTotal)} total`}
          />
          <Tile
            label="Roads broken"
            value={fmt(brokenCount)}
            accent={brokenCount > 0 ? STATUS.broken : undefined}
            detail="active field-marked breaks"
          />
          <Tile label="Buildings surveyed" value={fmt(buildingsTotal)} detail={`${fmt(gikCount)} GIK reports in area`} />
        </div>

        <div className="mt-6">
          <h2 className="mb-2 font-display text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Priority — need + cutoff
          </h2>
          <div className="flex h-[420px] rounded-sm border border-line bg-panel">
            <SettlementTable />
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
