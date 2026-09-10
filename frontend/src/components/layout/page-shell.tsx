/**
 * PageShell — consistent page wrapper for every partner page.
 *
 * Eliminates the repeated pattern across all 26 partner pages:
 *   <PartnerHeader title="..." subtitle="..." />
 *   <main className="flex-1 overflow-y-auto p-6"> ... </main>
 *
 * Usage:
 *   <PageShell title="Payments" subtitle="Money">
 *     <div>page content</div>
 *   </PageShell>
 *
 *   // With a right-side action:
 *   <PageShell title="Expenses" action={<Button>Add</Button>}>
 *     ...
 *   </PageShell>
 */
import { type ReactNode } from "react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { cn } from "@/lib/utils";

interface PageShellProps {
  title: string;
  subtitle?: string;
  /** Right-side header action (button, badge, etc.) */
  action?: ReactNode;
  children: ReactNode;
  /** Extra classes on the <main> element */
  className?: string;
  /** Remove default padding (for full-bleed content) */
  noPadding?: boolean;
}

export function PageShell({
  title,
  subtitle,
  action,
  children,
  className,
  noPadding = false,
}: PageShellProps) {
  return (
    <>
      <PartnerHeader title={title} subtitle={subtitle} action={action} />
      <main
        className={cn(
          "flex-1 overflow-y-auto",
          !noPadding && "p-4 sm:p-6",
          className,
        )}
      >
        {children}
      </main>
    </>
  );
}
