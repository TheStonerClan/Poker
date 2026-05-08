"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

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

const UpdateRecurrenceSchema = z.object({
  templateId: z.uuid(),
  rule: RuleSchema.nullable(),
});

export async function updateRecurrence(input: {
  templateId: string;
  rule: z.infer<typeof RuleSchema> | null;
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

  const { error } = await supabase
    .from("tournament_templates")
    .update({ recurrence_rule: value })
    .eq("id", parsed.data.templateId);
  if (error) return { status: "error", message: error.message };

  revalidatePath("/admin/settings");
  return { status: "ok" };
}
