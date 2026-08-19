import { useMemo } from "react";
import { useDashboardStore } from "../store/useDashboardStore";
import type { SettlementRow } from "./types";

const SORTERS: Record<string, (a: SettlementRow, b: SettlementRow) => number> = {
  cutoff: (a, b) =>
    Number(a.reached) - Number(b.reached) || (a.duration_s ?? Infinity) - (b.duration_s ?? Infinity),
  need: (a, b) => b.population - a.population || SORTERS.cutoff(a, b),
  name: (a, b) => a.name.localeCompare(b.name),
};

/** The joined need + cutoff view — one ranked list, reused by every panel
 *  that shows settlement priority (today: the sidebar list; later: Overview
 *  and the DALA sector table too — see AGENTS.md's Phase 3 notes). Ranked
 *  by travel time now, not distance — see the isochrone/cost-model plan. */
export function useSettlementRows(limit = 50): SettlementRow[] {
  const targets = useDashboardStore((s) => s.targets);
  const lastResult = useDashboardStore((s) => s.lastResult);
  const buildingCountByCode = useDashboardStore((s) => s.buildingCountByCode);
  const settleSort = useDashboardStore((s) => s.settleSort);

  return useMemo(() => {
    const byId = new Map((lastResult?.settlements ?? []).map((s) => [s.id, s]));
    const rows: SettlementRow[] = targets
      .filter((t) => t.name && t.code)
      .map((t) => {
        const s = byId.get(t.id);
        const duration_s = s?.duration_s ?? null;
        return {
          ...t,
          duration_s,
          distance_m: s?.distance_m ?? null,
          reached: duration_s !== null,
          buildings: buildingCountByCode.get(String(t.code)) ?? 0,
        };
      });
    rows.sort(SORTERS[settleSort] ?? SORTERS.cutoff);
    return rows.slice(0, limit);
  }, [targets, lastResult, buildingCountByCode, settleSort, limit]);
}
