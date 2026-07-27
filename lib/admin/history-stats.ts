/**
 * Pure stat aggregations for /admin/history.
 *
 * The dashboard pulls a handful of finished-tournament tables in parallel
 * (tournaments, tournament_players + names, prize_distributions, bust
 * events) and groups them client-side. With ~40 tournaments × ~10 players
 * each, the row counts are small enough that a few in-memory passes are
 * cheaper and easier to reason about than a stack of SQL CTEs through the
 * Supabase JS client.
 */

import { BASE_BOUNTY_AMOUNT } from "@/lib/bounty";

export type FinishedTournament = {
  id: string;
  /**
   * Owning template id, or null if the tournament was created without one
   * (rare but possible — old data, ad-hoc tournaments). Used by the
   * history dashboard to filter / group by league.
   */
  template_id: string | null;
  finished_at: string | null;
  started_at: string | null;
  buy_in_snapshot: number;
  current_level: number;
  /**
   * Per-token prices captured at finalize. Used by the cost-basis math
   * on the leaderboard ("net" payout = gross - sum of buy-in + each
   * rebuy + each add-on the player bought into across the window).
   * Optional because old tournaments predate the snapshots.
   */
  rebuy_price_snapshot?: number | null;
  /**
   * Buyback config snapshot. We mostly care about `addOnPrice` here so
   * we can charge the player for each add-on they took in the cost-
   * basis math. Older shapes use `price` for both rebuy + addon, hence
   * the type union.
   */
  buyback_config_snapshot?: {
    price?: number;
    addOnPrice?: number;
    rebuyPrice?: number;
  } | null;
  /** Resolved once at creation (see `resolveBounty`); null if no target. */
  bounty_target_player_id?: string | null;
  /**
   * Dollar amount pulled from this tournament's pool. Can exceed
   * BASE_BOUNTY_AMOUNT when it stacked from a prior unclaimed week —
   * see BASE_BOUNTY_AMOUNT's doc comment for why only the base amount
   * ever comes out of any single week's pool.
   */
  bounty_amount?: number | null;
  /** Set once an admin records who busted the target; null until then. */
  bounty_collected_by_player_id?: string | null;
};

export type RosterRow = {
  tournament_id: string;
  player_id: string | null;
  finishing_position: number | null;
  buyback_used: boolean;
  buyback_used_as: string | null;
  /**
   * Per-row rebuy counter introduced in migration 0003. Optional/null on
   * databases that haven't applied 0003 — read via `tokenCounts(row)`
   * which falls back to the legacy `buyback_used`+`buyback_used_as`
   * boolean pair so analytics still work for default-1 tournaments.
   */
  rebuys_used?: number | null;
  /** Per-row add-on counter; same 0003 caveat as `rebuys_used`. */
  addons_used?: number | null;
  busted_at_level: number | null;
  player: { id: string; name: string } | null;
};

/**
 * Pull the rebuy + add-on token counts from a roster row, preferring the
 * 0003-era integer counters when present and falling back to the legacy
 * boolean flag (`buyback_used` + `buyback_used_as`) otherwise. With
 * `tokensPerPlayer = 1` (the only tournament configuration in use today)
 * the two encodings carry the same information; this helper hides the
 * choice from every consumer so a DB without 0003 still aggregates
 * correctly.
 */
export function tokenCounts(row: {
  rebuys_used?: number | null;
  addons_used?: number | null;
  buyback_used: boolean;
  buyback_used_as: string | null;
}): { rebuys: number; addOns: number } {
  const rebuys =
    typeof row.rebuys_used === "number" && row.rebuys_used > 0
      ? row.rebuys_used
      : row.buyback_used && row.buyback_used_as === "rebuy"
        ? 1
        : 0;
  const addOns =
    typeof row.addons_used === "number" && row.addons_used > 0
      ? row.addons_used
      : row.buyback_used && row.buyback_used_as === "addon"
        ? 1
        : 0;
  return { rebuys, addOns };
}

export type PayoutRow = {
  tournament_id: string;
  position: number;
  amount: number;
  player_id: string | null;
  is_chopped: boolean;
};

