import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { toIsoDate } from "@/lib/schedule/next-night";
import { resolveNextNight } from "@/lib/schedule/server";
import {
  isValidHhMm,
  isValidTimezone,
  splitHhMm,
  zonedWallClockToUtc,
} from "@/lib/schedule/zoned-time";

/**
 * One row in the "upcoming tournaments" listing on the home pages.
 *
 * The list is a UNION of two data sources:
 *
 * - **Materialized** (`kind: 'scheduled'`) — rows in the `tournaments`
 *   table the admin already created via the wizard with
 *   `status='scheduled'`. These have an actual id (clickable on
 *   /admin) and a precise `scheduled_at` UTC timestamp.
 *
 * - **Projected** (`kind: 'projected'`) — the next occurrence of any
 *   template that has a `recurrence_rule`, computed via
 *   `resolveNextNight`. When the template has `start_time` +
 *   `start_timezone`, we compute the actual UTC instant for the next
 *   occurrence's wall-clock time in that zone — so the homepage can
 *   show "Fri, May 15, 7:00 PM CDT" instead of guessing date-only.
 *   When the template has no time set we fall back to a date-only
 *   render.
 *
 * Dedupe rule: if a template already has a materialized scheduled
 * tournament whose date matches the projected next date, drop the
 * projection.
 */
export type UpcomingTournament = {
  /** Stable React key. Distinct prefix per kind so projections re-key safely if the admin shifts the rule. */
  key: string;
  /** Display name from the owning template ("Friday Felt League", "Bluff & Buffoons", etc). */
  templateName: string;
  /** Free-form location string from `tournament_templates.location`. */
  location: string | null;
  /**
   * ISO timestamp suitable for `new Date(iso)`. For materialized rows
   * this is the UTC `scheduled_at`. For projected rows: a true UTC
   * instant when start_time+start_timezone are set, or a local-noon
   * anchor (`YYYY-MM-DDT12:00:00`, no zone suffix) when only the
   * date is known. The local-noon anchor sidesteps the off-by-one
   * bug where `new Date("2026-05-15")` parses as midnight UTC and
   * formats as "May 14" in any zone west of UTC.
   */
  iso: string | null;
  /** True when only the calendar date is known (no time-of-day). */
  dateOnly: boolean;
  /**
   * Template's IANA timezone, when one was configured. Renderers use
   * it to format the time-of-day in the venue's zone (so "7 PM CDT"
   * stays "7 PM CDT" regardless of the viewer's local zone) and to
   * surface the short timezone name ("CDT") next to the time.
   */
  timezone: string | null;
  /** Where to link on the admin dashboard. Null on the public landing. */
  href: string | null;
  /** Distinguishes scheduled tournament vs recurrence projection. */
  kind: "scheduled" | "projected";
};

export type FetchUpcomingOpts = {
  /**
   * When true, every row carries an `href` for the admin dashboard.
   * Materialized rows link to `/admin/tournaments/[id]`; projected
   * rows link to the template's Schedule tab.
   */
  adminLinks?: boolean;
  /** Hard cap on rows returned (default 10). */
  limit?: number;
  /** Override `now` for tests. */
  now?: Date;
};

/**
 * Build the unified upcoming-tournaments list. See the type doc
 * above for the data sources and dedupe rules.
 */
