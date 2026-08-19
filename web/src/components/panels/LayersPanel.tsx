import { useDashboardStore } from "../../store/useDashboardStore";
import type { LayerName } from "../../lib/types";
import { Switch } from "../ui/switch";
import { STATUS } from "../../lib/palette";

const ROWS: { id: LayerName; label: string; hint?: string; dot?: string }[] = [
  { id: "roads", label: "Accessibility roads", dot: STATUS.reachable },
  { id: "buildings", label: "Buildings", hint: "DuckDB" },
  { id: "settlements", label: "Settlements" },
  { id: "hubs", label: "Access hubs", dot: STATUS.hub },
  { id: "breaks", label: "Break markers", dot: STATUS.broken },
  { id: "gik", label: "GIK field reports", hint: "UGM", dot: STATUS.report },
];

export function LayersPanel() {
  const layerVisibility = useDashboardStore((s) => s.layerVisibility);
  const setLayerVisible = useDashboardStore((s) => s.setLayerVisible);

  return (
    <div className="flex flex-col gap-0.5 p-3">
      <h3 className="mb-1 font-display text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">
        Map layers
      </h3>
      {ROWS.map((row) => (
        <label
          key={row.id}
          className="flex cursor-pointer items-center justify-between rounded-sm px-1.5 py-1.5 hover:bg-panel-raised"
        >
          <span className="flex items-center gap-2 text-[12.5px] text-ink">
            {row.dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: row.dot }} />}
            {row.label}
            {row.hint && <span className="font-mono text-[10px] text-ink-faint">{row.hint}</span>}
          </span>
          <Switch
            checked={layerVisibility[row.id]}
            onCheckedChange={(v) => setLayerVisible(row.id, v)}
          />
        </label>
      ))}
    </div>
  );
}
