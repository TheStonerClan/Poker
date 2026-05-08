"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { blindLevels } from "@/lib/admin/queries";
import { computePayouts } from "prize-math";
import type { TablesUpdate } from "@/lib/database.types";

const IdSchema = z.uuid();

async function refresh(tournamentId: string) {
  revalidatePath("/admin");
  revalidatePath(`/admin/tournaments/${tournamentId}`);
}

export async function pauseTournament(tournamentId: string) {
  await requireAdmin();
  const id = IdSchema.parse(tournamentId);
  const supabase = await createClient();

  const { data: t, error: fetchErr } = await supabase
    .from("tournaments")
    .select("status, level_paused_at")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr || !t) throw new Error(fetchErr?.message ?? "Tournament not found");
  if (t.status !== "running") return;

  const { error } = await supabase
    .from("tournaments")
    .update({ status: "paused", level_paused_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await supabase.from("tournament_events").insert({
    tournament_id: id,
    type: "level_pause",
    payload: { at: new Date().toISOString() },
  });

  await refresh(id);
}

export async function resumeTournament(tournamentId: string) {
  await requireAdmin();
  const id = IdSchema.parse(tournamentId);
  const supabase = await createClient();

  const { data: t, error: fetchErr } = await supabase
    .from("tournaments")
    .select("status, level_paused_at, accumulated_pause_ms, started_at")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr || !t) throw new Error(fetchErr?.message ?? "Tournament not found");

  const now = new Date();
  const update: TablesUpdate<"tournaments"> = {
    status: "running",
    level_paused_at: null,
  };

  if (t.status === "scheduled" && !t.started_at) {
    update.started_at = now.toISOString();
    update.level_started_at = now.toISOString();
  } else if (t.status === "paused" && t.level_paused_at) {
    const pausedFor =
      now.getTime() - new Date(t.level_paused_at).getTime();
    update.accumulated_pause_ms =
      Number(t.accumulated_pause_ms ?? 0) + Math.max(0, pausedFor);
  }

  const { error } = await supabase
    .from("tournaments")
    .update(update)
    .eq("id", id);
  if (error) throw new Error(error.message);

  await supabase.from("tournament_events").insert({
    tournament_id: id,
    type: "level_resume",
    payload: { at: now.toISOString() },
  });

  await refresh(id);
}

