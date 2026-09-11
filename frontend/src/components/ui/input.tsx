import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // Gold glow focus — soft ring + shadow for premium hospitality feel.
        // hover: border slightly brightens before focus (responsive feel).
        // Classic subtle border with gold focus glow (toned down, minimal).
        "h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 text-base transition-all outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-muted-foreground/40 focus-visible:border-gold-400 focus-visible:ring-2 focus-visible:ring-gold-400/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
