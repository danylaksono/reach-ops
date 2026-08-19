import { useEffect } from "react";
import { useDashboardStore } from "../store/useDashboardStore";
import { TopBar } from "./TopBar";
import { NavRail } from "./NavRail";
import { TelemetryStrip } from "./TelemetryStrip";
import { RightPanel } from "./RightPanel";
import { MapCanvas } from "./MapCanvas";
import { Legend } from "./Legend";
import { FullscreenHud } from "./FullscreenHud";
import { OverviewView } from "./views/OverviewView";
import { DalaView } from "./views/DalaView";

export function AppShell() {
  const boot = useDashboardStore((s) => s.boot);
  const view = useDashboardStore((s) => s.view);
  const fullscreen = useDashboardStore((s) => s.fullscreen);
  const phase = useDashboardStore((s) => s.phase);
  const statusText = useDashboardStore((s) => s.statusText);

  useEffect(() => {
    boot().catch((err) => {
      console.error(err);
      useDashboardStore.setState({
        phase: "error",
        statusText: `Boot failed: ${(err as Error).message}`,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mapVisible = view === "accessibility";
  const showChrome = !fullscreen;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ground">
      {showChrome && <TopBar />}
      <div className="flex min-h-0 flex-1">
        {showChrome && <NavRail />}
        <main className="relative flex min-h-0 flex-1 flex-col">
          {showChrome && view === "accessibility" && <TelemetryStrip />}
          <div className="relative min-h-0 flex-1">
            <MapCanvas visible={mapVisible} />
            {mapVisible && showChrome && <Legend />}
            {mapVisible && fullscreen && <FullscreenHud />}
            {view === "overview" && (
              <div className="absolute inset-0 bg-ground">
                <OverviewView />
              </div>
            )}
            {view === "dala" && (
              <div className="absolute inset-0 bg-ground">
                <DalaView />
              </div>
            )}
            {phase === "error" && (
              <div className="absolute inset-x-0 bottom-0 border-t border-status-broken/40 bg-status-broken/10 px-4 py-2 font-mono text-[11.5px] text-status-broken">
                {statusText}
              </div>
            )}
          </div>
        </main>
        {showChrome && view === "accessibility" && <RightPanel />}
      </div>
    </div>
  );
}
