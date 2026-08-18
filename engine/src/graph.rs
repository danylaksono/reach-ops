//! Builds a routable graph directly from Phase 0's roads.geojson.
//!
//! Road segments in that file are already split at OSM way boundaries but
//! not turned into an explicit node/edge topology — junctions are only
//! implied by coincident coordinates between features. Nodes are
//! deduplicated by rounding each coordinate to 7 decimal places (~1cm),
//! which is safe here because the extraction upstream (DuckDB spatial,
//! no reprojection) preserves OSM's literal shared node coordinates —
//! verified separately (~21% of endpoints are shared by 2+ segments).
//!
//! Feature identity is also preserved: each GeoJSON feature is a road
//! segment as drawn on a map, so the web dashboard can colour it as
//! reachable/broken/unreachable after each recompute.

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

/// Per-feature state for visualising the road network.
#[derive(Debug, Clone, Copy)]
pub struct FeatureComputed {
    /// Number of coordinate-pair segments of this feature that are
    /// reachable from a hub through currently-passable edges.
    pub reachable: u32,
    /// Number where none of the underlying graph edges are passable.
    pub broken: u32,
    /// Total coordinate-pair segments.
    pub total: u32,
}

pub struct RoadGraph {
    pub(crate) graph: DiGraph<NodeData, EdgeData>,
    edges_by_osm_id: HashMap<i64, Vec<EdgeIndex>>,
    spatial_index: SpatialIndex,
    /// Per feature: one entry per coordinate-pair segment; each entry lists
    /// the graph edges for that segment (1 for oneway, 2 for two-way).
    feature_segments: Vec<Vec<Vec<EdgeIndex>>>,
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
        let mut feature_segments: Vec<Vec<Vec<EdgeIndex>>> = Vec::new();

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

            let mut segs: Vec<Vec<EdgeIndex>> = Vec::with_capacity(
                feature.geometry.coordinates.len().saturating_sub(1).max(0),
            );
            for pair in feature.geometry.coordinates.windows(2) {
                let [lon_a, lat_a] = pair[0];
                let [lon_b, lat_b] = pair[1];
                let a = get_or_add_node(&mut graph, &mut node_index, lon_a, lat_a);
                let b = get_or_add_node(&mut graph, &mut node_index, lon_b, lat_b);
                let length_m = haversine_m((lon_a, lat_a), (lon_b, lat_b));

                let mut seg_edges = Vec::with_capacity(2);
                if reversed {
                    let e = graph.add_edge(b, a, EdgeData { osm_id, length_m, passable: true });
                    edges_by_osm_id.entry(osm_id).or_default().push(e);
                    seg_edges.push(e);
                } else if forward_only {
                    let e = graph.add_edge(a, b, EdgeData { osm_id, length_m, passable: true });
                    edges_by_osm_id.entry(osm_id).or_default().push(e);
                    seg_edges.push(e);
                } else {
                    let e1 = graph.add_edge(a, b, EdgeData { osm_id, length_m, passable: true });
                    let e2 = graph.add_edge(b, a, EdgeData { osm_id, length_m, passable: true });
                    edges_by_osm_id.entry(osm_id).or_default().push(e1);
                    edges_by_osm_id.entry(osm_id).or_default().push(e2);
                    seg_edges.push(e1);
                    seg_edges.push(e2);
                }
                segs.push(seg_edges);
            }
            feature_segments.push(segs);
        }

        let spatial_index = SpatialIndex::build(&graph);
        Ok(RoadGraph { graph, edges_by_osm_id, spatial_index, feature_segments })
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

    /// Per-feature (GeoJSON feature index) road state given a Dijkstra
    /// distance map: how many segments are reachable, broken, or total.
    ///
    /// A segment is:
    /// - broken if every graph edge of the segment is currently passable=false;
    /// - reachable otherwise if at least one endpoint node is in `dist`.
    pub fn feature_states(
        &self,
        dist: &HashMap<NodeIndex, f64>,
    ) -> Vec<FeatureComputed> {
        self.feature_segments
            .iter()
            .map(|segments| {
                let mut reachable = 0u32;
                let mut broken = 0u32;
                for seg in segments {
                    let passable_count =
                        seg.iter().filter(|&&e| self.graph[e].passable).count();
                    if passable_count == 0 {
                        broken += 1;
                        continue;
                    }
                    let has_reachable_end = seg.iter().any(|&e| {
                        let (u, v) = self.graph.edge_endpoints(e).unwrap();
                        dist.contains_key(&u) || dist.contains_key(&v)
                    });
                    if has_reachable_end {
                        reachable += 1;
                    }
                }
                FeatureComputed { reachable, broken, total: segments.len() as u32 }
            })
            .collect()
    }

    pub fn feature_count(&self) -> usize {
        self.feature_segments.len()
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

    #[test]
    fn feature_state_reflects_broken_and_reachable() {
        let json = r#"{
            "type": "FeatureCollection",
            "features": [
                {"properties": {"osm_id": 1, "oneway": "yes"}, "geometry": {"type": "LineString", "coordinates": [[0.0, 0.0], [0.001, 0.0]]}},
                {"properties": {"osm_id": 2, "oneway": "yes"}, "geometry": {"type": "LineString", "coordinates": [[0.001, 0.0], [0.002, 0.0]]}},
                {"properties": {"osm_id": 3, "oneway": "yes"}, "geometry": {"type": "LineString", "coordinates": [[0.002, 0.0], [0.003, 0.0]]}}
            ]
        }"#;
        let mut rg = RoadGraph::from_geojson(json).unwrap();
        let a = rg.nearest_node(0.0, 0.0).unwrap();
        let c = rg.nearest_node(0.002, 0.0).unwrap();

        let dist_before = crate::reachability::multi_source_distances(&rg, &[a]);
        let states_before = rg.feature_states(&dist_before);
        assert_eq!(states_before[0].reachable, 1);
        assert_eq!(states_before[0].broken, 0);
        // feature 2 is connected via the junction (0.001 is reachable)
        assert_eq!(states_before[1].reachable, 1);

        // Break the middle feature entirely -> feature 3 unreachable.
        rg.set_passable(2, false);
        let dist_after = crate::reachability::multi_source_distances(&rg, &[a]);
        let states_after = rg.feature_states(&dist_after);
        assert_eq!(states_after[1].broken, 1);
        assert_eq!(states_after[1].reachable, 0);
        assert_eq!(states_after[2].reachable, 0);
        let _ = c;
    }
}