export type BustEvent = {
  tournament_id: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

// ─── Leaderboard ────────────────────────────────────────────────────────────

/**
 * F1-style season points awarded per finishing position. The whole
 * season standings reduce to "sum of these across every tournament a
 * player entered" — players who never cashed still bank points for
 * lasting longer than the bust-outs below them.
 *
 *   1st = 12 · 2nd = 10 · 3rd = 8 · 4th = 6 · 5th = 5 · 6th = 4 ·
 *   7th = 3 · 8th = 2 · 9th = 1 · 10th+ = 0
 *
 * Positions 4..9 decay by 1; the 12/10/8 head spread out the podium.
 * Mirrors the spec in PR #40 — keep the table here as the source of
 * truth; UI explains it via this same shape.
 */
export const F1_POINTS_TABLE: readonly number[] = [
  0, // index 0 unused; positions are 1-based
  12,
  10,
  8,
  6,
  5,
  4,
  3,
  2,
  1,
] as const;

export function f1Points(position: number | null | undefined): number {
  if (position == null || !Number.isFinite(position) || position < 1) return 0;
  return F1_POINTS_TABLE[position] ?? 0;
}

export type LeaderboardRow = {
  playerId: string;
  name: string;
  tournamentsPlayed: number;
  wins: number;
  /** "In the money" = finished with a non-zero payout. */
  itmCount: number;
  totalPayout: number;
  /** Best finishing position across all played tournaments (lower is better). */
  bestFinish: number | null;
};

export function buildLeaderboard(args: {
  roster: RosterRow[];
  payouts: PayoutRow[];
}): LeaderboardRow[] {
  const { roster, payouts } = args;

  // Map player_id → totals, walking through both tables once each.
  type Acc = {
    name: string;
    tournamentsPlayed: Set<string>;
    wins: number;
    itmTournaments: Set<string>;
    totalPayout: number;
    bestFinish: number | null;
  };
  const byPlayer = new Map<string, Acc>();

  for (const r of roster) {
    if (!r.player_id || !r.player) continue;
    const acc = byPlayer.get(r.player_id) ?? {
      name: r.player.name,
      tournamentsPlayed: new Set<string>(),
      wins: 0,
      itmTournaments: new Set<string>(),
      totalPayout: 0,
      bestFinish: null,
    };
    acc.tournamentsPlayed.add(r.tournament_id);
    if (r.finishing_position === 1) acc.wins += 1;
    if (
      r.finishing_position != null &&
      (acc.bestFinish == null || r.finishing_position < acc.bestFinish)
    ) {
      acc.bestFinish = r.finishing_position;
    }
    byPlayer.set(r.player_id, acc);
  }

  for (const p of payouts) {
    if (!p.player_id || p.amount <= 0) continue;
    const acc = byPlayer.get(p.player_id);
    if (!acc) continue; // player paid out but no roster row — shouldn't happen
    acc.totalPayout += p.amount;
    acc.itmTournaments.add(p.tournament_id);
  }

  const rows: LeaderboardRow[] = [];
  for (const [playerId, acc] of byPlayer.entries()) {
    rows.push({
      playerId,
      name: acc.name,
      tournamentsPlayed: acc.tournamentsPlayed.size,
      wins: acc.wins,
      itmCount: acc.itmTournaments.size,
      totalPayout: acc.totalPayout,
      bestFinish: acc.bestFinish,
    });
  }

  // Sort: most wins first, then total payout, then most tournaments played
  // (a tiebreaker that rewards regulars over one-night flukes).
  rows.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.totalPayout !== a.totalPayout) return b.totalPayout - a.totalPayout;
    return b.tournamentsPlayed - a.tournamentsPlayed;
  });

  return rows;
}

// ─── Bust histogram ─────────────────────────────────────────────────────────

export type BustHistogramBucket = {
  levelNum: number;
  count: number;
};

/**
 * For every bust event across the finished-tournament window, count how
 * many busts happened at each level. Result is sorted ascending by level
 * with no gaps within the observed range — empty levels render as zero
 * bars instead of being dropped, so the chart shape stays interpretable.
 */
export function buildBustHistogram(events: BustEvent[]): BustHistogramBucket[] {
  const counts = new Map<number, number>();
  let maxLevel = 0;
  for (const e of events) {
    const lvl = readLevel(e.payload);
    if (lvl == null) continue;
    counts.set(lvl, (counts.get(lvl) ?? 0) + 1);
    if (lvl > maxLevel) maxLevel = lvl;
  }
  if (maxLevel === 0) return [];
  const out: BustHistogramBucket[] = [];
  for (let l = 1; l <= maxLevel; l++) {
    out.push({ levelNum: l, count: counts.get(l) ?? 0 });
  }
  return out;
}

