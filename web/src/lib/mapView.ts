// MapLibre GL map controller — renders the accessibility dashboard layers
// and handles road click selection for the Spatial Intervention Loop sim.
// Imperative by design (MapLibre owns a canvas + WebGL context that's
// expensive to remount), driven from React via MapCanvas.tsx, which stays
// mounted across every view so switching Overview/Accessibility/DALA never
// tears the map down.
//
// Layers (bottom to top):
//   basemap      dark CARTO raster tiles (no API key)
//   buildings    per-settlement building-count choropleth (duckdb.ts)
//   settlements  settlement polygons + labels
//   road-pieces  accessibility-coloured road *pieces* (dynamic status)
//   break-marks  point-break markers (split-at-break-point)
//   hubs         access hub points
//   gik          crowdsourced field-report pins
//   selected     white highlight for the selected road

import maplibregl from "maplibre-gl";
import type { LngLatLike, MapGeoJSONFeature, MapMouseEvent } from "maplibre-gl";
import { ISOCHRONE_BANDS, STATUS, UNREACHABLE_COLOR } from "./palette";
import type { GeoJSON, RoadBreak, RoadPiece } from "./types";

const DARK_BASEMAP_URL = "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

/** `["step", ["get","duration_min"], firstColor, b1, c1, b2, c2, ...]` —
 *  MapLibre's step expression colours by the *last* boundary at or below
 *  the value, so bands must be ascending; the property is omitted
 *  entirely (not `null`) on unreachable pieces so `!has` cleanly detects
 *  them instead of relying on null-comparison quirks in expressions. */
function isochroneStepExpression(): unknown[] {
  const [first, ...rest] = ISOCHRONE_BANDS;
  const steps = rest.flatMap((band, i) => [ISOCHRONE_BANDS[i].maxMinutes, band.color]);
  return ["step", ["get", "duration_min"], first.color, ...steps];
}

function pieceStyle(): maplibregl.LayerSpecification {
  return {
    id: "road-pieces",
    type: "line",
    source: "road-pieces",
    paint: {
      "line-color": [
        "case",
        ["!", ["has", "duration_min"]],
        UNREACHABLE_COLOR,
        isochroneStepExpression(),
      ],
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        8,
        0.9,
        12,
        [
          "case",
          ["==", ["get", "highway"], "motorway"],
          3.0,
          ["==", ["get", "highway"], "trunk"],
          2.8,
          ["==", ["get", "highway"], "primary"],
          2.4,
          ["==", ["get", "highway"], "secondary"],
          2.0,
          ["==", ["get", "highway"], "tertiary"],
          1.4,
          ["==", ["get", "highway"], "residential"],
          1.0,
          0.6,
        ],
      ],
      "line-opacity": 0.92,
    },
  } as unknown as maplibregl.LayerSpecification;
}

export type RoadClickInfo = {
  id: number | string | undefined;
  osm_id: number;
  highway?: string;
  name?: string;
  status: string;
  lon?: number;
  lat?: number;
};

export type MapViewCallbacks = {
  onRoadClick?: (info: RoadClickInfo) => void;
  onHover?: (feature: MapGeoJSONFeature | null, e: MapMouseEvent | null) => void;
  onEmptyClick?: () => void;
  onReady?: () => void;
};

export class MapView {
  map: maplibregl.Map;
  private onRoadClick?: MapViewCallbacks["onRoadClick"];
  private onHover?: MapViewCallbacks["onHover"];
  private onEmptyClick?: MapViewCallbacks["onEmptyClick"];
  private onReady?: MapViewCallbacks["onReady"];
  private sourceLoaded = false;
  private selectedOsmId: number | null = null;
  private roadsGeojson?: GeoJSON;

