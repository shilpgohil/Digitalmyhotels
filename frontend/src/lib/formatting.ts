/**
 * Shared date/time formatting utilities.
 *
 * All datetimes from the backend are UTC ISO 8601 strings.
 * We render them in a human-readable format using the browser locale.
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

/** Format a UTC ISO datetime string as DD MMM YYYY, HH:mm (24hr, local zone). */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
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

/** Format a date-only string as DD MMM YYYY. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(`${iso}T00:00:00`));
  } catch {
    return iso;
  }
}

/** Format time portion only (HH:mm 24hr). */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
