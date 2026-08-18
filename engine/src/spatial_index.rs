//! Uniform-grid nearest-node / nearest-edge index.
//!
//! A first cut used a linear scan over all nodes for `nearest_node` — fine
//! for a handful of queries, but snapping ~1,600 settlements against
//! ~840,000 Flores graph nodes that way took well over a minute in the
//! browser (measured directly: still hadn't returned after 40+ seconds).
//! A uniform grid keyed by rounded lon/lat, searched in expanding rings,
//! brings each query down to a handful of candidate nodes.
//!
//! The same grid also indexes edge midpoints so a break report (a point on
//! the map) can be projected onto the nearest road edge — the "split at
//! break point" model — without scanning every edge.

use std::collections::HashMap;

use petgraph::graph::{DiGraph, EdgeIndex, NodeIndex};

use crate::graph::{haversine_m, EdgeData, NodeData};

/// ~1.1km at the equator; Flores spans roughly -8 to -9 latitude, where a
/// degree of longitude is still close enough to a degree of latitude in
/// metres that a single fixed cell size is fine.
const CELL_SIZE_DEG: f64 = 0.01;
const CELL_SIZE_M: f64 = CELL_SIZE_DEG * 111_320.0;

pub struct SpatialIndex {
    cells: HashMap<(i32, i32), Vec<NodeIndex>>,
    edge_cells: HashMap<(i32, i32), Vec<EdgeIndex>>,
}

fn cell_key(lon: f64, lat: f64) -> (i32, i32) {
    ((lon / CELL_SIZE_DEG).floor() as i32, (lat / CELL_SIZE_DEG).floor() as i32)
}

/// Project a point onto a segment (equirectangular approximation — fine for
/// short road segments). Returns (fraction along the segment, lon, lat).
fn project(lon: f64, lat: f64, lon_a: f64, lat_a: f64, lon_b: f64, lat_b: f64) -> (f64, f64, f64) {
    let dx = lon_b - lon_a;
    let dy = lat_b - lat_a;
    let len2 = dx * dx + dy * dy;
    let t = if len2 == 0.0 {
        0.0
    } else {
        ((lon - lon_a) * dx + (lat - lat_a) * dy) / len2
    };
    let t = t.clamp(0.0, 1.0);
    (t, lon_a + t * dx, lat_a + t * dy)
}

impl SpatialIndex {
    pub fn build(graph: &DiGraph<NodeData, EdgeData>) -> Self {
        let mut cells: HashMap<(i32, i32), Vec<NodeIndex>> = HashMap::new();
        for idx in graph.node_indices() {
            let n = &graph[idx];
            cells.entry(cell_key(n.lon, n.lat)).or_default().push(idx);
        }

        let mut edge_cells: HashMap<(i32, i32), Vec<EdgeIndex>> = HashMap::new();
        for e in graph.edge_indices() {
            let (u, v) = graph.edge_endpoints(e).unwrap();
            let (lon_a, lat_a) = (graph[u].lon, graph[u].lat);
            let (lon_b, lat_b) = (graph[v].lon, graph[v].lat);
            let mid = ((lon_a + lon_b) / 2.0, (lat_a + lat_b) / 2.0);
            edge_cells.entry(cell_key(mid.0, mid.1)).or_default().push(e);
        }

        SpatialIndex { cells, edge_cells }
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

    /// Nearest edge to a point, with the projected point on it. Returns
    /// (edge, projected_lon, projected_lat, fraction_along_edge).
    ///
    /// Searches expanding rings over edge midpoints; because an edge can
    /// extend well beyond its midpoint cell, we keep a slightly larger
    /// termination margin than the node search so a long edge whose
    /// midpoint is a cell or two away is still found.
    pub fn nearest_edge(
        &self,
        graph: &DiGraph<NodeData, EdgeData>,
        lon: f64,
        lat: f64,
    ) -> Option<(EdgeIndex, f64, f64, f64)> {
        let (cx, cy) = cell_key(lon, lat);
        let mut best: Option<(f64, EdgeIndex, f64, f64, f64)> = None;

        for radius in 0..2000i32 {
            for dx in -radius..=radius {
                for dy in -radius..=radius {
                    if radius > 0 && dx.abs() != radius && dy.abs() != radius {
                        continue;
                    }
                    if let Some(edges) = self.edge_cells.get(&(cx + dx, cy + dy)) {
                        for &e in edges {
                            let (u, v) = graph.edge_endpoints(e).unwrap();
                            let (lon_a, lat_a) = (graph[u].lon, graph[u].lat);
                            let (lon_b, lat_b) = (graph[v].lon, graph[v].lat);
                            let (t, plon, plat) = project(lon, lat, lon_a, lat_a, lon_b, lat_b);
                            let d = haversine_m((lon, lat), (plon, plat));
                            if best.is_none_or(|(bd, _, _, _, _)| d < bd) {
                                best = Some((d, e, plon, plat, t));
                            }
                        }
                    }
                }
            }
            if let Some((bd, _, _, _, _)) = best {
                // Margin of 2 cells: an edge's midpoint can be up to half
                // the edge length from the query point even when the edge
                // itself is the closest one.
                if (radius as f64) * CELL_SIZE_M > bd + 2.0 * CELL_SIZE_M {
                    break;
                }
            }
        }

        best.map(|(_, e, plon, plat, t)| (e, plon, plat, t))
    }
}