"use client";

/**
 * RouteLoader — branded DMH logo spinner shown on every page navigation.
 *
 * Replaces the thin gold progress bar (RouteProgress) with a premium
 * circular loader that uses the DigitalMyHotels icon mark:
 *
 *   ╭──────────────────╮
 *   │   ╭────────╮     │
 *   │   │ 🏨 D  │     │  ← DMH icon (32px)
 *   │   ╰────────╯     │  ← gold arc spins around it (180°, 0.75s)
 *   │   fixed bottom-R │
 *   ╰──────────────────╯
 *
 * The spinning gold arc directly mirrors the brand's swirl element.
 * Position: fixed bottom-6 right-6 (non-intrusive, universal).
 * Z-index: 9998 (below FullPageSpinner, above everything else).
 *
 * Animation:
 *   - Entrance: scale 0.6 + opacity 0 → 1 in 180ms (pop-in)
 *   - Exit: scale 0.6 + opacity 1 → 0 in 150ms (pop-out)
 *   - Ring: 180° gold arc (border-top + border-right) spinning at 0.75s/rev
 */

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

export function RouteLoader() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<"hidden" | "entering" | "visible" | "leaving">("hidden");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  };

  useEffect(() => {
    clear();
    // Enter
    setPhase("entering");
    const t1 = setTimeout(() => setPhase("visible"), 180);
    // Begin leaving after content has settled
    const t2 = setTimeout(() => setPhase("leaving"), 650);
    // Remove from DOM
    const t3 = setTimeout(() => setPhase("hidden"), 800);
    timers.current = [t1, t2, t3];
    return clear;
  }, [pathname]);

  if (phase === "hidden") return null;

  const isEntering = phase === "entering";
  const isLeaving = phase === "leaving";

  return (
    <div
      aria-hidden
      className="fixed bottom-6 right-6 z-[9998]"
      style={{
        animation: isEntering
          ? "dmh-loader-in 0.18s cubic-bezier(0.34,1.56,0.64,1) both"
          : isLeaving
          ? "dmh-loader-out 0.15s ease both"
          : undefined,
      }}
    >
      {/* Outer glow ring — subtle white halo */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          boxShadow: "0 0 0 4px rgba(192,154,46,0.12)",
        }}
      />

      {/* White circle card */}
      <div
        className="relative flex items-center justify-center rounded-full bg-white"
        style={{
          width: 52,
          height: 52,
          boxShadow: "0 4px 16px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.08)",
        }}
      >
        {/* ── DMH icon — static in center ── */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/dmh-icon.png"
          alt=""
          width={30}
          height={30}
          className="select-none object-contain"
          draggable={false}
          style={{ zIndex: 1, position: "relative" }}
        />

        {/* ── Spinning gold arc ring ──
            border-top + border-right = 180° arc that rotates clockwise.
            Colour matches logo's gold swirl: var(--gold-500) = #c09a2e  */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            border: "3px solid transparent",
            borderTopColor: "var(--gold-500)",
            borderRightColor: "var(--gold-500)",
            animation: "spin 0.75s linear infinite",
          }}
        />

        {/* ── Secondary arc (counter-rotate) — adds depth ──
            Thinner, slower, opposite direction — creates a layered effect
            reminiscent of the logo's double-swoosh quality. */}
        <div
          className="absolute rounded-full"
          style={{
            inset: 5,
            border: "2px solid transparent",
            borderBottomColor: "color-mix(in srgb, var(--gold-500) 35%, transparent)",
            borderLeftColor: "color-mix(in srgb, var(--gold-500) 35%, transparent)",
            animation: "spin-reverse 1.4s linear infinite",
          }}
        />
      </div>
    </div>
  );
}
