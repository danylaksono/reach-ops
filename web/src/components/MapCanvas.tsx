import { useEffect, useRef, useState } from "react";
import { useDashboardStore } from "../store/useDashboardStore";
import { MapView } from "../lib/mapView";
import { useMapView } from "./map-context";

type TooltipState = { name: string; highway: string; osmId: number; x: number; y: number } | null;

/**
 * Mounts once and stays mounted for the lifetime of the app — switching
 * Overview/Accessibility/DALA only toggles this container's visibility
 * (see AppShell), never remounts MapLibre. That's what makes brush-linking
 * across views possible later: one map instance, one source of truth.
 */
export function MapCanvas({ visible }: { visible: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useMapView();
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  const roads = useDashboardStore((s) => s.roads);
  const settlements = useDashboardStore((s) => s.settlements);
  const hubs = useDashboardStore((s) => s.hubs);
  const boundary = useDashboardStore((s) => s.boundary);
  const gik = useDashboardStore((s) => s.gik);
  const buildingsLayer = useDashboardStore((s) => s.buildingsLayer);
  const lastResult = useDashboardStore((s) => s.lastResult);
  const layerVisibility = useDashboardStore((s) => s.layerVisibility);
  const selectedRoad = useDashboardStore((s) => s.selectedRoad);
  const selectRoad = useDashboardStore((s) => s.selectRoad);
  const clearSelection = useDashboardStore((s) => s.clearSelection);

  // Mount MapLibre once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = new MapView(containerRef.current, {
      onRoadClick: (info) => selectRoad(info),
      onEmptyClick: () => clearSelection(),
      onHover: (feature, e) => {
        if (!feature || !e) {
          setTooltip(null);
          return;
        }
        const p = feature.properties ?? {};
        setTooltip({
          name: (p.name as string) || "Unnamed road",
          highway: (p.highway as string) || "unknown",
          osmId: p.osm_id as number,
          x: e.point.x,
          y: e.point.y,
        });
      },
    });
    return () => {
      mapRef.current?.destroy();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register layers once the static data has loaded.
  useEffect(() => {
    if (!mapRef.current || !roads || !settlements || !hubs) return;
    mapRef.current.initLayers({
      roadsGeojson: roads,
      settlementsGeojson: settlements,
      hubsGeojson: hubs,
      buildingsLayer,
      gikGeojson: gik,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roads, settlements, hubs]);

  // Fit to Flores once the boundary is known.
  useEffect(() => {
    if (mapRef.current && boundary?.features?.[0]?.geometry) {
      mapRef.current.fitFlores();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundary]);

  // Push each recompute's road pieces / break markers onto the map.
  useEffect(() => {
    if (!mapRef.current || !lastResult) return;
    mapRef.current.updatePieces(lastResult.pieces);
    mapRef.current.updateBreaks(lastResult.breaks);
  }, [lastResult]);

  // Layer visibility toggles.
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    m.setRoadsVisible(layerVisibility.roads);
    m.setLayerVisibility("buildings", layerVisibility.buildings);
    m.setLayerVisibility("settlements", layerVisibility.settlements);
    m.setLayerVisibility("settle-labels", layerVisibility.settlements);
    m.setLayerVisibility("hubs", layerVisibility.hubs);
    m.setLayerVisibility("hub-labels", layerVisibility.hubs);
    m.setBreakVisible(layerVisibility.breaks);
    m.setGikVisible(layerVisibility.gik);
  }, [layerVisibility]);

  // Selection highlight.
  useEffect(() => {
    mapRef.current?.selectRoadByOsmId(selectedRoad?.osm_id ?? null);
  }, [selectedRoad?.osm_id]);

  // Resize whenever the canvas becomes visible again (fullscreen toggle,
  // view switch) — MapLibre needs a nudge after its container's size changes
  // while it was display:none.
  useEffect(() => {
    if (visible) requestAnimationFrame(() => mapRef.current?.resize());
  }, [visible]);

  return (
    <div
      className="absolute inset-0"
      style={{ visibility: visible ? "visible" : "hidden" }}
    >
      {/* MapLibre sets this element's `position` itself (to lay out its
          own canvas/controls), which overrides an `absolute` utility class
          here — `h-full w-full` sizes it from the real-height parent above
          regardless of what position MapLibre ends up choosing. */}
      <div ref={containerRef} className="h-full w-full" />
      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 max-w-60 rounded-sm border border-line bg-panel-sunken/95 px-2.5 py-1.5 font-mono text-[11px] shadow-lg backdrop-blur-sm"
          style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
        >
          <div className="font-sans text-[11.5px] font-semibold text-ink">{tooltip.name}</div>
          <div className="text-ink-muted">
            {tooltip.highway} · OSM {tooltip.osmId}
          </div>
        </div>
      )}
    </div>
  );
}
