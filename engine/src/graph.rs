//! Builds a routable graph directly from Phase 0's roads.geojson.
//!
//! Road segments in that file are already split at OSM way boundaries but
//! not turned into an explicit node/edge topology — junctions are only
//! implied by coincident coordinates between features. Nodes are
//! deduplicated by rounding each coordinate to 7 decimal places (~1cm),
//! which is safe here because the extraction upstream (DuckDB spatial,
//! no reprojection) preserves OSM's literal shared node coordinates —
//! verified separately (~21% of endpoints are shared by 2+ segments).

use std::collections::HashMap;

use petgraph::graph::{DiGraph, EdgeIndex, NodeIndex};
use serde::Deserialize;

use crate::spatial_index::SpatialIndex;

#[derive(Debug, Clone, Copy)]
pub struct NodeData {
    pub lon: f64,
    pub lat: f64,
}

#[derive(Debug, Clone)]
pub struct EdgeData {
    pub osm_id: i64,
    pub length_m: f64,
    pub passable: bool,
}

pub struct RoadGraph {
    pub(crate) graph: DiGraph<NodeData, EdgeData>,
    edges_by_osm_id: HashMap<i64, Vec<EdgeIndex>>,
    spatial_index: SpatialIndex,
}

#[derive(Deserialize)]
struct FeatureCollection {
    features: Vec<Feature>,
}

#[derive(Deserialize)]
struct Feature {
    properties: RoadProperties,
    geometry: LineGeometry,
}

#[derive(Deserialize)]
struct RoadProperties {
    osm_id: i64,
    #[serde(default)]
    oneway: String,
}

#[derive(Deserialize)]
struct LineGeometry {
    #[serde(rename = "type")]
    geom_type: String,
    coordinates: Vec<[f64; 2]>,
}

fn node_key(lon: f64, lat: f64) -> String {
    format!("{:.7},{:.7}", lon, lat)
}

pub(crate) fn haversine_m(a: (f64, f64), b: (f64, f64)) -> f64 {
    const EARTH_RADIUS_M: f64 = 6_371_000.0;
    let (lon1, lat1) = a;
    let (lon2, lat2) = b;
    let (lat1r, lat2r) = (lat1.to_radians(), lat2.to_radians());
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let h = (dlat / 2.0).sin().powi(2) + lat1r.cos() * lat2r.cos() * (dlon / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_M * h.sqrt().asin()
}

fn get_or_add_node(
    graph: &mut DiGraph<NodeData, EdgeData>,
    node_index: &mut HashMap<String, NodeIndex>,
    lon: f64,
    lat: f64,
) -> NodeIndex {
    let key = node_key(lon, lat);
    if let Some(&idx) = node_index.get(&key) {
        idx
    } else {
        let idx = graph.add_node(NodeData { lon, lat });
        node_index.insert(key, idx);
        idx
    }
}

impl RoadGraph {
    pub fn from_geojson(json: &str) -> Result<Self, String> {
        let fc: FeatureCollection = serde_json::from_str(json).map_err(|e| e.to_string())?;

        let mut graph = DiGraph::new();
        let mut node_index: HashMap<String, NodeIndex> = HashMap::new();
        let mut edges_by_osm_id: HashMap<i64, Vec<EdgeIndex>> = HashMap::new();

        for feature in fc.features {
            if feature.geometry.geom_type != "LineString" {
                continue;
            }
            let osm_id = feature.properties.osm_id;
            let oneway = feature.properties.oneway.trim();
            let reversed = oneway == "-1" || oneway.eq_ignore_ascii_case("reverse");
            let forward_only = !reversed
                && (oneway == "1"
                    || oneway.eq_ignore_ascii_case("yes")
                    || oneway.eq_ignore_ascii_case("true"));

            for pair in feature.geometry.coordinates.windows(2) {
                let [lon_a, lat_a] = pair[0];
                let [lon_b, lat_b] = pair[1];
                let a = get_or_add_node(&mut graph, &mut node_index, lon_a, lat_a);
                let b = get_or_add_node(&mut graph, &mut node_index, lon_b, lat_b);
                let length_m = haversine_m((lon_a, lat_a), (lon_b, lat_b));

                if reversed {
                    let e = graph.add_edge(b, a, EdgeData { osm_id, length_m, passable: true });
                    edges_by_osm_id.entry(osm_id).or_default().push(e);
                } else if forward_only {
                    let e = graph.add_edge(a, b, EdgeData { osm_id, length_m, passable: true });
                    edges_by_osm_id.entry(osm_id).or_default().push(e);
                } else {
                    let e1 = graph.add_edge(a, b, EdgeData { osm_id, length_m, passable: true });
                    let e2 = graph.add_edge(b, a, EdgeData { osm_id, length_m, passable: true });
                    edges_by_osm_id.entry(osm_id).or_default().push(e1);
                    edges_by_osm_id.entry(osm_id).or_default().push(e2);
                }
            }
        }

        let spatial_index = SpatialIndex::build(&graph);
        Ok(RoadGraph { graph, edges_by_osm_id, spatial_index })
    }

    /// Mark every graph edge derived from `osm_id` as broken/restored.
    /// Returns how many graph edges were updated (0 if the id is unknown).
    pub fn set_passable(&mut self, osm_id: i64, passable: bool) -> usize {
        let mut n = 0;
        if let Some(edges) = self.edges_by_osm_id.get(&osm_id) {
            for &e in edges {
                if let Some(edge) = self.graph.edge_weight_mut(e) {
                    edge.passable = passable;
                    n += 1;
                }
            }
        }
        n
    }

    /// Nearest graph node to an arbitrary point, via the grid spatial index.
    pub fn nearest_node(&self, lon: f64, lat: f64) -> Option<NodeIndex> {
        self.spatial_index.nearest(&self.graph, lon, lat)
    }

    pub fn node_count(&self) -> usize {
        self.graph.node_count()
    }

    pub fn edge_count(&self) -> usize {
        self.graph.edge_count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_geojson() -> &'static str {
        // Two ways sharing an exact-coordinate junction at (0.001, 0.0).
        r#"{
            "type": "FeatureCollection",
            "features": [
                {
                    "properties": {"osm_id": 1, "oneway": ""},
                    "geometry": {"type": "LineString", "coordinates": [[0.0, 0.0], [0.001, 0.0]]}
                },
                {
                    "properties": {"osm_id": 2, "oneway": "yes"},
                    "geometry": {"type": "LineString", "coordinates": [[0.001, 0.0], [0.002, 0.0]]}
                }
            ]
        }"#
    }

    #[test]
    fn dedupes_shared_junction_node() {
        let rg = RoadGraph::from_geojson(sample_geojson()).unwrap();
        // 3 distinct coordinates, junction shared -> 3 nodes.
        assert_eq!(rg.node_count(), 3);
        // way 1 (two-way): 2 edges; way 2 (oneway): 1 edge.
        assert_eq!(rg.edge_count(), 3);
    }

    #[test]
    fn set_passable_updates_only_matching_osm_id() {
        let mut rg = RoadGraph::from_geojson(sample_geojson()).unwrap();
        let n = rg.set_passable(2, false);
        assert_eq!(n, 1);
        let still_passable = rg.graph.edge_weights().filter(|e| e.osm_id == 1).all(|e| e.passable);
        assert!(still_passable);
    }
}
