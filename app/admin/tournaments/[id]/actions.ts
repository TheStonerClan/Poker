"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { requireManagePlayerSlot } from "@/lib/auth/table-admin";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { blindLevels } from "@/lib/admin/queries";
import {
  computeBalanceMoves,
  computeMergeMoves,
  randomizeAssignments,
  resolveTablesConfig,
} from "@/lib/admin/tables";
import { computePayouts } from "prize-math";
import type { TablesUpdate } from "@/lib/database.types";

const IdSchema = z.uuid();

async function refresh(tournamentId: string) {
  revalidatePath("/admin");
  revalidatePath(`/admin/tournaments/${tournamentId}`);
  // /tv is a server component pulling the active tournament; revalidate so
  // bust / rebuy / addon / level changes show up immediately on the TV
  // instead of waiting for the 5s drift-sync poll.
  revalidatePath("/tv");
  // Table-admin scoped pages (`/table/[id]/[n]`) read the same roster
  // data; revalidate the whole subtree so an action taken on /admin or
  // on /table propagates either way.
  revalidatePath(`/table/${tournamentId}`, "layout");
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

export async function bustPlayer(input: {
  tournamentPlayerId: string;
}): Promise<AdminActionResult> {
  return runAdminAction(async () => {
    const { tournamentPlayerId } = BustSchema.parse(input);
    // Gate: either the global admin, or the table admin (seated
    // player) for the table this slot is on. Throws on rejection.
    const slot = await requireManagePlayerSlot(tournamentPlayerId);
    if (slot.busted_at_time) return;
    // Use the service client so non-admin table admins can write —
    // tournament_players RLS is admin-only, and the JS-level gate
    // above is what we trust.
    const supabase = createServiceClient();
    const tp = {
      tournament_id: slot.tournament_id,
      player_id: slot.player_id,
      busted_at_time: slot.busted_at_time,
      table_number: slot.table_number,
      seat_number: slot.seat_number,
    };

    const { data: t } = await supabase
      .from("tournaments")
      .select("current_level")
      .eq("id", tp.tournament_id)
      .maybeSingle();

    const { data: roster } = await supabase
      .from("tournament_players")
      .select("id, busted_at_time")
      .eq("tournament_id", tp.tournament_id);

    // Don't set finishing_position here. We used to compute it as the
    // active count at bust time, but that collides under rebuys: if
    // player A busts at 8, rebuys, then player B busts when 8 are still
    // active, B and the (now-cleared) A would both claim position 8 in
    // sequence, and the unique index on (tournament_id,
    // finishing_position) rejects the second write. Positions are now
    // assigned exclusively by performFinalize, sorting by
    // busted_at_time, so each player gets exactly one final position
    // regardless of how many rebuys they cycled through.
    const now = new Date().toISOString();
    // Free the chair: null the seat_number so balance / merge can reassign
    // it, but keep table_number so per-table chip-conservation math still
    // attributes their starting stack + rebuys/addons to the right table.
    // The original (table, seat) is preserved on the bust event payload
    // for analytics. Without this, busted players' seats stayed in the
    // partial unique index and blocked active reassignments — the source
    // of "Balance: no free seat at table N (cap N)" and the merge
    // unique-key violation.
    const { error } = await supabase
      .from("tournament_players")
      .update({
        busted_at_level: t?.current_level ?? null,
        busted_at_time: now,
        current_chips: 0,
        seat_number: null,
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
        table_number: tp.table_number ?? null,
        seat_number: tp.seat_number ?? null,
      },
    });

    // Auto-finalize when only one player remains. performFinalize now
    // computes finishing_position for everyone (busted in chronological
    // order + the survivor at 1) so we don't need to pre-set anything.
    const survivors = (roster ?? []).filter(
      (r) => r.id !== tournamentPlayerId && !r.busted_at_time,
    );
    if (survivors.length === 1) {
      await performFinalize(supabase, tp.tournament_id, {
        chopTopTwo: false,
        autoFromLastBust: true,
      });

      revalidatePath("/admin");
      revalidatePath(`/admin/tournaments/${tp.tournament_id}`);
      revalidatePath("/tv");
      return;
    }

    await refresh(tp.tournament_id);
  });
}

export type AdminActionResult = { ok: true } | { ok: false; error: string };

/**
 * Wrap a Supabase server-action body so that any thrown error surfaces as a
 * client-readable `{ ok: false, error }` instead of a Next 16 redacted
 * server error. Production builds strip thrown error messages "to avoid
 * leaking sensitive details", which makes diagnosing breakage on the
 * preview/prod deployments very painful — anything we WANT visible has to
 * come back as part of the action's return value.
 */
async function runAdminAction(
  fn: () => Promise<void>,
): Promise<AdminActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "Unknown server error";
    return { ok: false, error: message };
  }
}