function readLevel(payload: Record<string, unknown> | null): number | null {
  if (!payload) return null;
  const v = payload.at_level;
  return typeof v === "number" ? v : null;
}

// ─── Per-tournament summary ─────────────────────────────────────────────────

export type TournamentSummaryRow = {
  id: string;
  finishedAt: string | null;
  entries: number;
  rebuys: number;
  addOns: number;
  prizePool: number;
  winnerName: string | null;
  winnerId: string | null;
  chopped: boolean;
  buyIn: number;
};

export function buildTournamentSummaries(args: {
  tournaments: FinishedTournament[];
  roster: RosterRow[];
  payouts: PayoutRow[];
}): TournamentSummaryRow[] {
  const { tournaments, roster, payouts } = args;

  const rosterByTourn = groupBy(roster, (r) => r.tournament_id);
  const payoutsByTourn = groupBy(payouts, (p) => p.tournament_id);

  return tournaments.map((t) => {
    const tournRoster = rosterByTourn.get(t.id) ?? [];
    const tournPayouts = payoutsByTourn.get(t.id) ?? [];
    let rebuys = 0;
    let addOns = 0;
    for (const r of tournRoster) {
      const c = tokenCounts(r);
      rebuys += c.rebuys;
      addOns += c.addOns;
    }
    const prizePool = tournPayouts.reduce((s, p) => s + p.amount, 0);
    const chopped = tournPayouts.some((p) => p.is_chopped);
    const winnerRow = tournRoster.find((r) => r.finishing_position === 1);
    return {
      id: t.id,
      finishedAt: t.finished_at,
      // Starting roster size only — rebuys and add-ons are shown as
      // separate counts beside this number so combining them confused
      // the admin (a 13-player game with 6 rebuys read as "19 entries").
      entries: tournRoster.length,
      rebuys,
      addOns,
      prizePool,
      winnerName: winnerRow?.player?.name ?? null,
      winnerId: winnerRow?.player_id ?? null,
      chopped,
      buyIn: t.buy_in_snapshot,
    };
  });
}

// ─── Bounty ledger ──────────────────────────────────────────────────────────

export type BountyLedgerRow = {
  tournamentId: string;
  finishedAt: string | null;
  targetPlayerId: string;
  targetName: string;
  amount: number;
  /** True when `amount` carried over from a prior unclaimed week. */
  isStacked: boolean;
  collectorPlayerId: string | null;
  collectorName: string | null;
};

/**
 * One row per tournament that had a bounty in play (`resolveBounty` sets
 * `bounty_target_player_id` at creation; not every tournament has one —
 * there's no prior finished tournament, or none of its finishers came
 * back). Target and collector names are resolved from the already-
 * fetched roster rather than a separate query: both are guaranteed to
 * be in that tournament's roster (target is chosen from returning
 * players, collector is whoever busted them), so no join is missing.
 */
export function buildBountyLedger(args: {
  tournaments: FinishedTournament[];
  roster: RosterRow[];
}): BountyLedgerRow[] {
  const { tournaments, roster } = args;

  const nameByPlayer = new Map<string, string>();
  for (const r of roster) {
    if (r.player_id && r.player?.name) nameByPlayer.set(r.player_id, r.player.name);
  }

  const rows: BountyLedgerRow[] = [];
  for (const t of tournaments) {
    if (!t.bounty_target_player_id) continue;
    // tournaments.bounty_amount is Postgres `numeric`, which comes back
    // from the Supabase client as a string — Number(...) it here so
    // downstream summing (bountyCollectorCounts in HistoryBody) doesn't
    // silently string-concat instead of adding. Same guard as
    // lib/admin/bounty.ts's resolveBounty().
    const amount = Number(t.bounty_amount ?? BASE_BOUNTY_AMOUNT);
    rows.push({
      tournamentId: t.id,
      finishedAt: t.finished_at,
      targetPlayerId: t.bounty_target_player_id,
      targetName: nameByPlayer.get(t.bounty_target_player_id) ?? "—",
      amount,
      isStacked: amount > BASE_BOUNTY_AMOUNT,
      collectorPlayerId: t.bounty_collected_by_player_id ?? null,
      collectorName: t.bounty_collected_by_player_id
        ? (nameByPlayer.get(t.bounty_collected_by_player_id) ?? "—")
        : null,
    });
  }
  return rows;
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const arr = out.get(k);
    if (arr) {
      arr.push(item);
    } else {
      out.set(k, [item]);
    }
  }
  return out;
}

