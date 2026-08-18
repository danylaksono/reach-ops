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

#[derive(Serialize)]
struct StateResult {
    settlements: Vec<SettlementResult>,
    roads: Vec<RoadResult>,
}

/// Loads a road network once and answers repeated reachability queries as
/// the network state changes (edges marked broken/restored) — the
/// "evaluate" step of the Spatial Intervention Loop in AGENTS.md.
///
/// Hub and target locations are snapped to graph nodes once, via
/// `set_hubs`/`set_targets` (an O(points x nodes) linear scan — fine as a
/// one-off, too slow to repeat on every recompute). `compute_reachability`
/// then only reruns Dijkstra plus O(1) lookups against those cached node
/// indices, so it stays cheap to call after every edge status change.
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
    pub fn set_edge_status(&mut self, osm_id: f64, passable: bool) -> usize {
        self.rg.set_passable(osm_id as i64, passable)
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
    /// current edge state. Call `set_hubs`/`set_targets` at least once
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

    /// One-shot full state for the dashboard: settlement reachability
    /// (same shape as `compute_reachability`) plus per-road-feature state
    /// so each map line can be coloured by reachable/broken/unreachable.
    ///
    /// Returns JSON:
    /// {"settlements":[{"id","distance_m"}...],
    ///  "roads":[{"reachable","broken","total"}...]}
    ///
    /// `roads` is indexed by feature order in the input roads GeoJSON;
    /// `distance_m` is null when a settlement is unreachable from every hub.
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

        let result = StateResult { settlements, roads };
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
}