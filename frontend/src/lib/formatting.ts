/**
 * Shared date/time formatting utilities — Indian locale (DD/MM/YYYY).
 *
 * All date/time values from the backend are UTC ISO 8601 strings.
 * All dates are rendered in Indian format (DD/MM/YYYY or DD MMM YYYY).
 */

/**
 * Today's date as YYYY-MM-DD in the user's **local** timezone.
 * Use this instead of `new Date().toISOString().slice(0,10)` which gives UTC
 * and will show yesterday's date for users east of UTC (e.g. IST) after midnight.
 */
export function localToday(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Tomorrow's date as YYYY-MM-DD in the user's local timezone. */
export function localTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Format a UTC ISO datetime string → "31 Aug 2026, 14:30" (Indian style, 24hr).
 * Month name avoids DD/MM vs MM/DD ambiguity in date+time displays.
 */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Format a date-only ISO string → "31 Aug 2026" (Indian style with short month name).
 * Use for displayed dates where readability matters.
 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(`${iso}T00:00:00`));
  } catch {
    return iso;
  }
}

/**
 * Format a raw YYYY-MM-DD API date string → "31/08/2026" (DD/MM/YYYY).
 * Use for compact table cells and inline displays of API date fields.
 */
export function fmtApiDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Fast path: YYYY-MM-DD pattern — parse directly to avoid timezone issues.
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  // Fallback for other formats.
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Format time portion only → "14:30" (24hr). */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Format a UTC ISO datetime as a full locale-aware string → "31 Aug 2026, 14:30:05".
 * Use for audit logs and other verbose displays.
 */
export function fmtDateTimeFull(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
