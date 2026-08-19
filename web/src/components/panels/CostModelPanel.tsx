import { useDashboardStore } from "../../store/useDashboardStore";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";

/** Configurable travel-time assumptions behind the isochrone map — speed
 *  (km/h) per OSM highway class, editable here and pushed to the wasm
 *  engine on Apply. See AGENTS.md's cost-model note: this is the tunable
 *  policy layer sitting on top of the physical road graph, and the same
 *  slot a future terrain/slope layer would plug into (as a per-edge
 *  multiplier, not a change to this UI). */
export function CostModelPanel() {
  const costProfile = useDashboardStore((s) => s.costProfile);
  const dirty = useDashboardStore((s) => s.costProfileDirty);
  const setCostSpeed = useDashboardStore((s) => s.setCostSpeed);
  const setCostDefaultSpeed = useDashboardStore((s) => s.setCostDefaultSpeed);
  const applyCostProfile = useDashboardStore((s) => s.applyCostProfile);
  const resetCostProfile = useDashboardStore((s) => s.resetCostProfile);

  if (!costProfile) {
    return <div className="p-3 text-[12px] text-ink-faint">Loading cost model…</div>;
  }

  const classes = Object.keys(costProfile.speedsKmh).sort();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-3 pb-2">
        <h3 className="font-display text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">
          Travel speed assumptions
        </h3>
        <p className="mt-1 text-[11px] text-ink-faint">
          Assumed speed (km/h) per road class — drives every isochrone band on the map. Configurable, not
          authoritative; not yet terrain-adjusted (Flores is steep — see AGENTS.md).
        </p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 px-3">
          <SpeedRow
            label="default (unlisted class)"
            value={costProfile.defaultSpeedKmh}
            onChange={setCostDefaultSpeed}
          />
          {classes.map((cls) => (
            <SpeedRow
              key={cls}
              label={cls}
              value={costProfile.speedsKmh[cls]}
              onChange={(kmh) => setCostSpeed(cls, kmh)}
            />
          ))}
        </div>
      </ScrollArea>
      <div className="flex gap-2 border-t border-line p-3">
        <Button variant="ok" className="flex-1" disabled={!dirty} onClick={applyCostProfile}>
          Apply & recompute
        </Button>
        <Button variant="ghost" disabled={!dirty} onClick={resetCostProfile}>
          Discard
        </Button>
      </div>
    </div>
  );
}

function SpeedRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (kmh: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="truncate text-[12px] text-ink" title={label}>
        {label}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <input
          type="number"
          min={0.5}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-16 rounded-sm border border-line bg-panel-raised px-1.5 py-0.5 text-right font-mono text-[11.5px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-status-hub"
        />
        <span className="font-mono text-[10px] text-ink-faint">km/h</span>
      </span>
    </label>
  );
}
