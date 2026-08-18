pub mod graph;
pub mod reachability;
mod spatial_index;

use graph::{FeatureComputed, RoadGraph};
use petgraph::graph::NodeIndex;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
struct TargetPoint {
    id: String,
    lon: f64,
    lat: f64,
}

#[derive(Serialize, Clone)]
struct SettlementResult {
    id: String,
    distance_m: Option<f64>,
}

#[derive(Serialize)]
struct RoadResult {
    reachable: u32,
    broken: u32,
    total: u32,
}

impl From<FeatureComputed> for RoadResult {
    fn from(f: FeatureComputed) -> Self {
        RoadResult { reachable: f.reachable, broken: f.broken, total: f.total }
    }
}

/// One renderable road sub-piece: the geometry between two consecutive
/// graph nodes along a segment, flagged reachable/unreachable. The map
/// draws these instead of whole features so a point break can keep the
/// near side of a long way green while the far side goes dark.
#[derive(Serialize)]
struct PieceResult {
    /// Index into the input `roads.geojson` features array.
    feature: usize,
    coords: Vec<[f64; 2]>,
    reachable: bool,
}

/// An active point break for the map's break-marker layer.
#[derive(Serialize)]
struct BreakResult {
    id: String,
    lon: f64,
    lat: f64,
    osm_id: i64,
}

#[derive(Serialize)]
struct StateResult {
    settlements: Vec<SettlementResult>,
    roads: Vec<RoadResult>,
    pieces: Vec<PieceResult>,
    breaks: Vec<BreakResult>,
}

/// Loads a road network once and answers repeated reachability queries as
/// the network state changes (edges marked broken/restored, or points
/// marked broken via split-at-break-point) — the "evaluate" step of the
/// Spatial Intervention Loop in AGENTS.md.
///
/// Hub and target locations are snapped to graph nodes once, via
/// `set_hubs`/`set_targets` (an O(points x nodes) linear scan — fine as a
/// one-off, too slow to repeat on every recompute). `compute_reachability`
/// then only reruns Dijkstra plus O(1) lookups against those cached node
/// indices, so it stays cheap to call after every network status change.
#[wasm_bindgen]
pub struct Engine {
    rg: RoadGraph,
    hub_nodes: Vec<NodeIndex>,
    target_nodes: Vec<(String, Option<NodeIndex>)>,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new(roads_geojson: &str) -> Result<Engine, JsValue> {
        let rg = RoadGraph::from_geojson(roads_geojson).map_err(|e| JsValue::from_str(&e))?;
        Ok(Engine { rg, hub_nodes: Vec::new(), target_nodes: Vec::new() })
    }

    pub fn node_count(&self) -> usize {
        self.rg.node_count()
    }

    pub fn edge_count(&self) -> usize {
        self.rg.edge_count()
    }

    pub fn feature_count(&self) -> usize {
        self.rg.feature_count()
    }

    /// Mark every graph edge derived from an OSM way as broken/restored.
    /// `osm_id` arrives as f64 (JS number) — safe since OSM ids are well
    /// within f64's exact-integer range. Returns how many graph edges
    /// were updated (0 if the id isn't in the loaded network).
    ///
    /// This is the whole-way break (legacy/coarse). Prefer the point-based
    /// `set_break`, which only cuts traffic through the reported location.
    pub fn set_edge_status(&mut self, osm_id: f64, passable: bool) -> usize {
        self.rg.set_passable(osm_id as i64, passable)
    }

    /// Mark a *point* on the road network broken: projects the report onto
    /// the nearest road edge, physically splits that edge at the projected
    /// point, and blocks traversal through the new node. The road on both
    /// sides of the break stays usable — only traffic through the point is
    /// cut, so roads branching off before the break keep working.
    ///
    /// Returns the break id, or an error if no road is near the point.
    /// `Result<String, String>` (not `JsValue`) so it's natively testable —
    /// wasm-bindgen throws the `Err` string as a JS exception.
    pub fn set_break(&mut self, lon: f64, lat: f64) -> Result<String, String> {
        match self.rg.set_break(lon, lat) {
            Some(bp) => Ok(bp.id),
            None => Err("No road near break point".to_string()),
        }
    }

    /// Restore a point break by id (unblock the split node). The split
    /// geometry is kept, so this is fully reversible.
    pub fn restore_break(&mut self, id: &str) -> bool {
        self.rg.restore_break(id)
    }

    /// Restore every active point break.
    pub fn reset_breaks(&mut self) {
        self.rg.reset_breaks();
    }

