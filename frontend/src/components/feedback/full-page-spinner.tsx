/**
 * FullPageSpinner — branded DMH loading screen.
 *
 * Layout (top → bottom):
 *   1. Vertical DigitalMyHotels logo — gentle pulse animation (dmh-pulse)
 *   2. Gold shimmer bar — metallic sweep (dmh-shimmer)
 *   3. Three gold dots — staggered bounce (dmh-dot-bounce)
 *   4. Optional label (screen-reader accessible)
 *
 * Used by RequireAuth, ChangePasswordGuard, and any other full-page
 * waiting state. Replaces the old generic Loader2 spinner.
 */
export function FullPageSpinner({ label }: Readonly<{ label?: string }>) {
  return (
    <output
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white"
      aria-label={label ?? "Loading DigitalMyHotels…"}
    >
      {/* Vertical logo — breathes gently */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/dmh-logo-vertical.png"
        alt="DigitalMyHotels"
        width={200}
        height={120}
        className="select-none object-contain"
        style={{ animation: "dmh-pulse 1.6s ease-in-out infinite" }}
        draggable={false}
      />

      {/* Gold shimmer bar — metallic sweep */}
      <div
        className="relative mt-7 h-[3px] w-48 overflow-hidden rounded-full"
        style={{ background: "var(--navy-100)" }}
        aria-hidden
      >
        <div
          className="absolute inset-y-0 w-full rounded-full"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, var(--gold-500) 40%, #e8c040 55%, transparent 100%)",
            animation: "dmh-shimmer 1.6s ease-in-out infinite",
          }}
        />
      </div>

      {/* Three animated gold dots — staggered bounce */}
      <div className="mt-5 flex items-center gap-2" aria-hidden>
        {[0, 200, 400].map((delay) => (
          <div
            key={delay}
            className="size-2 rounded-full"
            style={{
              background: "var(--gold-500)",
              animation: `dmh-dot-bounce 1.2s ease-in-out infinite`,
              animationDelay: `${delay}ms`,
            }}
          />
        ))}
      </div>

      {/* Optional text label */}
      {label && (
        <p className="mt-5 text-xs font-medium text-muted-foreground">{label}</p>
      )}
    </output>
  );
}
