"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const CreateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sourceTemplateId: z.uuid(),
});

/**
 * Clone an existing template to a new one with a fresh name. Cloning is
 * the simplest UX for "make another template" — the admin starts from a
 * known-good config and edits via the existing tabs (basics, buyback,
 * blinds, prizes, schedule). A blank template would force the admin to
 * fill out 11 levels of blinds and a prize structure from scratch.
 *
 * The clone deep-copies the blind_structures row too — the source and
 * the clone get independent structures so editing one doesn't affect
 * the other.
 */
export async function createTournamentTemplate(
  _prev: { status: "idle" | "ok" | "error"; message?: string },
  formData: FormData,
): Promise<{ status: "idle" | "ok" | "error"; message?: string }> {
  await requireAdmin();
  const parsed = CreateTemplateSchema.safeParse({
    name: formData.get("name") ?? "",
    sourceTemplateId: formData.get("sourceTemplateId"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }
  const { name, sourceTemplateId } = parsed.data;
  const supabase = await createClient();

  // Pull the source template + blind structure.
  const { data: source, error: srcErr } = await supabase
    .from("tournament_templates")
    .select("*")
    .eq("id", sourceTemplateId)
    .maybeSingle();
  if (srcErr || !source) {
    return { status: "error", message: srcErr?.message ?? "Source not found" };
  }

  const { data: srcStruct } = await supabase
    .from("blind_structures")
    .select("*")
    .eq("id", source.blind_structure_id)
    .maybeSingle();
  if (!srcStruct) {
    return { status: "error", message: "Source blind structure not found" };
  }

  // Insert a copy of the blind structure.
  const { data: newStruct, error: structErr } = await supabase
    .from("blind_structures")
    .insert({
      name: `${name} — blinds`,
      levels: srcStruct.levels,
      notes: `Cloned from "${srcStruct.name}".`,
    })
    .select("id")
    .single();
  if (structErr || !newStruct) {
    return {
      status: "error",
      message: structErr?.message ?? "Could not clone blind structure",
    };
  }

  // Insert the new template referencing the cloned blind structure.
  const { data: newTemplate, error: tmplErr } = await supabase
    .from("tournament_templates")
    .insert({
      name,
      location: source.location,
      currency: source.currency,
      // Don't carry recurrence_rule across — each template owns its own
      // schedule, and copying the source's rule would silently double-
      // book the same poker night across two templates.
      recurrence_rule: null,
      buy_in: source.buy_in,
      starting_stack: source.starting_stack,
      max_rebuys: source.max_rebuys,
      rebuy_price: source.rebuy_price,
      rebuy_chips: source.rebuy_chips,
      ante_mode: source.ante_mode,
      buyback_config: source.buyback_config,
      side_pots: source.side_pots,
      rounding_mode: source.rounding_mode,
      prize_rules: source.prize_rules,
      chip_denominations: source.chip_denominations,
      starting_stack_composition: source.starting_stack_composition,
      blind_structure_id: newStruct.id,
    })
    .select("id")
    .single();
  if (tmplErr || !newTemplate) {
    return {
      status: "error",
      message: tmplErr?.message ?? "Could not create template",
    };
  }

  revalidatePath("/admin/templates");
  redirect(`/admin/templates/${newTemplate.id}`);
}

const BasicsSchema = z.object({
  templateId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  location: z.string().trim().max(80).optional().or(z.literal("")),
  buy_in: z.coerce.number().int().min(0),
  starting_stack: z.coerce.number().int().min(1),
  ante_mode: z.string().trim().min(1).max(8),
});

export async function updateTemplateBasics(
  _prev: { status: "idle" | "ok" | "error"; message?: string },
  formData: FormData,
): Promise<{ status: "idle" | "ok" | "error"; message?: string }> {
  await requireAdmin();
  const parsed = BasicsSchema.safeParse({
    templateId: formData.get("templateId"),
    name: formData.get("name") ?? "",
    location: formData.get("location") ?? "",
    buy_in: formData.get("buy_in") ?? 0,
    starting_stack: formData.get("starting_stack") ?? 0,
    ante_mode: formData.get("ante_mode") ?? "BB",
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }
  const { templateId, location, ...rest } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("tournament_templates")
    .update({ ...rest, location: location || null })
    .eq("id", templateId);
  if (error) return { status: "error", message: error.message };

  revalidatePath("/admin/templates");
  return { status: "ok" };
}

const RebuySchema = z.object({
  templateId: z.uuid(),
  // Rebuy and add-on are independent budgets — a player can use both. Each
  // defaults to 1 (one rebuy, one add-on). Capped at 5 to catch typos.
  rebuys_per_player: z.coerce.number().int().min(1).max(5),
  addons_per_player: z.coerce.number().int().min(1).max(5),
  rebuy_chips: z.coerce.number().int().min(0),
  rebuy_price: z.coerce.number().int().min(0),
  rebuy_through_level: z.coerce.number().int().min(0),
  addon_chips: z.coerce.number().int().min(0),
  addon_break_level: z.coerce.number().int().min(0),
});

export async function updateTemplateBuyback(
  _prev: { status: "idle" | "ok" | "error"; message?: string },
  formData: FormData,
): Promise<{ status: "idle" | "ok" | "error"; message?: string }> {
  await requireAdmin();
  const parsed = RebuySchema.safeParse({
    templateId: formData.get("templateId"),
    rebuys_per_player: formData.get("rebuys_per_player") ?? 1,
    addons_per_player: formData.get("addons_per_player") ?? 1,
    rebuy_chips: formData.get("rebuy_chips") ?? 0,
    rebuy_price: formData.get("rebuy_price") ?? 0,
    rebuy_through_level: formData.get("rebuy_through_level") ?? 0,
    addon_chips: formData.get("addon_chips") ?? 0,
    addon_break_level: formData.get("addon_break_level") ?? 0,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }
  const supabase = await createClient();
  const buybackConfig = {
    rebuysPerPlayer: parsed.data.rebuys_per_player,
    addOnsPerPlayer: parsed.data.addons_per_player,
    price: parsed.data.rebuy_price,
    rebuyChips: parsed.data.rebuy_chips,
    rebuyAllowedThroughLevel: parsed.data.rebuy_through_level,
    addOnAtBreakLevel: parsed.data.addon_break_level,
    addOnChips: parsed.data.addon_chips,
  };
  const { error } = await supabase
    .from("tournament_templates")
    .update({
      rebuy_chips: parsed.data.rebuy_chips,
      rebuy_price: parsed.data.rebuy_price,
      buyback_config: buybackConfig,
    })
    .eq("id", parsed.data.templateId);
  if (error) return { status: "error", message: error.message };
  revalidatePath("/admin/templates");
  return { status: "ok" };
}

const PrizeRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("fixed"),
    position: z.coerce.number().int().min(1),
    value: z.coerce.number().min(0),
  }),
  z.object({
    kind: z.literal("percentRemainder"),
    position: z.coerce.number().int().min(1),
    value: z.coerce.number().min(0).max(100),
  }),
  z.object({
    kind: z.literal("percentTotal"),
    position: z.coerce.number().int().min(1),
    value: z.coerce.number().min(0).max(100),
  }),
]);