export async function rebuyPlayer(input: {
  tournamentPlayerId: string;
}): Promise<AdminActionResult> {
  return runAdminAction(async () => {
    await requireAdmin();
    const { tournamentPlayerId } = BustSchema.parse(input);
    const supabase = await createClient();

    // Use SELECT * so a DB that hasn't run migration 0003 (which adds
    // rebuys_used / addons_used) still returns whatever columns DO exist.
    // We read the new counters defensively below.
    const { data: tp } = await supabase
      .from("tournament_players")
      .select("*")
      .eq("id", tournamentPlayerId)
      .maybeSingle();
    if (!tp) throw new Error("Player slot not found");

    const { data: t } = await supabase
      .from("tournaments")
      .select(
        "current_level, rebuy_chips_snapshot, buyback_config_snapshot, num_tables, max_seats_per_table, tables_config",
      )
      .eq("id", tp.tournament_id)
      .maybeSingle();

    const cfg = (t?.buyback_config_snapshot ?? {}) as {
      rebuyAllowedThroughLevel?: number;
      rebuyChips?: number;
      tokensPerPlayer?: number;
    };

    // Token limit: rebuys + addons combined cannot exceed tokensPerPlayer.
    // Default 1 (the legacy single-token rule). When the new counters
    // aren't present (DB without 0003), fall back to the boolean flag.
    const tokensPerPlayer = Math.max(1, cfg.tokensPerPlayer ?? 1);
    const rebuysUsed =
      typeof tp.rebuys_used === "number"
        ? tp.rebuys_used
        : tp.buyback_used && tp.buyback_used_as === "rebuy"
          ? 1
          : 0;
    const addonsUsed =
      typeof tp.addons_used === "number"
        ? tp.addons_used
        : tp.buyback_used && tp.buyback_used_as === "addon"
          ? 1
          : 0;
    const tokensSpent = rebuysUsed + addonsUsed;
    if (tokensSpent >= tokensPerPlayer) {
      throw new Error(
        `Buyback limit reached (${tokensSpent} of ${tokensPerPlayer} used).`,
      );
    }

    const cap = cfg.rebuyAllowedThroughLevel ?? Number.POSITIVE_INFINITY;
    if (t && t.current_level > cap) {
      throw new Error(`Rebuy window closed (allowed through level ${cap}).`);
    }

    const chips = cfg.rebuyChips ?? t?.rebuy_chips_snapshot ?? 0;
    const now = new Date().toISOString();

    // Find a seat for the rebought player. bustPlayer nulled their
    // seat_number to free the chair; rebuy needs to put them back at a
    // table. Prefer their original table_number (still set on the row);
    // fall back to whichever table has the most free seats if their
    // original is now at capacity (e.g., a Balance moved someone else
    // into their old slot).
    const tables = resolveTablesConfig({
      tablesConfig: t?.tables_config,
      numTables: t?.num_tables ?? null,
      maxSeatsPerTable: t?.max_seats_per_table ?? null,
    });
    let chosenTable: number | null = tp.table_number ?? null;
    let chosenSeat: number | null = null;
    if (tables.length > 0) {
      const { data: occupants } = await supabase
        .from("tournament_players")
        .select("table_number, seat_number")
        .eq("tournament_id", tp.tournament_id)
        .not("seat_number", "is", null);
      const occupied = new Map<number, Set<number>>();
      for (const o of occupants ?? []) {
        if (o.table_number != null && o.seat_number != null) {
          if (!occupied.has(o.table_number)) {
            occupied.set(o.table_number, new Set());
          }
          occupied.get(o.table_number)?.add(o.seat_number);
        }
      }
      const findSeat = (tableNum: number): number | null => {
        if (tableNum < 1 || tableNum > tables.length) return null;
        const cap = tables[tableNum - 1].max_seats;
        const used = occupied.get(tableNum) ?? new Set<number>();
        for (let s = 1; s <= cap; s++) {
          if (!used.has(s)) return s;
        }
        return null;
      };
      // Try original table first; on full, fall back to whichever table
      // has any room (lowest table number breaks ties).
      if (chosenTable != null) chosenSeat = findSeat(chosenTable);
      if (chosenSeat == null) {
        for (let i = 1; i <= tables.length; i++) {
          const seat = findSeat(i);
          if (seat != null) {
            chosenTable = i;
            chosenSeat = seat;
            break;
          }
        }
      }
      if (chosenSeat == null) {
        throw new Error(
          "No free seat at any table for the rebuy. Bust someone or expand a table.",
        );
      }
    }

    // Build the update payload conditionally so we don't try to write the
    // 0003 columns on a DB that doesn't have them.
    const update: TablesUpdate<"tournament_players"> = {
      buyback_used: true,
      buyback_used_as: "rebuy",
      buyback_used_at_level: t?.current_level ?? null,
      buyback_used_at_time: now,
      busted_at_level: null,
      busted_at_time: null,
      // Player is back in play; clear their bust-time finishing_position
      // so the unique index doesn't reject the next bust.
      finishing_position: null,
      current_chips: chips,
    };
    if (chosenSeat != null) {
      update.seat_number = chosenSeat;
      if (chosenTable != null) update.table_number = chosenTable;
    }
    if (typeof tp.rebuys_used === "number") {
      update.rebuys_used = rebuysUsed + 1;
    }

    const { error } = await supabase
      .from("tournament_players")
      .update(update)
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
        tokens_spent_after: tokensSpent + 1,
        tokens_per_player: tokensPerPlayer,
        table_number: chosenTable,
        seat_number: chosenSeat,
      },
    });

    await refresh(tp.tournament_id);
  });
}

export async function applyAddOn(input: {
  tournamentPlayerId: string;
}): Promise<AdminActionResult> {
  return runAdminAction(async () => {
    await requireAdmin();
    const { tournamentPlayerId } = BustSchema.parse(input);
    const supabase = await createClient();

    const { data: tp } = await supabase
      .from("tournament_players")
      .select("*")
      .eq("id", tournamentPlayerId)
      .maybeSingle();
    if (!tp) throw new Error("Player slot not found");

    const { data: t } = await supabase
      .from("tournaments")
      .select("current_level, buyback_config_snapshot")
      .eq("id", tp.tournament_id)
      .maybeSingle();

    const cfg = (t?.buyback_config_snapshot ?? {}) as {
      addOnAtBreakLevel?: number;
      addOnChips?: number;
      tokensPerPlayer?: number;
    };

    const tokensPerPlayer = Math.max(1, cfg.tokensPerPlayer ?? 1);
    const rebuysUsed =
      typeof tp.rebuys_used === "number"
        ? tp.rebuys_used
        : tp.buyback_used && tp.buyback_used_as === "rebuy"
          ? 1
          : 0;
    const addonsUsed =
      typeof tp.addons_used === "number"
        ? tp.addons_used
        : tp.buyback_used && tp.buyback_used_as === "addon"
          ? 1
          : 0;
    const tokensSpent = rebuysUsed + addonsUsed;
    if (tokensSpent >= tokensPerPlayer) {
      throw new Error(
        `Buyback limit reached (${tokensSpent} of ${tokensPerPlayer} used).`,
      );
    }
    if (
      t &&
      cfg.addOnAtBreakLevel &&
      t.current_level !== cfg.addOnAtBreakLevel
    ) {
      throw new Error(
        `Add-on only available at break level ${cfg.addOnAtBreakLevel}.`,
      );
    }

    const addChips = cfg.addOnChips ?? 0;
    const now = new Date().toISOString();

    const update: TablesUpdate<"tournament_players"> = {
      buyback_used: true,
      buyback_used_as: "addon",
      buyback_used_at_level: t?.current_level ?? null,
      buyback_used_at_time: now,
      current_chips: (tp.current_chips ?? 0) + addChips,
    };
    if (typeof tp.addons_used === "number") {
      update.addons_used = addonsUsed + 1;
    }

    const { error } = await supabase
      .from("tournament_players")
      .update(update)
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
        tokens_spent_after: tokensSpent + 1,
        tokens_per_player: tokensPerPlayer,
      },
    });

    await refresh(tp.tournament_id);
  });
}

