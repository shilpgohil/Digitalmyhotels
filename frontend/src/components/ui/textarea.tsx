import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // CLIENT SPEC: white bg, 6px radius (matches Input/Select).
        "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-white px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-gold-400 focus-visible:ring-2 focus-visible:ring-gold-400/20 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
