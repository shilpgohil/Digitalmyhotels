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
  id,
}: Readonly<{
  children: React.ReactNode;
  className?: string;
  /** Optional id — used by the skip-to-content link in the partner layout. */
  id?: string;
}>) {
  const pathname = usePathname();

  return (
    <div
      id={id}
      key={pathname}
      className={className}
      // 280ms smooth-out fade — 150ms read as an abrupt flash (client 09/2026).
      style={{ animation: "page-in 0.28s cubic-bezier(0.2, 0, 0, 1) backwards" }}
    >
      {children}
    </div>
  );
}