export async function advanceLevel(tournamentId: string) {
  await requireAdmin();
  const id = IdSchema.parse(tournamentId);
  const supabase = await createClient();

  const { data: t, error: fetchErr } = await supabase
    .from("tournaments")
    .select("current_level, blind_structure_snapshot, status")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr || !t) throw new Error(fetchErr?.message ?? "Tournament not found");

  const levels = blindLevels(t.blind_structure_snapshot);
  const max = levels.reduce((m, l) => (l.level_num > m ? l.level_num : m), 0);
  const nextLevel = Math.min(t.current_level + 1, max);

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("tournaments")
    .update({
      current_level: nextLevel,
      level_started_at: now,
      level_paused_at: null,
      accumulated_pause_ms: 0,
      status: t.status === "scheduled" ? "running" : t.status,
      started_at: t.status === "scheduled" ? now : undefined,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await supabase.from("tournament_events").insert({
    tournament_id: id,
    type: "level_advance",
    payload: { from_level: t.current_level, to_level: nextLevel },
  });

  await refresh(id);
}

export async function previousLevel(tournamentId: string) {
  await requireAdmin();
  const id = IdSchema.parse(tournamentId);
  const supabase = await createClient();

  const { data: t, error: fetchErr } = await supabase
    .from("tournaments")
    .select("current_level")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr || !t) throw new Error(fetchErr?.message ?? "Tournament not found");
  if (t.current_level <= 1) return;

  const prev = t.current_level - 1;
  const { error } = await supabase
    .from("tournaments")
    .update({
      current_level: prev,
      level_started_at: new Date().toISOString(),
      level_paused_at: null,
      accumulated_pause_ms: 0,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await supabase.from("tournament_events").insert({
    tournament_id: id,
    type: "level_advance",
    payload: { from_level: t.current_level, to_level: prev, direction: "back" },
  });

  await refresh(id);
}

const BustSchema = z.object({
  tournamentPlayerId: z.uuid(),
});

export async function bustPlayer(input: { tournamentPlayerId: string }) {
  await requireAdmin();
  const { tournamentPlayerId } = BustSchema.parse(input);
  const supabase = await createClient();

  const { data: tp } = await supabase
    .from("tournament_players")
    .select("tournament_id, player_id, busted_at_time")
    .eq("id", tournamentPlayerId)
    .maybeSingle();
  if (!tp) throw new Error("Player slot not found");
  if (tp.busted_at_time) return;

  const { data: t } = await supabase
    .from("tournaments")
    .select("current_level")
    .eq("id", tp.tournament_id)
    .maybeSingle();

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("tournament_players")
    .update({
      busted_at_level: t?.current_level ?? null,
      busted_at_time: now,
      current_chips: 0,
    })
    .eq("id", tournamentPlayerId);
  if (error) throw new Error(error.message);

  await supabase.from("tournament_events").insert({
    tournament_id: tp.tournament_id,
    type: "bust",
    payload: {
      tournament_player_id: tournamentPlayerId,
      player_id: tp.player_id,
      at_level: t?.current_level ?? null,
    },
  });

  await refresh(tp.tournament_id);
}

export async function rebuyPlayer(input: { tournamentPlayerId: string }) {
  await requireAdmin();
  const { tournamentPlayerId } = BustSchema.parse(input);
  const supabase = await createClient();

  const { data: tp } = await supabase
    .from("tournament_players")
    .select(
      "tournament_id, player_id, buyback_used, busted_at_time, current_chips",
    )
    .eq("id", tournamentPlayerId)
    .maybeSingle();
  if (!tp) throw new Error("Player slot not found");
  if (tp.buyback_used) throw new Error("Buyback token already spent");

  const { data: t } = await supabase
    .from("tournaments")
    .select(
      "current_level, rebuy_chips_snapshot, buyback_config_snapshot",
    )
    .eq("id", tp.tournament_id)
    .maybeSingle();

  const cfg = (t?.buyback_config_snapshot ?? {}) as {
    rebuyAllowedThroughLevel?: number;
    rebuyChips?: number;
  };
  const cap = cfg.rebuyAllowedThroughLevel ?? Number.POSITIVE_INFINITY;
  if (t && t.current_level > cap) {
    throw new Error(`Rebuy window closed (allowed through level ${cap}).`);
  }

  const chips = cfg.rebuyChips ?? t?.rebuy_chips_snapshot ?? 0;
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("tournament_players")
    .update({
      buyback_used: true,
      buyback_used_as: "rebuy",
      buyback_used_at_level: t?.current_level ?? null,
      buyback_used_at_time: now,
      busted_at_level: null,
      busted_at_time: null,
      current_chips: chips,
    })
    .eq("id", tournamentPlayerId);
  if (error) throw new Error(error.message);

  await supabase.from("tournament_events").insert({
    tournament_id: tp.tournament_id,
    type: "rebuy",
    payload: {
      tournament_player_id: tournamentPlayerId,
      player_id: tp.player_id,
      at_level: t?.current_level ?? null,
      chips,
    },
  });

  await refresh(tp.tournament_id);
}

export async function applyAddOn(input: { tournamentPlayerId: string }) {
  await requireAdmin();
  const { tournamentPlayerId } = BustSchema.parse(input);
  const supabase = await createClient();

  const { data: tp } = await supabase
    .from("tournament_players")
    .select(
      "tournament_id, player_id, buyback_used, current_chips",
    )
    .eq("id", tournamentPlayerId)
    .maybeSingle();
  if (!tp) throw new Error("Player slot not found");
  if (tp.buyback_used) throw new Error("Buyback token already spent");

  const { data: t } = await supabase
    .from("tournaments")
    .select("current_level, buyback_config_snapshot")
    .eq("id", tp.tournament_id)
    .maybeSingle();

  const cfg = (t?.buyback_config_snapshot ?? {}) as {
    addOnAtBreakLevel?: number;
    addOnChips?: number;
  };
  if (t && cfg.addOnAtBreakLevel && t.current_level !== cfg.addOnAtBreakLevel) {
    throw new Error(
      `Add-on only available at break level ${cfg.addOnAtBreakLevel}.`,
    );
  }

  const addChips = cfg.addOnChips ?? 0;
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("tournament_players")
    .update({
      buyback_used: true,
      buyback_used_as: "addon",
      buyback_used_at_level: t?.current_level ?? null,
      buyback_used_at_time: now,
      current_chips: (tp.current_chips ?? 0) + addChips,
    })
    .eq("id", tournamentPlayerId);
  if (error) throw new Error(error.message);

  await supabase.from("tournament_events").insert({
    tournament_id: tp.tournament_id,
    type: "addon",
    payload: {
      tournament_player_id: tournamentPlayerId,
      player_id: tp.player_id,
      at_level: t?.current_level ?? null,
      chips_added: addChips,
    },
  });

  await refresh(tp.tournament_id);
}

const ColorUpDecisionSchema = z.object({
  requestId: z.uuid(),
  decision: z.enum(["approved", "denied"]),
});

export async function decideColorUp(input: {
  requestId: string;
  decision: "approved" | "denied";
}) {
  await requireAdmin();
  const { requestId, decision } = ColorUpDecisionSchema.parse(input);
  const supabase = await createClient();

  const { data: req } = await supabase
    .from("color_up_requests")
    .select("tournament_id")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) throw new Error("Request not found");

  const { error } = await supabase
    .from("color_up_requests")
    .update({
      status: decision,
      processed_at: new Date().toISOString(),
    })
    .eq("id", requestId);
  if (error) throw new Error(error.message);

  await supabase.from("tournament_events").insert({
    tournament_id: req.tournament_id,
    type: "color_up",
    payload: { request_id: requestId, decision },
  });

  await refresh(req.tournament_id);
}

const FinalizeOptionsSchema = z
  .object({
    chopTopTwo: z.boolean().optional(),
  })
  .optional();

export async function finalizeTournament(
  tournamentId: string,
  options?: { chopTopTwo?: boolean },
) {
  await requireAdmin();
  const id = IdSchema.parse(tournamentId);
  const opts = FinalizeOptionsSchema.parse(options) ?? {};
  const chopTopTwo = !!opts.chopTopTwo;
  const supabase = await createClient();

  const { data: t } = await supabase
    .from("tournaments")
    .select(
      "id, prize_rules_snapshot, buy_in_snapshot, status, finished_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!t) throw new Error("Tournament not found");
  if (t.finished_at) throw new Error("Already finalized");

  const { data: roster } = await supabase
    .from("tournament_players")
    .select("id, player_id, buyback_used, busted_at_time, finishing_position")
    .eq("tournament_id", id);

  const players = roster ?? [];
  const buybacks = players.filter((p) => p.buyback_used).length;

  const payouts = computePayouts(
    t.prize_rules_snapshot as Parameters<typeof computePayouts>[0],
    {
      buyIns: players.length,
      buybacks,
      buyInPrice: t.buy_in_snapshot,
    },
  );

  // Build the finalized payout list. If the admin opted to chop, fold the
  // amounts at positions 1 and 2 together and split evenly. Both rows get
  // is_chopped=true so the recap/UI can render them as "tied for 1st".
  // Position 3+ is unchanged.
  type FinalRow = { position: number; amount: number; isChopped: boolean };
  let finalRows: FinalRow[];

  if (chopTopTwo) {
    const top1 = payouts.payouts.find((p) => p.position === 1);
    const top2 = payouts.payouts.find((p) => p.position === 2);
    if (!top1 || !top2) {
      throw new Error(
        "Chop requires the prize structure to define both 1st and 2nd place.",
      );
    }
    const combined = top1.amount + top2.amount;
    // Integer-dollar rounding: position 1 takes the +$1 if the combined
    // total is odd. Avoids fractional cents in the integer schema and
    // matches the existing "surplusToFirst" convention.
    const lower = Math.floor(combined / 2);
    const upper = combined - lower;
    finalRows = payouts.payouts.map((p) => {
      if (p.position === 1) return { position: 1, amount: upper, isChopped: true };
      if (p.position === 2) return { position: 2, amount: lower, isChopped: true };
      return { position: p.position, amount: p.amount, isChopped: false };
    });
  } else {
    finalRows = payouts.payouts.map((p) => ({
      position: p.position,
      amount: p.amount,
      isChopped: false,
    }));
  }

  const ranked = [...players].sort((a, b) => {
    const ap = a.finishing_position ?? Number.POSITIVE_INFINITY;
    const bp = b.finishing_position ?? Number.POSITIVE_INFINITY;
    return ap - bp;
  });

  const distRows = finalRows.map((p) => ({
    tournament_id: id,
    position: p.position,
    amount: p.amount,
    is_chopped: p.isChopped,
    player_id: ranked[p.position - 1]?.player_id ?? null,
  }));

  if (distRows.length > 0) {
    const { error: distErr } = await supabase
      .from("prize_distributions")
      .upsert(distRows, { onConflict: "tournament_id,position" });
    if (distErr) throw new Error(distErr.message);
  }

  const finishedAt = new Date().toISOString();
  const { error } = await supabase
    .from("tournaments")
    .update({ status: "finished", finished_at: finishedAt })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await supabase.from("tournament_events").insert({
    tournament_id: id,
    type: "finalize",
    payload: {
      buybacks,
      payouts: finalRows,
      effective_pool: payouts.effectivePool,
      chopped_top_two: chopTopTwo,
    },
  });

  revalidatePath("/admin");
  redirect("/admin");
}
