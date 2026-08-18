// MapLibre GL map module — renders the accessibility dashboard layers and
// handles road click selection for the Spatial Intervention Loop sim.
//
// Layers (bottom to top):
//   basemap      dark CARTO raster tiles (no API key)
//   buildings    per-settlement building-count choropleth (duckdb.js)
//   settlements  settlement polygons + labels
//   road-pieces  accessibility-coloured road *pieces* (dynamic status)
//   break-marks  point-break markers (split-at-break-point)
//   hubs         access hub points
//   selected     white highlight for the selected road
//
// Clicking a road selects it and fires onRoadClick().

import maplibregl from "https://esm.sh/maplibre-gl@4.7.1?bundle";

const DARK_BASEMAP_URL =
  "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

/** MapLibre style fragment for the accessibility road pieces layer. */
function pieceStyle() {
  return {
    id: "road-pieces",
    type: "line",
    source: "road-pieces",
    paint: {
      "line-color": [
        "case",
        ["==", ["get", "access_status"], "broken"],
        "#d0453c",
        ["==", ["get", "access_status"], "unreachable"],
        "#b25a3b",
        "#4f9e46", // reachable (default)
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
  };
}

export class MapView {
  /**
   * @param {Object} params
   * @param {HTMLElement} params.container  map mount div
   * @param {Function} [params.onRoadClick] (info) => void — road selected
   * @param {Function} [params.onHover]      (info|null) => void
   * @param {Function} [params.onEmptyClick] () => void — click not on road
   */
  constructor({ container, onRoadClick, onHover, onEmptyClick }) {
    this._onRoadClick = onRoadClick;
    this._onHover = onHover;
    this._onEmptyClick = onEmptyClick;
    this._sourceLoaded = false;
    this._selectedOsmId = null;

    this.map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
        sources: {
          carto: {
            type: "raster",
            tiles: [DARK_BASEMAP_URL],
            tileSize: 256,
          },
        },
        layers: [{ id: "basemap", type: "raster", source: "carto" }],
      },
      center: [121.2, -8.45],
      zoom: 7.5,
      attributionControl: true,
    });

    this._bindEvents();
  }

  /** Register all dashboard sources/layers once the style is loaded. */
  initLayers({
    roadsGeojson,
    settlementsGeojson,
    hubsGeojson,
    buildingsLayer,
  }) {
    this._roadsGeojson = roadsGeojson;
    this._settlementsGeojson = settlementsGeojson;
    this._hubsGeojson = hubsGeojson;
    this._buildingsLayer = buildingsLayer;

    if (this.map.isStyleLoaded()) {
      this._onLoad();
    } else {
      this.map.once("load", () => this._onLoad());
    }
  }

  _onLoad() {
    // Road pieces (initialised empty; populated on first recompute).
    this.map.addSource("road-pieces", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    this.map.addLayer(pieceStyle());

    // Break marker circles.
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
        "circle-color": "#d0453c",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });

    // Buildings layer: per-settlement building count choropleth.
    if (this._buildingsLayer) {
      this.map.addSource("buildings", {
        type: "geojson",
        data: this._buildingsLayer,
      });
      this.map.addLayer({
        id: "buildings",
        type: "fill",
        source: "buildings",
        paint: {
          "fill-color": [
            "interpolate",
            ["linear"],
            ["get", "building_count"],
            0,
            "rgba(0,0,0,0)",
            520,
            "#4db8ff55",
            2300,
            "#d0453c99",
          ],
          "fill-opacity": 0.5,
          "fill-outline-color": "rgba(255,255,255,0.12)",
        },
      });
    }

    // Settlements (polygons + labels).
    if (this._settlementsGeojson) {
      this.map.addSource("settlements", {
        type: "geojson",
        data: this._settlementsGeojson,
      });
      this.map.addLayer({
        id: "settlements",
        type: "line",
        source: "settlements",
        paint: {
          "line-color": "rgba(140,170,200,0.8)",
          "line-width": 0.8,
          "line-opacity": 0.6,
        },
      });
      this.map.addLayer({
        id: "settle-labels",
        type: "symbol",
        source: "settlements",
        layout: {
          "text-field": ["get", "name"],
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

    // Hubs.
    if (this._hubsGeojson) {
      this.map.addSource("hubs", { type: "geojson", data: this._hubsGeojson });
      this.map.addLayer({
        id: "hubs",
        type: "circle",
        source: "hubs",
        paint: {
          "circle-radius": 8,
          "circle-color": "#58a6ff",
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

    // Mark done — break-marks shown from the first recompute.
    this._sourceLoaded = true;
  }

  /**
   * Replace the road layer with per-piece features (one line per piece).
   */
  updatePieces(pieces) {
    if (!this._sourceLoaded || !this.map.getSource("road-pieces")) return;
    const feats = pieces.map((p) => {
      const road = this._roadsGeojson?.features?.[p.feature];
      const props = road?.properties ?? {};
      return {
        type: "Feature",
        properties: {
          access_status: p.reachable ? "reachable" : "unreachable",
          highway: props.highway ?? "",
          name: props.name ?? "",
          osm_id: props.osm_id ?? 0,
        },
        geometry: { type: "LineString", coordinates: p.coords },
      };
    });
    this.map.getSource("road-pieces").setData({
      type: "FeatureCollection",
      features: feats,
    });
  }

  /** Update the break-marker layer from the engine's breaks(). */
  updateBreaks(breaks) {
    if (!this._sourceLoaded || !this.map.getSource("break-marks")) return;
    const feats = breaks.map((b) => ({
      type: "Feature",
      properties: { id: b.id, osm_id: b.osm_id },
      geometry: { type: "Point", coordinates: [b.lon, b.lat] },
    }));
    this.map.getSource("break-marks").setData({
      type: "FeatureCollection",
      features: feats,
    });
  }

  /** Highigh a road by osm_id (from the sim panel selection). */
  selectRoadByOsmId(osmId) {
    this._selectedOsmId = osmId;
    this._renderSelection();
  }

  /** Clear the selected-road highlight. */
  clearSelection() {
    this._selectedOsmId = null;
    this._renderSelection();
  }

  _renderSelection() {
    if (this.map.getLayer("selected")) this.map.removeLayer("selected");
    if (this.map.getSource("selected-road"))
      this.map.removeSource("selected-road");
    if (this._selectedOsmId === null || !this._sourceLoaded) return;

    const feature = (this._roadsGeojson?.features ?? []).find(
      (f) => f.properties?.osm_id === this._selectedOsmId,
    );
    if (!feature) return;

    this.map.addSource("selected-road", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [feature] },
    });
    this.map.addLayer({
      id: "selected",
      type: "line",
      source: "selected-road",
      paint: {
        "line-color": "#ffffff",
        "line-width": 4,
        "line-opacity": 0.92,
      },
    });
  }

  /** Layer visibility toggles. */
  setLayerVisibility(layerId, visible) {
    if (this.map.getLayer(layerId)) {
      this.map.setLayoutProperty(
        layerId,
        "visibility",
        visible ? "visible" : "none",
      );
    }
  }

  /** Convenience: toggle accessibility road pieces. */
  setRoadsVisible(v) {
    this.setLayerVisibility("road-pieces", v);
  }

  /** Convenience: toggle break marker layer. */
  setBreakVisible(v) {
    this.setLayerVisibility("break-marks", v);
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

  // ---------- internals ----------

  _bindEvents() {
    this.map.on("click", (e) => {
      const feats = this.map.queryRenderedFeatures(e.point, {
        layers: ["road-pieces"],
      });
      if (feats.length > 0) {
        this._selectRoad(feats[0], e.lngLat);
      } else {
        this.clearSelection();
        this._onEmptyClick?.();
      }
    });

    this.map.on("mousemove", (e) => {
      const feats = this.map.queryRenderedFeatures(e.point, {
        layers: ["road-pieces"],
      });
      this.map.getCanvas().style.cursor = feats.length > 0 ? "pointer" : "";
      this._onHover?.(feats.length > 0 ? feats[0] : null, e);
    });

    this.map.on("mouseleave", () => this._onHover?.(null, null));
  }

  _selectRoad(feat, lngLat = null) {
    const p = feat.properties ?? {};
    this._selectedOsmId = p.osm_id ?? null;
    this._renderSelection();
    this._onRoadClick?.({
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
