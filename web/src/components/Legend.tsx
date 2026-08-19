import { ISOCHRONE_BANDS, STATUS, UNREACHABLE_COLOR } from "../lib/palette";

const POINT_ROWS: { label: string; color: string }[] = [
  { label: "Broken (marked)", color: STATUS.broken },
  { label: "Access hub", color: STATUS.hub },
  { label: "GIK field report", color: STATUS.report },
];

export function Legend() {
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-sm border border-line bg-panel/92 px-3 py-2 backdrop-blur-sm">
      <div className="mb-1.5 border-b border-line pb-1 font-display text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        Travel time from nearest hub
      </div>
      <div className="flex flex-col gap-1">
        {ISOCHRONE_BANDS.map((band) => (
          <div key={band.label} className="flex items-center gap-2 text-[11px] text-ink">
            <span className="inline-block h-[3px] w-5 rounded-sm" style={{ background: band.color }} />
            {band.label}
          </div>
        ))}
        <div className="flex items-center gap-2 text-[11px] text-ink">
          <span className="inline-block h-[3px] w-5 rounded-sm" style={{ background: UNREACHABLE_COLOR }} />
          Unreachable
        </div>
      </div>
      <div className="mt-1.5 flex flex-col gap-1 border-t border-line pt-1.5">
        {POINT_ROWS.map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-[11px] text-ink">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
            {r.label}
          </div>
        ))}
      </div>
    </div>
  );
}
