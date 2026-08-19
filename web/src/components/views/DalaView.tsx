import { Home, Zap, Wheat } from "lucide-react";
import { ScrollArea } from "../ui/scroll-area";

const SECTORS = [
  {
    icon: Home,
    name: "Housing & social",
    proxy: "Building counts (buildings_by_settlement.parquet) + Kontur population, per settlement.",
    missing: "A severity class (destroyed / major / minor) — not yet carried by any field report.",
  },
  {
    icon: Zap,
    name: "Infrastructure",
    proxy: "Road-break state from the accessibility engine — a broken segment is transport-sector damage.",
    missing: "Energy and water infrastructure status — no source for either yet.",
  },
  {
    icon: Wheat,
    name: "Economic",
    proxy: "None currently — GIK reports carry declared needs, not sector loss.",
    missing: "Everything. Out of scope for the lightweight proxy (see AGENTS.md).",
  },
];

/** Damage & Loss (DALA) report page — its own view per the interface plan
 *  in AGENTS.md: PDNA-style sector output is inherently tabular, not a map
 *  overlay, and this is deliberately a thin severity-proxy layer, not full
 *  DaLA/PDNA loss modelling. Honest empty state: nothing here is computed
 *  yet, only what each sector will use once a severity dimension exists. */
export function DalaView() {
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="font-display text-[17px] font-bold text-ink">Damage & Loss — Flores</h1>
        <p className="mt-1 max-w-xl text-[12.5px] text-ink-muted">
          A lightweight severity proxy, not a full DaLA/PDNA assessment — built from what this pipeline already
          has (buildings, population, road breaks), not modelled loss or recovery cost. See{" "}
          <span className="font-mono text-[11px] text-ink-faint">AGENTS.md</span> for the scope decision.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          {SECTORS.map((s) => (
            <div key={s.name} className="rounded-sm border border-line bg-panel p-4">
              <div className="flex items-center gap-2.5">
                <s.icon size={16} className="text-status-report" />
                <h2 className="font-display text-[13px] font-semibold text-ink">{s.name}</h2>
              </div>
              <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
                <dt className="text-ink-faint">Proxy</dt>
                <dd className="text-ink-muted">{s.proxy}</dd>
                <dt className="text-ink-faint">Missing</dt>
                <dd className="text-ink-muted">{s.missing}</dd>
              </dl>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-sm border border-dashed border-line px-4 py-3 text-[11.5px] text-ink-faint">
          Sector table and severity choropleth land here once field reports carry a damage-severity field. Until
          then, use the Overview and Accessibility views — they're built on the same population and building data.
        </div>
      </div>
    </ScrollArea>
  );
}
