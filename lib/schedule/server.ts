// Supabase-backed wrapper around the pure resolver in ./next-night.ts.
//
// Anything in the app that needs to know "when is the next poker night?"
// — the admin Settings page, future Signal reminder cron, public-facing
// next-night widget — should call resolveNextNight() from here so admin
// overrides are honored.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

import {
  MAX_LOOKAHEAD,
  parseRecurrenceRule,
  resolveNextNightFromOverrides,
  toIsoDate,
  type NextNightResolution,
  type OverrideEntry,
} from "./next-night";

/**
 * Resolve the next poker night for one template. Loads pending overrides from
 * Supabase, parses the rule, and reconciles. Pass `now` for tests.
 */
export async function resolveNextNight(
  supabase: SupabaseClient<Database>,
  template: { id: string; recurrence_rule: string | null },
  now: Date = new Date(),
): Promise<NextNightResolution> {
  const rule = parseRecurrenceRule(template.recurrence_rule);
  if (!rule) return { kind: "no-rule" };

  const today = toIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const { data, error } = await supabase
    .from("schedule_overrides")
    .select("id, original_date, overridden_date, note")
    .eq("template_id", template.id)
    .gte("original_date", today)
    .order("original_date", { ascending: true })
    .limit(MAX_LOOKAHEAD * 2);

  if (error) throw new Error(`schedule_overrides query failed: ${error.message}`);

  const overrides = new Map<string, OverrideEntry>();
  for (const row of data ?? []) {
    overrides.set(row.original_date, {
      id: row.id,
      overridden_date: row.overridden_date,
      note: row.note,
    });
  }

  return resolveNextNightFromOverrides({ rule, now, overrides });
}
