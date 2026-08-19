import { Maximize2, Minimize2 } from "lucide-react";
import { useDashboardStore } from "../store/useDashboardStore";
import { Button } from "./ui/button";

export function TopBar() {
  const statusText = useDashboardStore((s) => s.statusText);
  const phase = useDashboardStore((s) => s.phase);
  const fullscreen = useDashboardStore((s) => s.fullscreen);
  const setFullscreen = useDashboardStore((s) => s.setFullscreen);
  const resetAll = useDashboardStore((s) => s.resetAll);
  const view = useDashboardStore((s) => s.view);

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[15px] font-bold tracking-tight text-ink">REACH-OPS</span>
        <span className="hidden font-mono text-[10.5px] text-ink-faint sm:inline">
          FLORES · EQ 2026-08-15
        </span>
      </div>
      <div className="flex-1" />
      <span
        className={`font-mono text-[11px] text-ink-muted ${phase === "ready" ? "" : "animate-pulse"}`}
      >
        {statusText}
      </span>
      <Button
        variant="danger"
        size="sm"
        disabled={phase !== "ready"}
        onClick={resetAll}
        title="Restore every broken road and clear the current selection"
      >
        Reset all
      </Button>
      {view === "accessibility" && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setFullscreen(!fullscreen)}
          title={fullscreen ? "Exit fullscreen map" : "Focus map fullscreen"}
        >
          {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </Button>
      )}
    </header>
  );
}
