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
        // Whisper-thin border (20% opacity) so the field reads as borderless
        // but still has tactile hit-area clarity. Gold glow on focus.
        "h-8 w-full min-w-0 rounded-lg border border-input/20 bg-black/[0.03] px-2.5 py-1 text-base transition-all outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/60 hover:border-input/40 focus-visible:border-gold-400 focus-visible:bg-white/70 focus-visible:ring-2 focus-visible:ring-gold-400/20 focus-visible:shadow-[0_0_0_4px_rgba(192,154,46,0.08)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
