import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border text-[11.5px] font-medium tracking-wide uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-status-hub) disabled:pointer-events-none disabled:opacity-35",
  {
    variants: {
      variant: {
        default:
          "border-line bg-panel-raised text-ink hover:bg-line hover:border-line-strong",
        danger:
          "border-status-broken/50 text-status-broken hover:bg-status-broken/10",
        ok: "border-status-reachable/50 text-status-reachable hover:bg-status-reachable/10",
        ghost: "border-transparent text-ink-muted hover:text-ink hover:bg-panel-raised",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2 text-[10.5px]",
        icon: "h-8 w-8 shrink-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  ),
);
Button.displayName = "Button";