    /// Number of active point breaks (the "roads broken" HUD count).
    pub fn break_count(&self) -> usize {
        self.rg.break_count()
    }

    /// Active point breaks as JSON:
    /// `[{"id":"b1","lon":...,"lat":...,"osm_id":...}, ...]` — for the
    /// map's break-marker layer.
    pub fn breaks_json(&self) -> Result<String, JsValue> {
        let breaks: Vec<BreakResult> = self
            .rg
            .breaks()
            .into_iter()
            .map(|(id, lon, lat, osm_id)| BreakResult { id, lon, lat, osm_id })
            .collect();
        serde_json::to_string(&breaks).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// `hubs_json`: [[lon, lat], ...]. Snaps and caches hub node indices.
    pub fn set_hubs(&mut self, hubs_json: &str) -> Result<(), JsValue> {
        let hubs: Vec<[f64; 2]> =
            serde_json::from_str(hubs_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.hub_nodes =
            hubs.iter().filter_map(|&[lon, lat]| self.rg.nearest_node(lon, lat)).collect();
        Ok(())
    }

    /// `targets_json`: [{"id","lon","lat"}, ...]. Snaps and caches target
    /// node indices (e.g. one per settlement).
    pub fn set_targets(&mut self, targets_json: &str) -> Result<(), JsValue> {
        let targets: Vec<TargetPoint> =
            serde_json::from_str(targets_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.target_nodes = targets
            .into_iter()
            .map(|t| {
                let node = self.rg.nearest_node(t.lon, t.lat);
                (t.id, node)
            })
            .collect();
        Ok(())
    }

    /// Returns a JSON array of {"id", "distance_m"} for the cached targets
    /// — distance_m is null when unreachable from every hub given the
    /// current network state. Call `set_hubs`/`set_targets` at least once
    /// before this.
    pub fn compute_reachability(&self) -> Result<String, JsValue> {
        let dist = reachability::multi_source_distances(&self.rg, &self.hub_nodes);

        let results: Vec<SettlementResult> = self
            .target_nodes
            .iter()
            .map(|(id, node)| SettlementResult {
                id: id.clone(),
                distance_m: node.and_then(|n| dist.get(&n).copied()),
            })
            .collect();

        serde_json::to_string(&results).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// One-shot full state for the dashboard: settlement reachability,
    /// per-road-feature state, renderable per-piece road geometry with
    /// reachability, and active point breaks.
    ///
    /// Returns JSON:
    /// ```json
    /// {
    ///   "settlements": [{"id","distance_m"}...],
    ///   "roads": [{"reachable","broken","total"}...],
    ///   "pieces": [{"feature", "coords": [[lon,lat],...], "reachable"}...],
    ///   "breaks": [{"id","lon","lat","osm_id"}...]
    /// }
    /// ```
    ///
    /// `roads` is indexed by feature order in the input roads GeoJSON;
    /// `pieces` are the map's render primitives (a point break splits one
    /// road's pieces so the near side stays green and the far side goes
    /// dark); `distance_m` is null when a settlement is unreachable.
    pub fn compute_state(&self) -> Result<String, JsValue> {
        let dist = reachability::multi_source_distances(&self.rg, &self.hub_nodes);

        let settlements: Vec<SettlementResult> = self
            .target_nodes
            .iter()
            .map(|(id, node)| SettlementResult {
                id: id.clone(),
                distance_m: node.and_then(|n| dist.get(&n).copied()),
            })
            .collect();

        let roads: Vec<RoadResult> =
            self.rg.feature_states(&dist).into_iter().map(Into::into).collect();

        let pieces: Vec<PieceResult> = self
            .rg
            .segment_pieces(&dist)
            .into_iter()
            .map(|p| PieceResult { feature: p.feature, coords: p.coords, reachable: p.reachable })
            .collect();

        let breaks: Vec<BreakResult> = self
            .rg
            .breaks()
            .into_iter()
            .map(|(id, lon, lat, osm_id)| BreakResult { id, lon, lat, osm_id })
            .collect();

        let result = StateResult { settlements, roads, pieces, breaks };
        serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_geojson() -> &'static str {
        r#"{
            "type": "FeatureCollection",
            "features": [
                {"properties": {"osm_id": 1, "oneway": "yes"}, "geometry": {"type": "LineString", "coordinates": [[0.0, 0.0], [0.001, 0.0]]}}
            ]
        }"#
    }

    #[test]
    fn settlement_result_shape_is_serializable() {
        let s = SettlementResult { id: "x".into(), distance_m: Some(12.5) };
        let js = serde_json::to_string(&s).unwrap();
        assert_eq!(js, r#"{"id":"x","distance_m":12.5}"#);
    }

    #[test]
    fn compute_state_serializes_settlements_and_roads() {
        let mut e = Engine::new(sample_geojson()).unwrap();
        e.set_hubs("[[0.0, 0.0]]").unwrap();
        e.set_targets(r#"[{"id": "s1", "lon": 0.001, "lat": 0.0}]"#).unwrap();
        let s = e.compute_state().unwrap();
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["settlements"][0]["id"], "s1");
        assert_eq!(v["roads"].as_array().unwrap().len(), 1);
        assert_eq!(v["roads"][0]["total"], 1);
        assert_eq!(v["roads"][0]["broken"], 0);
        // Pieces: one per coordinate pair; all reachable before a break.
        assert_eq!(v["pieces"].as_array().unwrap().len(), 1);
        assert_eq!(v["pieces"][0]["reachable"], true);
        assert_eq!(v["breaks"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn breaking_edge_marks_road_broken_and_far_end_unreachable() {
        let mut e = Engine::new(sample_geojson()).unwrap();
        e.set_hubs("[[0.0, 0.0]]").unwrap();
        e.set_targets(r#"[{"id": "far", "lon": 0.001, "lat": 0.0}]"#).unwrap();

        let before = serde_json::from_str::<serde_json::Value>(&e.compute_state().unwrap()).unwrap();
        assert_eq!(before["roads"][0]["broken"], 0);
        assert!(before["settlements"][0]["distance_m"].is_number());

        e.set_edge_status(1.0, false);
        let after = serde_json::from_str::<serde_json::Value>(&e.compute_state().unwrap()).unwrap();
        assert_eq!(after["roads"][0]["broken"], 1);
        assert!(after["settlements"][0]["distance_m"].is_null());
    }

    #[test]
    fn point_break_splits_pieces_and_registers_break() {
        // One long two-way road; a point break in the middle should split
        // the renderable pieces (near side reachable, far side not) and
        // register a break for the marker layer.
        let json = r#"{
            "type": "FeatureCollection",
            "features": [
                {"properties": {"osm_id": 10, "oneway": ""}, "geometry": {"type": "LineString", "coordinates": [[0.0, 0.0], [0.003, 0.0]]}}
            ]
        }"#;
        let mut e = Engine::new(json).unwrap();
        e.set_hubs("[[0.0, 0.0]]").unwrap();
        e.set_targets(r#"[{"id": "s", "lon": 0.003, "lat": 0.0}]"#).unwrap();

        e.set_break(0.0015, 0.0).expect("first break should succeed");
        assert_eq!(e.break_count(), 1);

        let s = e.compute_state().unwrap();
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();

        // Two pieces: hub side reachable, far side unreachable.
        let pieces = v["pieces"].as_array().unwrap();
        assert_eq!(pieces.len(), 2);
        assert_eq!(pieces[0]["reachable"], true);
        assert_eq!(pieces[1]["reachable"], false);
        assert_eq!(pieces[0]["feature"], 0);
        assert_eq!(pieces[1]["feature"], 0);

        // Break marker registered with the split location + road id.
        let breaks = v["breaks"].as_array().unwrap();
        assert_eq!(breaks.len(), 1);
        assert_eq!(breaks[0]["osm_id"], 10);
        assert_eq!(breaks[0]["lon"], 0.0015);
        assert_eq!(breaks[0]["lat"], 0.0);

        // Settlement past the break is unreachable.
        assert!(v["settlements"][0]["distance_m"].is_null());

        // Restoring removes the break but keeps the split geometry.
        let id = breaks[0]["id"].as_str().unwrap().to_string();
        assert!(e.restore_break(&id));
        assert_eq!(e.break_count(), 0);
        let s2 = e.compute_state().unwrap();
        let v2: serde_json::Value = serde_json::from_str(&s2).unwrap();
        assert_eq!(v2["breaks"].as_array().unwrap().len(), 0);
        assert!(v2["settlements"][0]["distance_m"].is_number());
        assert_eq!(v2["pieces"].as_array().unwrap().len(), 2);

        // Reset works too (fresh break, then reset clears it).
        e.set_break(0.0015, 0.0).expect("re-break after restore should succeed");
        e.reset_breaks();
        assert_eq!(e.break_count(), 0);
    }
}