// ─── Time-range filter ──────────────────────────────────────────────────────

/**
 * Filter window the historics page surfaces as filter pills. Three of
 * the four are tournament-count windows ("last 1, 3, 6 finished
 * tournaments"); the fourth is a calendar 12-month window so admins
 * can see seasonal trends without having to count tournaments.
 *
 * "Prior year" intentionally means "trailing 12 months from today",
 * not "the calendar year just past" — that's the more useful signal
 * for an actively-running league. The helper text in the UI says
 * "past 12 months" so there's no ambiguity for anyone reading.
 */
export type HistoryRange = "last1" | "last3" | "last6" | "year12" | "all";

export const HISTORY_RANGES: readonly HistoryRange[] = [
  "last1",
  "last3",
  "last6",
  "year12",
  "all",
] as const;

export function isHistoryRange(v: unknown): v is HistoryRange {
  return (
    typeof v === "string" && (HISTORY_RANGES as readonly string[]).includes(v)
  );
}

export function rangeLabel(r: HistoryRange): string {
  switch (r) {
    case "last1":
      return "Last game";
    case "last3":
      return "Last 3 games";
    case "last6":
      return "Last 6 games";
    case "year12":
      return "Past 12 months";
    case "all":
      return "All time";
  }
}

/**
 * Filter `tournaments` (which the caller has already sorted DESC by
 * finished_at) down to the chosen range. Tournament-count windows
 * just slice the head; the 12-month window keeps anything with a
 * finished_at within the past year.
 *
 * Caller still owns the cap on the upstream query — pass at least
 * 12 for "year12" to behave correctly when 12+ months of activity
 * exists. We don't bound it here.
 */
export function applyHistoryRange(
  tournaments: FinishedTournament[],
  range: HistoryRange,
  nowMs: number = Date.now(),
): FinishedTournament[] {
  switch (range) {
    case "last1":
      return tournaments.slice(0, 1);
    case "last3":
      return tournaments.slice(0, 3);
    case "last6":
      return tournaments.slice(0, 6);
    case "year12": {
      const cutoff = nowMs - 365 * 24 * 60 * 60 * 1000;
      return tournaments.filter((t) => {
        if (!t.finished_at) return false;
        const ms = Date.parse(t.finished_at);
        return Number.isFinite(ms) && ms >= cutoff;
      });
    }
    case "all":
      return tournaments;
  }
}

// ─── Per-player granular stats ──────────────────────────────────────────────

