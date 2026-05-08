"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Self-report a bust. Trusts the caller — the schema's RLS only allows
 * admins to mutate `tournament_players`, so this action runs with the
 * service-role key. We constrain the update to (tournament_id, player_id)
 * tuples that exist and are still active so a duplicate tap is a no-op.
 *
 * The accompanying `tournament_events` row makes the action visible in
 * the admin's history feed.
 */
export async function selfReportBust(args: {
  tournamentId: string;
  playerId: string;
  anonSession: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { tournamentId, playerId, anonSession } = args;
  if (!tournamentId || !playerId) {
    return { ok: false, error: "missing identifiers" };
  }
  const admin = createAdminClient();

  const { data: tournament, error: tErr } = await admin
    .from("tournaments")
    .select("current_level, finished_at")
    .eq("id", tournamentId)
    .single();
  if (tErr || !tournament) {
    return { ok: false, error: "tournament not found" };
  }
  if (tournament.finished_at) {
    return { ok: false, error: "tournament is finalized" };
  }

  const { data: tp, error: tpErr } = await admin
    .from("tournament_players")
    .select("id, busted_at_time")
    .eq("tournament_id", tournamentId)
    .eq("player_id", playerId)
    .maybeSingle();
  if (tpErr || !tp) {
    return { ok: false, error: "you are not in this tournament" };
  }
  if (tp.busted_at_time) {
    return { ok: true };
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("tournament_players")
    .update({
      busted_at_time: now,
      busted_at_level: tournament.current_level,
      current_chips: 0,
    })
    .eq("id", tp.id);
  if (updateErr) {
    return { ok: false, error: updateErr.message };
  }

  await admin.from("tournament_events").insert({
    tournament_id: tournamentId,
    type: "bust",
    payload: {
      player_id: playerId,
      level: tournament.current_level,
      reported_by: "player",
      anon_session: anonSession,
    },
  });

  revalidatePath(`/play/${tournamentId}`);
  return { ok: true };
}

export type ColorUpSubmission = {
  tournamentId: string;
  playerId: string;
  anonSession: string;
  submittedTotal: number;
  submittedChips: Array<{ value: number; count: number }>;
  exchangeFor: Array<{ value: number; count: number }>;
  netChange: number;
  newTotal: number;
};

/**
 * Insert a color-up request for the admin queue. The schema has an
 * RLS policy requiring `tournament_players.claimed_session_id` to match
 * the request's `session_id`, but the player view holds claims in
 * Realtime presence (not the DB column), so we route through the
 * service role to avoid a no-op rejection.
 */
export async function submitColorUpRequest(
  payload: ColorUpSubmission,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { error } = await admin.from("color_up_requests").insert({
    tournament_id: payload.tournamentId,
    player_id: payload.playerId,
    session_id: payload.anonSession,
    submitted_chips: {
      total: payload.submittedTotal,
      chips: payload.submittedChips,
    },
    exchange_for_chips: {
      total: payload.newTotal,
      chips: payload.exchangeFor,
      net_change: payload.netChange,
    },
    status: "pending",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
