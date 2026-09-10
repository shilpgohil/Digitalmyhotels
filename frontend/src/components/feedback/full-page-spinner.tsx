/**
 * FullPageSpinner — branded DMH loading screen.
 *
 * Used by RequireAuth and any other full-page wait state.
 * Shows the vertical DigitalMyHotels logo with a gold shimmer bar below it.
 * Logo gently breathes (dmh-pulse) while the bar sweeps (dmh-shimmer).
 */

// eslint-disable-next-line @next/next/no-img-element
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

      {/* Gold shimmer bar */}
      <div
        className="relative mt-8 h-[3px] w-44 overflow-hidden rounded-full"
        style={{ background: "var(--navy-100)" }}
        aria-hidden
      >
        <div
          className="absolute inset-y-0 w-full rounded-full"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, var(--gold-500) 45%, #e8c040 55%, transparent 100%)",
            animation: "dmh-shimmer 1.6s ease-in-out infinite",
          }}
        />
      </div>

      {/* Optional label — screen-reader only by default */}
      {label && (
        <p className="mt-5 text-xs font-medium text-muted-foreground">{label}</p>
      )}
    </output>
  );
}