  constructor(container: HTMLElement, callbacks: MapViewCallbacks) {
    this.onRoadClick = callbacks.onRoadClick;
    this.onHover = callbacks.onHover;
    this.onEmptyClick = callbacks.onEmptyClick;
    this.onReady = callbacks.onReady;

    this.map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
        sources: {
          carto: { type: "raster", tiles: [DARK_BASEMAP_URL], tileSize: 256 },
        },
        layers: [{ id: "basemap", type: "raster", source: "carto" }],
      },
      center: [121.2, -8.45],
      zoom: 7.5,
    });

    this.bindEvents();
  }

  initLayers({
    roadsGeojson,
    settlementsGeojson,
    hubsGeojson,
    buildingsLayer,
    gikGeojson,
  }: {
    roadsGeojson: GeoJSON;
    settlementsGeojson: GeoJSON;
    hubsGeojson: GeoJSON;
    buildingsLayer: GeoJSON | null;
    gikGeojson: GeoJSON | null;
  }) {
    this.roadsGeojson = roadsGeojson;
    const build = () =>
      this.onLoad({ settlementsGeojson, hubsGeojson, buildingsLayer, gikGeojson });
    if (this.map.isStyleLoaded()) build();
    else this.map.once("load", build);
  }

  private onLoad({
    settlementsGeojson,
    hubsGeojson,
    buildingsLayer,
    gikGeojson,
  }: {
    settlementsGeojson: GeoJSON;
    hubsGeojson: GeoJSON;
    buildingsLayer: GeoJSON | null;
    gikGeojson: GeoJSON | null;
  }) {
    this.map.addSource("road-pieces", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    this.map.addLayer(pieceStyle());

    this.map.addSource("break-marks", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    this.map.addLayer({
      id: "break-marks",
      type: "circle",
      source: "break-marks",
      paint: {
        "circle-radius": 7,
        "circle-color": STATUS.broken,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });

    if (buildingsLayer) {
      this.map.addSource("buildings", { type: "geojson", data: buildingsLayer as never });
      this.map.addLayer({
        id: "buildings",
        type: "fill",
        source: "buildings",
        layout: { visibility: "none" },
        paint: {
          "fill-color": [
            "interpolate",
            ["linear"],
            ["get", "building_count"],
            0,
            "rgba(0,0,0,0)",
            520,
            `${STATUS.hub}55`,
            2300,
            `${STATUS.broken}99`,
          ],
          "fill-opacity": 0.5,
          "fill-outline-color": "rgba(255,255,255,0.12)",
        },
      });
    }

    if (settlementsGeojson) {
      this.map.addSource("settlements", { type: "geojson", data: settlementsGeojson as never });
      this.map.addLayer({
        id: "settlements",
        type: "line",
        source: "settlements",
        paint: { "line-color": "rgba(140,170,200,0.8)", "line-width": 0.8, "line-opacity": 0.6 },
      });
      this.map.addLayer({
        id: "settle-labels",
        type: "symbol",
        source: "settlements",
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Regular"],
          "text-size": 9.5,
          "text-offset": [0, 0.8],
          "text-anchor": "top",
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#aab4c0",
          "text-halo-color": "rgba(13,17,23,0.9)",
          "text-halo-width": 1.4,
        },
      });
    }

    if (hubsGeojson) {
      this.map.addSource("hubs", { type: "geojson", data: hubsGeojson as never });
      this.map.addLayer({
        id: "hubs",
        type: "circle",
        source: "hubs",
        paint: {
          "circle-radius": 8,
          "circle-color": STATUS.hub,
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#f0f6ff",
        },
      });
      this.map.addLayer({
        id: "hub-labels",
        type: "symbol",
        source: "hubs",
        layout: {
          "text-field": ["get", "kab_kota_name"],
          "text-font": ["Open Sans Regular"],
          "text-size": 10,
          "text-offset": [0, 1.4],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#bedcff",
          "text-halo-color": "rgba(13,17,23,0.9)",
          "text-halo-width": 1.5,
        },
      });
    }

    if (gikGeojson?.features?.length) {
      this.map.addSource("gik", { type: "geojson", data: gikGeojson as never });
      this.map.addLayer({
        id: "gik",
        type: "circle",
        source: "gik",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 3.5, 12, 7],
          "circle-color": STATUS.report,
          "circle-opacity": 0.9,
          "circle-stroke-width": 1.2,
          "circle-stroke-color": "#0d1117",
        },
      });
      this.map.addLayer({
        id: "gik-labels",
        type: "symbol",
        source: "gik",
        layout: {
          "text-field": ["get", "households"],
          "text-font": ["Open Sans Regular"],
          "text-size": 9,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
        },
        paint: {
          "text-color": STATUS.report,
          "text-halo-color": "rgba(13,17,23,0.9)",
          "text-halo-width": 1.2,
        },
      });
      this.map.on("click", "gik", (e) => {
        const p = e.features?.[0]?.properties ?? {};
        const html = `<div class="font-semibold">${p.location || "GIK report"}</div>
          <div class="text-ink-muted">${p.households ?? "?"} KK · ${p.people ?? "?"} people</div>
          <div class="text-ink-muted">${p.needs || ""}</div>
          <div class="text-ink-muted">${p.status || ""}${p.photo ? ` · <a href="https://geoportal.science/gik/uploads/${p.photo}" target="_blank" rel="noopener">photo</a>` : ""}</div>`;
        new maplibregl.Popup({ closeButton: true, maxWidth: "280px" })
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(this.map);
      });
      this.map.on("mouseenter", "gik", () => {
        this.map.getCanvas().style.cursor = "pointer";
      });
      this.map.on("mouseleave", "gik", () => {
        this.map.getCanvas().style.cursor = "";
      });
    }

    this.sourceLoaded = true;
    this.onReady?.();
  }

  updatePieces(pieces: RoadPiece[]) {
    if (!this.sourceLoaded || !this.map.getSource("road-pieces")) return;
    const feats = pieces.map((p) => {
      const road = this.roadsGeojson?.features?.[p.feature];
      const props = road?.properties ?? {};
      return {
        type: "Feature" as const,
        properties: {
          // Omitted (not null) when unreachable — the paint expression
          // uses `!has` to detect that, since MapLibre's `==` against a
          // literal `null` is unreliable across property-missing states.
          ...(p.duration_s !== null ? { duration_min: p.duration_s / 60 } : {}),
          access_status: p.reachable ? "reachable" : "unreachable",
          highway: props.highway ?? "",
          name: props.name ?? "",
          osm_id: props.osm_id ?? 0,
        },
        geometry: { type: "LineString" as const, coordinates: p.coords },
      };
    });
    (this.map.getSource("road-pieces") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: feats,
    });
  }

  updateBreaks(breaks: RoadBreak[]) {
    if (!this.sourceLoaded || !this.map.getSource("break-marks")) return;
    const feats = breaks.map((b) => ({
      type: "Feature" as const,
      properties: { id: b.id, osm_id: b.osm_id },
      geometry: { type: "Point" as const, coordinates: [b.lon, b.lat] },
    }));
    (this.map.getSource("break-marks") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: feats,
    });
  }

  selectRoadByOsmId(osmId: number | null) {
    this.selectedOsmId = osmId;
    this.renderSelection();
  }

  clearSelection() {
    this.selectedOsmId = null;
    this.renderSelection();
  }

  private renderSelection() {
    if (this.map.getLayer("selected")) this.map.removeLayer("selected");
    if (this.map.getSource("selected-road")) this.map.removeSource("selected-road");
    if (this.selectedOsmId === null || !this.sourceLoaded) return;

    const feature = (this.roadsGeojson?.features ?? []).find(
      (f) => f.properties?.osm_id === this.selectedOsmId,
    );
    if (!feature) return;

    this.map.addSource("selected-road", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [feature] } as never,
    });
    this.map.addLayer({
      id: "selected",
      type: "line",
      source: "selected-road",
      paint: { "line-color": "#ffffff", "line-width": 4, "line-opacity": 0.92 },
    });
  }

  setLayerVisibility(layerId: string, visible: boolean) {
    if (this.map.getLayer(layerId)) {
      this.map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
    }
  }

  setRoadsVisible(v: boolean) {
    this.setLayerVisibility("road-pieces", v);
  }

  setBreakVisible(v: boolean) {
    this.setLayerVisibility("break-marks", v);
  }

  setGikVisible(v: boolean) {
    this.setLayerVisibility("gik", v);
    this.setLayerVisibility("gik-labels", v);
  }

  fitFlores() {
    this.map.fitBounds(
      [
        [118.9, -9.1],
        [123.5, -8.0],
      ],
      { padding: 60, duration: 800 },
    );
  }

  flyTo(center: LngLatLike, zoom = 11) {
    this.map.flyTo({ center, zoom, duration: 800 });
  }

  resize() {
    this.map.resize();
  }

  destroy() {
    this.map.remove();
  }

  private bindEvents() {
    this.map.on("click", (e) => {
      const feats = this.map.queryRenderedFeatures(e.point, { layers: ["road-pieces"] });
      if (feats.length > 0) {
        this.selectRoad(feats[0], e.lngLat);
      } else {
        this.clearSelection();
        this.onEmptyClick?.();
      }
    });

    this.map.on("mousemove", (e) => {
      const feats = this.map.queryRenderedFeatures(e.point, { layers: ["road-pieces"] });
      this.map.getCanvas().style.cursor = feats.length > 0 ? "pointer" : "";
      this.onHover?.(feats.length > 0 ? feats[0] : null, e);
    });

    this.map.on("mouseleave", () => this.onHover?.(null, null));
  }

  private selectRoad(feat: MapGeoJSONFeature, lngLat: maplibregl.LngLat | null = null) {
    const p = feat.properties ?? {};
    this.selectedOsmId = (p.osm_id as number) ?? null;
    this.renderSelection();
    this.onRoadClick?.({
      id: feat.id,
      osm_id: p.osm_id,
      highway: p.highway,
      name: p.name,
      status: p.access_status,
      lon: lngLat?.lng,
      lat: lngLat?.lat,
    });
  }
}
