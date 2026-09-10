/**
 * InlineSpinner — a tiny branded arc spinner for use inside buttons.
 *
 * Matches the RouteLoader / FullPageSpinner aesthetic at micro scale.
 * Uses `currentColor` so it adapts to whatever the parent button's text color
 * is (white on dark buttons, navy on light buttons, etc.).
 *
 * Usage:
 *   {submitting && <InlineSpinner />}
 *   {submitting ? "Saving..." : "Save"}
 */

import { cn } from "@/lib/utils";

export function InlineSpinner({
  className,
  size = 16,
}: Readonly<{
  className?: string;
  /** Diameter in px. Default: 16 */
  size?: number;
}>) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      {/* Outer arc — 180° (top + right border), matches current color */}
      <span
        className="block rounded-full"
        style={{
          width: size,
          height: size,
          border: `${Math.max(2, Math.round(size / 8))}px solid transparent`,
          borderTopColor: "currentColor",
          borderRightColor: "currentColor",
          animation: "spin 0.75s linear infinite",
        }}
      />
    </span>
  );
}
