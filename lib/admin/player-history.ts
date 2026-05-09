/**
 * Per-player bust / rebuy / addon timeline for the TV recap Stats slide.
 *
 * tournament_events is the source of truth: each player's history is the
 * sequence of events with type IN ('bust', 'rebuy', 'addon') for their
 * player_id, ordered by created_at. With a rebuy cycle the history reads
 * naturally — "bust L4, rebuy L5, bust L7" — and the timestamp on each
 * event gives the wall-clock time the user asked for.
 */

export type GameEvent = {
  type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export type HistoryEntry = {
  type: "bust" | "rebuy" | "addon";
  level: number | null;
  /** ISO timestamp from tournament_events.created_at. */
  at: string;
  /** Chips granted (for rebuy/addon). Undefined for bust. */
  chips?: number;
};

export type PlayerHistory = {
  playerId: string;
  name: string;
  /** Final position from tournament_players.finishing_position, if assigned. */
  finalPosition: number | null;
  /** Payout from prize_distributions, if any. */
  payout: number;
  events: HistoryEntry[];
};

/**
 * Group bust/rebuy/addon events by player, joined with the player's name
 * and final position. Each player's events come out chronologically (by
 * the events table's natural insertion order, which the caller passes
 * sorted ascending).
 *
 * Players with no game events are still included if they have a
 * `finalPosition` set — they ran the table without busting (the
 * survivor) and the recap should show them at position 1 even with an
 * empty event list.
 */
export function buildPlayerHistories(args: {
  events: readonly GameEvent[];
  players: ReadonlyArray<{
    player_id: string | null;
    finishing_position: number | null;
    payout_amount: number | null;
    players?: { id: string; name: string } | null;
  }>;
  payouts?: ReadonlyArray<{
    position: number;
    amount: number;
    player_id: string | null;
  }>;
}): PlayerHistory[] {
  const byId = new Map<string, PlayerHistory>();

  for (const p of args.players) {
    const id = p.player_id;
    if (!id) continue;
    const name = p.players?.name ?? "—";
    byId.set(id, {
      playerId: id,
      name,
      finalPosition: p.finishing_position ?? null,
      payout: p.payout_amount ?? 0,
      events: [],
    });
  }

  // Layer in payouts (they're more authoritative than payout_amount when
  // the column wasn't backfilled). Position-keyed lookup also catches
  // chops where two players share position 1.
  if (args.payouts) {
    for (const p of args.payouts) {
      if (!p.player_id) continue;
      const entry = byId.get(p.player_id);
      if (entry && p.amount > entry.payout) entry.payout = p.amount;
    }
  }

  for (const e of args.events) {
    if (e.type !== "bust" && e.type !== "rebuy" && e.type !== "addon") {
      continue;
    }
    const playerId =
      typeof e.payload?.player_id === "string"
        ? (e.payload.player_id as string)
        : null;
    if (!playerId) continue;
    const entry = byId.get(playerId);
    if (!entry) continue;

    const level =
      typeof e.payload?.at_level === "number"
        ? (e.payload.at_level as number)
        : null;
    const chipsRaw =
      typeof e.payload?.chips === "number"
        ? (e.payload.chips as number)
        : typeof e.payload?.chips_added === "number"
          ? (e.payload.chips_added as number)
          : undefined;

    entry.events.push({
      type: e.type as HistoryEntry["type"],
      level,
      at: e.created_at,
      chips: chipsRaw,
    });
  }

  // Sort: winner first, then by final position. Players without a
  // finalPosition (rare — should only happen pre-finalize, which the
  // recap never sees) sink to the bottom.
  return Array.from(byId.values()).sort((a, b) => {
    const ap = a.finalPosition ?? Number.POSITIVE_INFINITY;
    const bp = b.finalPosition ?? Number.POSITIVE_INFINITY;
    return ap - bp;
  });
}
