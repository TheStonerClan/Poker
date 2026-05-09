import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

export type UpcomingTournament = {
  id: string;
  /**
   * When the admin scheduled the tournament to start. May be null on
   * older rows that pre-date the column being populated; the UI sorts
   * those last so future-dated games stay at the top of the list.
   */
  scheduled_at: string | null;
  /** Display name from the owning template ("Friday Felt League", etc). */
  templateName: string;
  /**
   * Free-form location string from `tournament_templates.location`
   * ("Travis's basement", "VFW hall", etc). Null when the template
   * was created before location was a thing.
   */
  location: string | null;
};

/**
 * Tournaments the admin has set up but not yet started. Drives the
 * "Upcoming" sections on the public landing page and the admin
 * dashboard. We treat `status='scheduled'` AND `finished_at IS NULL`
 * as the source of truth — `scheduled_at` is just the (optional)
 * planned start time.
 *
 * Sorted by `scheduled_at` ASC with nulls last so dated games surface
 * before "TBD"s. Returns at most `limit` rows (default 10) — the UI
 * doesn't render an unbounded list and the data is hot enough that
 * pagination isn't worth the complexity yet.
 *
 * Callers pass their own supabase client so this helper works with
 * both the cookie-respecting admin client (for /admin) and the
 * service-role client (for the public landing page, where there's no
 * authenticated user).
 */
export async function fetchUpcomingTournaments(
  supabase: SupabaseClient<Database>,
  limit = 10,
): Promise<UpcomingTournament[]> {
  const { data, error } = await supabase
    .from("tournaments")
    .select(
      "id, scheduled_at, status, finished_at, template:tournament_templates(name, location)",
    )
    .eq("status", "scheduled")
    .is("finished_at", null)
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((row) => {
    const template = row.template as { name?: string; location?: string | null } | null;
    return {
      id: row.id,
      scheduled_at: row.scheduled_at,
      templateName: template?.name ?? "Tournament",
      location: template?.location ?? null,
    };
  });
}
