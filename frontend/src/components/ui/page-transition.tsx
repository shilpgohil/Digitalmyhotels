"use client";

/**
 * PageTransition — wraps page children in a keyed container.
 *
 * When the pathname changes, React remounts the children → triggers the
 * CSS `page-in` animation (opacity-only fade, 150ms).
 *
 * ⚠️  CRITICAL: Do NOT use CSS `transform` in the page-in keyframes.
 * A `transform` on this wrapper element (even translateY(0) via fill-mode:both)
 * creates a new CSS containing block for `position:fixed` descendants.
 * This breaks all sticky footer bars — they'd be pinned to the scroll
 * container rather than the viewport. Opacity-only is safe because
 * `opacity:1` does NOT create a containing block.
 *
 * Used in both (partner) and (super-admin) layouts to wrap {children}.
 */

import { usePathname } from "next/navigation";

export function PageTransition({
  children,
  className,
}: Readonly<{
  children: React.ReactNode;
  className?: string;
}>) {
  const pathname = usePathname();

  return (
    <div
      key={pathname}
      className={className}
      style={{ animation: "page-in 0.15s ease backwards" }}
    >
      {children}
    </div>
  );
}
