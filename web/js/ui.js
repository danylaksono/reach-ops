// DOM/UI handling for the Reach-Ops dashboard: sidebar tabs, layer toggles,
// settlement list, Spatial Intervention Loop sim panel, HUD, and the map
// tooltip. Pure DOM — no engine/map logic here.

import { metersLabel } from "./data.js";

export class UI {
  constructor() {
    // Topbar
    this.statusEl = document.getElementById("status");
    this.resetBtn = document.getElementById("reset-btn");

    // HUD
    this.reachPctEl = document.getElementById("reach-pct");
    this.popPctEl = document.getElementById("pop-pct");
    this.roadBrokenEl = document.getElementById("road-broken");
    this.recomputeMsEl = document.getElementById("recompute-ms");

    // Sim panel
    this.simSelectedEl = document.getElementById("sim-selected");
    this.breakBtn = document.getElementById("break-btn");
    this.restoreBtn = document.getElementById("restore-btn");

    // Legend + tooltip
    this.tooltipEl = document.getElementById("tooltip");

    // Sidebar
    this.settleListEl = document.getElementById("settle-list");
    this.settleSortEl = document.getElementById("settle-sort");
    this.toggleRoads = document.getElementById("toggle-roads");
    this.toggleBuildings = document.getElementById("toggle-buildings");
    this.toggleSettlements = document.getElementById("toggle-settlements");
    this.toggleHubs = document.getElementById("toggle-hubs");
    this.toggleBreak = document.getElementById("toggle-break");
    this.toggleGik = document.getElementById("toggle-gik");

    this.buildingsStatusEl = document.getElementById("buildings-status");
    this.buildingsRemoteEl = document.getElementById("buildings-remote");
    this.gikStatusEl = document.getElementById("gik-status");
  }

  setStatus(text) {
    this.statusEl.textContent = text;
  }

  /** Wire up static controls (buttons, tabs, layer toggles). */
  bindControls({ onBreak, onRestore, onReset, onToggleVisibility, onSort, onTab }) {
    this.breakBtn.addEventListener("click", onBreak);
    this.restoreBtn.addEventListener("click", onRestore);
    this.resetBtn.addEventListener("click", onReset);
    this.settleSortEl.addEventListener("change", onSort);

    const toggles = [
      ["roads", this.toggleRoads],
      ["buildings", this.toggleBuildings],
      ["settlements", this.toggleSettlements],
      ["hubs", this.toggleHubs],
      ["break", this.toggleBreak],
      ["gik", this.toggleGik],
    ];
    for (const [name, el] of toggles) {
      el.addEventListener("change", () => onToggleVisibility(name, el.checked));
    }
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document
          .querySelectorAll(".tab")
          .forEach((t) => t.classList.remove("active"));
        document
          .querySelectorAll(".tab-body")
          .forEach((b) => b.classList.remove("active"));
        tab.classList.add("active");
        document
          .getElementById(`tab-${tab.dataset.tab}`)
          .classList.add("active");
      });
    });
  }

  updateHud({ reachPct, popPct, brokenCount, recomputeMs }) {
    this.reachPctEl.textContent = reachPct === null ? "—" : `${reachPct}%`;
    this.popPctEl.textContent = popPct === null ? "—" : `${popPct}%`;
    this.roadBrokenEl.textContent = String(brokenCount);
    this.recomputeMsEl.textContent =
      recomputeMs === null ? "—" : `${Math.round(recomputeMs)}ms`;
  }

  setSimSelected(info) {
    if (!info) {
      this.simSelectedEl.textContent = "No road selected.";
      this.breakBtn.disabled = true;
      this.restoreBtn.disabled = true;
      return;
    }
    const name = info.name || "Unnamed road";
    const hw = info.highway || "unknown";
    const status = info.status || "unknown";
    this.simSelectedEl.textContent = `${name} (${hw}) — status: ${status} · OSM ${info.osm_id}`;
    this.breakBtn.disabled = info.status === "broken";
    this.restoreBtn.disabled = info.status !== "broken";
  }

  setSettlementEnabled() {}

  /** Render the top settlements list (need + cutoff joined view). */
  renderSettlements(rows) {
    this.settleListEl.innerHTML = "";
    for (const r of rows) {
      const div = document.createElement("div");
      div.className = "settle-row";
      const dot = document.createElement("span");
      dot.className = "s-dot";
      dot.style.background = r.reached ? "#3fb950" : "#d45c45";
      const name = document.createElement("span");
      name.className = "s-name";
      name.textContent = r.name;
      name.title = `${r.kab_kota_name}`;
      const meta = document.createElement("span");
      meta.className = "s-meta";
      meta.textContent = metersLabel(r.distance_m) ?? "";
      const pill = document.createElement("span");
      if (!r.reached) {
        pill.className = "s-pill";
        pill.textContent = "cutoff";
      }
      div.append(dot, name, meta, pill);
      // Clicking a row flies to the settlement centroid.
      div.addEventListener("click", () => this._onFlyTo?.(r));
      this.settleListEl.appendChild(div);
    }
  }

  setOnFlyTo(fn) {
    this._onFlyTo = fn;
  }

  showTooltip(html, x, y, mapContainer) {
    const el = this.tooltipEl;
    if (!html) {
      el.hidden = true;
      return;
    }
    el.innerHTML = html;
    el.hidden = false;
    const rect = mapContainer.getBoundingClientRect();
    el.style.left = `${x - rect.left + 14}px`;
    el.style.top = `${y - rect.top + 14}px`;
  }
}
