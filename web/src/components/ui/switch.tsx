import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../../lib/cn";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-line-strong bg-panel-sunken transition-colors data-[state=checked]:bg-status-hub/70 data-[state=checked]:border-status-hub focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-hub",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-ink-muted shadow transition-transform data-[state=checked]:translate-x-4 data-[state=checked]:bg-ground" />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
