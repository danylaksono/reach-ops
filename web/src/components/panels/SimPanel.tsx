import { useDashboardStore } from "../../store/useDashboardStore";
import { Button } from "../ui/button";

const STAGES = [
  "Pick a road on the map to simulate a failure",
  "Watch reachability & settlement cutoff recompute",
  "Restore the road to model relief",
];

/** The Spatial Intervention Loop sim panel — filter/prioritise already live
 *  in the priority list; this is intervene/evaluate. */
export function SimPanel() {
  const selectedRoad = useDashboardStore((s) => s.selectedRoad);
  const breakSelected = useDashboardStore((s) => s.breakSelected);
  const restoreSelected = useDashboardStore((s) => s.restoreSelected);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <h3 className="mb-1.5 font-display text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">
          Spatial Intervention Loop
        </h3>
        <ol className="flex flex-col gap-1">
          {STAGES.map((s, i) => (
            <li key={s} className="flex items-start gap-2 text-[11.5px] text-ink-muted">
              <span className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-status-hub font-mono text-[9px] font-bold text-ground">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
      </div>

      <div className="min-h-11 rounded-sm border border-dashed border-line bg-panel-sunken px-2.5 py-2 font-mono text-[11.5px] text-ink">
        {selectedRoad ? (
          <>
            {selectedRoad.name || "Unnamed road"} ({selectedRoad.highway || "unknown"}) — status:{" "}
            <span
              className={
                selectedRoad.status === "broken"
                  ? "text-status-broken"
                  : selectedRoad.status === "unreachable"
                    ? "text-status-cutoff"
                    : "text-status-reachable"
              }
            >
              {selectedRoad.status}
            </span>{" "}
            · OSM {selectedRoad.osm_id}
          </>
        ) : (
          <span className="text-ink-faint">No road selected.</span>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          variant="danger"
          disabled={!selectedRoad || selectedRoad.status === "broken"}
          onClick={breakSelected}
          className="flex-1"
        >
          Mark broken
        </Button>
        <Button
          variant="ok"
          disabled={!selectedRoad || selectedRoad.status !== "broken"}
          onClick={restoreSelected}
          className="flex-1"
        >
          Restore
        </Button>
      </div>
    </div>
  );
}
