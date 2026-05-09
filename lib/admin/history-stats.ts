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

export type FinishedTournament = {
  id: string;
  finished_at: string | null;
  started_at: string | null;
  buy_in_snapshot: number;
  current_level: number;
};

export type RosterRow = {
  tournament_id: string;
  player_id: string | null;
  finishing_position: number | null;
  buyback_used: boolean;
  buyback_used_as: string | null;
  rebuys_used: number | null;
  addons_used: number | null;
  busted_at_level: number | null;
  player: { id: string; name: string } | null;
};

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
    const rebuys = tournRoster.reduce((s, r) => s + (r.rebuys_used ?? 0), 0);
    const addOns = tournRoster.reduce((s, r) => s + (r.addons_used ?? 0), 0);
    const prizePool = tournPayouts.reduce((s, p) => s + p.amount, 0);
    const chopped = tournPayouts.some((p) => p.is_chopped);
    const winnerRow = tournRoster.find((r) => r.finishing_position === 1);
    return {
      id: t.id,
      finishedAt: t.finished_at,
      entries: tournRoster.length + rebuys, // each rebuy is its own paid entry
      rebuys,
      addOns,
      prizePool,
      winnerName: winnerRow?.player?.name ?? null,
      chopped,
      buyIn: t.buy_in_snapshot,
    };
  });
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
