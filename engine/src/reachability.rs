//! Multi-source Dijkstra over the road graph, respecting each edge's
//! `passable` flag and each node's blocked state — this is the "recompute
//! after a road is marked broken/restored" step from the SIL loop in
//! AGENTS.md.
//!
//! Point breaks (split-at-break-point) are modelled as blocked nodes:
//! Dijkstra may *arrive at* a blocked node (so the near side of a break
//! remains reachable and drawn) but may not traverse *through* it, which
//! exactly matches "this spot on the road is cut, everything before it on
//! the way still works".

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};

use ordered_float::OrderedFloat;
use petgraph::graph::NodeIndex;
use petgraph::visit::EdgeRef;

use crate::graph::RoadGraph;

/// Shortest distance (metres) from the nearest of `sources` to every node
/// reachable through currently-passable edges. Nodes not present in the
/// returned map are unreachable.
pub fn multi_source_distances(rg: &RoadGraph, sources: &[NodeIndex]) -> HashMap<NodeIndex, f64> {
    let mut dist: HashMap<NodeIndex, f64> = HashMap::new();
    let mut heap: BinaryHeap<Reverse<(OrderedFloat<f64>, NodeIndex)>> = BinaryHeap::new();

    for &s in sources {
        dist.insert(s, 0.0);
        heap.push(Reverse((OrderedFloat(0.0), s)));
    }

    while let Some(Reverse((OrderedFloat(d), u))) = heap.pop() {
        if d > *dist.get(&u).unwrap_or(&f64::INFINITY) {
            continue;
        }
        for edge in rg.graph.edges(u) {
            if !edge.weight().passable {
                continue;
            }
            let v = edge.target();
            let nd = d + edge.weight().length_m;
            if nd >= *dist.get(&v).unwrap_or(&f64::INFINITY) {
                continue;
            }
            dist.insert(v, nd);
            // A blocked node (point break) can be *arrived at* — so the
            // near side of a break stays reachable — but it is never
            // pushed onto the heap, so its outgoing edges are never
            // relaxed and nothing can traverse *through* it.
            if !rg.is_blocked(v) {
                heap.push(Reverse((OrderedFloat(nd), v)));
            }
        }
    }

    dist
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocked_node_is_arrived_at_but_not_traversed() {
        // a -> m -> b chain, m blocked (point break). a stays reachable,
        // m is reached (near side of the break), b is not (no traversal
        // through the break).
        let json = r#"{
            "type": "FeatureCollection",
            "features": [
                {"properties": {"osm_id": 1, "oneway": "yes"}, "geometry": {"type": "LineString", "coordinates": [[0.0, 0.0], [0.002, 0.0], [0.004, 0.0]]}}
            ]
        }"#;
        let mut rg = RoadGraph::from_geojson(json).unwrap();

        // Break exactly at the middle vertex (0.002, 0.0).
        let bp = rg.set_break(0.002, 0.0).expect("break on the way");
        // Landed on an existing vertex -> junction-blocked, no split needed.
        assert_eq!(rg.node_count(), 3);

        let a = rg.nearest_node(0.0, 0.0).unwrap();
        let m = rg.nearest_node(0.002, 0.0).unwrap();
        let b = rg.nearest_node(0.004, 0.0).unwrap();

        let dist = multi_source_distances(&rg, &[a]);
        assert!(dist.contains_key(&a));
        // The blocked node itself is reachable (arrive at).
        assert!(dist.contains_key(&m));
        // Nothing beyond it is (no traverse through).
        assert!(!dist.contains_key(&b));

        rg.restore_break(&bp.id);
        let restored = multi_source_distances(&rg, &[a]);
        assert!(restored.contains_key(&b));
    }

    #[test]
    fn broken_edge_forces_detour_or_unreachable() {
        // a -> b -> c off the straight line (a genuine detour, longer than
        // direct), plus a direct a -> c edge.
        let json = r#"{
            "type": "FeatureCollection",
            "features": [
                {"properties": {"osm_id": 1, "oneway": "yes"}, "geometry": {"type": "LineString", "coordinates": [[0.0, 0.0], [0.001, 0.001]]}},
                {"properties": {"osm_id": 2, "oneway": "yes"}, "geometry": {"type": "LineString", "coordinates": [[0.001, 0.001], [0.002, 0.0]]}},
                {"properties": {"osm_id": 3, "oneway": "yes"}, "geometry": {"type": "LineString", "coordinates": [[0.0, 0.0], [0.002, 0.0]]}}
            ]
        }"#;
        let mut rg = RoadGraph::from_geojson(json).unwrap();
        let a = rg.nearest_node(0.0, 0.0).unwrap();
        let c = rg.nearest_node(0.002, 0.0).unwrap();

        let before = multi_source_distances(&rg, &[a]);
        let direct = before[&c];

        // Breaking the direct a->c edge should force the longer a->b->c path.
        rg.set_passable(3, false);
        let after = multi_source_distances(&rg, &[a]);
        assert!(after[&c] > direct);

        // Breaking every edge out of a should make c unreachable.
        rg.set_passable(1, false);
        let fully_broken = multi_source_distances(&rg, &[a]);
        assert!(!fully_broken.contains_key(&c));
    }
}
