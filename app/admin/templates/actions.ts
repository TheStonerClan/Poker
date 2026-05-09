"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

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
  // tokensPerPlayer is the per-player buyback budget. 1 keeps the legacy
  // "one token, usable as either rebuy or addon" rule. Higher allows e.g.
  // 2 rebuys, or rebuy + addon. Capped at 5 to catch typos.
  tokens_per_player: z.coerce.number().int().min(1).max(5),
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
    tokens_per_player: formData.get("tokens_per_player") ?? 1,
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
    tokensPerPlayer: parsed.data.tokens_per_player,
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
