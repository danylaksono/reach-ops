import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { useDashboardStore } from "../../store/useDashboardStore";
import { useSettlementRows } from "../../lib/useSettlementRows";
import type { SettlementRow } from "../../lib/types";
import { fmt, metersLabel } from "../../lib/format";
import { STATUS } from "../../lib/palette";
import { useMapView } from "../map-context";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "../../lib/cn";

const columns: ColumnDef<SettlementRow>[] = [
  {
    id: "status",
    header: "",
    size: 14,
    cell: ({ row }) => (
      <span
        className="block h-2 w-2 rounded-full"
        style={{ background: row.original.reached ? STATUS.reachable : STATUS.cutoff }}
      />
    ),
  },
  {
    accessorKey: "name",
    header: "Settlement",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="truncate text-[12px] text-ink">{row.original.name}</div>
        <div className="truncate font-mono text-[10px] text-ink-faint">{row.original.kab_kota_name}</div>
      </div>
    ),
  },
  {
    accessorKey: "population",
    header: "Pop.",
    cell: ({ row }) => <span className="font-mono text-[11px] text-ink-muted">{fmt(row.original.population)}</span>,
  },
  {
    id: "status_label",
    header: "",
    cell: ({ row }) =>
      row.original.reached ? (
        <span className="font-mono text-[10.5px] text-ink-faint">{metersLabel(row.original.distance_m)}</span>
      ) : (
        <Badge tone="cutoff">Cutoff</Badge>
      ),
  },
];

/** The priority/triage list — need (population) + cutoff (reachability)
 *  joined in one ranked view, per AGENTS.md's Phase 3 plan. */
export function SettlementTable() {
  const settleSort = useDashboardStore((s) => s.settleSort);
  const setSettleSort = useDashboardStore((s) => s.setSettleSort);
  const rows = useSettlementRows();
  const mapRef = useMapView();

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3 pt-2">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-display text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">
          Priority list
        </h3>
        <select
          value={settleSort}
          onChange={(e) => setSettleSort(e.target.value as never)}
          className="rounded-sm border border-line bg-panel-raised px-1.5 py-1 font-mono text-[10.5px] text-ink outline-none"
        >
          <option value="cutoff">Highest risk</option>
          <option value="need">Highest need</option>
          <option value="name">Name</option>
        </select>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <table className="w-full border-collapse">
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => mapRef.current?.flyTo([row.original.lon, row.original.lat])}
                className={cn(
                  "cursor-pointer border-b border-line/60 hover:bg-panel-raised",
                  !row.original.reached && "bg-status-cutoff/[0.04]",
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-1.5 py-1.5 align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}
