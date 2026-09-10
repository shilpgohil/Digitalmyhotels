/**
 * FullPageSpinner — premium DMH brand loading screen.
 *
 * Uses the same double-arc spinner pattern as RouteLoader but scaled up:
 *   - DMH icon mark (80px) as the centerpiece
 *   - Outer gold arc (4px, 180°) spinning clockwise at 0.75s
 *   - Inner gold arc (2.5px, counter-clockwise, 35% opacity) at 1.4s
 *   - "DigitalMyHotels" wordmark below
 *   - No shimmer bar, no dots — clean and consistent with route loader
 *
 * Used by RequireAuth, ChangePasswordGuard, root page redirect.
 */
export function FullPageSpinner({ label }: Readonly<{ label?: string }>) {
  return (
    <output
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white"
      aria-label={label ?? "Loading DigitalMyHotels…"}
    >
      {/* ── Spinner ring + DMH icon ── */}
      <div className="relative" style={{ width: 96, height: 96 }}>
        {/* Outer glow — subtle gold halo */}
        <div
          className="absolute inset-0 rounded-full"
          style={{ boxShadow: "0 0 0 6px rgba(192,154,46,0.10)" }}
        />

        {/* White circle card */}
        <div
          className="absolute inset-0 rounded-full bg-white"
          style={{ boxShadow: "0 8px 28px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.06)" }}
        />

        {/* DMH icon — centered, static */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/dmh-icon.png"
          alt="DigitalMyHotels"
          width={56}
          height={56}
          className="absolute select-none object-contain"
          style={{
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 1,
          }}
          draggable={false}
        />

        {/* Primary arc — gold, 180°, clockwise, 0.75s */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            border: "4px solid transparent",
            borderTopColor: "var(--gold-500)",
            borderRightColor: "var(--gold-500)",
            animation: "spin 0.75s linear infinite",
          }}
        />

        {/* Secondary arc — inner, counter-clockwise, subtle */}
        <div
          className="absolute rounded-full"
          style={{
            inset: 8,
            border: "2.5px solid transparent",
            borderBottomColor: "color-mix(in srgb, var(--gold-500) 40%, transparent)",
            borderLeftColor: "color-mix(in srgb, var(--gold-500) 40%, transparent)",
            animation: "spin-reverse 1.4s linear infinite",
          }}
        />
      </div>

      {/* ── Wordmark below ── */}
      <div className="mt-8 flex flex-col items-center gap-1 select-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/dmh-logo-horizontal.png"
          alt="DigitalMyHotels"
          height={22}
          className="h-[22px] w-auto object-contain opacity-70"
          draggable={false}
        />
      </div>

      {/* Optional label */}
      {label && (
        <p className="mt-4 text-xs font-medium text-muted-foreground">{label}</p>
      )}
    </output>
  );
}
