import { useDashboardStore } from "../store/useDashboardStore";
import { BASEMAPS } from "../lib/mapView";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

const IDS = Object.keys(BASEMAPS) as (keyof typeof BASEMAPS)[];

export function BasemapSwitcher() {
  const basemap = useDashboardStore((s) => s.basemap);
  const setBasemap = useDashboardStore((s) => s.setBasemap);

  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-10 rounded-sm border border-line bg-panel/92 p-1 backdrop-blur-sm">
      <ToggleGroup
        type="single"
        value={basemap}
        onValueChange={(v) => v && setBasemap(v as typeof basemap)}
      >
        {IDS.map((id) => (
          <ToggleGroupItem key={id} value={id}>
            {BASEMAPS[id].label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
