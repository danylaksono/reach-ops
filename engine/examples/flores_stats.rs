//! Sanity check: load the real Phase 0 output and report graph size plus
//! a sample reachability run from the placeholder hubs.
//! Run: cargo run --example flores_stats

use std::fs;
use std::time::Instant;

use reach_ops_engine::cost::CostModel;
use reach_ops_engine::graph::RoadGraph;
use reach_ops_engine::reachability::multi_source_times;

fn main() {
    let roads_json = fs::read_to_string("../data/flores/roads.geojson").expect("read roads.geojson");
    let hubs_json = fs::read_to_string("../data/flores/hubs.geojson").expect("read hubs.geojson");

    let t0 = Instant::now();
    let rg = RoadGraph::from_geojson(&roads_json).expect("parse roads.geojson");
    println!(
        "graph: {} nodes, {} edges, built in {:?}",
        rg.node_count(),
        rg.edge_count(),
        t0.elapsed()
    );

    let hubs: serde_json::Value = serde_json::from_str(&hubs_json).unwrap();
    let hub_nodes: Vec<_> = hubs["features"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|f| {
            let coords = f["geometry"]["coordinates"].as_array()?;
            let lon = coords[0].as_f64()?;
            let lat = coords[1].as_f64()?;
            rg.nearest_node(lon, lat)
        })
        .collect();
    println!("snapped {} hub points to graph nodes", hub_nodes.len());

    let t1 = Instant::now();
    let cost_model = CostModel::default();
    let dist = multi_source_times(&rg, &hub_nodes, &cost_model);
    println!(
        "reachability from {} hubs: {} / {} nodes reached in {:?}",
        hub_nodes.len(),
        dist.len(),
        rg.node_count(),
        t1.elapsed()
    );

    let settlements_json =
        fs::read_to_string("../data/flores/settlements.geojson").expect("read settlements.geojson");
    let settlements: serde_json::Value = serde_json::from_str(&settlements_json).unwrap();
    let centroids: Vec<(f64, f64)> = settlements["features"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| {
            let rings = f["geometry"]["coordinates"].as_array().unwrap();
            let ring = if f["geometry"]["type"] == "Polygon" {
                rings[0].as_array().unwrap().clone()
            } else {
                rings[0].as_array().unwrap()[0].as_array().unwrap().clone()
            };
            let (mut sx, mut sy) = (0.0, 0.0);
            for pt in &ring {
                let p = pt.as_array().unwrap();
                sx += p[0].as_f64().unwrap();
                sy += p[1].as_f64().unwrap();
            }
            (sx / ring.len() as f64, sy / ring.len() as f64)
        })
        .collect();

    let t2 = Instant::now();
    let target_nodes: Vec<_> =
        centroids.iter().filter_map(|&(lon, lat)| rg.nearest_node(lon, lat)).collect();
    println!(
        "snapped {} settlement centroids to graph nodes in {:?}",
        target_nodes.len(),
        t2.elapsed()
    );

    let reached = target_nodes.iter().filter(|n| dist.contains_key(n)).count();
    println!("{} / {} settlements reachable from hubs", reached, target_nodes.len());
}
