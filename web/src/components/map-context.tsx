import { createContext, useContext, useRef, type MutableRefObject, type ReactNode } from "react";
import type { MapView } from "../lib/mapView";

type MapViewRef = MutableRefObject<MapView | null>;

const MapViewContext = createContext<MapViewRef | null>(null);

/** Wraps the app so any panel (settlement list, sim panel) can reach the
 *  single persistent MapView instance to fly to a point or read state. */
export function MapViewProvider({ children }: { children: ReactNode }) {
  const ref = useRef<MapView | null>(null);
  return <MapViewContext.Provider value={ref}>{children}</MapViewContext.Provider>;
}

export function useMapView(): MapViewRef {
  const ctx = useContext(MapViewContext);
  if (!ctx) throw new Error("useMapView must be used within a MapViewProvider");
  return ctx;
}
