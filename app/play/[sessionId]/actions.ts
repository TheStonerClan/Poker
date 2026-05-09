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

/**
 * Player self-reports their chip total at a break (typically right after
 * a color-up exchange). Two effects:
 *
 *  1. Append a `chip_snapshot` event so analytics can compute break-over-
 *     break gains/losses without scanning the live player row.
 *  2. Update the player's `current_chips` so the admin / TV totals reflect
 *     the new figure immediately. Without this the TV's average-stack and
 *     M-ratio (BB count) would lag by however much the chip distribution
 *     shifted during the color-up.
 *
 * Constraints:
 * - Only allowed during a break level (the player UI gates on this too,
 *   but enforced server-side). After the break, totals are managed by
 *   the bust / rebuy / addon actions — accepting more snapshots once
 *   play resumes risks confusion.
 * - Tournament must not be finalized.
 */
export async function submitChipSnapshot(args: {
  tournamentId: string;
  playerId: string;
  anonSession: string;
  chips: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { tournamentId, playerId, anonSession, chips } = args;
  if (!tournamentId || !playerId) {
    return { ok: false, error: "missing identifiers" };
  }
  if (!Number.isFinite(chips) || !Number.isInteger(chips) || chips < 0) {
    return { ok: false, error: "chip count must be a non-negative whole number" };
  }
  const admin = createAdminClient();

  const { data: tournament, error: tErr } = await admin
    .from("tournaments")
    .select("current_level, finished_at, blind_structure_snapshot")
    .eq("id", tournamentId)
    .single();
  if (tErr || !tournament) {
    return { ok: false, error: "tournament not found" };
  }
  if (tournament.finished_at) {
    return { ok: false, error: "tournament is finalized" };
  }

  // Server-side break check. The blind_structure_snapshot is JSONB shaped
  // like [{ level_num, is_break, ... }]; find the current level and verify.
  const levels = Array.isArray(tournament.blind_structure_snapshot)
    ? (tournament.blind_structure_snapshot as Array<{
        level_num?: number;
        is_break?: boolean;
      }>)
    : [];
  const currentLevel = levels.find(
    (l) => l.level_num === tournament.current_level,
  );
  if (!currentLevel?.is_break) {
    return {
      ok: false,
      error: "chip count can only be logged during a break",
    };
  }

  const { data: tp, error: tpErr } = await admin
    .from("tournament_players")
    .select("id, busted_at_time, current_chips")
    .eq("tournament_id", tournamentId)
    .eq("player_id", playerId)
    .maybeSingle();
  if (tpErr || !tp) {
    return { ok: false, error: "you are not in this tournament" };
  }
  if (tp.busted_at_time) {
    return { ok: false, error: "you are already busted" };
  }

  const previous = tp.current_chips ?? 0;

  const { error: updErr } = await admin
    .from("tournament_players")
    .update({ current_chips: chips })
    .eq("id", tp.id);
  if (updErr) {
    return { ok: false, error: updErr.message };
  }

  await admin.from("tournament_events").insert({
    tournament_id: tournamentId,
    type: "chip_snapshot",
    payload: {
      player_id: playerId,
      level_num: tournament.current_level,
      chips,
      previous_chips: previous,
      delta: chips - previous,
      anon_session: anonSession,
      reported_by: "player",
    },
  });

  revalidatePath(`/play/${tournamentId}`);
  return { ok: true };
}
