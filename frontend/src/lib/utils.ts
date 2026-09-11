import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * tailwind-merge does NOT know our custom typography utilities
 * (text-micro / text-label / text-caption — defined in globals.css).
 * Without this config it misclassifies them as text-COLOR classes, so
 * `cn("text-micro", "text-danger")` would DELETE text-micro and the
 * element silently inherits a 14–16px font — the root cause of the
 * "random oversized fonts" bug (status chips, badges, notifications).
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": ["text-micro", "text-label", "text-caption"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