/** A `rebuy` or `addon` event (same shape — both carry at_level + player_id). */
export type TokenEvent = {
  tournament_id: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

function readPlayerId(payload: Record<string, unknown> | null): string | null {
  const v = payload?.player_id;
  return typeof v === "string" ? v : null;
}

function readAtLevel(payload: Record<string, unknown> | null): number | null {
  const v = payload?.at_level;
  return typeof v === "number" ? v : null;
}

export function tournamentCostBasis(
  tournament: FinishedTournament,
): { rebuyPrice: number; addOnPrice: number } {
  const cfg = tournament.buyback_config_snapshot ?? null;
  const rebuyPrice =
    (typeof cfg?.rebuyPrice === "number" ? cfg.rebuyPrice : null) ??
    (typeof cfg?.price === "number" ? cfg.price : null) ??
    tournament.rebuy_price_snapshot ??
    tournament.buy_in_snapshot;
  const addOnPrice =
    (typeof cfg?.addOnPrice === "number" ? cfg.addOnPrice : null) ??
    (typeof cfg?.price === "number" ? cfg.price : null) ??
    tournament.rebuy_price_snapshot ??
    tournament.buy_in_snapshot;
  return { rebuyPrice, addOnPrice };
}

export type PlayerStatsRow = {
  playerId: string;
  name: string;
  /**
   * Sum of `f1Points(finishing_position)` across the window. The
   * primary leaderboard sort key — finishing later (better) earns more
   * points even when the player wasn't in the money.
   */
  points: number;
  /** Tournaments the player entered in the window. */
  tournamentsPlayed: number;
  /** Tournaments where finishing_position === 1. */
  wins: number;
  /** Tournaments where they took home a non-zero payout (in-the-money). */
  itmCount: number;
  /** Sum of payouts from prize_distributions (gross). */
  grossWinnings: number;
  /**
   * Total cost basis: sum across played tournaments of buy_in plus
   * rebuy_price × rebuys plus addOn_price × addons. The "net" leaderboard
   * sorts by `grossWinnings - costBasis`, so a player who never rebuys
   * but always cashes runs above someone who rebuys repeatedly to chase.
   */
  costBasis: number;
  /** grossWinnings − costBasis. Can be (and often is) negative. */
  net: number;
  /**
   * Average level at which the player busted out across tournaments
   * where they have a recorded busted_at_level. `null` when they never
   * busted in the window (e.g. they won or chopped every tournament).
   */
  avgBustLevel: number | null;
  /**
   * Average level at which the player rebought across `rebuy` events.
   * `null` when they have zero rebuys in the window.
   */
  avgRebuyLevel: number | null;
  /** Total rebuys across the window. */
  totalRebuys: number;
  /** Total add-ons across the window. */
  totalAddOns: number;
  /**
   * Fraction of played tournaments where they rebought at least once.
   * 0..1. Surfaces "always rebuys" vs "never rebuys" cohorts.
   */
  rebuyRate: number;
  /** Average finishing position (lower is better). `null` if no recorded position. */
  avgFinish: number | null;
};

export function buildPlayerStats(args: {
  tournaments: FinishedTournament[];
  roster: RosterRow[];
  payouts: PayoutRow[];
  rebuyEvents: TokenEvent[];
  addOnEvents: TokenEvent[];
}): PlayerStatsRow[] {
  const { tournaments, roster, payouts, rebuyEvents, addOnEvents } = args;

  const tournamentById = new Map(tournaments.map((t) => [t.id, t]));
  const tournamentIds = new Set(tournamentById.keys());

  // Drop roster rows / events that fall outside the window — the caller
  // pre-filters tournaments by range, but the upstream query may have
  // pulled events for tournaments we've now sliced out.
  const rosterInWindow = roster.filter((r) => tournamentIds.has(r.tournament_id));
  const payoutsInWindow = payouts.filter((p) =>
    tournamentIds.has(p.tournament_id),
  );
  const rebuysInWindow = rebuyEvents.filter((e) =>
    tournamentIds.has(e.tournament_id),
  );
  const addOnsInWindow = addOnEvents.filter((e) =>
    tournamentIds.has(e.tournament_id),
  );

  type Acc = {
    name: string;
    points: number;
    tournamentsPlayed: Set<string>;
    tournamentsWithRebuy: Set<string>;
    wins: number;
    itmTournaments: Set<string>;
    grossWinnings: number;
    costBasis: number;
    bustLevels: number[];
    rebuyLevels: number[];
    totalRebuys: number;
    totalAddOns: number;
    finishingPositions: number[];
  };
  const byPlayer = new Map<string, Acc>();
  const ensure = (id: string, name: string): Acc => {
    let acc = byPlayer.get(id);
    if (!acc) {
      acc = {
        name,
        points: 0,
        tournamentsPlayed: new Set(),
        tournamentsWithRebuy: new Set(),
        wins: 0,
        itmTournaments: new Set(),
        grossWinnings: 0,
        costBasis: 0,
        bustLevels: [],
        rebuyLevels: [],
        totalRebuys: 0,
        totalAddOns: 0,
        finishingPositions: [],
      };
      byPlayer.set(id, acc);
    }
    return acc;
  };

  for (const r of rosterInWindow) {
    if (!r.player_id || !r.player) continue;
    const tournament = tournamentById.get(r.tournament_id);
    if (!tournament) continue;
    const acc = ensure(r.player_id, r.player.name);
    acc.tournamentsPlayed.add(r.tournament_id);
    if (r.finishing_position === 1) acc.wins += 1;
    if (r.finishing_position != null) {
      acc.finishingPositions.push(r.finishing_position);
      acc.points += f1Points(r.finishing_position);
    }
    if (r.busted_at_level != null) {
      acc.bustLevels.push(r.busted_at_level);
    }
    // Cost basis: one buy-in + token-priced rebuys + token-priced
    // add-ons. We use the per-row counters (0003) and fall back to the
    // legacy boolean via tokenCounts() so an unmigrated DB still works.
    const counts = tokenCounts(r);
    const basis = tournamentCostBasis(tournament);
    acc.costBasis +=
      tournament.buy_in_snapshot +
      counts.rebuys * basis.rebuyPrice +
      counts.addOns * basis.addOnPrice;
    acc.totalRebuys += counts.rebuys;
    acc.totalAddOns += counts.addOns;
    if (counts.rebuys > 0) acc.tournamentsWithRebuy.add(r.tournament_id);
  }

  for (const p of payoutsInWindow) {
    if (!p.player_id || p.amount <= 0) continue;
    const acc = byPlayer.get(p.player_id);
    if (!acc) continue;
    acc.grossWinnings += p.amount;
    acc.itmTournaments.add(p.tournament_id);
  }

  // Rebuy events tell us *when* (level), the roster row tells us *how
  // many*. We use the events for per-level averaging because the row
  // counter is just the count.
  for (const e of rebuysInWindow) {
    const pid = readPlayerId(e.payload);
    const lvl = readAtLevel(e.payload);
    if (!pid || lvl == null) continue;
    const acc = byPlayer.get(pid);
    if (!acc) continue;
    acc.rebuyLevels.push(lvl);
  }

  // Add-on event levels could be tracked the same way, but currently the
  // UI only surfaces the *count* of add-ons (the level they were taken
  // is much less informative — add-ons usually only happen at one
  // configured break level). Keep the loop variable for future use.
  void addOnsInWindow;

  const rows: PlayerStatsRow[] = [];
  for (const [playerId, acc] of byPlayer.entries()) {
    const tournamentsPlayed = acc.tournamentsPlayed.size;
    const rebuyRate =
      tournamentsPlayed > 0
        ? acc.tournamentsWithRebuy.size / tournamentsPlayed
        : 0;
    const avgBustLevel =
      acc.bustLevels.length > 0
        ? acc.bustLevels.reduce((s, n) => s + n, 0) / acc.bustLevels.length
        : null;
    const avgRebuyLevel =
      acc.rebuyLevels.length > 0
        ? acc.rebuyLevels.reduce((s, n) => s + n, 0) / acc.rebuyLevels.length
        : null;
    const avgFinish =
      acc.finishingPositions.length > 0
        ? acc.finishingPositions.reduce((s, n) => s + n, 0) /
          acc.finishingPositions.length
        : null;
    rows.push({
      playerId,
      name: acc.name,
      points: acc.points,
      tournamentsPlayed,
      wins: acc.wins,
      itmCount: acc.itmTournaments.size,
      grossWinnings: acc.grossWinnings,
      costBasis: acc.costBasis,
      net: acc.grossWinnings - acc.costBasis,
      avgBustLevel,
      avgRebuyLevel,
      totalRebuys: acc.totalRebuys,
      totalAddOns: acc.totalAddOns,
      rebuyRate,
      avgFinish,
    });
  }

  // Default sort: F1 points DESC, then average finishing position ASC
  // (lower is better). Players with equal points — e.g. everyone who
  // busted out of the points (finished worse than 9th) and so scored 0 —
  // are separated by who finishes higher on average. Players with no
  // recorded finish sort last among their points group. Wins and net
  // remain as deeper tiebreakers for identical points + avg finish.
  // The UI can re-sort by any other column on click.
  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const aFinish = a.avgFinish ?? Number.POSITIVE_INFINITY;
    const bFinish = b.avgFinish ?? Number.POSITIVE_INFINITY;
    if (aFinish !== bFinish) return aFinish - bFinish;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.net - a.net;
  });

  return rows;
}

