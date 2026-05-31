/**
 * Pure logic for the live hand tracker. No DB calls — every helper
 * takes the relevant rows and returns derived state. The server
 * actions in `app/admin/tournaments/[id]/hand-actions.ts` are thin
 * wrappers around these helpers + writes.
 *
 * Why pure: the betting state machine (whose turn, when does the
 * street advance, what's the to-call amount, how do side pots split)
 * has a lot of corners. Keeping it free of Supabase clients makes
 * it cheap to unit-test in the future and easy to reason about while
 * staring at the table.
 */

import type { Tables } from "@/lib/database.types";

export type Hand = Tables<"hands">;
export type HandSeat = Tables<"hand_seats">;
export type HandAction = Tables<"hand_actions">;
export type HandResult = Tables<"hand_results">;

export type Street = "preflop" | "flop" | "turn" | "river";
export type StreetOrFinal = Street | "showdown" | "complete";

export const STREETS: readonly Street[] = ["preflop", "flop", "turn", "river"];

export type ActionKind =
  | "post_sb"
  | "post_bb"
  | "post_ante"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "fold"
  | "all_in";

// ─── State derivation ───────────────────────────────────────────────────

/**
 * Per-seat snapshot of activity ON THE CURRENT STREET. Resets each
 * time the street advances — `total_contributed` on hand_seats is the
 * cumulative number across the whole hand.
 */
export type SeatStreetState = {
  seat_number: number;
  tournament_player_id: string;
  // Chips this seat has put in just on this street. Used to compute
  // the "to call" amount for the next-to-act seat.
  contributed_this_street: number;
  // Did this seat take a voluntary action this street (check, call,
  // bet, raise, all_in, fold)? Blind/ante posts don't count — the BB
  // still gets a chance to act preflop even after posting.
  has_acted_this_street: boolean;
  // Convenience mirrors from hand_seats so the UI doesn't have to
  // double-look-up.
  is_folded: boolean;
  is_all_in: boolean;
  current_chips: number;
};

export type HandState = {
  hand: Hand;
  seats: HandSeat[];
  actions: HandAction[];
  // Derived street state, keyed by seat_number for fast lookup.
  streetState: Map<number, SeatStreetState>;
  // The highest single-seat contribution on the current street.
  // Equals the BB amount preflop before anyone acts.
  currentBet: number;
  // Total chips in the pot, all streets combined.
  pot: number;
  // Seat that should act next, or null if the street/hand is over.
  nextToActSeat: number | null;
  // Helper flags for the UI.
  streetIsComplete: boolean;
  handIsOver: boolean;
  remainingActiveSeats: number[]; // seats still in (not folded, not all-in)
  remainingInHandSeats: number[]; // seats still in (not folded; may be all-in)
};

/**
 * Walk the action log + seat starting state to compute everything
 * the UI needs about the current hand. Reasonably cheap — O(actions);
 * a typical hand has 5–30 entries.
 */
