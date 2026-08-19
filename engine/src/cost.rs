//! Configurable travel-cost model: converts a graph edge's static
//! attributes (road class, length, and — once populated — terrain) into a
//! travel-time weight for Dijkstra. Kept separate from `RoadGraph` so the
//! same physical network can be re-costed on the fly (an operator tuning
//! speed assumptions, or later a terrain layer) without rebuilding the
//! graph — only Dijkstra needs to rerun. See `Engine::set_cost_model`.
//!
//! Terrain is not implemented yet. `EdgeData::terrain_multiplier` is
//! threaded through `time_seconds()` already (uniformly 1.0 for every edge
//! right now) so wiring in a real terrain layer later — Flores is steep
//! enough that slope is a genuine cost, not a rounding error — is a
//! data-population problem (join a slope-derived multiplier onto edges at
//! graph-build time, e.g. from a DEM), not an architecture change.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::graph::EdgeData;

/// Assumed travel speed (km/h) per OSM `highway` tag, plus a fallback for
/// unlisted classes. These are configurable defaults, not authoritative —
/// a coordinator with better local knowledge should be able to override
/// them from the dashboard without a rebuild (`Engine::set_cost_model`
/// takes this same shape as JSON; `Engine::cost_model_json` reads the
/// current one back so the UI never hardcodes a second copy of the
/// defaults).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostModel {
    pub speeds_kmh: HashMap<String, f64>,
    pub default_speed_kmh: f64,
}

/// Floor on any configured speed so a bad value (0, negative, or an
/// overly aggressive edit from the UI) can never produce an infinite or
/// NaN travel time — both of which `serde_json` refuses to serialize, and
/// would otherwise turn one bad input into a total dashboard crash instead
/// of just a very slow road.
const MIN_SPEED_KMH: f64 = 0.5;

// Class coverage checked against the actual Flores extract
// (`data/flores/roads.geojson`): residential, unclassified, track,
// tertiary, trunk, secondary, primary, living_street, and the three
// `_link` classes account for every edge in it. `motorway`/`path`/
// `footway` don't occur there but are kept for portability to other study
// areas — see AGENTS.md for the "not NTT-specific" intent.
fn default_speeds() -> HashMap<String, f64> {
    [
        ("motorway", 70.0),
        ("trunk", 55.0),
        ("trunk_link", 35.0),
        ("primary", 45.0),
        ("primary_link", 30.0),
        ("secondary", 35.0),
        ("secondary_link", 25.0),
        ("tertiary", 28.0),
        ("tertiary_link", 20.0),
        ("unclassified", 20.0),
        ("residential", 20.0),
        ("living_street", 12.0),
        ("service", 15.0),
        ("track", 12.0),
        ("path", 5.0),
        ("footway", 5.0),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect()
}

impl Default for CostModel {
    fn default() -> Self {
        CostModel { speeds_kmh: default_speeds(), default_speed_kmh: 20.0 }
    }
}

impl CostModel {
    pub fn speed_kmh(&self, highway: &str) -> f64 {
        self.speeds_kmh
            .get(highway)
            .copied()
            .unwrap_or(self.default_speed_kmh)
            .max(MIN_SPEED_KMH)
    }

    /// Travel time (seconds) to cross one edge, given its physical length,
    /// road class, and terrain multiplier (currently always 1.0 — see
    /// module docs).
    pub fn time_seconds(&self, edge: &EdgeData) -> f64 {
        let speed_ms = self.speed_kmh(&edge.highway) * 1000.0 / 3600.0;
        (edge.length_m / speed_ms) * edge.terrain_multiplier
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_class_uses_its_own_speed() {
        let cm = CostModel::default();
        let edge = EdgeData {
            osm_id: 1,
            length_m: 1000.0,
            passable: true,
            highway: "trunk".into(),
            terrain_multiplier: 1.0,
        };
        // 1000m at 55km/h = 65.4...s
        let expected = 1000.0 / (55.0 * 1000.0 / 3600.0);
        assert!((cm.time_seconds(&edge) - expected).abs() < 1e-6);
    }

    #[test]
    fn unknown_class_falls_back_to_default_speed() {
        let cm = CostModel::default();
        let edge = EdgeData {
            osm_id: 1,
            length_m: 1000.0,
            passable: true,
            highway: "surprise_tag".into(),
            terrain_multiplier: 1.0,
        };
        let expected = 1000.0 / (20.0 * 1000.0 / 3600.0);
        assert!((cm.time_seconds(&edge) - expected).abs() < 1e-6);
    }

    #[test]
    fn zero_speed_is_floored_not_infinite() {
        let mut cm = CostModel::default();
        cm.speeds_kmh.insert("footway".into(), 0.0);
        let edge = EdgeData {
            osm_id: 1,
            length_m: 100.0,
            passable: true,
            highway: "footway".into(),
            terrain_multiplier: 1.0,
        };
        assert!(cm.time_seconds(&edge).is_finite());
    }

    #[test]
    fn terrain_multiplier_scales_time() {
        let cm = CostModel::default();
        let flat = EdgeData {
            osm_id: 1,
            length_m: 1000.0,
            passable: true,
            highway: "track".into(),
            terrain_multiplier: 1.0,
        };
        let steep = EdgeData { terrain_multiplier: 2.0, ..flat.clone() };
        assert!((cm.time_seconds(&steep) - cm.time_seconds(&flat) * 2.0).abs() < 1e-9);
    }

    #[test]
    fn round_trips_through_json_in_camel_case() {
        let cm = CostModel::default();
        let json = serde_json::to_string(&cm).unwrap();
        assert!(json.contains("\"speedsKmh\""));
        assert!(json.contains("\"defaultSpeedKmh\""));
        let back: CostModel = serde_json::from_str(&json).unwrap();
        assert_eq!(back.default_speed_kmh, cm.default_speed_kmh);
    }
}
