import { Minimize2 } from "lucide-react";
import { useDashboardStore } from "../store/useDashboardStore";
import { pct } from "../lib/format";

/** The only chrome left when an operator focuses the map fullscreen — exit
 *  control plus the same three numbers the telemetry strip shows, so the
 *  headline picture (reached / broken) is never fully out of view. */
export function FullscreenHud() {
  const setFullscreen = useDashboardStore((s) => s.setFullscreen);
  const lastResult = useDashboardStore((s) => s.lastResult);
  const engine = useDashboardStore((s) => s.engine);

  const total = lastResult?.settlements.length ?? 0;
  const reached = lastResult?.settlements.filter((s) => s.duration_s !== null).length ?? 0;
  const reachPct = total ? Math.round((reached / total) * 100) : null;
  const brokenCount = (engine?.breakCount() ?? 0) + (engine?.broken.size ?? 0);

  return (
    <div className="absolute right-3 top-3 z-20 flex items-center gap-3 rounded-sm border border-line bg-panel/92 px-3 py-1.5 backdrop-blur-sm">
      <span className="font-mono text-[12px] text-ink">
        {pct(reachPct)} <span className="text-ink-faint">reached</span>
      </span>
      <span className="font-mono text-[12px] text-status-broken">
        {brokenCount} <span className="text-ink-faint">broken</span>
      </span>
      <button
        onClick={() => setFullscreen(false)}
        aria-label="Exit fullscreen map"
        className="flex h-6 w-6 items-center justify-center rounded-sm text-ink-muted hover:bg-panel-raised hover:text-ink"
      >
        <Minimize2 size={13} />
      </button>
    </div>
  );
}
