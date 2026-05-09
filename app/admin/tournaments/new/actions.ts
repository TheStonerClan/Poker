"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { randomizeAssignments } from "@/lib/admin/tables";

const StartSchema = z.object({
  templateId: z.uuid(),
  playerIds: z.array(z.uuid()).min(2, "Pick at least two players."),
  numTables: z.coerce.number().int().min(1).max(10),
  maxSeatsPerTable: z.coerce.number().int().min(2).max(10),
});

export type StartTournamentResult = {
  status: "ok" | "error";
  message?: string;
};

export async function startTournament(input: {
  templateId: string;
  playerIds: string[];
  numTables: number;
  maxSeatsPerTable: number;
}): Promise<StartTournamentResult> {
  await requireAdmin();
  const parsed = StartSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const { templateId, playerIds, numTables, maxSeatsPerTable } = parsed.data;
  if (playerIds.length > numTables * maxSeatsPerTable) {
    return {
      status: "error",
      message: `${playerIds.length} players don't fit in ${numTables} × ${maxSeatsPerTable} seats. Bump tables or seats.`,
    };
  }
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("tournaments")
    .select("id")
    .in("status", ["scheduled", "running", "paused"])
    .limit(1);
  if (existing && existing.length > 0) {
    return {
      status: "error",
      message: "Another tournament is already active. Finalize it first.",
    };
  }

  const { data: template, error: tplErr } = await supabase
    .from("tournament_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  if (tplErr || !template) {
    return { status: "error", message: tplErr?.message ?? "Template not found" };
  }

  const { data: structure, error: bsErr } = await supabase
    .from("blind_structures")
    .select("levels")
    .eq("id", template.blind_structure_id)
    .maybeSingle();
  if (bsErr || !structure) {
    return { status: "error", message: bsErr?.message ?? "Blind structure not found" };
  }

  const { data: tournament, error: insErr } = await supabase
    .from("tournaments")
    .insert({
      template_id: template.id,
      status: "scheduled",
      buy_in_snapshot: template.buy_in,
      starting_stack_snapshot: template.starting_stack,
      max_rebuys_snapshot: template.max_rebuys,
      rebuy_price_snapshot: template.rebuy_price,
      rebuy_chips_snapshot: template.rebuy_chips,
      ante_mode_snapshot: template.ante_mode,
      buyback_config_snapshot: template.buyback_config,
      side_pots_snapshot: template.side_pots,
      rounding_mode_snapshot: template.rounding_mode,
      prize_rules_snapshot: template.prize_rules,
      chip_denominations_snapshot: template.chip_denominations,
      starting_stack_composition_snapshot: template.starting_stack_composition,
      blind_structure_snapshot: structure.levels,
      current_level: 1,
      num_tables: numTables,
      max_seats_per_table: maxSeatsPerTable,
    })
    .select("id")
    .single();
  if (insErr || !tournament) {
    return { status: "error", message: insErr?.message ?? "Could not create tournament" };
  }

  // Randomize the roster onto (table, seat) before inserting. The randomize
  // helper round-robins so table sizes stay balanced (ceil/floor of N/T).
  const assignments = randomizeAssignments({
    playerIds,
    numTables,
    maxSeatsPerTable,
  });
  const tpRows = assignments.map((a) => ({
    tournament_id: tournament.id,
    player_id: a.player_id,
    table_number: a.table_number,
    seat_number: a.seat_number,
    current_chips: template.starting_stack,
  }));

  const { error: tpErr } = await supabase.from("tournament_players").insert(tpRows);
  if (tpErr) {
    // Roll back the tournament so the admin can retry. We're not in a tx, but
    // this keeps state consistent in the common case.
    await supabase.from("tournaments").delete().eq("id", tournament.id);
    return { status: "error", message: tpErr.message };
  }

  revalidatePath("/admin");
  redirect(`/admin/tournaments/${tournament.id}`);
}