export function deriveHandState(input: {
  hand: Hand;
  seats: HandSeat[];
  actions: HandAction[];
}): HandState {
  const { hand, seats, actions } = input;
  const street = hand.current_street as StreetOrFinal;

  // Re-derive per-seat street state. We need:
  //  - contributed_this_street (sum of action amounts on this street)
  //  - has_acted_this_street (any voluntary action on this street)
  const streetState = new Map<number, SeatStreetState>();
  for (const s of seats) {
    streetState.set(s.seat_number, {
      seat_number: s.seat_number,
      tournament_player_id: s.tournament_player_id,
      contributed_this_street: 0,
      has_acted_this_street: false,
      is_folded: s.is_folded,
      is_all_in: s.is_all_in,
      current_chips: s.current_chips,
    });
  }

  for (const a of actions) {
    const st = streetState.get(a.seat_number);
    if (!st) continue;
    if (a.street === street) {
      // Antes are forced posts settled BEFORE betting opens — they go
      // into the pot (via hand_seats.total_contributed) but must NOT
      // inflate the per-street running bet. Without this filter, the
      // BB shows BB+ante on preflop, that becomes the current_bet,
      // and everyone else is told they owe (BB+ante − their ante) to
      // call — which is BB extra, instead of BB. (e.g. Level 1 1/2
      // with $2 ante was showing BB=$4, everyone "in at $2" with
      // "call $2 to bring it up to $4" — the canonical case the
      // user reported.)
      //
      // SB and BB ARE part of the betting round, so post_sb /
      // post_bb still count toward contributed_this_street.
      if (a.action !== "post_ante") {
        st.contributed_this_street += a.amount;
      }
      if (
        a.action === "check" ||
        a.action === "call" ||
        a.action === "bet" ||
        a.action === "raise" ||
        a.action === "fold" ||
        a.action === "all_in"
      ) {
        st.has_acted_this_street = true;
      }
    }
  }

  // currentBet for THIS street = max contribution among any seat
  // (folded or otherwise — a fold can't undo their contribution but
  // also can't be the high bet's source, so functionally it's the max
  // among contributors).
  let currentBet = 0;
  for (const st of streetState.values()) {
    if (st.contributed_this_street > currentBet) {
      currentBet = st.contributed_this_street;
    }
  }

  // Pot = sum of every contribution across all streets.
  let pot = 0;
  for (const s of seats) pot += s.total_contributed;

  // Active seats (still able to act this street): not folded, not
  // all-in, have chips.
  const remainingActiveSeats: number[] = [];
  const remainingInHandSeats: number[] = [];
  for (const s of seats) {
    if (!s.is_folded) remainingInHandSeats.push(s.seat_number);
    if (!s.is_folded && !s.is_all_in && s.current_chips > 0) {
      remainingActiveSeats.push(s.seat_number);
    }
  }

  // Hand over if 0 or 1 non-folded seats remain. Showdown is a
  // separate state — the hand row's current_street tells us if the
  // UI is in showdown.
  const handIsOver =
    remainingInHandSeats.length <= 1 || street === "complete";

  // Compute the next-to-act seat. Tricky because:
  //   - Preflop, first to act = first active seat after BB.
  //   - Postflop, first to act = first active seat after dealer (i.e.
  //     SB or the nearest active to its left).
  //   - Within a street, next = first active seat after the LAST
  //     actor whose contribution doesn't yet match currentBet (or
  //     hasn't acted yet).
  // Street is complete when every non-folded, non-all-in seat has
  // contributed_this_street == currentBet AND has_acted_this_street.
  const streetIsComplete = isStreetComplete(streetState, currentBet);
  let nextToActSeat: number | null = null;

  const isBettingStreet = STREETS.includes(street as Street);
  if (!handIsOver && isBettingStreet) {
    nextToActSeat = computeNextToAct({
      seats,
      streetState,
      actions,
      street: street as Street,
      hand,
      currentBet,
    });
  }

  return {
    hand,
    seats,
    actions,
    streetState,
    currentBet,
    pot,
    nextToActSeat,
    streetIsComplete,
    handIsOver,
    remainingActiveSeats,
    remainingInHandSeats,
  };
}

function isStreetComplete(
  streetState: Map<number, SeatStreetState>,
  currentBet: number,
): boolean {
  // Street is complete when every seat that COULD still act has
  // matched the current bet AND has taken a voluntary action this
  // street. Folded and all-in seats are skipped (they're done).
  // If nobody is eligible (everyone all-in or folded), the "betting"
  // is also over — caller advances through the remaining streets to
  // showdown.
  for (const st of streetState.values()) {
    if (st.is_folded) continue;
    if (st.is_all_in) continue;
    if (st.current_chips <= 0) continue;
    if (!st.has_acted_this_street) return false;
    if (st.contributed_this_street < currentBet) return false;
  }
  return true;
}

/**
 * Compute the next seat to act. Preflop UTG is left of BB; postflop
 * UTG is the first active seat left of the dealer. Within a street,
 * we use the last action's seat as the anchor and walk clockwise to
 * find the next active seat that still owes a call OR hasn't acted.
 */