const PrizeSchema = z.object({
  templateId: z.uuid(),
  rules: z.array(PrizeRuleSchema).min(1),
  rounding_increment: z.coerce.number().int(),
  surplus_to_first: z.boolean(),
  guarantee: z.coerce.number().min(0),
  overlay: z.boolean(),
});

export async function updateTemplatePrizes(input: {
  templateId: string;
  rules: Array<
    | { kind: "fixed"; position: number; value: number }
    | { kind: "percentRemainder"; position: number; value: number }
    | { kind: "percentTotal"; position: number; value: number }
  >;
  rounding_increment: number;
  surplus_to_first: boolean;
  guarantee: number;
  overlay: boolean;
}): Promise<{ status: "ok" | "error"; message?: string }> {
  await requireAdmin();
  const parsed = PrizeSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("tournament_templates")
    .update({
      prize_rules: {
        type: "static",
        rules: parsed.data.rules,
        rounding: {
          increment: parsed.data.rounding_increment,
          surplusToFirst: parsed.data.surplus_to_first,
        },
        guarantee: parsed.data.guarantee,
        overlay: parsed.data.overlay,
      },
      rounding_mode: {
        increment: parsed.data.rounding_increment,
        surplusToFirst: parsed.data.surplus_to_first,
      },
    })
    .eq("id", parsed.data.templateId);
  if (error) return { status: "error", message: error.message };
  revalidatePath("/admin/templates");
  return { status: "ok" };
}

const BlindLevelSchema = z.object({
  level_num: z.number().int().min(1),
  small: z.number().int().min(0).optional(),
  big: z.number().int().min(0).optional(),
  ante: z.number().int().min(0).optional(),
  duration_sec: z.number().int().min(1),
  is_break: z.boolean(),
  color_up_chips: z.array(z.number().int().min(1)).optional(),
});

const StructureSchema = z.object({
  blindStructureId: z.uuid(),
  levels: z.array(BlindLevelSchema).min(1),
});

export async function updateBlindStructure(input: {
  blindStructureId: string;
  levels: z.infer<typeof BlindLevelSchema>[];
}): Promise<{ status: "ok" | "error"; message?: string }> {
  await requireAdmin();
  const parsed = StructureSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }
  // Re-number levels to match their position in the array.
  const renumbered = parsed.data.levels.map((l, i) => ({ ...l, level_num: i + 1 }));
  const supabase = await createClient();
  const { error } = await supabase
    .from("blind_structures")
    .update({ levels: renumbered })
    .eq("id", parsed.data.blindStructureId);
  if (error) return { status: "error", message: error.message };
  revalidatePath("/admin/templates");
  return { status: "ok" };
}
