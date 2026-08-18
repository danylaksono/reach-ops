// MapLibre GL map module — renders the accessibility dashboard layers and
// handles road click selection for the Spatial Intervention Loop sim.
//
// Layers (bottom to top):
//   basemap      dark CARTO raster tiles (no API key)
//   buildings    per-settlement building-count choropleth (duckdb.js)
//   settlements  settlement polygons + labels
//   roads        accessibility-coloured road network (dynamic status)
//   hubs         access hub points
//   selected     white highlight for the clicked road
//
// Clicking a road selects it and fires onRoadClick().

import maplibregl from "https://esm.sh/maplibre-gl@4.7.1?bundle";

const DARK_BASEMAP_URL =
  "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

/** MapLibre style fragment for the accessibility roads layer. */
function roadStyle() {
  return {
    id: "roads",
    type: "line",
    source: "roads",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": [
        "case",
        ["==", ["get", "access_status"], "broken"],
        "#d0453c",
        ["==", ["get", "access_status"], "unreachable"],
        "#b25a3b",
        ["==", ["get", "access_status"], "reachable"],
        "#4f9e46",
        "#9b9b9b", // default / unknown
      ],
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        8,
        0.6,
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
          0.8,
        ],
      ],
      "line-opacity": 0.9,
    },
  };
}

export class MapView {
  /**
   * @param {Object} params
   * @param {HTMLElement} params.container   map mount div
   * @param {Function} [params.onRoadClick]  (info) => void — road selected
   * @param {Function} [params.onHover]      (info|null) => void
   * @param {Function} [params.onEmptyClick] () => void — click not on a road
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
        // Public no-key glyph server so symbol layers (settlement/hub labels)
        // can render text without a MapTiler token or self-hosted fonts.
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
      center: [121.2, -8.45], // Flores island
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
    // Roads (bottom-most vector layer; drawn under settlements but above
    // buildings so the accessibility picture stays on top).
    this.map.addSource("roads", { type: "geojson", data: this._roadsGeojson });
    this.map.addLayer(roadStyle());

    // Award settlements / building density layer (optional buildings at top).
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

    this._sourceLoaded = true;
  }

  /** Apply per-feature access_status from the engine's road state. */
  updateStatus(roadsStatus) {
    if (!this._sourceLoaded || !this.map.getSource("roads")) return;
    const data = JSON.parse(JSON.stringify(this._roadsGeojson));
    for (let i = 0; i < data.features.length; i++) {
      const s = roadsStatus[i];
      if (!s) continue;
      const isBroken = s.broken === s.total && s.total > 0;
      const isReachable = s.reachable > 0;
      data.features[i].properties.access_status = isBroken
        ? "broken"
        : isReachable
          ? "reachable"
          : "unreachable";
    }
    this.map.getSource("roads").setData(data);
  }

  /** Highlight a road by osm_id (from the sim panel selection). */
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

  /** Convenience: toggle accessibility roads layer. */
  setRoadsVisible(v) {
    this.setLayerVisibility("roads", v);
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
        layers: ["roads"],
      });
      if (feats.length > 0) {
        this._selectRoad(feats[0]);
      } else {
        this.clearSelection();
        this._onEmptyClick?.();
      }
    });

    this.map.on("mousemove", (e) => {
      const feats = this.map.queryRenderedFeatures(e.point, {
        layers: ["roads"],
      });
      this.map.getCanvas().style.cursor = feats.length > 0 ? "pointer" : "";
      this._onHover?.(feats.length > 0 ? feats[0] : null, e);
    });

    this.map.on("mouseleave", () => this._onHover?.(null, null));
  }

  _selectRoad(feat) {
    const p = feat.properties ?? {};
    this._selectedOsmId = p.osm_id ?? null;
    this._renderSelection();
    this._onRoadClick?.({
      id: feat.id,
      osm_id: p.osm_id,
      highway: p.highway,
      name: p.name,
      status: p.access_status,
    });
  }
}
