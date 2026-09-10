"use client";

/**
 * PageTransition — wraps page children in a keyed container.
 *
 * When the pathname changes (Next.js App Router navigation), React will
 * unmount/remount the children because the key changes. This triggers the
 * CSS `page-in` animation defined in globals.css — a 150ms opacity+lift
 * fade-in that makes every route change feel smooth instead of hard-cut.
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
      style={{ animation: "page-in 0.15s ease both" }}
    >
      {children}
    </div>
  );
}