export async function fetchUpcomingTournaments(
  supabase: SupabaseClient<Database>,
  opts: FetchUpcomingOpts = {},
): Promise<UpcomingTournament[]> {
  const limit = opts.limit ?? 10;
  const adminLinks = opts.adminLinks ?? false;
  const now = opts.now ?? new Date();

  // 1. Materialized scheduled tournaments. Joined to the template so
  //    we can show the venue zone next to the time.
  const { data: scheduledData } = await supabase
    .from("tournaments")
    .select(
      "id, scheduled_at, template_id, template:tournament_templates(id, name, location, start_timezone)",
    )
    .eq("status", "scheduled")
    .is("finished_at", null);

  const materialized: UpcomingTournament[] = (scheduledData ?? []).map(
    (row) => {
      const template = row.template as
        | {
            id?: string;
            name?: string;
            location?: string | null;
            start_timezone?: string | null;
          }
        | null;
      return {
        key: `t:${row.id}`,
        templateName: template?.name ?? "Tournament",
        location: template?.location ?? null,
        iso: row.scheduled_at,
        dateOnly: false,
        timezone: template?.start_timezone ?? null,
        href: adminLinks ? `/admin/tournaments/${row.id}` : null,
        kind: "scheduled",
      };
    },
  );

  // 2. Projected recurrences.
  const { data: templatesData } = await supabase
    .from("tournament_templates")
    .select(
      "id, name, location, recurrence_rule, start_time, start_timezone",
    );

  // "This template already has a materialized scheduled tournament
  // on this calendar date" set so a projection doesn't double-up the
  // same event.
  const materializedByTemplateDate = new Set<string>();
  for (const row of scheduledData ?? []) {
    if (!row.template_id || !row.scheduled_at) continue;
    materializedByTemplateDate.add(
      `${row.template_id}:${row.scheduled_at.slice(0, 10)}`,
    );
  }

  const projected: UpcomingTournament[] = [];
  for (const t of templatesData ?? []) {
    if (!t.recurrence_rule) continue;
    const next = await resolveNextNight(
      supabase,
      { id: t.id, recurrence_rule: t.recurrence_rule },
      now,
    );
    if (next.kind !== "ok") continue;
    const isoDate = toIsoDate(next.next.effectiveDate);
    if (materializedByTemplateDate.has(`${t.id}:${isoDate}`)) continue;

    // Compute the iso the homepage should render. Three cases:
    //
    // - Time + zone present: a true UTC timestamp for that
    //   occurrence's start. Lets us show "Fri, May 15, 7:00 PM CDT"
    //   in any viewer's zone.
    //
    // - No time set: anchor at local noon (no Z suffix) so JS
    //   parses it as the viewer's local clock — keeps the calendar
    //   date stable everywhere instead of bouncing to "May 14" for
    //   anyone west of UTC.
    //
    // - Time set but invalid zone (shouldn't happen — DB constraint
    //   plus action validation — but defensive): treat as date-only.
    let iso: string;
    let dateOnly: boolean;
    let timezone: string | null = null;
    if (
      t.start_time &&
      t.start_timezone &&
      isValidHhMm(t.start_time) &&
      isValidTimezone(t.start_timezone)
    ) {
      const [hour, minute] = splitHhMm(t.start_time);
      const utc = zonedWallClockToUtc(
        next.next.effectiveDate.getFullYear(),
        next.next.effectiveDate.getMonth() + 1,
        next.next.effectiveDate.getDate(),
        hour,
        minute,
        t.start_timezone,
      );
      iso = utc.toISOString();
      dateOnly = false;
      timezone = t.start_timezone;
    } else {
      iso = `${isoDate}T12:00:00`;
      dateOnly = true;
    }

    projected.push({
      key: `proj:${t.id}:${isoDate}`,
      templateName: t.name,
      location: t.location ?? null,
      iso,
      dateOnly,
      timezone,
      // Projected rows haven't been materialized into a `tournaments`
      // row yet, so there's no /admin/tournaments/[id] page for the
      // admin to land on. Route them to the wizard with the template
      // pre-selected — the wizard will pick players, randomize seats,
      // INSERT the tournament with status='scheduled', and redirect to
      // the detail page where they can review + start. Materialized
      // rows continue to deep-link straight to the detail page above.
      href: adminLinks
        ? `/admin/tournaments/new?templateId=${t.id}`
        : null,
      kind: "projected",
    });
  }

  // 3. Merge + sort.
  const all = [...materialized, ...projected];
  all.sort((a, b) => {
    if (a.iso == null && b.iso == null) return 0;
    if (a.iso == null) return 1;
    if (b.iso == null) return -1;
    return a.iso.localeCompare(b.iso);
  });

  return all.slice(0, limit);
}
