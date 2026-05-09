import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { toIsoDate } from "@/lib/schedule/next-night";
import { resolveNextNight } from "@/lib/schedule/server";

/**
 * One row in the "upcoming tournaments" listing on the home pages.
 *
 * The list is a UNION of two data sources:
 *
 * - **Materialized** (`kind: 'scheduled'`) — rows in the `tournaments`
 *   table the admin already created via the wizard with
 *   `status='scheduled'`. These have an actual id (clickable on
 *   /admin) and a precise `scheduled_at` timestamp.
 *
 * - **Projected** (`kind: 'projected'`) — the next occurrence of any
 *   template that has a `recurrence_rule` set, computed via
 *   `resolveNextNight`. These don't exist in the `tournaments` table
 *   yet — they're the future dates the admin can see in /admin/settings.
 *   On the admin home each one links to its template's Schedule tab
 *   so the admin can move/cancel; on the public landing they're
 *   read-only.
 *
 * Dedupe rule: if a template already has a materialized scheduled
 * tournament whose date matches the projected next date, drop the
 * projection. Otherwise both surface — useful when the admin has
 * pre-built next Friday's game manually AND the recurrence rule
 * already points to the Friday after that.
 */
export type UpcomingTournament = {
  /** Stable React key. Distinct prefix per kind so projections re-key safely if the admin shifts the rule. */
  key: string;
  /** Display name from the owning template ("Friday Felt League", "Bluff & Buffoons", etc). */
  templateName: string;
  /**
   * Free-form location string from `tournament_templates.location`
   * ("Travis's basement", "VFW hall", etc). Null when the template
   * was created before location was a thing.
   */
  location: string | null;
  /**
   * ISO timestamp for materialized rows (UTC time), or `YYYY-MM-DD`
   * for projected rows. The renderer reads `dateOnly` to decide
   * whether to format the time-of-day.
   */
  iso: string | null;
  /** True for projected rows where we only know the date, not the time. */
  dateOnly: boolean;
  /** Where to link on the admin dashboard. Null on the public landing. */
  href: string | null;
  /** Distinguishes scheduled tournament vs recurrence projection (used by callers, not currently rendered). */
  kind: "scheduled" | "projected";
};

export type FetchUpcomingOpts = {
  /**
   * When true, every row carries an `href` for the admin dashboard.
   * Materialized rows link to `/admin/tournaments/[id]` (where the
   * existing detail page handles edit + add-players + start);
   * projected rows link to the template's Schedule tab so the admin
   * can move/cancel that occurrence.
   */
  adminLinks?: boolean;
  /** Hard cap on rows returned (default 10). */
  limit?: number;
  /** Override `now` for tests. */
  now?: Date;
};

/**
 * Build the unified upcoming-tournaments list. See the type doc above
 * for the data sources and dedupe rules.
 */
export async function fetchUpcomingTournaments(
  supabase: SupabaseClient<Database>,
  opts: FetchUpcomingOpts = {},
): Promise<UpcomingTournament[]> {
  const limit = opts.limit ?? 10;
  const adminLinks = opts.adminLinks ?? false;
  const now = opts.now ?? new Date();

  // 1. Materialized scheduled tournaments.
  const { data: scheduledData } = await supabase
    .from("tournaments")
    .select(
      "id, scheduled_at, template_id, template:tournament_templates(id, name, location)",
    )
    .eq("status", "scheduled")
    .is("finished_at", null);

  const materialized: UpcomingTournament[] = (scheduledData ?? []).map(
    (row) => {
      const template = row.template as
        | { id?: string; name?: string; location?: string | null }
        | null;
      return {
        key: `t:${row.id}`,
        templateName: template?.name ?? "Tournament",
        location: template?.location ?? null,
        iso: row.scheduled_at,
        dateOnly: false,
        href: adminLinks ? `/admin/tournaments/${row.id}` : null,
        kind: "scheduled",
      };
    },
  );

  // 2. Projected recurrences. Pull every template + its recurrence
  //    rule, then ask the canonical resolver for the next-night date
  //    (which honors any schedule_overrides — same code path the
  //    /admin/settings list uses, so the two views stay consistent).
  const { data: templatesData } = await supabase
    .from("tournament_templates")
    .select("id, name, location, recurrence_rule");

  // Build "this template already has a materialized tournament on
  // this calendar date" set so the projection doesn't double-up the
  // same event. Compare by date-only because scheduled_at is a
  // timestamp and the projection only has a date.
  const materializedByTemplateDate = new Set<string>();
  for (const row of scheduledData ?? []) {
    if (!row.template_id || !row.scheduled_at) continue;
    const dateOnly = row.scheduled_at.slice(0, 10); // ISO YYYY-MM-DD prefix
    materializedByTemplateDate.add(`${row.template_id}:${dateOnly}`);
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
    projected.push({
      key: `proj:${t.id}:${isoDate}`,
      templateName: t.name,
      location: t.location ?? null,
      iso: isoDate,
      dateOnly: true,
      href: adminLinks ? `/admin/templates/${t.id}?tab=schedule` : null,
      kind: "projected",
    });
  }

  // 3. Merge + sort. Compare by ISO prefix so date-only projected
  //    rows interleave correctly with timestamped materialized rows
  //    ("2026-05-15" < "2026-05-15T19:00:00Z" — both sort to the
  //    same calendar day, with the projected one first because the
  //    string prefix is shorter).
  const all = [...materialized, ...projected];
  all.sort((a, b) => {
    if (a.iso == null && b.iso == null) return 0;
    if (a.iso == null) return 1; // null/TBD last
    if (b.iso == null) return -1;
    return a.iso.localeCompare(b.iso);
  });

  return all.slice(0, limit);
}