// ─── Per-player tournament-by-tournament history ────────────────────────────

export type PlayerTournamentRow = {
  tournamentId: string;
  finishedAt: string | null;
  position: number | null;
  payout: number;
  buyIn: number;
  rebuys: number;
  addOns: number;
  bustedAtLevel: number | null;
  net: number;
  /**
   * Whose row this is. Redundant when the caller already scoped
   * `roster` to one known player (the player profile page's use case),
   * but load-bearing when `roster` instead spans every player in one
   * tournament (the tournament detail page's use case) — same function,
   * different scoping by the caller.
   */
  playerId: string | null;
  playerName: string;
};

/**
 * Row-level detail behind one player's aggregate `PlayerStatsRow` — the
 * player profile page's tournament-by-tournament list. Caller is
 * expected to have already scoped `roster` and `payouts` to just this
 * one player (see PlayerHistoryBody's loader), so there's no
 * player_id filtering here; every roster row becomes one output row.
 */
export function buildPlayerTournamentHistory(args: {
  tournaments: FinishedTournament[];
  roster: RosterRow[];
  payouts: PayoutRow[];
}): PlayerTournamentRow[] {
  const tournamentById = new Map(args.tournaments.map((t) => [t.id, t]));
  // Keyed by (tournament, player) — not just tournament — so this stays
  // correct whether `payouts` is pre-scoped to one player (the player
  // profile page) or spans everyone in one tournament (the tournament
  // detail page). Keying by tournament alone would sum every player's
  // payout onto every row once more than one player is present.
  const payoutByKey = new Map<string, number>();
  for (const p of args.payouts) {
    if (!p.player_id) continue;
    const key = `${p.tournament_id}:${p.player_id}`;
    payoutByKey.set(key, (payoutByKey.get(key) ?? 0) + p.amount);
  }

  const rows: PlayerTournamentRow[] = [];
  for (const r of args.roster) {
    const t = tournamentById.get(r.tournament_id);
    if (!t) continue;
    const counts = tokenCounts(r);
    const basis = tournamentCostBasis(t);
    const payout = r.player_id
      ? (payoutByKey.get(`${r.tournament_id}:${r.player_id}`) ?? 0)
      : 0;
    const cost =
      t.buy_in_snapshot +
      counts.rebuys * basis.rebuyPrice +
      counts.addOns * basis.addOnPrice;
    rows.push({
      tournamentId: r.tournament_id,
      finishedAt: t.finished_at,
      position: r.finishing_position,
      payout,
      buyIn: t.buy_in_snapshot,
      rebuys: counts.rebuys,
      addOns: counts.addOns,
      bustedAtLevel: r.busted_at_level,
      net: payout - cost,
      playerId: r.player_id,
      playerName: r.player?.name ?? "—",
    });
  }

  rows.sort((a, b) => {
    const at = a.finishedAt ? Date.parse(a.finishedAt) : 0;
    const bt = b.finishedAt ? Date.parse(b.finishedAt) : 0;
    return bt - at;
  });
  return rows;
}

