"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isValidTimezone } from "@/lib/schedule/zoned-time";

const RuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("nthWeekdayOfMonth"),
    nth: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(-1),
    ]),
    weekday: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
  }),
  z.object({
    kind: z.literal("everyNDays"),
    n: z.coerce.number().int().min(1).max(365),
  }),
]);

// HH:MM 24-hour. Mirrors the DB CHECK constraint from migration 0008.
const HhMmSchema = z
  .string()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Time must be HH:MM (24h)");

// IANA zone, validated via Intl.DateTimeFormat at runtime — Zod can't
// hold the full list. Returns a friendly error so the UI shows it.
const TimezoneSchema = z
  .string()
  .min(1)
  .refine(isValidTimezone, "Unknown timezone");

const UpdateRecurrenceSchema = z
  .object({
    templateId: z.uuid(),
    rule: RuleSchema.nullable(),
    startTime: HhMmSchema.nullable(),
    startTimezone: TimezoneSchema.nullable(),
  })
  .refine(
    (v) =>
      (v.startTime === null && v.startTimezone === null) ||
      (v.startTime !== null && v.startTimezone !== null),
    {
      message:
        "Start time and timezone must be set together (or both empty).",
      path: ["startTime"],
    },
  );

export async function updateRecurrence(input: {
  templateId: string;
  rule: z.infer<typeof RuleSchema> | null;
  startTime: string | null;
  startTimezone: string | null;
}): Promise<{ status: "ok" | "error"; message?: string }> {
  await requireAdmin();
  const parsed = UpdateRecurrenceSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  const supabase = await createClient();
  const value = parsed.data.rule
    ? JSON.stringify(parsed.data.rule)
    : null;

  // Read the current rule first; if it actually changed, blow away any
  // pending overrides so admins don't have stale moves attached to dates the
  // new rule no longer produces.
  const { data: existing, error: readErr } = await supabase
    .from("tournament_templates")
    .select("recurrence_rule")
    .eq("id", parsed.data.templateId)
    .maybeSingle();
  if (readErr) return { status: "error", message: readErr.message };

  const ruleChanged = (existing?.recurrence_rule ?? null) !== value;

  const { error } = await supabase
    .from("tournament_templates")
    .update({
      recurrence_rule: value,
      start_time: parsed.data.startTime,
      start_timezone: parsed.data.startTimezone,
    })
    .eq("id", parsed.data.templateId);
  if (error) return { status: "error", message: error.message };

  if (ruleChanged) {
    const { error: delErr } = await supabase
      .from("schedule_overrides")
      .delete()
      .eq("template_id", parsed.data.templateId);
    if (delErr) return { status: "error", message: delErr.message };
  }

  revalidatePath("/admin/settings");
  return { status: "ok" };
}

// ─── One-off date overrides for the next poker night ─────────────────────────

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

const MoveNightSchema = z
  .object({
    templateId: z.uuid(),
    originalDate: IsoDate,
    overriddenDate: IsoDate,
    note: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.originalDate !== v.overriddenDate, {
    message: "Pick a different date than the original.",
    path: ["overriddenDate"],
  });

const CancelNightSchema = z.object({
  templateId: z.uuid(),
  originalDate: IsoDate,
  note: z.string().trim().max(200).optional(),
});

const ClearOverrideSchema = z.object({
  templateId: z.uuid(),
  originalDate: IsoDate,
});

type ActionResult = { status: "ok" | "error"; message?: string };

/**
 * Move a single occurrence of the recurring schedule to a new date. Idempotent
 * per (templateId, originalDate): repeated calls update the existing override.
 */
export async function moveNextNight(input: {
  templateId: string;
  originalDate: string;
  overriddenDate: string;
  note?: string;
}): Promise<ActionResult> {
  const user = await requireAdmin();
  const parsed = MoveNightSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("schedule_overrides").upsert(
    {
      template_id: parsed.data.templateId,
      original_date: parsed.data.originalDate,
      overridden_date: parsed.data.overriddenDate,
      note: parsed.data.note ?? null,
      created_by: user.id,
    },
    { onConflict: "template_id,original_date" },
  );
  if (error) return { status: "error", message: error.message };

  revalidatePath("/admin/settings");
  return { status: "ok" };
}

/**
 * Cancel a single occurrence (skip it entirely). The resolver advances to
 * the rule's next date.
 */
export async function cancelNextNight(input: {
  templateId: string;
  originalDate: string;
  note?: string;
}): Promise<ActionResult> {
  const user = await requireAdmin();
  const parsed = CancelNightSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("schedule_overrides").upsert(
    {
      template_id: parsed.data.templateId,
      original_date: parsed.data.originalDate,
      overridden_date: null,
      note: parsed.data.note ?? null,
      created_by: user.id,
    },
    { onConflict: "template_id,original_date" },
  );
  if (error) return { status: "error", message: error.message };

  revalidatePath("/admin/settings");
  return { status: "ok" };
}

/**
 * Clear an override and restore the rule's natural date for that occurrence.
 */
export async function clearScheduleOverride(input: {
  templateId: string;
  originalDate: string;
}): Promise<ActionResult> {
  await requireAdmin();
  const parsed = ClearOverrideSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("schedule_overrides")
    .delete()
    .eq("template_id", parsed.data.templateId)
    .eq("original_date", parsed.data.originalDate);
  if (error) return { status: "error", message: error.message };

  revalidatePath("/admin/settings");
  return { status: "ok" };
}
