import { useDashboardStore } from "../../store/useDashboardStore";

export function DataPanel() {
  const buildingsStatus = useDashboardStore((s) => s.buildingsStatus);
  const gikStatus = useDashboardStore((s) => s.gikStatus);

  return (
    <div className="flex flex-col gap-4 p-3 text-[12px] text-ink-muted">
      <section>
        <h3 className="mb-1 font-display text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">
          Buildings
        </h3>
        <p>{buildingsStatus}</p>
        <p className="mt-1 text-[11px] text-ink-faint">
          Per-settlement building counts, queried in-browser via DuckDB-WASM from{" "}
          <code className="rounded-sm bg-panel-raised px-1 py-0.5 font-mono text-[10.5px]">
            buildings_by_settlement.parquet
          </code>
          . No server round-trip.
        </p>
      </section>
      <section>
        <h3 className="mb-1 font-display text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">
          GIK field reports
        </h3>
        <p>{gikStatus}</p>
        <p className="mt-1 text-[11px] text-ink-faint">
          Crowdsourced needs reports from the UGM Geoportal Informasi Kebencanaan (
          <a
            href="https://geoportal.science/gik/dashboard.html"
            target="_blank"
            rel="noopener"
            className="text-status-hub hover:underline"
          >
            geoportal.science/gik
          </a>
          ), fetched by <code className="rounded-sm bg-panel-raised px-1 py-0.5 font-mono text-[10.5px]">pipeline.gik</code>{" "}
          and clipped to the study area.
        </p>
      </section>
      <section>
        <h3 className="mb-1 font-display text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">
          About
        </h3>
        <p>
          Reach-Ops is a prototype disaster-response dashboard for the 15 August 2026 Flores earthquake — OSM roads +
          Kontur population, with a Rust/petgraph engine running in the browser via WebAssembly. Accessibility is a
          multi-source Dijkstra from aid hubs; broken roads cut off the network downstream.
        </p>
        <p className="mt-1 text-[11px] text-ink-faint">
          Hubs are placeholder regency centroids — swap in real airstrip/port/warehouse coordinates when a
          coordinator supplies them.
        </p>
      </section>
    </div>
  );
}