const ColorUpDecisionSchema = z.object({
  requestId: z.uuid(),
  decision: z.enum(["approved", "denied"]),
});

export async function decideColorUp(input: {
  requestId: string;
  decision: "approved" | "denied";
}) {
  const { requestId, decision } = ColorUpDecisionSchema.parse(input);
  // Look up the request first so we can resolve the player's
  // tournament_player slot, then gate via requireManagePlayerSlot.
  // Service client both for the lookup (cross-table read) and the
  // subsequent writes so a non-admin table admin can decide a
  // color-up for someone at their own table.
  const supabase = createServiceClient();

  const { data: req } = await supabase
    .from("color_up_requests")
    .select("tournament_id, player_id, submitted_chips, exchange_for_chips")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) throw new Error("Request not found");

  // Resolve the slot for this (tournament, player) so the gate
  // can verify the caller is at the right table.
  const { data: slotRow } = await supabase
    .from("tournament_players")
    .select("id")
    .eq("tournament_id", req.tournament_id)
    .eq("player_id", req.player_id)
    .maybeSingle();
  if (!slotRow) throw new Error("Player slot not found");
  await requireManagePlayerSlot(slotRow.id);

  // Pull the rounding delta out of the player's submission. The player
  // page stores the exchange as { total, chips, net_change }, where
  // net_change is (newTotal - submittedTotal): positive when the
  // exchange rounded up (player gains chips), zero on exact swaps,
  // negative on round-down. This is what we apply to current_chips on
  // approve so the per-player display + the tournament-wide chip total
  // both reflect the gain.
  const efc = req.exchange_for_chips as {
    total?: number;
    net_change?: number;
  } | null;
  const sc = req.submitted_chips as { total?: number } | null;
  const netChange =
    efc && typeof efc.net_change === "number" ? efc.net_change : 0;
  const submittedTotal =
    sc && typeof sc.total === "number" ? sc.total : null;
  const newTotal = efc && typeof efc.total === "number" ? efc.total : null;

  // On approve, bump the player's current_chips by net_change so a
  // round-up exchange ($23 → $25) shows the +$2 in their stack and
  // contributes to the pool. On deny, leave current_chips alone.
  if (decision === "approved" && netChange !== 0 && req.player_id) {
    const { data: tp } = await supabase
      .from("tournament_players")
      .select("id, current_chips")
      .eq("tournament_id", req.tournament_id)
      .eq("player_id", req.player_id)
      .maybeSingle();
    if (tp) {
      const next = (tp.current_chips ?? 0) + netChange;
      const { error: chipErr } = await supabase
        .from("tournament_players")
        .update({ current_chips: Math.max(0, next) })
        .eq("id", tp.id);
      if (chipErr) throw new Error(chipErr.message);
    }
  }

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
    payload: {
      request_id: requestId,
      decision,
      player_id: req.player_id,
      submitted_total: submittedTotal,
      new_total: newTotal,
      net_change: netChange,
    },
  });

  await refresh(req.tournament_id);
}

const ManualColorUpSchema = z.object({
  tournamentPlayerId: z.uuid(),
  submittedTotal: z.coerce.number().int().min(0).max(1_000_000),
  receivedTotal: z.coerce.number().int().min(0).max(1_000_000),
});

/**
 * Admin-direct color-up entry. The standard flow is player-submits-via-
 * /play → admin-approves-via-ColorUpInbox, but the room sometimes wants
 * the admin to record an exchange on the spot (player handed chips
 * across the table, no /play submission). This action mirrors the
 * decide-and-approve path: it persists a color_up_requests row with
 * status='approved', bumps the player's current_chips by the round-up
 * delta, and appends a tournament_events row — so the downstream
 * tournament-wide chip-pool readers (getApprovedColorUpGains) and TV
 * accounting work identically to the player-submitted flow.
 *
 * Uses the service client to bypass the session-tied INSERT policy on
 * color_up_requests (which exists to prevent unclaimed-session spam
 * from /play but blocks legitimate admin entries).
 */
