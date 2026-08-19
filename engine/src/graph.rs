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
//!
//! # Point-based breaks (split-at-break-point)
//!
//! A break report is a *point*, not a whole OSM way: a long rural way with
//! no intermediate junctions shouldn't go dark along its entire length when
//! one spot is damaged. `set_break` projects the report onto the nearest
//! edge, physically splits that edge at the projected point (adding a new
//! graph node), and blocks traversal through that node. Road on both sides
//! of the break, and everything connected on the near side, stays usable;
//! only traffic *through* the point is cut. Restoring unblocks the node and
//! reconnects the network; the split geometry is kept (harmless extra
//! junction, keeps restore simple and fully reversible).

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
    /// OSM `highway` tag — looked up against a `CostModel`'s speed table at
    /// Dijkstra time (see `cost.rs`), not baked into a precomputed weight,
    /// so the cost model can change at runtime without rebuilding the graph.
    pub highway: String,
    /// Multiplier applied to travel time, uniformly 1.0 today. Placeholder
    /// for a future terrain/slope cost layer — see `cost.rs` module docs.
    pub terrain_multiplier: f64,
}

/// One clickable road feature (one GeoJSON LineString).
///
/// `start..end` is the range into `RoadGraph::segments` holding that
/// feature's coordinate-pair segments, so feature indexing in the JSON
/// output stays aligned with the input `roads.geojson` features array.
#[derive(Debug, Clone, Copy)]
pub struct FeatureRange {
    pub start: usize,
    pub end: usize,
}

/// Per-feature state for visualising the road network (whole-way view).
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

/// One graph-level coordinate-pair segment of a road feature.
///
/// `edges` are the directed graph edges covering the segment (1 for a
/// one-way, 2 for a two-way; more after a split). `nodes` are the graph
/// nodes in *geometric order along the feature* — normally `[a, b]`, and
/// `[a, m, b]` after a break splits the segment at the new node `m`.
#[derive(Debug, Clone)]
pub struct Segment {
    pub edges: Vec<EdgeIndex>,
    pub nodes: Vec<NodeIndex>,
}

/// A point break: where it is, which road it's on, and the graph node that
/// is blocked to model it (the newly-inserted split node, or the junction
/// node when the report landed right on an existing junction).
#[derive(Debug, Clone)]
pub struct BreakPoint {
    pub id: String,
    pub lon: f64,
    pub lat: f64,
    pub osm_id: i64,
    pub node: NodeIndex,
}

/// One renderable sub-piece of a road: the geometry between two consecutive
/// graph nodes along a segment, with whether that sub-piece is reachable.
#[derive(Debug, Clone)]
pub struct SegmentPiece {
    pub feature: usize,
    pub coords: Vec<[f64; 2]>,
    pub reachable: bool,
    /// Travel time (seconds) to reach the far end of this piece along the
    /// fastest path from a hub, for isochrone-band colouring. `None` when
    /// either end is unreachable (mirrors `reachable`).
    pub duration_s: Option<f64>,
}

/// Fraction of a segment beyond which a projected point counts as "on the
/// segment" rather than "at the junction". 1% of the segment length.
const ENDPOINT_EPS: f64 = 0.01;

pub struct RoadGraph {
    pub(crate) graph: DiGraph<NodeData, EdgeData>,
    edges_by_osm_id: HashMap<i64, Vec<EdgeIndex>>,
    spatial_index: SpatialIndex,
    /// Per feature: range into `segments` (aligned with the input features
    /// array, including empty ranges for skipped features).
    feature_ranges: Vec<FeatureRange>,
    /// Flat list of all coordinate-pair segments.
    segments: Vec<Segment>,
    /// Graph nodes traversal is blocked through (split node of a point
    /// break, or a junction node when the break landed on one). Counted so
    /// several breaks at the same node only need one restore to open it.
    blocked_nodes: HashMap<NodeIndex, u32>,
    /// Active point breaks, in creation order.
    breaks: Vec<BreakPoint>,
    /// Monotonic break counter — ids ("b0", "b1", ...) are never reused,
    /// even after a break is restored.
    break_seq: u64,
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
    /// OSM `highway` tag — drives the cost-model speed lookup (`cost.rs`).
    /// Missing/unrecognised values fall back to `CostModel::default_speed_kmh`.
    #[serde(default)]
    highway: String,
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
        let mut feature_ranges: Vec<FeatureRange> = Vec::new();
        let mut segments: Vec<Segment> = Vec::new();

