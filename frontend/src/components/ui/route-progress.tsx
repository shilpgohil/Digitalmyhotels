"use client";

/**
 * RouteProgress — a thin gold bar fixed at the very top of the viewport.
 *
 * Fires on every client-side route change (detected via usePathname).
 * Animates from 0 → 88% (fast) then jumps to 100% and fades out.
 * Uses brand gold (#c09a2e / --gold-500) matching the DMH logo's swirl arc.
 *
 * No external library required — pure CSS keyframes defined in globals.css.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

export function RouteProgress() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    // Clear any in-flight timers from a previous navigation.
    for (const t of timerRefs.current) clearTimeout(t);
    timerRefs.current = [];

    // Start the bar.
    setPhase("running");

    // After the fill animation completes (600ms for fill + 200ms grace), mark done.
    const t1 = setTimeout(() => setPhase("done"), 800);
    // Remove the element from the DOM after the fade-out transition.
    const t2 = setTimeout(() => setPhase("idle"), 1100);

    timerRefs.current = [t1, t2];

    return () => {
      for (const t of timerRefs.current) clearTimeout(t);
    };
  }, [pathname]);

  if (phase === "idle") return null;

  return (
    <div
      aria-hidden
      className="fixed left-0 top-0 z-[9999] h-[2.5px]"
      style={{
        background: "var(--gold-500)",
        boxShadow: "0 0 6px 0 color-mix(in srgb, var(--gold-500) 60%, transparent)",
        animation:
          phase === "running"
            ? "dmh-progress 0.8s cubic-bezier(0.22, 1, 0.36, 1) forwards"
            : undefined,
        opacity: phase === "done" ? 0 : 1,
        transition: phase === "done" ? "opacity 0.3s ease" : undefined,
        width: phase === "done" ? "100%" : undefined,
      }}
    />
  );
}