export async function applyManualColorUp(input: {
  tournamentPlayerId: string;
  submittedTotal: number;
  receivedTotal: number;
}): Promise<AdminActionResult> {
  return runAdminAction(async () => {
    const { tournamentPlayerId, submittedTotal, receivedTotal } =
      ManualColorUpSchema.parse(input);
    // Gate: admin OR table admin for this player's table.
    const slot = await requireManagePlayerSlot(tournamentPlayerId);
    if (slot.busted_at_time) {
      throw new Error("Can't color-up a busted player.");
    }
    if (!slot.player_id) {
      throw new Error("Player slot has no linked player.");
    }
    const supabase = await createClient();
    const tp = {
      id: tournamentPlayerId,
      tournament_id: slot.tournament_id,
      player_id: slot.player_id,
      current_chips: slot.current_chips,
      busted_at_time: slot.busted_at_time,
    };

    const { data: t } = await supabase
      .from("tournaments")
      .select("status")
      .eq("id", tp.tournament_id)
      .maybeSingle();
    if (!t) throw new Error("Tournament not found");
    if (t.status !== "running" && t.status !== "paused") {
      throw new Error(
        `Color-up is only available while the tournament is running or paused (currently ${t.status}).`,
      );
    }

    const netChange = receivedTotal - submittedTotal;

    // Service client: bypasses the session-tied RLS INSERT policy on
    // color_up_requests (which prevents anon spam from /play but blocks
    // legitimate admin-initiated rows). All other admin paths already
    // do this kind of thing through createServiceClient.
    const service = createServiceClient();

    const nowIso = new Date().toISOString();
    const { data: inserted, error: insErr } = await service
      .from("color_up_requests")
      .insert({
        tournament_id: tp.tournament_id,
        player_id: tp.player_id,
        // No real session — admin entry. The schema requires text NOT
        // NULL, so a sentinel keeps the audit trail readable without
        // ever colliding with a real /play session id.
        session_id: "admin-manual",
        submitted_chips: { total: submittedTotal, chips: [] },
        exchange_for_chips: {
          total: receivedTotal,
          chips: [],
          net_change: netChange,
        },
        status: "approved",
        processed_at: nowIso,
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      throw new Error(insErr?.message ?? "Could not record color-up");
    }

    if (netChange !== 0) {
      const nextChips = Math.max(0, (tp.current_chips ?? 0) + netChange);
      const { error: chipErr } = await service
        .from("tournament_players")
        .update({ current_chips: nextChips })
        .eq("id", tp.id);
      if (chipErr) throw new Error(chipErr.message);
    }

    await service.from("tournament_events").insert({
      tournament_id: tp.tournament_id,
      type: "color_up",
      payload: {
        request_id: inserted.id,
        decision: "approved",
        player_id: tp.player_id,
        submitted_total: submittedTotal,
        new_total: receivedTotal,
        net_change: netChange,
        source: "admin-manual",
      },
    });

    await refresh(tp.tournament_id);
  });
}

const FinalizeOptionsSchema = z
  .object({
    chopTopTwo: z.boolean().optional(),
  })
  .optional();

type SupabaseAny =
  | Awaited<ReturnType<typeof createClient>>
  | ReturnType<typeof createServiceClient>;

/**
 * Core finalize logic, factored out so both the manual finalize action and
 * the auto-finalize-on-last-bust path can call it without duplicating the
 * pool math. Doesn't redirect — caller handles navigation. Doesn't gate on
 * roster size — caller is responsible for that (auto-finalize: exactly 1
 * survivor; manual: exactly 2 in-play).
 */
async function performFinalize(
  supabase: SupabaseAny,
  tournamentId: string,
  options: { chopTopTwo: boolean; autoFromLastBust?: boolean },
): Promise<void> {
  const { data: t } = await supabase
    .from("tournaments")
    .select(
      "id, prize_rules_snapshot, buy_in_snapshot, status, finished_at",
    )
    .eq("id", tournamentId)
    .maybeSingle();
  if (!t) throw new Error("Tournament not found");
  if (t.finished_at) throw new Error("Already finalized");

  const { data: roster } = await supabase
    .from("tournament_players")
    .select(
      "id, player_id, buyback_used, rebuys_used, addons_used, busted_at_time, finishing_position",
    )
    .eq("tournament_id", tournamentId);

  const players = roster ?? [];

  // Compute finishing_position for everyone now (single authoritative
  // assignment). Algorithm:
  //   - Survivors (busted_at_time IS NULL) split position 1 evenly. The
  //     normal case is one survivor → 1; chop sets two heads-up players
  //     to 1 and 2 with the chop flag on the payouts side.
  //   - Busted players sort by busted_at_time ASCENDING (earliest bust
  //     first). The earliest bust gets position N (worst), the next gets
  //     N-1, and so on, leaving position 2 for the last to bust.
  // Re-bought players' busted_at_time reflects their LAST bust, so they
  // get one final position regardless of how many cycles they survived.
  // Clearing existing finishing_position values first lets us reassign
  // without colliding on the unique partial index.
  const survivors = players.filter((p) => p.busted_at_time == null);
  const busted = players
    .filter((p) => p.busted_at_time != null)
    .sort((a, b) => {
      const at = new Date(a.busted_at_time as string).getTime();
      const bt = new Date(b.busted_at_time as string).getTime();
      return at - bt;
    });

  const N = players.length;
  const positionUpdates: Array<{ id: string; position: number }> = [];

  // Survivors → 1 (and 2 for chop). The current schema's unique partial
  // index allows multiple survivors only if some have NULL position;
  // when there are 2 survivors and chop is off, give them positions 1
  // and 2 by tournament_player.id order so we don't violate the index
  // when a manual finalize-with-2-still-in happens.
  if (survivors.length === 1) {
    positionUpdates.push({ id: survivors[0].id, position: 1 });
  } else if (survivors.length >= 2) {
    const sorted = [...survivors].sort((a, b) => a.id.localeCompare(b.id));
    positionUpdates.push({ id: sorted[0].id, position: 1 });
    if (sorted[1]) positionUpdates.push({ id: sorted[1].id, position: 2 });
    // Any extra survivors (shouldn't happen for a sane finalize) get
    // pushed onto the end of the busted-by-time list to fill positions
    // 3, 4, … in their id order. Defensive.
    for (let i = 2; i < sorted.length; i++) {
      positionUpdates.push({ id: sorted[i].id, position: i + 1 });
    }
  }

  // Busted, in chronological order. The first to bust earns position N,
  // working down toward 2. We start at N and decrement, but skip any
  // positions already claimed by survivors above.
  const claimed = new Set(positionUpdates.map((p) => p.position));
  let nextBustPosition = N;
  for (const b of busted) {
    while (claimed.has(nextBustPosition)) nextBustPosition--;
    positionUpdates.push({ id: b.id, position: nextBustPosition });
    claimed.add(nextBustPosition);
    nextBustPosition--;
  }

  // Two-phase: clear existing finishing_position values so the new ones
  // don't collide with stale data from earlier busts during the assignment
  // pass.
  const { error: clearErr } = await supabase
    .from("tournament_players")
    .update({ finishing_position: null })
    .eq("tournament_id", tournamentId);
  if (clearErr) throw new Error(clearErr.message);

  for (const u of positionUpdates) {
    const { error: upErr } = await supabase
      .from("tournament_players")
      .update({ finishing_position: u.position })
      .eq("id", u.id);
    if (upErr) throw new Error(upErr.message);
  }

  // Re-fetch with the freshly assigned positions for use by the payout
  // ranking below. Cheaper than mutating the in-memory array piecemeal.
  const { data: rankedRoster } = await supabase
    .from("tournament_players")
    .select(
      "id, player_id, buyback_used, rebuys_used, addons_used, busted_at_time, finishing_position",
    )
    .eq("tournament_id", tournamentId);
  const rankedPlayers = rankedRoster ?? players;
  // Sum the per-player counters so buybacks reflects actual paid entries
  // when tokensPerPlayer > 1. The counter columns default to 0 and the
  // 0003 backfill set them to 1 for legacy rows that already had
  // buyback_used=true, so this is correct for both old and new data.
  const buybacks = players.reduce(
    (s, p) => s + (p.rebuys_used ?? 0) + (p.addons_used ?? 0),
    0,
  );

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

  if (options.chopTopTwo) {
    const top1 = payouts.payouts.find((p) => p.position === 1);
    const top2 = payouts.payouts.find((p) => p.position === 2);
    if (!top1 || !top2) {
      throw new Error(
        "Chop requires the prize structure to define both 1st and 2nd place.",
      );
    }
    const combined = top1.amount + top2.amount;
    // Integer-dollar rounding: position 1 takes the +$1 if the combined
    // total is odd. Matches the existing surplusToFirst convention.
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

  const ranked = [...rankedPlayers].sort((a, b) => {
    const ap = a.finishing_position ?? Number.POSITIVE_INFINITY;
    const bp = b.finishing_position ?? Number.POSITIVE_INFINITY;
    return ap - bp;
  });

  const distRows = finalRows.map((p) => ({
    tournament_id: tournamentId,
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
    .eq("id", tournamentId);
  if (error) throw new Error(error.message);

  await supabase.from("tournament_events").insert({
    tournament_id: tournamentId,
    type: "finalize",
    payload: {
      buybacks,
      payouts: finalRows,
      effective_pool: payouts.effectivePool,
      chopped_top_two: options.chopTopTwo,
      auto: options.autoFromLastBust ?? false,
    },
  });
}

export async function finalizeTournament(
  tournamentId: string,
  options?: { chopTopTwo?: boolean },
) {
  await requireAdmin();
  const id = IdSchema.parse(tournamentId);
  const opts = FinalizeOptionsSchema.parse(options) ?? {};
  const chopTopTwo = !!opts.chopTopTwo;
  const supabase = await createClient();

  // Manual-finalize gating: only allow when exactly 2 players are still
  // in play. 1-or-fewer means the auto-finalize path on the last bust
  // already handled (or should handle) it; 3+ means the tournament isn't
  // close enough to its end to call. This makes the "chop pot" UX safe:
  // chop is only ever offered when there are 2 left, and the manual
  // button is hidden otherwise.
  const { data: roster } = await supabase
    .from("tournament_players")
    .select("id, busted_at_time")
    .eq("tournament_id", id);
  const inPlay = (roster ?? []).filter((r) => !r.busted_at_time).length;

  if (inPlay !== 2) {
    throw new Error(
      `Manual finalize is only available with exactly 2 players still in play (currently ${inPlay}). The last bust auto-finalizes; if more than 2 are in, keep playing.`,
    );
  }

  await performFinalize(supabase, id, { chopTopTwo });

  revalidatePath("/admin");
  revalidatePath(`/admin/tournaments/${id}`);
  revalidatePath("/tv");
  redirect("/admin");
}

/**
 * Hard-delete a tournament that hasn't started yet. The admin set one up
 * by mistake (wrong template, dummy/test run) and wants it gone — there
 * are no events worth preserving, so the row and its empty roster get
 * dropped entirely instead of being soft-cancelled.
 *
 * Wraps the `delete_tournament` RPC, which handles the
 * tournament_events append-only trigger that would otherwise block the
 * cascading delete. Gated to status='scheduled' so a live or finished
 * tournament can't be wiped by accident.
 */
export async function cancelScheduledTournament(
  tournamentId: string,
): Promise<AdminActionResult> {
  return runAdminAction(async () => {
    await requireAdmin();
    const id = IdSchema.parse(tournamentId);
    const supabase = await createClient();

    const { data: t, error: fetchErr } = await supabase
      .from("tournaments")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (fetchErr || !t) {
      throw new Error(fetchErr?.message ?? "Tournament not found");
    }
    if (t.status !== "scheduled") {
      throw new Error(
        `Cancel is only available before a tournament starts (currently ${t.status}). Finish it first, then delete from the detail page.`,
      );
    }

    const { error } = await supabase.rpc("delete_tournament", {
      p_tournament_id: id,
    });
    if (error) throw new Error(error.message);

    revalidatePath("/admin");
    revalidatePath("/admin/tournaments");
    revalidatePath("/tv");
  });
}

/**
 * Hard-delete a finalized tournament. Use case: the admin ran a
 * test/dummy tournament end-to-end and now wants it gone from
 * /history. Wipes the tournament plus its roster, events, color-up
 * requests, and prize distributions via the cascading delete RPC.
 *
 * Gated to status='finished' (and 'cancelled' for legacy soft-cancelled
 * rows, if any exist) so a live tournament can't be deleted out from
 * under the admin mid-game. Destructive — UI surfaces a confirm.
 */
export async function deleteFinalizedTournament(
  tournamentId: string,
): Promise<AdminActionResult> {
  return runAdminAction(async () => {
    await requireAdmin();
    const id = IdSchema.parse(tournamentId);
    const supabase = await createClient();

    const { data: t, error: fetchErr } = await supabase
      .from("tournaments")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (fetchErr || !t) {
      throw new Error(fetchErr?.message ?? "Tournament not found");
    }
    if (t.status !== "finished" && t.status !== "cancelled") {
      throw new Error(
        `Delete is only available after a tournament finishes (currently ${t.status}). Finalize it first.`,
      );
    }

    const { error } = await supabase.rpc("delete_tournament", {
      p_tournament_id: id,
    });
    if (error) throw new Error(error.message);

    revalidatePath("/admin");
    revalidatePath("/admin/tournaments");
    revalidatePath("/history");
    revalidatePath("/tv");
  });
}

/**
 * Re-shuffle the roster across the tournament's tables. Only valid while
 * the tournament is in `scheduled` state (before the timer starts) — once
 * the cards are dealt, players are committed to their seats.
 *
 * Returns the same `{ ok, error? }` shape as the other admin actions so
 * the production error message survives Next 16's redaction.
 */
export async function randomizeTableAssignments(
  tournamentId: string,
): Promise<AdminActionResult> {
  return runAdminAction(async () => {
    await requireAdmin();
    const id = IdSchema.parse(tournamentId);
    const supabase = await createClient();

    const { data: t, error: tErr } = await supabase
      .from("tournaments")
      .select("status, num_tables, max_seats_per_table, tables_config")
      .eq("id", id)
      .maybeSingle();
    if (tErr || !t) throw new Error(tErr?.message ?? "Tournament not found");
    if (t.status !== "scheduled") {
      throw new Error(
        `Re-randomize is only available while the tournament is scheduled (currently ${t.status}).`,
      );
    }

    const tables = resolveTablesConfig({
      tablesConfig: t.tables_config,
      numTables: t.num_tables,
      maxSeatsPerTable: t.max_seats_per_table,
    });
    if (tables.length === 0) {
      throw new Error(
        "This tournament was created before table management — open a new tournament to use it.",
      );
    }

    const { data: roster } = await supabase
      .from("tournament_players")
      .select("id")
      .eq("tournament_id", id);
    const rows = roster ?? [];
    if (rows.length === 0) {
      throw new Error("No players to randomize.");
    }

    const assignments = randomizeAssignments({
      playerIds: rows.map((r) => r.id),
      tables,
    });

    // Two-phase update: clear seats first, then assign. The unique index
    // on (tournament_id, table_number, seat_number) would otherwise reject
    // any update that swaps two players' seats. Clearing to NULL drops
    // them out of the partial unique index entirely.
    const { error: clearErr } = await supabase
      .from("tournament_players")
      .update({ table_number: null, seat_number: null })
      .eq("tournament_id", id);
    if (clearErr) throw new Error(clearErr.message);

    // Apply new assignments one row at a time. With ~30 players this is
    // cheap; the alternative (a Postgres CTE update) would need a custom
    // RPC. The `player_id` field on each assignment is actually the
    // tournament_player row id we shuffled in (the helper is id-agnostic),
    // so we can update by it directly.
    for (const a of assignments) {
      const { error } = await supabase
        .from("tournament_players")
        .update({
          table_number: a.table_number,
          seat_number: a.seat_number,
        })
        .eq("id", a.player_id);
      if (error) throw new Error(error.message);
    }

    await refresh(id);
  });
}

/**
 * Redistribute active players across the existing tables so the spread
 * (busiest minus quietest) is ≤ 1. Touches only active players —
 * busted-out rows keep their historical (table, seat) for the record.
 *
 * Only valid during play (running / paused). Returns an error result if
 * tables are already balanced or there's only one table.
 */
export async function balanceTables(
  tournamentId: string,
): Promise<AdminActionResult> {
  return runAdminAction(async () => {
    await requireAdmin();
    const id = IdSchema.parse(tournamentId);
    const supabase = await createClient();

    const { data: t, error: tErr } = await supabase
      .from("tournaments")
      .select("status, num_tables, max_seats_per_table, tables_config")
      .eq("id", id)
      .maybeSingle();
    if (tErr || !t) throw new Error(tErr?.message ?? "Tournament not found");
    if (t.status !== "running" && t.status !== "paused") {
      throw new Error(
        `Balance is only available during play (currently ${t.status}).`,
      );
    }

    const tables = resolveTablesConfig({
      tablesConfig: t.tables_config,
      numTables: t.num_tables,
      maxSeatsPerTable: t.max_seats_per_table,
    });
    if (tables.length <= 1) {
      throw new Error("Only one table — nothing to balance.");
    }

    const { data: rows } = await supabase
      .from("tournament_players")
      .select("id, table_number, seat_number, busted_at_time")
      .eq("tournament_id", id);

    const moves = computeBalanceMoves({
      rows: rows ?? [],
      tablesConfig: tables,
    });
    if (moves.length === 0) {
      throw new Error("Tables are already balanced.");
    }

    // Defensive cleanup: free busted players' seats so they don't block
    // active reassignments via the partial unique index on
    // (tournament_id, table_number, seat_number). Going forward,
    // bustPlayer nulls seat_number on bust, so this only catches old
    // tournaments created before that fix. table_number stays so the
    // per-table chip-conservation math still attributes their stack.
    const { error: clearBustedErr } = await supabase
      .from("tournament_players")
      .update({ seat_number: null })
      .eq("tournament_id", id)
      .not("busted_at_time", "is", null);
    if (clearBustedErr) throw new Error(clearBustedErr.message);

    // Each move targets an unused (table, seat) per the helper's invariant
    // (it tracks the occupied set as it generates moves, ignoring busted
    // players). So a sequence of single-row updates can't violate the
    // partial unique index.
    for (const m of moves) {
      const { error } = await supabase
        .from("tournament_players")
        .update({
          table_number: m.table_number,
          seat_number: m.seat_number,
        })
        .eq("id", m.id);
      if (error) throw new Error(error.message);
    }

    await refresh(id);
  });
}

/**
 * Consolidate every active player onto the largest-capacity table.
 * Active players already at the target keep their seats; everyone else
 * gets a randomized seat among the remaining unused chairs at the
 * target. Busted players keep their original (table, seat) for the
 * record — they're not playing anymore and their stats stay attached
 * to the table they busted at.
 *
 * Only valid when active count fits at the largest configured table
 * (otherwise the merge would overflow). Trigger this from the admin UI
 * once the field is small enough.
 */
export async function mergeTables(
  tournamentId: string,
): Promise<AdminActionResult> {
  return runAdminAction(async () => {
    await requireAdmin();
    const id = IdSchema.parse(tournamentId);
    const supabase = await createClient();

    const { data: t, error: tErr } = await supabase
      .from("tournaments")
      .select("status, num_tables, max_seats_per_table, tables_config")
      .eq("id", id)
      .maybeSingle();
    if (tErr || !t) throw new Error(tErr?.message ?? "Tournament not found");
    if (t.status !== "running" && t.status !== "paused") {
      throw new Error(
        `Merge is only available during play (currently ${t.status}).`,
      );
    }

    const tables = resolveTablesConfig({
      tablesConfig: t.tables_config,
      numTables: t.num_tables,
      maxSeatsPerTable: t.max_seats_per_table,
    });

    const { data: rows } = await supabase
      .from("tournament_players")
      .select("id, table_number, seat_number, busted_at_time")
      .eq("tournament_id", id);

    const plan = computeMergeMoves({
      rows: rows ?? [],
      tablesConfig: tables,
    });
    if (plan.kind === "blocked") {
      throw new Error(plan.reason);
    }

    // Defensive cleanup: free busted players' seats so they don't block
    // active reassignments via the partial unique index on
    // (tournament_id, table_number, seat_number). Going forward,
    // bustPlayer nulls seat_number on bust, so this only catches
    // tournaments created before that fix. table_number stays so the
    // per-table chip-conservation math still attributes their stack.
    const { error: clearBustedErr } = await supabase
      .from("tournament_players")
      .update({ seat_number: null })
      .eq("tournament_id", id)
      .not("busted_at_time", "is", null);
    if (clearBustedErr) throw new Error(clearBustedErr.message);

    // Two-phase: clear movers' (table, seat) up front. Their target
    // seats might collide mid-loop with each other or with the seats
    // they're currently occupying on the source table. Stayers (active
    // players already at the target) are untouched — their seats were
    // factored into the plan via computeMergeMoves's `usedSeats` set.
    const moverIds = new Set(plan.moves.map((m) => m.id));
    if (moverIds.size > 0) {
      const { error: clearErr } = await supabase
        .from("tournament_players")
        .update({ table_number: null, seat_number: null })
        .in("id", Array.from(moverIds));
      if (clearErr) throw new Error(clearErr.message);
    }

    for (const m of plan.moves) {
      const { error } = await supabase
        .from("tournament_players")
        .update({
          table_number: m.table_number,
          seat_number: m.seat_number,
        })
        .eq("id", m.id);
      if (error) throw new Error(error.message);
    }

    await supabase.from("tournament_events").insert({
      tournament_id: id,
      type: "admin_note",
      payload: {
        kind: "merge_tables",
        target_table: plan.targetTable,
        moved: plan.moves.length,
      },
    });

    await refresh(id);
  });
}

// ─── Pre-game roster edits (status='scheduled' only) ────────────────────────

const AddPlayersSchema = z.object({
  tournamentId: z.uuid(),
  playerIds: z.array(z.uuid()).min(1, "Pick at least one player to add."),
});

/**
 * Stage additional players onto a scheduled (not-yet-started)
 * tournament. Lets the admin add late-confirming RSVPs over the days
 * leading up to a game without re-running the wizard from scratch.
 *
 * Smart-insert seating: each new player takes the lowest free seat at
 * the table with the most remaining capacity. Existing players keep
 * their (table, seat) — the admin can hit "Re-randomize" separately
 * if they want a fresh shuffle.
 *
 * Idempotent on player_id: passing a player who's already rostered is
 * silently skipped instead of erroring (so an "Add" UI that doesn't
 * pre-filter the master list still works).
 *
 * Locked once the tournament starts. The detail page also hides the
 * controls in that state, but the action enforces it server-side.
 */
export async function addPlayersToTournament(input: {
  tournamentId: string;
  playerIds: string[];
}): Promise<AdminActionResult> {
  return runAdminAction(async () => {
    await requireAdmin();
    const { tournamentId, playerIds } = AddPlayersSchema.parse(input);
    const supabase = await createClient();

    const { data: t, error: tErr } = await supabase
      .from("tournaments")
      .select(
        "status, starting_stack_snapshot, num_tables, max_seats_per_table, tables_config",
      )
      .eq("id", tournamentId)
      .maybeSingle();
    if (tErr || !t) throw new Error(tErr?.message ?? "Tournament not found");
    if (t.status !== "scheduled") {
      throw new Error(
        `Roster is locked once the tournament starts (currently ${t.status}).`,
      );
    }

    const { data: existing, error: rosterErr } = await supabase
      .from("tournament_players")
      .select("player_id, table_number, seat_number")
      .eq("tournament_id", tournamentId);
    if (rosterErr) throw new Error(rosterErr.message);

    const alreadyRostered = new Set(
      (existing ?? []).map((r) => r.player_id).filter(Boolean) as string[],
    );
    const toAdd = playerIds.filter((id) => !alreadyRostered.has(id));
    if (toAdd.length === 0) return; // nothing to do — caller asked for already-rostered players

    const tables = resolveTablesConfig({
      tablesConfig: t.tables_config,
      numTables: t.num_tables,
      maxSeatsPerTable: t.max_seats_per_table,
    });

    // Build per-table occupied-seat counts so we can keep picking
    // "table with most remaining capacity" greedily without re-
    // computing from the occupied set every iteration.
    const filled = tables.map((cfg) => {
      let n = 0;
      for (const r of existing ?? []) {
        if (r.table_number === tables.indexOf(cfg) + 1) n++;
      }
      return n;
    });
    const occupied = new Set<string>();
    for (const r of existing ?? []) {
      if (r.table_number != null && r.seat_number != null) {
        occupied.add(`${r.table_number}:${r.seat_number}`);
      }
    }

    const newRows: Array<{
      tournament_id: string;
      player_id: string;
      current_chips: number;
      table_number?: number | null;
      seat_number?: number | null;
    }> = [];
    for (const pid of toAdd) {
      // No tables configured (legacy tournament) — insert with NULL
      // seat so the admin can re-seat manually. Doesn't error so the
      // add still works.
      if (tables.length === 0) {
        newRows.push({
          tournament_id: tournamentId,
          player_id: pid,
          current_chips: t.starting_stack_snapshot,
        });
        continue;
      }

      // Pick the table with the FEWEST occupants (skipping any at
      // cap). Ties break to the lowest-indexed table for
      // determinism. We deliberately go by fewest-filled rather than
      // most-remaining-seats: with uneven max_seats those two pick
      // different tables, and "balanced player count" is what the
      // admin wants when staging a late RSVP. Bug reported by Travis
      // — caps 10/9, current split 7/6, added player went to t1
      // (more remaining) instead of t2 (fewer players).
      let bestIdx = -1;
      let bestFilled = Infinity;
      for (let i = 0; i < tables.length; i++) {
        if (filled[i] >= tables[i].max_seats) continue;
        if (filled[i] < bestFilled) {
          bestIdx = i;
          bestFilled = filled[i];
        }
      }
      if (bestIdx < 0) {
        throw new Error(
          "All tables are full. Add a table or raise a seat cap before adding more players.",
        );
      }

      const tableNumber = bestIdx + 1;
      const cap = tables[bestIdx].max_seats;
      let seat = 1;
      while (seat <= cap && occupied.has(`${tableNumber}:${seat}`)) seat++;
      if (seat > cap) {
        // Shouldn't happen given the bestRemaining check above, but
        // bail loudly rather than silently NULL the seat.
        throw new Error(
          `No free seat at ${tables[bestIdx].name} (cap ${cap}). Re-randomize and try again.`,
        );
      }
      occupied.add(`${tableNumber}:${seat}`);
      filled[bestIdx]++;
      newRows.push({
        tournament_id: tournamentId,
        player_id: pid,
        table_number: tableNumber,
        seat_number: seat,
        current_chips: t.starting_stack_snapshot,
      });
    }

    const { error: insErr } = await supabase
      .from("tournament_players")
      .insert(newRows);
    if (insErr) throw new Error(insErr.message);

    await refresh(tournamentId);
  });
}

const RemovePlayerSchema = z.object({
  tournamentId: z.uuid(),
  tournamentPlayerId: z.uuid(),
});

/**
 * Remove a player from a scheduled (not-yet-started) tournament's
 * staged roster. Their (table, seat) becomes free for the next added
 * player; existing players keep their assignments.
 *
 * Locked once the tournament starts — at that point use the bust
 * flow instead.
 */
export async function removePlayerFromTournament(input: {
  tournamentId: string;
  tournamentPlayerId: string;
}): Promise<AdminActionResult> {
  return runAdminAction(async () => {
    await requireAdmin();
    const { tournamentId, tournamentPlayerId } =
      RemovePlayerSchema.parse(input);
    const supabase = await createClient();

    const { data: t, error: tErr } = await supabase
      .from("tournaments")
      .select("status")
      .eq("id", tournamentId)
      .maybeSingle();
    if (tErr || !t) throw new Error(tErr?.message ?? "Tournament not found");
    if (t.status !== "scheduled") {
      throw new Error(
        `Roster is locked once the tournament starts (currently ${t.status}). Use the bust flow instead.`,
      );
    }

    const { error: delErr } = await supabase
      .from("tournament_players")
      .delete()
      .eq("id", tournamentPlayerId)
      .eq("tournament_id", tournamentId);
    if (delErr) throw new Error(delErr.message);

    await refresh(tournamentId);
  });
}

// ─── Chip-count edits ───────────────────────────────────────────────────

const AdjustChipsSchema = z.object({
  tournamentPlayerId: z.uuid(),
  // 10M is a generous cap — way above any realistic stack — but
  // small enough to catch a "typed an extra zero" mistake.
  newChips: z.coerce.number().int().min(0).max(10_000_000),
  reason: z
    .string()
    .trim()
    .max(140)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
});

/**
 * Set a tournament player's `current_chips` to a new total. Used by
 * the head admin to correct leaderboards before a table merge (when
 * relying on each player's QR self-report isn't reliable) and by
 * table admins to keep their own table's counts honest mid-tournament.
 *
 * Appends a `chip_adjust` event for audit:
 *   { tournament_player_id, player_id, at_level,
 *     table_number, seat_number,
 *     before, after, delta,
 *     actor: 'admin' | 'table_admin', reason? }
 *
 * Rejects on busted players (they're at 0 by definition; use rebuy
 * if you want them back in) and on negative deltas that would
 * push the stack below zero.
 */
export async function adjustChips(input: {
  tournamentPlayerId: string;
  newChips: number;
  reason?: string | null;
}): Promise<AdminActionResult> {
  return runAdminAction(async () => {
    const parsed = AdjustChipsSchema.parse(input);
    const slot = await requireManagePlayerSlot(parsed.tournamentPlayerId);
    if (slot.busted_at_time) {
      throw new Error(
        "Player is busted — use Rebuy to bring them back in, not chip edit.",
      );
    }

    const supabase = createServiceClient();
    const { data: t } = await supabase
      .from("tournaments")
      .select("current_level, status")
      .eq("id", slot.tournament_id)
      .maybeSingle();
    if (!t) throw new Error("Tournament not found.");
    if (t.status === "finished" || t.status === "cancelled") {
      throw new Error(
        `Chip edits are only allowed while the tournament is active (currently ${t.status}).`,
      );
    }

    const before = slot.current_chips;
    const after = parsed.newChips;
    if (after === before) return; // no-op

    const { error: upErr } = await supabase
      .from("tournament_players")
      .update({ current_chips: after })
      .eq("id", parsed.tournamentPlayerId);
    if (upErr) throw new Error(upErr.message);

    await supabase.from("tournament_events").insert({
      tournament_id: slot.tournament_id,
      type: "chip_adjust",
      payload: {
        tournament_player_id: parsed.tournamentPlayerId,
        player_id: slot.player_id,
        at_level: t.current_level,
        table_number: slot.table_number,
        seat_number: slot.seat_number,
        before,
        after,
        delta: after - before,
        actor: slot.actor,
        reason: parsed.reason,
      },
    });

    await refresh(slot.tournament_id);
  });
}