function computeNextToAct(args: {
  seats: HandSeat[];
  streetState: Map<number, SeatStreetState>;
  actions: HandAction[];
  street: Street;
  hand: Hand;
  currentBet: number;
}): number | null {
  const { seats, streetState, actions, street, hand, currentBet } = args;

  const sortedSeats = [...seats].sort(
    (a, b) => a.seat_number - b.seat_number,
  );
  if (sortedSeats.length === 0) return null;

  // Find anchor seat: last actor on THIS street, or if none yet, the
  // "before-UTG" seat (BB preflop, dealer postflop).
  const streetActions = actions.filter((a) => a.street === street);
  let anchorSeat: number;
  if (streetActions.length > 0) {
    anchorSeat = streetActions[streetActions.length - 1].seat_number;
  } else if (street === "preflop") {
    anchorSeat = hand.bb_seat;
  } else {
    anchorSeat = hand.dealer_seat;
  }

  // Walk clockwise starting AFTER the anchor. For up to N seats,
  // pick the first seat that:
  //   - is in the hand (not folded, not all-in, has chips)
  //   - either hasn't acted this street, or has acted but
  //     contributed_this_street < currentBet (i.e. there's a raise
  //     to call).
  const seatNumbers = sortedSeats.map((s) => s.seat_number);
  const startIdx = clockwiseStartIdx(seatNumbers, anchorSeat);
  for (let i = 0; i < seatNumbers.length; i++) {
    const sn = seatNumbers[(startIdx + i) % seatNumbers.length];
    const st = streetState.get(sn);
    if (!st) continue;
    if (st.is_folded || st.is_all_in || st.current_chips <= 0) continue;
    const owesCall = st.contributed_this_street < currentBet;
    const stillNeedsToAct = !st.has_acted_this_street;
    if (owesCall || stillNeedsToAct) return sn;
  }
  return null; // street is complete
}

function clockwiseStartIdx(
  seatNumbers: number[],
  anchorSeat: number,
): number {
  // Return the index of the seat IMMEDIATELY clockwise of anchor.
  // Seats are sorted ASC; clockwise means "next index, wrap to 0".
  // If anchor isn't in the array (it busted/got moved mid-hand —
  // shouldn't happen but be defensive), start at index 0.
  const i = seatNumbers.indexOf(anchorSeat);
  if (i < 0) return 0;
  return (i + 1) % seatNumbers.length;
}

// ─── Dealer / blind seating ────────────────────────────────────────────

/**
 * Pick dealer + SB + BB for the next hand at a table, given the
 * previous hand (if any) and the seats currently occupied by active
 * players. Auto-rotates clockwise from the previous dealer.
 *
 *  - First hand at this table → dealer = lowest active seat.
 *  - Subsequent hand → dealer = next clockwise active seat after the
 *    previous hand's dealer. If the previous dealer's seat is no
 *    longer active (player busted, moved tables), we skip.
 *  - Heads-up (exactly 2 active seats) → dealer = SB, opposite seat
 *    = BB. Standard heads-up rules.
 *
 * Returns null if there aren't enough seats to start a hand (< 2).
 */
export function pickNextDealer(input: {
  previousDealerSeat: number | null;
  activeSeatNumbers: number[];
}): { dealer_seat: number; sb_seat: number; bb_seat: number } | null {
  const sorted = [...input.activeSeatNumbers].sort((a, b) => a - b);
  if (sorted.length < 2) return null;

  let dealerSeat: number;
  if (input.previousDealerSeat == null) {
    dealerSeat = sorted[0];
  } else {
    // Find seat strictly clockwise of previous dealer (even if prev
    // dealer is no longer active — we use it only as an anchor).
    // If prev dealer was the highest seat number, wrap to the lowest.
    const next = sorted.find((s) => s > input.previousDealerSeat!);
    dealerSeat = next ?? sorted[0];
  }

  if (sorted.length === 2) {
    // Heads-up: dealer posts SB, opponent posts BB.
    const sbSeat = dealerSeat;
    const bbSeat = sorted.find((s) => s !== dealerSeat) ?? dealerSeat;
    return { dealer_seat: dealerSeat, sb_seat: sbSeat, bb_seat: bbSeat };
  }

  // 3+: SB = next clockwise of dealer, BB = next clockwise of SB.
  const dealerIdx = sorted.indexOf(dealerSeat);
  const sbSeat = sorted[(dealerIdx + 1) % sorted.length];
  const sbIdx = sorted.indexOf(sbSeat);
  const bbSeat = sorted[(sbIdx + 1) % sorted.length];
  return { dealer_seat: dealerSeat, sb_seat: sbSeat, bb_seat: bbSeat };
}

