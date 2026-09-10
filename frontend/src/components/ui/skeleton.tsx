import { cn } from "@/lib/utils"

/**
 * Skeleton — shimmer loading placeholder.
 * Uses a sweeping gradient (silver shimmer) instead of simple opacity pulse.
 * More visible and professional — matches the gold brand palette.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("dmh-skeleton rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
