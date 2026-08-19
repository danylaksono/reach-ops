import { useMemo } from "react";
import { useDashboardStore } from "../store/useDashboardStore";
import type { SettlementRow } from "./types";

const SORTERS: Record<string, (a: SettlementRow, b: SettlementRow) => number> = {
  cutoff: (a, b) =>
    Number(a.reached) - Number(b.reached) || (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity),
  need: (a, b) => b.population - a.population || SORTERS.cutoff(a, b),
  name: (a, b) => a.name.localeCompare(b.name),
};

/** The joined need + cutoff view — one ranked list, reused by every panel
 *  that shows settlement priority (today: the sidebar list; later: Overview
 *  and the DALA sector table too — see AGENTS.md's Phase 3 notes). */
export function useSettlementRows(limit = 50): SettlementRow[] {
  const targets = useDashboardStore((s) => s.targets);
  const lastResult = useDashboardStore((s) => s.lastResult);
  const buildingCountByCode = useDashboardStore((s) => s.buildingCountByCode);
  const settleSort = useDashboardStore((s) => s.settleSort);

  return useMemo(() => {
    const byId = new Map((lastResult?.settlements ?? []).map((s) => [s.id, s.distance_m]));
    const rows: SettlementRow[] = targets
      .filter((t) => t.name && t.code)
      .map((t) => {
        const d = byId.get(t.id) ?? null;
        return {
          ...t,
          distance_m: d,
          reached: d !== null,
          buildings: buildingCountByCode.get(String(t.code)) ?? 0,
        };
      });
    rows.sort(SORTERS[settleSort] ?? SORTERS.cutoff);
    return rows.slice(0, limit);
  }, [targets, lastResult, buildingCountByCode, settleSort, limit]);
}
