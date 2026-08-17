//! Uniform-grid nearest-node index.
//!
//! A first cut used a linear scan over all nodes for `nearest_node` — fine
//! for a handful of queries, but snapping ~1,600 settlements against
//! ~840,000 Flores graph nodes that way took well over a minute in the
//! browser (measured directly: still hadn't returned after 40+ seconds).
//! A uniform grid keyed by rounded lon/lat, searched in expanding rings,
//! brings each query down to a handful of candidate nodes.

use std::collections::HashMap;

use petgraph::graph::{DiGraph, NodeIndex};

use crate::graph::{haversine_m, EdgeData, NodeData};

/// ~1.1km at the equator; Flores spans roughly -8 to -9 latitude, where a
/// degree of longitude is still close enough to a degree of latitude in
/// metres that a single fixed cell size is fine.
const CELL_SIZE_DEG: f64 = 0.01;
const CELL_SIZE_M: f64 = CELL_SIZE_DEG * 111_320.0;

pub struct SpatialIndex {
    cells: HashMap<(i32, i32), Vec<NodeIndex>>,
}

fn cell_key(lon: f64, lat: f64) -> (i32, i32) {
    ((lon / CELL_SIZE_DEG).floor() as i32, (lat / CELL_SIZE_DEG).floor() as i32)
}

impl SpatialIndex {
    pub fn build(graph: &DiGraph<NodeData, EdgeData>) -> Self {
        let mut cells: HashMap<(i32, i32), Vec<NodeIndex>> = HashMap::new();
        for idx in graph.node_indices() {
            let n = &graph[idx];
            cells.entry(cell_key(n.lon, n.lat)).or_default().push(idx);
        }
        SpatialIndex { cells }
    }

    /// Nearest node by expanding-ring search over the grid. Stops once the
    /// search radius has covered the current best distance plus a full
    /// cell margin, which guarantees no closer node is hiding in an
    /// unsearched cell.
    pub fn nearest(&self, graph: &DiGraph<NodeData, EdgeData>, lon: f64, lat: f64) -> Option<NodeIndex> {
        let (cx, cy) = cell_key(lon, lat);
        let mut best: Option<(f64, NodeIndex)> = None;

        for radius in 0..2000i32 {
            for dx in -radius..=radius {
                for dy in -radius..=radius {
                    if radius > 0 && dx.abs() != radius && dy.abs() != radius {
                        continue; // only the outer ring of this radius
                    }
                    if let Some(nodes) = self.cells.get(&(cx + dx, cy + dy)) {
                        for &idx in nodes {
                            let n = &graph[idx];
                            let d = haversine_m((lon, lat), (n.lon, n.lat));
                            if best.is_none_or(|(bd, _)| d < bd) {
                                best = Some((d, idx));
                            }
                        }
                    }
                }
            }
            if let Some((bd, _)) = best {
                if (radius as f64) * CELL_SIZE_M > bd + CELL_SIZE_M {
                    break;
                }
            }
        }

        best.map(|(_, idx)| idx)
    }
}