// ─── Break-shift analysis ───────────────────────────────────────────────────

/**
 * Per-player chip count reported during a break (or anytime the player
 * submitted via /play). The historics page uses these to compute who
 * runs above/below the table average and who has the biggest swings.
 */
export type ChipSnapshotEvent = {
  tournament_id: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type Snapshot = {
  tournamentId: string;
  playerId: string;
  level: number;
  chips: number;
  /** Order events were recorded — used to break ties at same level. */
  ts: number;
};

function readSnapshots(events: ChipSnapshotEvent[]): Snapshot[] {
  const out: Snapshot[] = [];
  for (const e of events) {
    const pid = readPlayerId(e.payload);
    const lvl = e.payload?.level_num;
    const chips = e.payload?.chips;
    if (
      !pid ||
      typeof lvl !== "number" ||
      typeof chips !== "number" ||
      !Number.isFinite(chips)
    ) {
      continue;
    }
    out.push({
      tournamentId: e.tournament_id,
      playerId: pid,
      level: lvl,
      chips,
      ts: Date.parse(e.created_at) || 0,
    });
  }
  return out;
}

export type BreakShiftRow = {
  playerId: string;
  name: string;
  /** Number of (tournament, level) snapshot points contributing. */
  snapshotCount: number;
  /**
   * Average ratio of (player chips at break) / (mean chips at the same
   * break in that tournament). 1.0 == on-average. >1 == consistently
   * above the average, <1 == below. Computed across every snapshot
   * the player has in the window.
   */
  avgChipsRatio: number;
  /** Their single highest chips-vs-table-average ratio ever recorded. */
  maxChipsRatio: number;
  /** Their single lowest chips-vs-table-average ratio ever recorded. */
  minChipsRatio: number;
  /** Distinct tournaments where at least one check-in ratio was > 1. */
  tournamentsAboveAverage: number;
  /** Distinct tournaments where at least one check-in ratio was < 1. */
  tournamentsBelowAverage: number;
  /**
   * Largest single between-break swing in chips for this player.
   * Computed as max |chips_after - chips_before| for any consecutive
   * pair of their snapshots in the SAME tournament.
   */
  biggestSwing: number;
  /**
   * Average between-break swing magnitude relative to the mean chip
   * count of all snapshots at those break points. Lets us compare
   * "this player swings ±15% per break" vs "this one swings ±60%".
   * `null` when the player has fewer than 2 snapshots in any
   * tournament.
   */
  avgSwingRatio: number | null;
};

export function buildBreakShiftStats(args: {
  tournaments: FinishedTournament[];
  roster: RosterRow[];
  events: ChipSnapshotEvent[];
}): BreakShiftRow[] {
  const tournamentIds = new Set(args.tournaments.map((t) => t.id));
  const inWindow = args.events.filter((e) => tournamentIds.has(e.tournament_id));
  const snapshots = readSnapshots(inWindow);
  if (snapshots.length === 0) return [];

  // Map player_id -> name. Roster is the cheapest source.
  const nameByPlayer = new Map<string, string>();
  for (const r of args.roster) {
    if (r.player_id && r.player?.name) nameByPlayer.set(r.player_id, r.player.name);
  }

  // For each (tournament, level) compute the mean of all reported chip
  // counts. Snapshots without enough peers (a single reporter at that
  // level) still count — their ratio is just 1.0 since the mean equals
  // their value, and they don't skew anyone's number.
  const meansByTournamentLevel = new Map<string, number>();
  {
    const grouped = new Map<string, number[]>();
    for (const s of snapshots) {
      const k = `${s.tournamentId}:${s.level}`;
      const arr = grouped.get(k);
      if (arr) arr.push(s.chips);
      else grouped.set(k, [s.chips]);
    }
    for (const [k, arr] of grouped.entries()) {
      const sum = arr.reduce((a, b) => a + b, 0);
      meansByTournamentLevel.set(k, sum / arr.length);
    }
  }

  // Group by player; within each player, group by tournament; sort by
  // level so we can compute consecutive-break swings.
  const byPlayer = new Map<
    string,
    Map<string, Snapshot[]>
  >();
  for (const s of snapshots) {
    let perTournament = byPlayer.get(s.playerId);
    if (!perTournament) {
      perTournament = new Map();
      byPlayer.set(s.playerId, perTournament);
    }
    const arr = perTournament.get(s.tournamentId);
    if (arr) arr.push(s);
    else perTournament.set(s.tournamentId, [s]);
  }

  const rows: BreakShiftRow[] = [];
  for (const [playerId, perTournament] of byPlayer.entries()) {
    let ratioSum = 0;
    let ratioCount = 0;
    let maxRatio = -Infinity;
    let minRatio = Infinity;
    const tournamentsAbove = new Set<string>();
    const tournamentsBelow = new Set<string>();
    let biggestSwing = 0;
    let swingRatioSum = 0;
    let swingRatioCount = 0;

    for (const arr of perTournament.values()) {
      // Sort by level, then by timestamp so duplicates at the same
      // level (a player who reported twice at one break) stay ordered.
      arr.sort((a, b) => a.level - b.level || a.ts - b.ts);
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        const mean =
          meansByTournamentLevel.get(`${s.tournamentId}:${s.level}`) ?? s.chips;
        if (mean > 0) {
          const ratio = s.chips / mean;
          ratioSum += ratio;
          ratioCount += 1;
          if (ratio > maxRatio) maxRatio = ratio;
          if (ratio < minRatio) minRatio = ratio;
          if (ratio > 1) tournamentsAbove.add(s.tournamentId);
          if (ratio < 1) tournamentsBelow.add(s.tournamentId);
        }
        if (i > 0) {
          const prev = arr[i - 1];
          const swing = Math.abs(s.chips - prev.chips);
          if (swing > biggestSwing) biggestSwing = swing;
          // Relative-to-mean: average the means of the two adjacent
          // break points so a swing during a tight break (low mean)
          // doesn't read identically to one during a chip-rich late
          // break.
          const prevMean =
            meansByTournamentLevel.get(`${prev.tournamentId}:${prev.level}`) ??
            prev.chips;
          const baseline = (mean + prevMean) / 2;
          if (baseline > 0) {
            swingRatioSum += swing / baseline;
            swingRatioCount += 1;
          }
        }
      }
    }

    rows.push({
      playerId,
      name: nameByPlayer.get(playerId) ?? "—",
      snapshotCount: ratioCount,
      avgChipsRatio: ratioCount > 0 ? ratioSum / ratioCount : 1,
      maxChipsRatio: ratioCount > 0 ? maxRatio : 1,
      minChipsRatio: ratioCount > 0 ? minRatio : 1,
      tournamentsAboveAverage: tournamentsAbove.size,
      tournamentsBelowAverage: tournamentsBelow.size,
      biggestSwing,
      avgSwingRatio:
        swingRatioCount > 0 ? swingRatioSum / swingRatioCount : null,
    });
  }

  // Default sort: most data points first so single-snapshot players
  // don't swamp the top of the list.
  rows.sort((a, b) => b.snapshotCount - a.snapshotCount);
  return rows;
}
