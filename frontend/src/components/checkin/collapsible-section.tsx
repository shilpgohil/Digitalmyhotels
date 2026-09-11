"use client";
/**
 * CollapsibleSection — accordion-style section card for the check-in form.
 * Each form section (Booking Details, Guest, Room, Payment, etc.) uses this
 * to allow staff to expand/collapse individual sections.
 *
 * Differs from SectionPanel: always has an expand/collapse toggle.
 */
import { type ReactNode, useState } from "react";
import { ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";

interface CollapsibleSectionProps {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Whether the section starts expanded. Default: true */
  defaultOpen?: boolean;
  /** Optional count badge shown on the header (e.g. "2" for 2 guests). */
  badge?: string;
}

export function CollapsibleSection({
  icon: Icon,
  title,
  subtitle,
  children,
  defaultOpen = true,
  badge,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border bg-card shadow-card overflow-hidden transition-shadow duration-200">
      <button
        type="button"
        className="flex w-full items-center justify-between px-5 py-4"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="flex size-7 items-center justify-center rounded-md bg-gold-50">
              <Icon className="size-4 text-gold-600" aria-hidden />
            </div>
          )}
          <div className="text-left">
            <p className="font-semibold text-sm text-foreground">{title}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {badge && (
            <span className="ml-2 rounded-full bg-gold-100 px-2 py-0.5 text-micro font-semibold text-gold-700">
              {badge}
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground shrink-0" aria-hidden />
        )}
      </button>
      {open && <div className="border-t px-5 py-5">{children}</div>}
    </div>
  );
}