// ─── Action validation ──────────────────────────────────────────────────

export type ActionValidation =
  | { ok: true; amount: number; becomesAllIn: boolean }
  | { ok: false; error: string };

/**
 * Validate a proposed action against the current hand state and
 * compute the chip-cost. Loose enforcement: only chip math and
 * out-of-turn checks; we don't enforce min-raise / min-bet rules
 * (house-game variance, per Phase 2 scope answer).
 */
export function validateAction(args: {
  state: HandState;
  seatNumber: number;
  action: ActionKind;
  // Required for bet/raise. For call/check/fold, ignored.
  inputAmount?: number;
}): ActionValidation {
  const { state, seatNumber, action, inputAmount } = args;
  const st = state.streetState.get(seatNumber);
  if (!st) return { ok: false, error: "Seat not in this hand." };
  if (st.is_folded) {
    return { ok: false, error: "You're folded for this hand." };
  }
  if (st.is_all_in) {
    return { ok: false, error: "You're already all-in." };
  }
  if (state.nextToActSeat !== seatNumber) {
    return { ok: false, error: "Not your turn." };
  }

  const owedToCall = state.currentBet - st.contributed_this_street;

  switch (action) {
    case "fold":
      return { ok: true, amount: 0, becomesAllIn: false };

    case "check":
      if (owedToCall > 0) {
        return {
          ok: false,
          error: `Can't check — you owe $${owedToCall} to call.`,
        };
      }
      return { ok: true, amount: 0, becomesAllIn: false };

    case "call": {
      if (owedToCall <= 0) {
        return {
          ok: false,
          error: "Nothing to call. Use Check instead.",
        };
      }
      const payable = Math.min(owedToCall, st.current_chips);
      // If the call eats the player's whole stack, it's an all-in
      // for less — flag it. The post-action update sets is_all_in.
      const becomesAllIn = payable >= st.current_chips;
      return { ok: true, amount: payable, becomesAllIn };
    }

    case "bet": {
      if (state.currentBet > 0) {
        return {
          ok: false,
          error: "There's already a bet — use Raise.",
        };
      }
      const n = Math.max(0, Math.floor(inputAmount ?? 0));
      if (n <= 0) return { ok: false, error: "Bet must be > 0." };
      if (n > st.current_chips) {
        return { ok: false, error: "Can't bet more than your stack." };
      }
      const becomesAllIn = n >= st.current_chips;
      return { ok: true, amount: n, becomesAllIn };
    }

    case "raise": {
      if (state.currentBet <= 0) {
        return {
          ok: false,
          error: "Nothing to raise — use Bet.",
        };
      }
      // `inputAmount` is the player's TOTAL bet on this street (i.e.
      // raise-TO, not raise-BY). Common house-game phrasing. We then
      // compute the additional chips required from the player's
      // stack.
      const total = Math.max(0, Math.floor(inputAmount ?? 0));
      if (total <= state.currentBet) {
        return {
          ok: false,
          error: `Raise must be more than $${state.currentBet}.`,
        };
      }
      const additional = total - st.contributed_this_street;
      if (additional > st.current_chips) {
        return {
          ok: false,
          error: "Can't raise more than your stack.",
        };
      }
      const becomesAllIn = additional >= st.current_chips;
      return { ok: true, amount: additional, becomesAllIn };
    }

    case "all_in": {
      // Push entire remaining stack into the pot. The resulting
      // contribution-this-street is either a call (if it doesn't
      // exceed currentBet), an under-call (still all-in, side-pot
      // territory), or a raise (if it exceeds currentBet).
      if (st.current_chips <= 0) {
        return { ok: false, error: "No chips to push." };
      }
      return { ok: true, amount: st.current_chips, becomesAllIn: true };
    }

    default:
      return { ok: false, error: `Unknown action: ${action}` };
  }
}

// ─── Side-pot math ──────────────────────────────────────────────────────

export type Pot = {
  kind: string; // 'main', 'side_1', 'side_2', ...
  amount: number;
  // Tournament_player_ids who are eligible to win this pot (not
  // folded and contributed at least up to the pot's level).
  eligible: string[];
};

