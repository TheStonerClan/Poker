"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import {
  canManageTable,
  requireManageTable,
} from "@/lib/auth/table-admin";
import { createServiceClient } from "@/lib/supabase/service";
import {
  STREETS,
  buildAwards,
  buildUncontestedAward,
  computePotStructure,
  deriveHandState,
  pickNextDealer,
  validateAction,
  type ActionKind,
  type AwardChoice,
  type Hand,
  type HandAction,
  type HandSeat,
  type Street,
} from "@/lib/admin/hand";
import { blindLevels } from "@/lib/admin/queries";
import { resolveTablesConfig } from "@/lib/admin/tables";
import type { TablesUpdate } from "@/lib/database.types";

// Re-export the existing result type shape so call sites can share it.
export type HandActionResult = { ok: true } | { ok: false; error: string };

async function refreshTable(tournamentId: string) {
  revalidatePath("/admin");
  revalidatePath(`/admin/tournaments/${tournamentId}`);
  revalidatePath(`/table/${tournamentId}`, "layout");
  revalidatePath("/tv");
}

async function runScoped(
  fn: () => Promise<void>,
): Promise<HandActionResult> {
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

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Fetch the (single) active hand at this table, or null if there
 * isn't one. The unique partial index `hands_one_active_per_table_idx`
 * guarantees at most one row.
 */
async function fetchActiveHand(
  supabase: ReturnType<typeof createServiceClient>,
  tournamentId: string,
  tableNumber: number,
): Promise<Hand | null> {
  const { data } = await supabase
    .from("hands")
    .select("*")
    .eq("tournament_id", tournamentId)
    .eq("table_number", tableNumber)
    .eq("status", "active")
    .maybeSingle();
  return (data ?? null) as Hand | null;
}

async function fetchHandWithChildren(
  supabase: ReturnType<typeof createServiceClient>,
  handId: string,
): Promise<{ hand: Hand; seats: HandSeat[]; actions: HandAction[] }> {
  const [handRes, seatsRes, actionsRes] = await Promise.all([
    supabase.from("hands").select("*").eq("id", handId).single(),
    supabase.from("hand_seats").select("*").eq("hand_id", handId),
    supabase
      .from("hand_actions")
      .select("*")
      .eq("hand_id", handId)
      .order("created_at", { ascending: true }),
  ]);
  if (handRes.error || !handRes.data) {
    throw new Error(handRes.error?.message ?? "Hand not found");
  }
  return {
    hand: handRes.data as Hand,
    seats: (seatsRes.data ?? []) as HandSeat[],
    actions: (actionsRes.data ?? []) as HandAction[],
  };
}

function getBlindsAtLevel(
  blindStructureSnapshot: unknown,
  levelNum: number,
): { small: number; big: number; ante: number } {
  const levels = blindLevels(blindStructureSnapshot);
  const lvl = levels.find((l) => l.level_num === levelNum);
  return {
    small: lvl?.small ?? 0,
    big: lvl?.big ?? 0,
    ante: lvl?.ante ?? 0,
  };
}

// ─── startHand ──────────────────────────────────────────────────────────

const StartHandSchema = z.object({
  tournamentId: z.uuid(),
  tableNumber: z.number().int().min(1),
  // Optional manual overrides (used by the "Reset dealer" path).
  // When omitted, dealer auto-rotates from the previous hand.
  dealerSeat: z.number().int().min(1).optional(),
  sbSeat: z.number().int().min(1).optional(),
  bbSeat: z.number().int().min(1).optional(),
});

/**
 * Open a new active hand at a table. Snapshots blinds + the current
 * roster, posts SB / BB / antes from each player's chip stack, and
 * picks the dealer position (auto-rotated from the previous hand at
 * this table unless an override was passed).
 *
 * Returns an error if there's already an active hand at this table
 * (UI should call cancelHand first), or if fewer than 2 active
 * players are seated (can't play with one).
 */
export async function startHand(input: {
  tournamentId: string;
  tableNumber: number;
  dealerSeat?: number;
  sbSeat?: number;
  bbSeat?: number;
}): Promise<HandActionResult> {
  return runScoped(async () => {
    const parsed = StartHandSchema.parse(input);
    await requireManageTable({
      tournamentId: parsed.tournamentId,
      tableNumber: parsed.tableNumber,
    });
    const supabase = createServiceClient();

    const existing = await fetchActiveHand(
      supabase,
      parsed.tournamentId,
      parsed.tableNumber,
    );
    if (existing) {
      throw new Error(
        "A hand is already in progress at this table. Finish or cancel it first.",
      );
    }

    // Pull the tournament + roster needed to snapshot the hand.
    const [tournamentRes, rosterRes, previousHandRes] = await Promise.all([
      supabase
        .from("tournaments")
        .select(
          "id, current_level, blind_structure_snapshot, status, num_tables, max_seats_per_table, tables_config",
        )
        .eq("id", parsed.tournamentId)
        .single(),
      supabase
        .from("tournament_players")
        .select(
          "id, seat_number, table_number, current_chips, busted_at_time",
        )
        .eq("tournament_id", parsed.tournamentId)
        .eq("table_number", parsed.tableNumber),
      supabase
        .from("hands")
        .select("dealer_seat, hand_number")
        .eq("tournament_id", parsed.tournamentId)
        .eq("table_number", parsed.tableNumber)
        .order("hand_number", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (tournamentRes.error || !tournamentRes.data) {
      throw new Error(
        tournamentRes.error?.message ?? "Tournament not found",
      );
    }
    const tournament = tournamentRes.data;
    if (tournament.status !== "running" && tournament.status !== "paused") {
      throw new Error(
        `Can't start a hand — tournament is ${tournament.status}.`,
      );
    }
    const tablesCfg = resolveTablesConfig({
      tablesConfig: tournament.tables_config,
      numTables: tournament.num_tables,
      maxSeatsPerTable: tournament.max_seats_per_table,
    });
    if (parsed.tableNumber > tablesCfg.length) {
      throw new Error("Table not configured for this tournament.");
    }

    // Eligible players: at this table, not busted, has a seat, has
    // chips. We allow seat to be null only as a defensive check; in
    // practice everyone seated has a non-null seat_number.
    const eligible = (rosterRes.data ?? [])
      .filter(
        (r) =>
          r.busted_at_time == null &&
          r.seat_number != null &&
          (r.current_chips ?? 0) > 0,
      )
      .map((r) => ({
        tournament_player_id: r.id,
        seat_number: r.seat_number as number,
        current_chips: r.current_chips ?? 0,
      }));
    if (eligible.length < 2) {
      throw new Error("Need at least 2 active players to start a hand.");
    }

    // Pick dealer + blinds. Manual override beats auto-rotate.
    let dealer_seat: number;
    let sb_seat: number;
    let bb_seat: number;
    if (parsed.dealerSeat && parsed.sbSeat && parsed.bbSeat) {
      dealer_seat = parsed.dealerSeat;
      sb_seat = parsed.sbSeat;
      bb_seat = parsed.bbSeat;
    } else {
      const picked = pickNextDealer({
        previousDealerSeat: previousHandRes.data?.dealer_seat ?? null,
        activeSeatNumbers: eligible.map((e) => e.seat_number),
      });
      if (!picked) {
        throw new Error("Couldn't pick dealer position.");
      }
      dealer_seat = picked.dealer_seat;
      sb_seat = picked.sb_seat;
      bb_seat = picked.bb_seat;
    }

    // Snapshot blinds + ante from the current level.
    const blinds = getBlindsAtLevel(
      tournament.blind_structure_snapshot,
      tournament.current_level,
    );
    if (blinds.big <= 0) {
      throw new Error(
        "Current level has no big blind — start the tournament first.",
      );
    }

    const handNumber = (previousHandRes.data?.hand_number ?? 0) + 1;

    // Insert the hand row + hand_seats in a single round-trip each.
    const { data: hand, error: handErr } = await supabase
      .from("hands")
      .insert({
        tournament_id: parsed.tournamentId,
        table_number: parsed.tableNumber,
        hand_number: handNumber,
        level_num: tournament.current_level,
        small_blind: blinds.small,
        big_blind: blinds.big,
        ante: blinds.ante,
        dealer_seat,
        sb_seat,
        bb_seat,
      })
      .select("*")
      .single();
    if (handErr || !hand) {
      throw new Error(handErr?.message ?? "Could not create hand.");
    }

    const seatRows = eligible.map((e) => ({
      hand_id: hand.id,
      seat_number: e.seat_number,
      tournament_player_id: e.tournament_player_id,
      starting_chips: e.current_chips,
      current_chips: e.current_chips,
    }));
    const { error: seatsErr } = await supabase
      .from("hand_seats")
      .insert(seatRows);
    if (seatsErr) {
      // Best-effort rollback so we don't leave the hands row dangling
      // without seats. Cascading delete handles child rows.
      await supabase.from("hands").delete().eq("id", hand.id);
      throw new Error(seatsErr.message);
    }

    // Post antes (one action per seat) + SB + BB. Updates each seat's
    // current_chips, total_contributed, is_all_in.
    await postBlindsAndAntes({
      supabase,
      hand: hand as Hand,
      seats: seatRows.map((r) => ({
        hand_id: r.hand_id,
        seat_number: r.seat_number,
        tournament_player_id: r.tournament_player_id,
        starting_chips: r.starting_chips,
        current_chips: r.current_chips,
        total_contributed: 0,
        is_folded: false,
        is_all_in: false,
      })),
    });

    await refreshTable(parsed.tournamentId);
  });
}

async function postBlindsAndAntes(args: {
  supabase: ReturnType<typeof createServiceClient>;
  hand: Hand;
  seats: HandSeat[];
}) {
  const { supabase, hand, seats } = args;
  // Deterministic order: ante from every seat in seat order, then
  // SB, then BB. Sequence numbers start at 1 and tick up per posting
  // so the action log has a stable read order on the preflop street.
  let seq = 1;
  const updates: Array<{
    seat_number: number;
    current_chips: number;
    total_contributed: number;
    is_all_in: boolean;
  }> = [];
  const actions: Array<{
    hand_id: string;
    street: string;
    sequence: number;
    seat_number: number;
    tournament_player_id: string;
    action: string;
    amount: number;
    chips_remaining: number;
  }> = [];

  const seatMap = new Map<number, HandSeat>();
  for (const s of seats) seatMap.set(s.seat_number, { ...s });

  // Antes first — every seat puts in `ante` (capped at their stack).
  if (hand.ante > 0) {
    for (const seat of [...seats].sort(
      (a, b) => a.seat_number - b.seat_number,
    )) {
      const live = seatMap.get(seat.seat_number)!;
      const pay = Math.min(hand.ante, live.current_chips);
      if (pay <= 0) continue;
      live.current_chips -= pay;
      live.total_contributed += pay;
      if (live.current_chips === 0) live.is_all_in = true;
      actions.push({
        hand_id: hand.id,
        street: "preflop",
        sequence: seq++,
        seat_number: live.seat_number,
        tournament_player_id: live.tournament_player_id,
        action: "post_ante",
        amount: pay,
        chips_remaining: live.current_chips,
      });
    }
  }

  // SB
  if (hand.small_blind > 0) {
    const sb = seatMap.get(hand.sb_seat);
    if (sb) {
      const pay = Math.min(hand.small_blind, sb.current_chips);
      if (pay > 0) {
        sb.current_chips -= pay;
        sb.total_contributed += pay;
        if (sb.current_chips === 0) sb.is_all_in = true;
        actions.push({
          hand_id: hand.id,
          street: "preflop",
          sequence: seq++,
          seat_number: sb.seat_number,
          tournament_player_id: sb.tournament_player_id,
          action: "post_sb",
          amount: pay,
          chips_remaining: sb.current_chips,
        });
      }
    }
  }

  // BB
  if (hand.big_blind > 0) {
    const bb = seatMap.get(hand.bb_seat);
    if (bb) {
      const pay = Math.min(hand.big_blind, bb.current_chips);
      if (pay > 0) {
        bb.current_chips -= pay;
        bb.total_contributed += pay;
        if (bb.current_chips === 0) bb.is_all_in = true;
        actions.push({
          hand_id: hand.id,
          street: "preflop",
          sequence: seq++,
          seat_number: bb.seat_number,
          tournament_player_id: bb.tournament_player_id,
          action: "post_bb",
          amount: pay,
          chips_remaining: bb.current_chips,
        });
      }
    }
  }

  for (const seat of seatMap.values()) {
    updates.push({
      seat_number: seat.seat_number,
      current_chips: seat.current_chips,
      total_contributed: seat.total_contributed,
      is_all_in: seat.is_all_in,
    });
  }

  // Apply updates + insert actions.
  for (const u of updates) {
    await supabase
      .from("hand_seats")
      .update({
        current_chips: u.current_chips,
        total_contributed: u.total_contributed,
        is_all_in: u.is_all_in,
      })
      .eq("hand_id", hand.id)
      .eq("seat_number", u.seat_number);
  }
  if (actions.length > 0) {
    await supabase.from("hand_actions").insert(actions);
  }
}

// ─── postAction ─────────────────────────────────────────────────────────

const PostActionSchema = z.object({
  handId: z.uuid(),
  seatNumber: z.number().int().min(1),
  action: z.enum([
    "check",
    "call",
    "bet",
    "raise",
    "fold",
    "all_in",
  ] as const satisfies readonly ActionKind[]),
  // For bet, the amount to bet. For raise, the TOTAL bet (raise-to).
  // Ignored for check/call/fold/all-in.
  amount: z.number().int().min(0).optional(),
});

/**
 * Log a single voluntary action by the seat whose turn it is.
 * Validates against the derived state, debits the player's stack,
 * inserts the action row, and (if this action closed the street)
 * advances `hands.current_street`. Auto-progresses through later
 * streets when everyone left is all-in, so the next admin tap is
 * "Award pot".
 */
export async function postAction(input: {
  handId: string;
  seatNumber: number;
  action: ActionKind;
  amount?: number;
}): Promise<HandActionResult> {
  return runScoped(async () => {
    const parsed = PostActionSchema.parse(input);
    const supabase = createServiceClient();

    const { hand, seats, actions } = await fetchHandWithChildren(
      supabase,
      parsed.handId,
    );
    await requireManageTable({
      tournamentId: hand.tournament_id,
      tableNumber: hand.table_number,
    });
    if (hand.status !== "active") {
      throw new Error("Hand is not active.");
    }

    const state = deriveHandState({ hand, seats, actions });

    const validation = validateAction({
      state,
      seatNumber: parsed.seatNumber,
      action: parsed.action,
      inputAmount: parsed.amount,
    });
    if (!validation.ok) throw new Error(validation.error);

    const seat = seats.find((s) => s.seat_number === parsed.seatNumber);
    if (!seat) throw new Error("Seat not found.");

    // Determine the seat's new state after this action.
    const debit = validation.amount;
    const isFolding = parsed.action === "fold";
    const newChips = seat.current_chips - debit;
    if (newChips < 0) throw new Error("Stack arithmetic error.");
    const newAllIn = validation.becomesAllIn || seat.is_all_in;
    const newContributed = seat.total_contributed + debit;

    // Compute the sequence number for this action on the current
    // street. Append-to-end; we don't care about gaps.
    const streetActions = actions.filter(
      (a) => a.street === hand.current_street,
    );
    const nextSequence = streetActions.length + 1;

    // Map the action label to the stored action kind. "all_in" is
    // recorded as such; the UI uses it for distinguishing forced
    // pushes from explicit bet/raise amounts.
    await supabase.from("hand_actions").insert({
      hand_id: hand.id,
      street: hand.current_street,
      sequence: nextSequence,
      seat_number: seat.seat_number,
      tournament_player_id: seat.tournament_player_id,
      action: parsed.action,
      amount: debit,
      chips_remaining: newChips,
    });

    const seatUpdate: Partial<HandSeat> = {
      current_chips: newChips,
      total_contributed: newContributed,
      is_all_in: newAllIn,
    };
    if (isFolding) seatUpdate.is_folded = true;
    await supabase
      .from("hand_seats")
      .update(seatUpdate)
      .eq("hand_id", hand.id)
      .eq("seat_number", seat.seat_number);

    // Re-derive state to decide next step (advance street / showdown
    // / uncontested).
    const refreshed = await fetchHandWithChildren(supabase, hand.id);
    const next = deriveHandState(refreshed);

    if (
      next.remainingInHandSeats.length <= 1 &&
      hand.current_street !== "showdown"
    ) {
      // Last folder walks — award pot to the survivor immediately.
      await awardUncontested(supabase, refreshed);
    } else if (next.streetIsComplete) {
      // Advance street. If everyone left is all-in, skip directly to
      // showdown (no betting possible on later streets).
      await maybeAdvanceStreet(supabase, refreshed);
    }

    await refreshTable(hand.tournament_id);
  });
}

async function maybeAdvanceStreet(
  supabase: ReturnType<typeof createServiceClient>,
  refreshed: { hand: Hand; seats: HandSeat[]; actions: HandAction[] },
) {
  const idx = STREETS.indexOf(refreshed.hand.current_street as Street);
  if (idx < 0) return; // already in showdown/complete
  const nextStreet = STREETS[idx + 1];
  // Anyone still able to act on a later street? At most one
  // non-all-in non-folded seat means no further betting possible.
  const canStillAct = refreshed.seats.filter(
    (s) => !s.is_folded && !s.is_all_in && s.current_chips > 0,
  );
  let target: string;
  if (!nextStreet || canStillAct.length <= 1) {
    target = "showdown";
  } else {
    target = nextStreet;
  }
  await supabase
    .from("hands")
    .update({ current_street: target })
    .eq("id", refreshed.hand.id);
}

async function awardUncontested(
  supabase: ReturnType<typeof createServiceClient>,
  refreshed: { hand: Hand; seats: HandSeat[]; actions: HandAction[] },
) {
  const award = buildUncontestedAward({ seats: refreshed.seats });
  if (!award) return;
  await supabase.from("hand_results").insert({
    hand_id: refreshed.hand.id,
    tournament_player_id: award.tournament_player_id,
    pot_kind: award.pot_kind,
    amount_won: award.amount,
    is_split: award.is_split,
  });
  await closeHandAndCreditPlayers({
    supabase,
    handId: refreshed.hand.id,
    awards: [award],
    seats: refreshed.seats,
  });
}

// ─── awardPots (showdown) ──────────────────────────────────────────────

const AwardPotsSchema = z.object({
  handId: z.uuid(),
  // Map of pot_kind → array of tournament_player_ids declared winners.
  choices: z.record(z.string(), z.array(z.uuid())),
});

/**
 * Award the pot(s) at showdown. The admin picks winners for each
 * pot (main + any side pots) on the UI; we validate eligibility,
 * split evenly across ties (remainder to the first listed winner),
 * write `hand_results` rows, and credit each winner's
 * `tournament_players.current_chips`.
 *
 * Closes the hand: status='complete', current_street='complete'.
 */
export async function awardPots(input: {
  handId: string;
  choices: AwardChoice;
}): Promise<HandActionResult> {
  return runScoped(async () => {
    const parsed = AwardPotsSchema.parse(input);
    const supabase = createServiceClient();
    const { hand, seats } = await fetchHandWithChildren(
      supabase,
      parsed.handId,
    );
    await requireManageTable({
      tournamentId: hand.tournament_id,
      tableNumber: hand.table_number,
    });
    if (hand.status !== "active") {
      throw new Error("Hand is not active.");
    }

    const pots = computePotStructure(seats);
    const built = buildAwards({
      pots,
      choices: parsed.choices as AwardChoice,
    });
    if (!built.ok) throw new Error(built.error);

    const rows = built.awards.map((a) => ({
      hand_id: hand.id,
      tournament_player_id: a.tournament_player_id,
      pot_kind: a.pot_kind,
      amount_won: a.amount,
      is_split: a.is_split,
    }));
    if (rows.length > 0) {
      const { error: resErr } = await supabase
        .from("hand_results")
        .insert(rows);
      if (resErr) throw new Error(resErr.message);
    }

    await closeHandAndCreditPlayers({
      supabase,
      handId: hand.id,
      awards: built.awards,
      seats,
    });

    await refreshTable(hand.tournament_id);
  });
}

async function closeHandAndCreditPlayers(args: {
  supabase: ReturnType<typeof createServiceClient>;
  handId: string;
  awards: Array<{
    tournament_player_id: string;
    amount: number;
  }>;
  seats: HandSeat[];
}) {
  const { supabase, handId, awards, seats } = args;

  // Sum awards per tournament_player_id; a player can win multiple
  // pots (e.g. main + side_1 if they covered everyone).
  const winningsByPlayer = new Map<string, number>();
  for (const a of awards) {
    winningsByPlayer.set(
      a.tournament_player_id,
      (winningsByPlayer.get(a.tournament_player_id) ?? 0) + a.amount,
    );
  }

  // For every seat in the hand, the new tournament-wide chip stack =
  // hand_seats.current_chips (their unspent stack from this hand) +
  // any winnings. Net delta vs. the player's pre-hand
  // tournament_players.current_chips:
  //   delta = (current_chips + winnings) − starting_chips
  // We don't reach back to the pre-hand row; instead we trust that
  // tournament_players.current_chips was decremented at hand start
  // by (starting_chips − current_chips) "implicitly" — actually we
  // didn't touch tournament_players when starting the hand, so we
  // need to set it here to the post-hand value.
  //
  // Decision: tournament_players.current_chips is the "between
  // hands" stack. During a hand, the truth lives in hand_seats.
  // At hand close, we write tournament_players.current_chips =
  // hand_seats.current_chips + winnings. Clean.
  for (const seat of seats) {
    const winnings = winningsByPlayer.get(seat.tournament_player_id) ?? 0;
    const postChips = seat.current_chips + winnings;
    const update: TablesUpdate<"tournament_players"> = {
      current_chips: postChips,
    };
    await supabase
      .from("tournament_players")
      .update(update)
      .eq("id", seat.tournament_player_id);
  }

  await supabase
    .from("hands")
    .update({
      status: "complete",
      current_street: "complete",
      completed_at: new Date().toISOString(),
    })
    .eq("id", handId);
  // No tournament_events emission for now — the audit lives entirely
  // in hand_actions + hand_results, queried by hand id. If/when we
  // want a unified timeline we'll wire it then.
}

// ─── undoLastAction ─────────────────────────────────────────────────────

const UndoSchema = z.object({ handId: z.uuid() });

/**
 * Reverse the most recent hand_action. Recomputes the affected
 * seat's chip stack + flags from scratch using the remaining log,
 * so the action history stays the single source of truth.
 *
 * Refuses to undo a blind/ante post (the first few rows on
 * preflop) — that'd require recomputing everyone's auto-posts and
 * the UX is "cancel the hand instead." Also refuses to undo on a
 * completed hand (the pot's already been credited).
 */
export async function undoLastAction(input: {
  handId: string;
}): Promise<HandActionResult> {
  return runScoped(async () => {
    const { handId } = UndoSchema.parse(input);
    const supabase = createServiceClient();

    const { hand, seats, actions } = await fetchHandWithChildren(
      supabase,
      handId,
    );
    await requireManageTable({
      tournamentId: hand.tournament_id,
      tableNumber: hand.table_number,
    });
    if (hand.status !== "active") {
      throw new Error("Hand is not active.");
    }
    if (actions.length === 0) {
      throw new Error("Nothing to undo.");
    }
    const last = actions[actions.length - 1];
    if (
      last.action === "post_sb" ||
      last.action === "post_bb" ||
      last.action === "post_ante"
    ) {
      throw new Error(
        "Can't undo blinds/antes — cancel the hand and start fresh.",
      );
    }

    // Delete the row. Then recompute the affected seat's state from
    // the remaining log.
    const { error: delErr } = await supabase
      .from("hand_actions")
      .delete()
      .eq("id", last.id);
    if (delErr) throw new Error(delErr.message);

    // Re-derive the seat's contribution + status from the remaining
    // action log + starting chips.
    const remaining = actions.filter((a) => a.id !== last.id);
    const seatActions = remaining.filter(
      (a) => a.seat_number === last.seat_number,
    );
    const seat = seats.find((s) => s.seat_number === last.seat_number);
    if (!seat) throw new Error("Seat not found.");

    let contributed = 0;
    let folded = false;
    let allIn = false;
    for (const a of seatActions) {
      contributed += a.amount;
      if (a.action === "fold") folded = true;
      if (a.action === "all_in") allIn = true;
    }
    const newChips = seat.starting_chips - contributed;
    if (newChips < 0) throw new Error("Recompute underflow.");
    // Re-evaluate all-in: a player is all-in if they have 0 chips
    // AND they put chips in. Avoids marking a folded-with-0-stack
    // player as all-in incorrectly.
    if (newChips === 0 && contributed > 0) allIn = true;
    else if (newChips > 0) allIn = false;

    await supabase
      .from("hand_seats")
      .update({
        current_chips: newChips,
        total_contributed: contributed,
        is_folded: folded,
        is_all_in: allIn,
      })
      .eq("hand_id", handId)
      .eq("seat_number", seat.seat_number);

    // Roll back the street if the undo emptied it and the previous
    // street is what we should be on. Simpler heuristic: if any
    // actions remain on the current_street, leave it. If not,
    // walk back one street.
    const refreshed = await fetchHandWithChildren(supabase, handId);
    const currentStreetActions = refreshed.actions.filter(
      (a) => a.street === refreshed.hand.current_street,
    );
    if (currentStreetActions.length === 0 && refreshed.hand.current_street !== "preflop") {
      const idx = STREETS.indexOf(refreshed.hand.current_street as Street);
      const prev = idx > 0 ? STREETS[idx - 1] : "preflop";
      await supabase
        .from("hands")
        .update({ current_street: prev })
        .eq("id", handId);
    }

    await refreshTable(hand.tournament_id);
  });
}

// ─── advanceStreetManually ──────────────────────────────────────────────

const AdvanceStreetSchema = z.object({ handId: z.uuid() });

/**
 * Force the hand to the next street. Used by the UI when the
 * derived state says "street complete" — usually the post-action
 * helper has already done this for you, but this exposes a manual
 * fallback. Rejects if the street isn't actually complete.
 */
export async function advanceStreetManually(input: {
  handId: string;
}): Promise<HandActionResult> {
  return runScoped(async () => {
    const { handId } = AdvanceStreetSchema.parse(input);
    const supabase = createServiceClient();
    const fetched = await fetchHandWithChildren(supabase, handId);
    await requireManageTable({
      tournamentId: fetched.hand.tournament_id,
      tableNumber: fetched.hand.table_number,
    });
    if (fetched.hand.status !== "active") {
      throw new Error("Hand is not active.");
    }
    const state = deriveHandState(fetched);
    if (!state.streetIsComplete) {
      throw new Error("Street isn't complete yet.");
    }
    await maybeAdvanceStreet(supabase, fetched);
    await refreshTable(fetched.hand.tournament_id);
  });
}

// ─── cancelHand ─────────────────────────────────────────────────────────

const CancelHandSchema = z.object({ handId: z.uuid() });

/**
 * Throw away an active hand. Marks the hand status='cancelled'. No
 * chip refund is needed because we never debit `tournament_players`
 * during a hand — the stack lives in `hand_seats` until the hand
 * closes and only then gets pushed back to the tournament row.
 *
 * Used when the admin started a hand by mistake or wants to redo
 * dealer/blind positions from scratch.
 */
export async function cancelHand(input: {
  handId: string;
}): Promise<HandActionResult> {
  return runScoped(async () => {
    const { handId } = CancelHandSchema.parse(input);
    const supabase = createServiceClient();
    const { hand } = await fetchHandWithChildren(supabase, handId);
    await requireManageTable({
      tournamentId: hand.tournament_id,
      tableNumber: hand.table_number,
    });
    if (hand.status !== "active") {
      throw new Error("Hand is not active.");
    }
    await supabase
      .from("hands")
      .update({
        status: "cancelled",
        current_street: "complete",
        completed_at: new Date().toISOString(),
      })
      .eq("id", handId);
    await refreshTable(hand.tournament_id);
  });
}

// ─── movePlayerToTable (admin-only) ─────────────────────────────────────

const MovePlayerSchema = z.object({
  tournamentPlayerId: z.uuid(),
  toTableNumber: z.number().int().min(1),
});

/**
 * Move an active player from their current table to another.
 * Admin-only — used during the night when a balance/merge isn't
 * quite right, or to fix a typo. Picks the lowest free seat at the
 * destination. Refuses if the destination is full or the player is
 * already busted.
 *
 * After a move, the destination table's next "Start hand" picks a
 * fresh dealer; the source table's next hand auto-rotates around
 * the smaller field as normal.
 */
export async function movePlayerToTable(input: {
  tournamentPlayerId: string;
  toTableNumber: number;
}): Promise<HandActionResult> {
  return runScoped(async () => {
    await requireAdmin();
    const parsed = MovePlayerSchema.parse(input);
    const supabase = createServiceClient();

    const { data: tp } = await supabase
      .from("tournament_players")
      .select(
        "id, tournament_id, table_number, seat_number, busted_at_time",
      )
      .eq("id", parsed.tournamentPlayerId)
      .maybeSingle();
    if (!tp) throw new Error("Player slot not found.");
    if (tp.busted_at_time) {
      throw new Error("Player is busted — can't move them.");
    }
    if (tp.table_number === parsed.toTableNumber) {
      throw new Error("Player is already at that table.");
    }

    // Block moves during an active hand at the source OR destination.
    // Splitting a player mid-hand is undefined; admin should wait or
    // cancel the hand first.
    const { data: activeHands } = await supabase
      .from("hands")
      .select("id, table_number")
      .eq("tournament_id", tp.tournament_id)
      .eq("status", "active")
      .in(
        "table_number",
        [tp.table_number, parsed.toTableNumber].filter(
          (n): n is number => n != null,
        ),
      );
    if (activeHands && activeHands.length > 0) {
      throw new Error(
        "A hand is in progress at one of those tables. Finish or cancel first.",
      );
    }

    // Validate destination + find a free seat.
    const { data: tournament } = await supabase
      .from("tournaments")
      .select(
        "num_tables, max_seats_per_table, tables_config",
      )
      .eq("id", tp.tournament_id)
      .single();
    if (!tournament) throw new Error("Tournament not found.");
    const tablesCfg = resolveTablesConfig({
      tablesConfig: tournament.tables_config,
      numTables: tournament.num_tables,
      maxSeatsPerTable: tournament.max_seats_per_table,
    });
    if (parsed.toTableNumber > tablesCfg.length) {
      throw new Error("Destination table doesn't exist.");
    }
    const destCap = tablesCfg[parsed.toTableNumber - 1].max_seats;

    const { data: occupants } = await supabase
      .from("tournament_players")
      .select("seat_number")
      .eq("tournament_id", tp.tournament_id)
      .eq("table_number", parsed.toTableNumber)
      .not("seat_number", "is", null);
    const taken = new Set(
      (occupants ?? [])
        .map((o) => o.seat_number)
        .filter((s): s is number => s != null),
    );
    let seat: number | null = null;
    for (let s = 1; s <= destCap; s++) {
      if (!taken.has(s)) {
        seat = s;
        break;
      }
    }
    if (seat == null) {
      throw new Error("No free seat at the destination table.");
    }

    const { error: upErr } = await supabase
      .from("tournament_players")
      .update({
        table_number: parsed.toTableNumber,
        seat_number: seat,
      })
      .eq("id", parsed.tournamentPlayerId);
    if (upErr) throw new Error(upErr.message);

    await supabase.from("tournament_events").insert({
      tournament_id: tp.tournament_id,
      type: "admin_note",
      payload: {
        kind: "move_player",
        tournament_player_id: parsed.tournamentPlayerId,
        from_table: tp.table_number,
        from_seat: tp.seat_number,
        to_table: parsed.toTableNumber,
        to_seat: seat,
      },
    });

    // Source + destination need a fresh "Start hand" prompt; the
    // dealer auto-rotate logic will skip any stale seats. We don't
    // explicitly invalidate any state because the dealer pick reads
    // live roster each time.
    await refreshTable(tp.tournament_id);
  });
}

// Helper for the UI to know whether a table-admin can manage right
// now (re-exported to avoid an extra round-trip from the page).
export async function canCurrentUserManageTable(input: {
  tournamentId: string;
  tableNumber: number;
}): Promise<boolean> {
  return canManageTable(input);
}
