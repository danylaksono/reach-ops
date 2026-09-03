# ALUR operation provider

Exposes the Reach-Ops wasm engine as a calculation ALUR can call, so a
coordinator can run accessibility against their own data in ALUR's workspace
instead of this repo's dashboard.

It lives here rather than in ALUR deliberately. ALUR ships no analytical
calculation — its `src/providers/index.ts` is empty and a reviewer can check
that — so anything that knows what a road is belongs in the repo that owns the
road graph.

## What it declares

| | |
| --- | --- |
| **Inputs** | `network` (lines), `origins` (any geometry), `destinations` (any geometry) |
| **Settings** | a fallback speed plus one speed per segment class |
| **Changes** | `sever` — split the network at a point; `place-origin` — add an origin at a point |
| **Outputs** | `reach` — travel time joined per destination; `network_state` — the network as lines carrying reachability |
| **Measure** | mean travel time, lower is better |

Column names are bound by the analyst, not assumed. The graph builder reads
`osm_id`, `highway` and `oneway` off each feature by name, so `index.js` renames
whatever columns were bound to those before handing the network over — that
bridging is the adapter's job, and it is why the same provider works against data
that calls its columns something else.

Origins and destinations accept any geometry and are reduced to a vertex-average
representative point. Real destination data is rarely points; Flores settlements
arrive as boundaries, and requiring conversion first would make the calculation
unusable against the data it exists to answer questions about.

## Contract

Documented in ALUR's `src/types/operations.ts`. Nothing here imports from ALUR —
the interface is structural, which is what makes an open ecosystem possible. The
lifecycle is `create → setChanges / setParameters → evaluate → dispose`, split
that way because building the graph costs seconds and re-running Dijkstra costs
milliseconds.

`setChanges` receives the **whole ordered list** and must make the engine's state
equal exactly that list, not add to it. This adapter calls `reset_breaks()` and
replays. Diffing against the previous list would be faster, but replaying a few
dozen severances costs a fraction of the Dijkstra that follows, and it is what
makes undo provably exact rather than approximately right.

## Verifying

```sh
node alur-provider/verify.mjs
```

Drives the whole contract against the real Flores network and the real wasm —
the same thing ALUR's worker host does. Needs `data/flores/` (from
`pipeline.run`) and a built `web/pkg/` (see the root README).

Last run: graph built in ~7.2s from 41MB of roads, 1416 of 1619 destinations
reached, mean 4012s, 862,009 render pieces. Severing an arterial raised the mean
to 4099s; placing an origin at the worst-served settlement brought it to 4084s;
replaying an earlier change list reproduced its result byte for byte.

Those numbers moved when the road network switched to Overture (see the root
README): 1411 → 1416 reached, and the build got slower because the network got
bigger — 31MB and 25,360 segments before, 41MB and 48,261 now, for the same
16,000 km of road cut into ~2x as many pieces.

The severance check moved with it. It picks the arterial to cut *from the data*,
and used to take the first trunk/primary way in the file; that passed only
because feature order happened to favour it. On the Overture network the first
arterial in the file is a stub carrying no shortest path, so the cut moved
nothing and the check failed — correctly, having caught its own weak premise.
It now picks the longest trunk/primary way, aggregating by `osm_id` because that
is the unit a severance actually removes.

## Serving it to ALUR

ALUR loads a provider by URL inside a worker, so this directory and `../web/pkg`
need to be reachable over HTTP **with CORS allowed**.

`python -m http.server` will not do — it sends no `Access-Control-Allow-Origin`
header, and a cross-origin module import fails with a bare `net::ERR_FAILED` that
looks like the file is missing. Verified the hard way. Use anything that sets the
header, e.g.:

```sh
npx serve --cors -l 8732 .     # from the repo root
```

Then point ALUR's **Calculations** panel at
`http://localhost:8732/alur-provider/index.js`.

Serving from the repo root matters: `index.js` statically imports
`../web/pkg/reach_ops_engine.js`, and that glue fetches its own `.wasm`
relative to itself.