/**
 * Given the final hand_seats state, compute the pot structure with
 * full side-pot handling.
 *
 * Algorithm (classic peel-the-layers):
 *   1. Sort active+folded seats by total_contributed ASC.
 *   2. For each unique contribution level, peel a "layer" of (level
 *      − prevLevel) chips off every seat that contributed at least
 *      that much. That's one pot.
 *   3. Eligibility for that pot = non-folded seats whose contribution
 *      is >= that level.
 *
 * Folded players' chips still go into the pot but they can't win
 * any of it. If only one player is eligible for a pot (everyone else
 * folded or contributed less), that pot is uncontested and goes back
 * to them.
 */
export function computePotStructure(seats: HandSeat[]): Pot[] {
  // Snapshot needed fields. Skip seats that contributed nothing — they
  // don't change pot levels.
  const rows = seats
    .map((s) => ({
      player: s.tournament_player_id,
      contributed: s.total_contributed,
      isFolded: s.is_folded,
    }))
    .filter((r) => r.contributed > 0)
    .sort((a, b) => a.contributed - b.contributed);

  if (rows.length === 0) return [];

  const pots: Pot[] = [];
  let prevLevel = 0;
  let potIndex = 0;

  // Use unique levels; multiple seats can share a level.
  const uniqueLevels = Array.from(
    new Set(rows.map((r) => r.contributed)),
  ).sort((a, b) => a - b);

  for (const level of uniqueLevels) {
    const slice = level - prevLevel;
    if (slice <= 0) continue;

    // Everyone who contributed at least `level` puts `slice` into
    // this pot.
    const contributors = rows.filter((r) => r.contributed >= level);
    const amount = slice * contributors.length;

    // Eligible to win = contributors who didn't fold.
    const eligible = contributors
      .filter((r) => !r.isFolded)
      .map((r) => r.player);

    if (amount > 0) {
      pots.push({
        kind: potIndex === 0 ? "main" : `side_${potIndex}`,
        amount,
        eligible,
      });
      potIndex++;
    }

    prevLevel = level;
  }

  return pots;
}

// ─── Award helpers ──────────────────────────────────────────────────────

export type AwardChoice = {
  // pot.kind → array of tournament_player_ids declared winners.
  // The pot is split evenly; integer remainder goes to the first
  // declared winner (deterministic).
  [potKind: string]: string[];
};

export type Award = {
  pot_kind: string;
  tournament_player_id: string;
  amount: number;
  is_split: boolean;
};

/**
 * Convert an admin's winner picks into discrete pot-award rows.
 * Validates that each declared winner is actually eligible for the
 * pot they're awarded. Splits evenly with the remainder going to the
 * first listed winner.
 */
export function buildAwards(input: {
  pots: Pot[];
  choices: AwardChoice;
}): { ok: true; awards: Award[] } | { ok: false; error: string } {
  const awards: Award[] = [];
  for (const pot of input.pots) {
    const winners = input.choices[pot.kind] ?? [];
    if (winners.length === 0) {
      return {
        ok: false,
        error: `No winner picked for ${pot.kind} pot.`,
      };
    }
    for (const w of winners) {
      if (!pot.eligible.includes(w)) {
        return {
          ok: false,
          error: `Player not eligible for ${pot.kind} pot.`,
        };
      }
    }
    const isSplit = winners.length > 1;
    const share = Math.floor(pot.amount / winners.length);
    const remainder = pot.amount - share * winners.length;
    for (let i = 0; i < winners.length; i++) {
      const amount = share + (i === 0 ? remainder : 0);
      if (amount > 0) {
        awards.push({
          pot_kind: pot.kind,
          tournament_player_id: winners[i],
          amount,
          is_split: isSplit,
        });
      }
    }
  }
  return { ok: true, awards };
}

/**
 * Award an uncontested pot — used when everyone but one player has
 * folded before showdown. The whole pot goes to the lone survivor.
 */
export function buildUncontestedAward(input: {
  seats: HandSeat[];
}): Award | null {
  const inHand = input.seats.filter((s) => !s.is_folded);
  if (inHand.length !== 1) return null;
  const pot = input.seats.reduce((sum, s) => sum + s.total_contributed, 0);
  if (pot <= 0) return null;
  return {
    pot_kind: "uncontested",
    tournament_player_id: inHand[0].tournament_player_id,
    amount: pot,
    is_split: false,
  };
}
