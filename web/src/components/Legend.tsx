import { STATUS } from "../lib/palette";

const ROWS: { label: string; color: string; shape: "line" | "dot" }[] = [
  { label: "Reachable", color: STATUS.reachable, shape: "line" },
  { label: "Unreachable downstream", color: STATUS.cutoff, shape: "line" },
  { label: "Broken (marked)", color: STATUS.broken, shape: "line" },
  { label: "Access hub", color: STATUS.hub, shape: "dot" },
  { label: "GIK field report", color: STATUS.report, shape: "dot" },
];

export function Legend() {
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-sm border border-line bg-panel/92 px-3 py-2 backdrop-blur-sm">
      <div className="mb-1.5 border-b border-line pb-1 font-display text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        Accessibility
      </div>
      <div className="flex flex-col gap-1">
        {ROWS.map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-[11px] text-ink">
            {r.shape === "line" ? (
              <span className="inline-block h-[3px] w-5 rounded-sm" style={{ background: r.color }} />
            ) : (
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
            )}
            {r.label}
          </div>
        ))}
      </div>
    </div>
  );
}
