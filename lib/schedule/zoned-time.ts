/**
 * Tiny zone-aware time helpers — no `Temporal`, no date-fns-tz.
 *
 * The recurrence resolver returns a calendar Date (local-midnight).
 * To render an upcoming tournament's start as a real ISO timestamp
 * we need to combine that calendar date with HH:MM in a specified
 * IANA zone, and produce a UTC instant.
 *
 * Standard `new Date(...)` constructors don't accept an IANA zone, so
 * we lean on `Intl.DateTimeFormat` to compute the offset for the
 * (date, time, zone) triple and back out the UTC ms.
 *
 * Pure — no I/O. Safe on both server and client.
 */

/**
 * Return the UTC offset, in minutes, of `tz` at the given UTC instant.
 * Positive when the zone is east of UTC ("Asia/Kolkata" => 330);
 * negative when west ("America/Chicago" CST => -360).
 *
 * Uses `Intl.DateTimeFormat` with `timeZoneName: "longOffset"` which
 * formats as "GMT" or "GMT±HH:MM" in every modern engine — we parse
 * the trailing offset out.
 */
export function offsetMinutesAt(date: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "longOffset",
  });
  // Formatted output looks like "12/31/2025, GMT-06:00". We pull
  // the trailing GMT± piece off without depending on positional
  // tokens, which can vary by locale.
  const parts = fmt.formatToParts(date);
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(tzName);
  if (!m) return 0; // "GMT" alone == zero offset (UTC)
  const sign = m[1] === "-" ? -1 : 1;
  const hours = Number(m[2]);
  const mins = m[3] ? Number(m[3]) : 0;
  return sign * (hours * 60 + mins);
}

/**
 * Given a wall-clock date + time (interpreted in `tz`), return the
 * corresponding UTC `Date`. Handles DST correctly for the typical
 * cases we care about — when the wall clock is unambiguous, the
 * computed offset matches; ambiguous fall-back hour and skipped
 * spring-forward times resolve as if the local clock were valid
 * (good enough for poker night, DST shifts always happen at 2 AM
 * anyway).
 *
 * Inputs:
 *   year/month/day — calendar parts (month is 1-12)
 *   hour/minute — 24-hour wall-clock time
 *   tz — IANA zone like "America/Chicago"
 */
export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  // First pass: pretend the wall clock is UTC. That's wrong, but
  // it's close enough to read the offset for that calendar moment
  // in the target zone.
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const offsetMin = offsetMinutesAt(new Date(naive), tz);
  // Subtract the offset to get the actual UTC instant: the wall
  // clock is "behind" UTC by `offsetMin` for east-of-UTC zones, so
  // the true UTC time is naive minus that offset.
  return new Date(naive - offsetMin * 60_000);
}

/**
 * Format a UTC `Date` as a YYYY-MM-DD calendar date *in the given
 * IANA zone*. Used to derive an occurrence date from a stored
 * `scheduled_at` (timestamptz) — `.slice(0, 10)` on the raw ISO is
 * UTC and can off-by-one a row stored for an evening event in any
 * west-of-UTC zone. en-CA gives the ISO order without manual padding.
 */
export function localDateInTz(date: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

/**
 * Get a short timezone abbreviation ("CDT", "PST", "GMT+1") suitable
 * for inline display next to a formatted time. Falls back to the
 * IANA name if the short form isn't available in the runtime.
 */
export function shortTimezoneName(date: Date, tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    });
    const part = fmt
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? tz;
  } catch {
    return tz;
  }
}

/** Validate a "HH:MM" 24-hour string. Used by both client + action. */
export function isValidHhMm(s: unknown): s is string {
  return typeof s === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s);
}

/** Validate that `tz` is an IANA name the runtime knows about. */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0) return false;
  try {
    // Constructing the formatter throws on unknown zones.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Split "HH:MM" into [hour, minute]. Caller should have validated already. */
export function splitHhMm(s: string): [number, number] {
  const [h, m] = s.split(":");
  return [pad2parse(h), pad2parse(m)];
}

function pad2parse(s: string): number {
  return Number.parseInt(s, 10);
}
