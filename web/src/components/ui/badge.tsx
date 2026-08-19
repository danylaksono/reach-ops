import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
  {
    variants: {
      tone: {
        neutral: "bg-panel-raised text-ink-muted border border-line",
        cutoff: "bg-status-cutoff/15 text-status-cutoff",
        broken: "bg-status-broken/15 text-status-broken",
        reachable: "bg-status-reachable/15 text-status-reachable",
        report: "bg-status-report/15 text-status-report",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone, className }))} {...props} />;
}
