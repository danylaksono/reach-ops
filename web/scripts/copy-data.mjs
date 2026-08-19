// Build-only step: copies the repo-root `data/<study_area>/` outputs into
// `web/public/data/` so `vite build` picks them up as static assets
// (anything in `public/` is copied verbatim into `dist/`). Not needed in
// dev — the `serve-repo-data` middleware in vite.config.ts serves `/data`
// straight from `../data` instead, so the dev server always reflects the
// latest pipeline output without a copy step.
//
// `web/public/data/` is gitignored — this script is the only thing that
// populates it, and the repo-root `data/` (committed, since it can't be
// regenerated without the hand-prepared raw extracts in local-data/ — see
// AGENTS.md's Phase 0 notes) stays the single source of truth.

import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const webDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(webDir, "..", "data");
const dest = path.join(webDir, "public", "data");

if (!existsSync(src)) {
  console.error(`copy-data: no data/ directory at ${src} — run the Phase 0 pipeline first.`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`copy-data: ${src} -> ${dest}`);