        for feature in fc.features {
            let start = segments.len();
            if feature.geometry.geom_type == "LineString" {
                let osm_id = feature.properties.osm_id;
                let oneway = feature.properties.oneway.trim();
                let highway = feature.properties.highway.trim().to_string();
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
                    let edge_data = |highway: &str| EdgeData {
                        osm_id,
                        length_m,
                        passable: true,
                        highway: highway.to_string(),
                        terrain_multiplier: 1.0,
                    };

                    let mut seg_edges = Vec::with_capacity(2);
                    if reversed {
                        let e = graph.add_edge(b, a, edge_data(&highway));
                        edges_by_osm_id.entry(osm_id).or_default().push(e);
                        seg_edges.push(e);
                    } else if forward_only {
                        let e = graph.add_edge(a, b, edge_data(&highway));
                        edges_by_osm_id.entry(osm_id).or_default().push(e);
                        seg_edges.push(e);
                    } else {
                        let e1 = graph.add_edge(a, b, edge_data(&highway));
                        let e2 = graph.add_edge(b, a, edge_data(&highway));
                        edges_by_osm_id.entry(osm_id).or_default().push(e1);
                        edges_by_osm_id.entry(osm_id).or_default().push(e2);
                        seg_edges.push(e1);
                        seg_edges.push(e2);
                    }
                    segments.push(Segment { edges: seg_edges, nodes: vec![a, b] });
                }
            }
            feature_ranges.push(FeatureRange { start, end: segments.len() });
        }

        let spatial_index = SpatialIndex::build(&graph);
        Ok(RoadGraph {
            graph,
            edges_by_osm_id,
            spatial_index,
            feature_ranges,
            segments,
            blocked_nodes: HashMap::new(),
            breaks: Vec::new(),
            break_seq: 0,
        })
    }

    /// Mark every graph edge derived from `osm_id` as broken/restored.
    /// Returns how many graph edges were updated (0 if the id is unknown).
    /// Applies to the whole way — split sub-edges inherit the id, so a
    /// whole-way break still works alongside point breaks.
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

    /// True if traversal must not pass through `node` (point break there).
    pub fn is_blocked(&self, node: NodeIndex) -> bool {
        self.blocked_nodes.contains_key(&node)
    }

    /// Project a break report onto the nearest road edge and model it as a
    /// point: split the segment at the projected point and block the new
    /// node. The remaining road on both sides of the break stays usable;
    /// only traversal through the point is cut.
    ///
    /// If the report lands within `ENDPOINT_EPS` of an existing node (the
    /// break is effectively at a junction), the nearest node is blocked
    /// instead — all roads through that junction are cut, which is the
    /// honest interpretation of a point report at a junction.
    ///
    /// Returns the created break, or None if the point is far outside the
    /// road network.
    pub fn set_break(&mut self, lon: f64, lat: f64) -> Option<BreakPoint> {
        let (edge, plon, plat, t) = self.spatial_index.nearest_edge(&self.graph, lon, lat)?;

        if t > ENDPOINT_EPS && t < 1.0 - ENDPOINT_EPS {
            self.split_and_block(edge, plon, plat, t)
        } else {
            // Break at a junction: block the nearest node.
            let node = self.spatial_index.nearest(&self.graph, lon, lat)?;
            let osm_id = self.graph[edge].osm_id;
            let (nlon, nlat) = (self.graph[node].lon, self.graph[node].lat);
            *self.blocked_nodes.entry(node).or_insert(0) += 1;
            self.break_seq += 1;
            let bp = BreakPoint {
                id: format!("b{}", self.break_seq),
                lon: nlon,
                lat: nlat,
                osm_id,
                node,
            };
            self.breaks.push(bp.clone());
            Some(bp)
        }
    }

    /// Split the segment containing `edge` at `(plon, plat)` and block the
    /// new middle node. Handles both directed edges of a two-way segment so
    /// there is no way around the block.
    ///
    /// A segment's edges span its node pairs (`[a,b]` normally; `[a,m,b]`
    /// after a previous split). Only the edges spanning the single pair the
    /// break lands on are split — the other pairs' edges are left untouched,
    /// so repeated breaks on the same long way each cut only their own spot.
    fn split_and_block(
        &mut self,
        edge: EdgeIndex,
        plon: f64,
        plat: f64,
        t: f64,
    ) -> Option<BreakPoint> {
        // Locate the segment and determine the geometric pair it spans.
        let seg_idx = self
            .segments
            .iter()
            .position(|s| s.edges.contains(&edge))?;
        let seg_nodes = self.segments[seg_idx].nodes.clone();
        let (u, v) = self.graph.edge_endpoints(edge).unwrap();
        let pos = seg_nodes
            .windows(2)
            .position(|w| (w[0] == u && w[1] == v) || (w[0] == v && w[1] == u))?;
        let (x, y) = (seg_nodes[pos], seg_nodes[pos + 1]);
        // Geometric direction of the found edge: X -> Y forward, Y -> X reverse.
        let forward_dir = seg_nodes[pos] == u;
        let t_geo = if forward_dir { t } else { 1.0 - t };

        let osm_id = self.graph[edge].osm_id;
        let length_m = self.graph[edge].length_m;

        // Snapshot the edges spanning the (x, y) pair: their endpoints and
        // data, as values — NOT indices held across mutation. `DiGraph`'s
        // (non-Stable) `add_edge`/`remove_edge` reuse freed indices, so
        // iterating a live index list while removing and re-adding edges
        // re-binds an "old" index to a brand-new edge mid-loop and corrupts
        // the graph (observed: a spurious zero-length edge + an unsplit
        // original edge surviving). Every other edge of this segment (other
        // pairs from earlier splits) is left as-is.
        let mut removed_edges: Vec<EdgeIndex> = Vec::new();
        let mut pair_edges: Vec<(NodeIndex, NodeIndex, bool, String, f64)> = Vec::new();
        for &e in &self.segments[seg_idx].edges {
            let (a, b) = self.graph.edge_endpoints(e).unwrap();
            if (a == x && b == y) || (a == y && b == x) {
                let data = &self.graph[e];
                pair_edges.push((a, b, data.passable, data.highway.clone(), data.terrain_multiplier));
                removed_edges.push(e);
            }
        }
        // Remove all originals before adding any replacement — no aliasing.
        // Removing in descending index order matters: petgraph's `DiGraph`
        // `remove_edge` swaps the last edge into the freed slot, so removing
        // a low index can relocate a not-yet-removed edge to that same slot
        // and leave the following removal targeting stale/live indices.
        // Descending order never relocates a pending edge into a slot we
        // still process.
        removed_edges.sort_unstable_by(|a, b| b.cmp(a));
        for &e in &removed_edges {
            let removed = self.graph.remove_edge(e);
            debug_assert!(removed.is_some(), "edge {:?} should exist", e);
        }

        // New middle node at the break point.
        let m = self.graph.add_node(NodeData { lon: plon, lat: plat });

        // Now add all new edges; each old directed edge x->y splits into
        // x->m and m->y (with the geometric direction deciding which half
        // gets t_geo of the length).
        let mut new_edges: Vec<EdgeIndex> = Vec::with_capacity(pair_edges.len() * 2);
        for (a, b, passable, highway, terrain_multiplier) in &pair_edges {
            let (a, b, passable) = (*a, *b, *passable);
            let (len_a_m, len_m_b) = if (a, b) == (x, y) {
                (length_m * t_geo, length_m * (1.0 - t_geo))
            } else {
                (length_m * (1.0 - t_geo), length_m * t_geo)
            };
            let e1 = self.graph.add_edge(
                a,
                m,
                EdgeData {
                    osm_id,
                    length_m: len_a_m,
                    passable,
                    highway: highway.clone(),
                    terrain_multiplier: *terrain_multiplier,
                },
            );
            let e2 = self.graph.add_edge(
                m,
                b,
                EdgeData {
                    osm_id,
                    length_m: len_m_b,
                    passable,
                    highway: highway.clone(),
                    terrain_multiplier: *terrain_multiplier,
                },
            );
            new_edges.push(e1);
            new_edges.push(e2);
        }

        // Update the segment: drop the original pair edges, keep everything
        // else, append the new four, and insert the middle node at its
        // geometric position pos+1.
        let seg = &mut self.segments[seg_idx];
        seg.edges.retain(|e| !removed_edges.contains(e));
        seg.edges.extend(new_edges.iter().copied());
        seg.nodes.insert(pos + 1, m);

        // Update the per-osm-id edge bookkeeping so whole-way breaks still
        // see every sub-edge.
        if let Some(list) = self.edges_by_osm_id.get_mut(&osm_id) {
            list.retain(|e| !removed_edges.contains(e));
            list.extend(new_edges.iter().copied());
        }

        // Block the split node and record the break.
        *self.blocked_nodes.entry(m).or_insert(0) += 1;
        self.break_seq += 1;
        let bp = BreakPoint {
            id: format!("b{}", self.break_seq),
            lon: plon,
            lat: plat,
            osm_id,
            node: m,
        };
        self.breaks.push(bp.clone());

        // Topology changed: the spatial index (nodes + edge midpoints)
        // must be rebuilt so later breaks/queries see the new edges.
        self.spatial_index = SpatialIndex::build(&self.graph);

        Some(bp)
    }

    /// Restore a point break by id: unblock its node. The split geometry is
    /// kept (a harmless extra junction), so this is fully reversible.
    /// Returns true if a break with that id existed.
    pub fn restore_break(&mut self, id: &str) -> bool {
        let Some(pos) = self.breaks.iter().position(|b| b.id == id) else {
            return false;
        };
        let bp = self.breaks.remove(pos);
        self.unblock(bp.node);
        true
    }

    /// Restore every active point break.
    pub fn reset_breaks(&mut self) {
        for bp in std::mem::take(&mut self.breaks) {
            self.unblock(bp.node);
        }
    }

    pub fn break_count(&self) -> usize {
        self.breaks.len()
    }

    /// Active point breaks, as JSON-friendly data for the map layer.
    pub fn breaks(&self) -> Vec<(String, f64, f64, i64)> {
        self.breaks
            .iter()
            .map(|b| (b.id.clone(), b.lon, b.lat, b.osm_id))
            .collect()
    }

    fn unblock(&mut self, node: NodeIndex) {
        if let Some(count) = self.blocked_nodes.get_mut(&node) {
            *count -= 1;
            if *count == 0 {
                self.blocked_nodes.remove(&node);
            }
        }
    }

    /// Per-feature (GeoJSON feature index) road state given a Dijkstra
    /// distance map: how many segments are reachable, broken, or total.
    ///
    /// A segment is:
    /// - broken if every graph edge of the segment is currently passable=false;
    /// - reachable otherwise if at least one node of the segment is in `dist`.
    pub fn feature_states(
        &self,
        dist: &HashMap<NodeIndex, crate::reachability::TravelCost>,
    ) -> Vec<FeatureComputed> {
        self.feature_ranges
            .iter()
            .map(|range| {
                let mut reachable = 0u32;
                let mut broken = 0u32;
                for seg in &self.segments[range.start..range.end] {
                    let passable_count =
                        seg.edges.iter().filter(|&&e| self.graph[e].passable).count();
                    if passable_count == 0 {
                        broken += 1;
                        continue;
                    }
                    let has_reachable_end =
                        seg.nodes.iter().any(|n| dist.contains_key(n));
                    if has_reachable_end {
                        reachable += 1;
                    }
                }
                FeatureComputed { reachable, broken, total: (range.end - range.start) as u32 }
            })
            .collect()
    }

    /// Renderable sub-pieces for the dashboard map. Each piece is the
    /// geometry between two consecutive graph nodes of a segment, with how
    /// reachable it currently is. A point-break split turns one segment
    /// into two pieces — near side reachable, far side not — so the map can
    /// draw the still-usable part of the road green instead of the whole
    /// way going dark.
    pub fn segment_pieces(
        &self,
        dist: &HashMap<NodeIndex, crate::reachability::TravelCost>,
    ) -> Vec<SegmentPiece> {
        let mut out = Vec::new();
        for (fi, range) in self.feature_ranges.iter().enumerate() {
            for seg in &self.segments[range.start..range.end] {
                for pair in seg.nodes.windows(2) {
                    let (a, b) = (pair[0], pair[1]);
                    let (ta, tb) = (dist.get(&a), dist.get(&b));
                    let reachable = ta.is_some() && tb.is_some();
                    // The far/slower end of the piece is the honest "time
                    // to have this whole piece usable" figure.
                    let duration_s = match (ta, tb) {
                        (Some(x), Some(y)) => Some(x.time_s.max(y.time_s)),
                        _ => None,
                    };
                    out.push(SegmentPiece {
                        feature: fi,
                        coords: vec![
                            [self.graph[a].lon, self.graph[a].lat],
                            [self.graph[b].lon, self.graph[b].lat],
                        ],
                        reachable,
                        duration_s,
                    });
                }
            }
        }
        out
    }

    pub fn feature_count(&self) -> usize {
        self.feature_ranges.len()
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

        let dist_before = crate::reachability::multi_source_times(&rg, &[a], &crate::cost::CostModel::default());
        let states_before = rg.feature_states(&dist_before);
        assert_eq!(states_before[0].reachable, 1);
        assert_eq!(states_before[0].broken, 0);
        // feature 2 is connected via the junction (0.001 is reachable)
        assert_eq!(states_before[1].reachable, 1);

        // Break the middle feature entirely -> feature 3 unreachable.
        rg.set_passable(2, false);
        let dist_after = crate::reachability::multi_source_times(&rg, &[a], &crate::cost::CostModel::default());
        let states_after = rg.feature_states(&dist_after);
        assert_eq!(states_after[1].broken, 1);
        assert_eq!(states_after[1].reachable, 0);
        assert_eq!(states_after[2].reachable, 0);
        let _ = c;
    }

    #[test]
    fn point_break_splits_segment_and_blocks_only_through_it() {
        // One long two-way road, hub at the west end, target at the east.
        let json = r#"{
            "type": "FeatureCollection",
            "features": [
                {"properties": {"osm_id": 10, "oneway": ""}, "geometry": {"type": "LineString", "coordinates": [[0.0, 0.0], [0.003, 0.0]]}}
            ]
        }"#;
        let mut rg = RoadGraph::from_geojson(json).unwrap();

        let hub = rg.nearest_node(0.0, 0.0).unwrap();
        let far_end = rg.nearest_node(0.003, 0.0).unwrap();

        // Before the break: everything reachable.
        let dist_before = crate::reachability::multi_source_times(&rg, &[hub], &crate::cost::CostModel::default());
        assert!(dist_before.contains_key(&far_end));
        assert_eq!(rg.node_count(), 2);
        assert_eq!(rg.feature_states(&dist_before)[0].reachable, 1);

        // Break at the middle of the segment.
        let bp = rg.set_break(0.0015, 0.0).expect("break should land on the road");
        assert_eq!(bp.osm_id, 10);
        assert_eq!(rg.break_count(), 1);

        // The segment was split: new middle node + 4 directed edges
        // (two-way segment, both directions split).
        assert_eq!(rg.node_count(), 3);
        assert_eq!(rg.edge_count(), 4);

        // Hub side still reachable, far side no longer.
        let dist = crate::reachability::multi_source_times(&rg, &[hub], &crate::cost::CostModel::default());
        assert!(dist.contains_key(&hub));
        assert!(!dist.contains_key(&far_end));

        // Pieces: [hub .. m] reachable, [m .. far_end] unreachable — the
        // map can keep the near side green.
        let pieces = rg.segment_pieces(&dist);
        assert_eq!(pieces.len(), 2);
        assert!(pieces[0].reachable);
        assert!(!pieces[1].reachable);

        // Restore: far end reachable again, breaks cleared.
        assert!(rg.restore_break(&bp.id));
        assert_eq!(rg.break_count(), 0);
        let dist_restored = crate::reachability::multi_source_times(&rg, &[hub], &crate::cost::CostModel::default());
        assert!(dist_restored.contains_key(&far_end));
    }

    #[test]
    fn point_break_preserves_side_road_connectivity() {
        // Feature 1: hub road a--j--b (long, passing through the junction
        // j at (0.001, 0.0)). Feature 2: a side road branching off AT j,
        // *before* the break point. Breaking mid a--b must leave the side
        // road reachable because j shares a node with the main road.
        let json = r#"{
            "type": "FeatureCollection",
            "features": [
                {"properties": {"osm_id": 1, "oneway": "yes"}, "geometry": {"type": "LineString", "coordinates": [[0.0, 0.0], [0.001, 0.0], [0.003, 0.0]]}},
                {"properties": {"osm_id": 2, "oneway": "yes"}, "geometry": {"type": "LineString", "coordinates": [[0.001, 0.0], [0.001, 0.001]]}}
            ]
        }"#;
        let mut rg = RoadGraph::from_geojson(json).unwrap();
        let hub = rg.nearest_node(0.0, 0.0).unwrap();
        let side_end = rg.nearest_node(0.001, 0.001).unwrap();

        rg.set_break(0.0020, 0.0).expect("break on feature 1");

        let dist = crate::reachability::multi_source_times(&rg, &[hub], &crate::cost::CostModel::default());
        // Side road junction (0.001, 0.0) and side end both reachable.
        assert!(dist.contains_key(&side_end));
        // Far end of feature 1 (0.003) unreachable.
        let far = rg.nearest_node(0.003, 0.0).unwrap();
        assert!(!dist.contains_key(&far));
    }

    #[test]
    fn rebreak_after_restore_works() {
        // A break, restore, then a fresh break at the same point must all
        // succeed — the split geometry is kept after restore, so the second
        // break lands on the (now split) sub-edges.
        let json = r#"{
            "type": "FeatureCollection",
            "features": [
                {"properties": {"osm_id": 10, "oneway": ""}, "geometry": {"type": "LineString", "coordinates": [[0.0, 0.0], [0.003, 0.0]]}}
            ]
        }"#;
        let mut rg = RoadGraph::from_geojson(json).unwrap();

        let bp1 = rg.set_break(0.0015, 0.0).expect("first break");
        assert_eq!(rg.break_count(), 1);
        assert!(rg.restore_break(&bp1.id));
        assert_eq!(rg.break_count(), 0);

        let bp2 = rg.set_break(0.0015, 0.0).expect("re-break after restore");
        assert_eq!(rg.break_count(), 1);
        assert_eq!(bp2.osm_id, 10);
    }

    #[test]
    fn break_at_junction_blocks_the_junction() {
        // Two one-way features meeting at (0.001, 0.0); a break reported
        // exactly at the junction blocks every road through it.
        let json = r#"{
            "type": "FeatureCollection",
            "features": [
                {"properties": {"osm_id": 1, "oneway": "yes"}, "geometry": {"type": "LineString", "coordinates": [[0.0, 0.0], [0.001, 0.0]]}},
                {"properties": {"osm_id": 2, "oneway": "yes"}, "geometry": {"type": "LineString", "coordinates": [[0.001, 0.0], [0.002, 0.0]]}}
            ]
        }"#;
        let mut rg = RoadGraph::from_geojson(json).unwrap();
        let hub = rg.nearest_node(0.0, 0.0).unwrap();
        let far = rg.nearest_node(0.002, 0.0).unwrap();

        // The report is exactly ON the shared junction coordinate -> t lands
        // in the endpoint band -> nearest node (the junction) is blocked.
        let bp = rg.set_break(0.001, 0.0).expect("break at junction");
        assert_eq!(rg.break_count(), 1);
        // No split happened (break at existing node).
        assert_eq!(rg.node_count(), 3);

        let dist = crate::reachability::multi_source_times(&rg, &[hub], &crate::cost::CostModel::default());
        assert!(dist.contains_key(&hub));
        assert!(!dist.contains_key(&far));

        rg.restore_break(&bp.id);
        let dist_restored = crate::reachability::multi_source_times(&rg, &[hub], &crate::cost::CostModel::default());
        assert!(dist_restored.contains_key(&far));
    }
}