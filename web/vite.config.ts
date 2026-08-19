import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import sirv from "sirv";

// Phase 0 outputs live at `data/<study_area>/`, a sibling of `web/`, and are
// not copied into the app — the dev server needs to reach them at the same
// absolute `/data/...` path the built app fetches from in production (see
// `README.md`: production is just `python -m http.server` from the repo
// root, where `/data` and `/web/dist` are naturally siblings). `sirv` serves
// range requests, which DuckDB-WASM's parquet reader relies on for
// partial reads.
function serveRepoData() {
  return {
    name: "serve-repo-data",
    configureServer(server: import("vite").ViteDevServer) {
      const assets = sirv(path.resolve(__dirname, "..", "data"), {
        dev: true,
        etag: true,
      });
      server.middlewares.use("/data", (req, res, next) => assets(req, res, next));
    },
  };
}

// GitHub Pages project sites are served under /<repo-name>/, not /, so
// every root-relative asset/data reference needs that prefix at build
// time. The deploy workflow sets VITE_BASE_PATH from
// actions/configure-pages' `base_path` output rather than hardcoding the
// repo name here — local `npm run build` (VITE_BASE_PATH unset) still
// produces a root-relative "/" build, e.g. for `python -m http.server`.
const base = process.env.VITE_BASE_PATH ? `${process.env.VITE_BASE_PATH}/` : "/";

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), serveRepoData()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 8731,
  },
  build: {
    outDir: "dist",
  },
});
