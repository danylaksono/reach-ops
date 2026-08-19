import { Gauge, Route, ClipboardList } from "lucide-react";
import { useDashboardStore } from "../store/useDashboardStore";
import type { ViewMode } from "../lib/types";
import { cn } from "../lib/cn";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

const DESTINATIONS: { id: ViewMode; label: string; icon: typeof Gauge }[] = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "accessibility", label: "Accessibility", icon: Route },
  { id: "dala", label: "Damage & Loss", icon: ClipboardList },
];

export function NavRail() {
  const view = useDashboardStore((s) => s.view);
  const setView = useDashboardStore((s) => s.setView);

  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2">
      <TooltipProvider delayDuration={200}>
        {DESTINATIONS.map(({ id, label, icon: Icon }) => (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setView(id)}
                aria-label={label}
                aria-current={view === id}
                className={cn(
                  "flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-sm border border-transparent text-ink-muted transition-colors hover:text-ink",
                  view === id && "border-line-strong bg-panel-raised text-status-hub",
                )}
              >
                <Icon size={17} strokeWidth={2} />
                <span className="font-display text-[8.5px] font-semibold uppercase leading-none">
                  {label.split(" ")[0]}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ))}
      </TooltipProvider>
    </nav>
  );
}
