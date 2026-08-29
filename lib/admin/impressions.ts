import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { createServiceClient } from "@/lib/supabase/service";
import {
  buildPlayerStats,
  buildPlayerTournamentHistory,
  type ChipSnapshotEvent,
  type FinishedTournament,
  type PayoutRow,
  type RosterRow,
  type TokenEvent,
} from "@/lib/admin/history-stats";

const MODEL = "claude-opus-5";
const TOURNAMENT_LIMIT = 60;
const RECENT_HISTORY_COUNT = 3;
// Non-streaming; well under any HTTP timeout for this response size, and
// generous enough that a growing roster doesn't get truncated mid-response
// (each blurb is short, but 25+ players' worth of {playerId, impression}
// entries adds up — the previous 4096 cap was the direct cause of the
// "invalid JSON" failures: the response got cut off mid-array).
const MAX_OUTPUT_TOKENS = 16_000;

const SYSTEM_PROMPT = `You write extremely short "post-tournament impression" blurbs for a home poker league's public stats page.

You will receive a JSON array of players, each with verified stats and recent tournament history pulled straight from the league's database. For each player, write ONE blurb (2 sentences max, under ~50 words) using ONLY the facts given in that player's own data — never invent, estimate, or embellish a specific number, date, level, or event that isn't present. A warm, lightly playful recap-writer tone is good; unverifiable claims about mindset, feelings, or intent are not.

If a player has very little data (0-1 recorded tournaments), keep the blurb brief and don't overstate what one data point means.

A "wins" value ending in .5 is not an error: when the final two players chop the pot they're tied for 1st, and each is credited half a win. Describe those as a chop or a shared title rather than as a fraction of a victory.

Some tournaments in a player's recentHistory include a "chipCheckpoints" list — their reported chip count at specific levels that night, in order. When present, you may describe their stack trajectory (e.g., built an early lead before fading, or ground up from a short stack) using only those exact chip counts and levels. Most tournaments won't have this — never imply a trajectory for one that doesn't.

Return one impression per player in the input, same order.`;

// Structured output schema — the API enforces this shape server-side, so
// there's no more markdown-fence stripping or manual JSON.parse of raw
// model text to get wrong (that free-text approach is exactly what broke
// as the roster grew: one stray unescaped quote or a cut-off response
// anywhere in a 25-entry array invalidated the whole batch).
const ImpressionsResponseSchema = z.object({
  impressions: z.array(
    z.object({
      playerId: z.string(),
      impression: z.string(),
    }),
  ),
});

type PlayerFacts = {
  playerId: string;
  name: string;
  tournamentsPlayed: number;
  /** Fractional — a chopped tournament credits 0.5 to each tied player. */
  wins: number;
  itmCount: number;
  points: number;
  net: number;
  avgFinish: number | null;
  avgBustLevel: number | null;
  rebuyRate: number;
  totalRebuys: number;
  totalAddOns: number;
  recentHistory: Array<{
    finishedAt: string | null;
    position: number | null;
    bustedAtLevel: number | null;
    rebuys: number;
    addOns: number;
    net: number;
    /**
     * Chip count at each level a snapshot exists for that night, in
     * order — omitted entirely when none exist. Comes from the same
     * chip_snapshot events the /history break-shift stats use, so an
     * admin's "Chips" edit or the /table check-in panel counts the
     * same as a player's own /play self-report.
     */
    chipCheckpoints?: Array<{ levelNum: number; chips: number }>;
  }>;
};

export type RefreshImpressionsResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

/**
 * Regenerate players' "post-tournament impression" blurbs for one scope
 * (real league or sandbox — never mixed), in a single batched Claude
 * call rather than one call per player. Batching keeps this fast and
 * cheap even as the roster grows, and lets the model see the whole
 * field at once (useful context for anything relative, like who else
 * is on a streak) without actually asking it to compare players
 * against each other in the output.
 *
 * Always "all time" for the scope — impressions are a standing
 * synopsis of the relationship, not scoped to whatever range filter a
 * viewer happens to have picked on the profile page. That applies even
 * when `playerIds` narrows *which* players get refreshed: each
 * included player's blurb is still built from their full history, not
 * just the triggering tournament.
 *
 * `sourceTournamentId` records which tournament's finalize triggered
 * the refresh; omit it for an admin-initiated on-demand refresh not
 * tied to any particular finalize — it then falls back to the most
 * recently finished tournament in this scope purely as a
 * record-keeping label (there's nothing to summarize, and this
 * resolves to an error result, when there's no finished tournament to
 * fall back to).
 *
 * `playerIds`, when given, restricts the refresh to just those
 * players (still computed from each one's full all-time history) —
 * performFinalize passes just the roster of the tournament that
 * finished, since regenerating all 25+ players on every finalize would
 * burn tokens on 20+ players whose stats didn't even change tonight.
 * Omit it (the admin-triggered on-demand "Refresh all" button's case)
 * to cover everyone with at least one recorded game in this scope.
 *
 * Never throws — every failure (missing API key, no data, a malformed
 * response, a network error) resolves to `{ ok: false, error }` after
 * logging, rather than rejecting. performFinalize calls this and must
 * never fail or stall because impression generation had a bad day; the
 * admin-triggered on-demand refresh reads the result to show real
 * success/failure feedback instead.
 */
export async function refreshAllPlayerImpressions(args: {
  isSandbox: boolean;
  sourceTournamentId?: string | null;
  playerIds?: string[];
}): Promise<RefreshImpressionsResult> {
  try {
    return await doRefreshAllPlayerImpressions(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("refreshAllPlayerImpressions: unexpected error", err);
    return { ok: false, error: message };
  }
}

async function doRefreshAllPlayerImpressions(args: {
  isSandbox: boolean;
  sourceTournamentId?: string | null;
  playerIds?: string[];
}): Promise<RefreshImpressionsResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const message = "ANTHROPIC_API_KEY is not set";
    console.error(`refreshAllPlayerImpressions: ${message}, skipping`);
    return { ok: false, error: message };
  }

  const supabase = createServiceClient();

  const { data: finished } = await supabase
    .from("tournaments")
    .select(
      "id, template_id, status, finished_at, started_at, buy_in_snapshot, current_level, rebuy_price_snapshot, buyback_config_snapshot",
    )
    .eq("status", "finished")
    .eq("is_sandbox", args.isSandbox)
    .order("finished_at", { ascending: false })
    .limit(TOURNAMENT_LIMIT);

  const tournaments = (finished ?? []) as FinishedTournament[];
  if (tournaments.length === 0) {
    return { ok: false, error: "No finished tournaments to summarize yet" };
  }
  // Falls back to the most recently finished tournament when the caller
  // (an on-demand admin refresh) doesn't have a specific one in hand —
  // this is only ever a record-keeping label, never read back for logic.
  const sourceTournamentId = args.sourceTournamentId ?? tournaments[0].id;

  const tournamentIds = tournaments.map((t) => t.id);

  const [
    { data: rosterData },
    { data: payoutsData },
    { data: rebuyData },
    { data: addOnData },
    { data: snapshotData },
  ] = await Promise.all([
    supabase
      .from("tournament_players")
      .select("*, player:players!tournament_players_player_id_fkey(id, name)")
      .in("tournament_id", tournamentIds),
    supabase
      .from("prize_distributions")
      .select("tournament_id, position, amount, player_id, is_chopped")
      .in("tournament_id", tournamentIds),
    supabase
      .from("tournament_events")
      .select("tournament_id, payload, created_at")
      .in("tournament_id", tournamentIds)
      .eq("type", "rebuy"),
    supabase
      .from("tournament_events")
      .select("tournament_id, payload, created_at")
      .in("tournament_id", tournamentIds)
      .eq("type", "addon"),
    supabase
      .from("tournament_events")
      .select("tournament_id, payload, created_at")
      .in("tournament_id", tournamentIds)
      .eq("type", "chip_snapshot"),
  ]);

  const roster = (rosterData ?? []) as unknown as RosterRow[];
  if (roster.length === 0) {
    return { ok: false, error: "No roster rows to summarize yet" };
  }
  const payouts = (payoutsData ?? []) as PayoutRow[];
  const rebuyEvents = (rebuyData ?? []) as TokenEvent[];
  const addOnEvents = (addOnData ?? []) as TokenEvent[];
  const snapshotEvents = (snapshotData ?? []) as ChipSnapshotEvent[];

  // (tournamentId, playerId) -> chip checkpoints, sorted by level. Same
  // raw shape /history's break-shift stats read from — reused here as
  // literal chip-count-at-level facts rather than a derived ratio, so
  // the model only ever sees numbers that actually happened.
  const checkpointsByKey = new Map<
    string,
    Array<{ levelNum: number; chips: number }>
  >();
  for (const e of snapshotEvents) {
    const p = e.payload as {
      player_id?: unknown;
      level_num?: unknown;
      chips?: unknown;
    } | null;
    const pid = typeof p?.player_id === "string" ? p.player_id : null;
    const levelNum = typeof p?.level_num === "number" ? p.level_num : null;
    const chips = typeof p?.chips === "number" ? p.chips : null;
    if (!pid || levelNum == null || chips == null) continue;
    const key = `${e.tournament_id}:${pid}`;
    const arr = checkpointsByKey.get(key) ?? [];
    arr.push({ levelNum, chips });
    checkpointsByKey.set(key, arr);
  }
  for (const arr of checkpointsByKey.values()) {
    arr.sort((a, b) => a.levelNum - b.levelNum);
  }

  const playerStats = buildPlayerStats({
    tournaments,
    roster,
    payouts,
    rebuyEvents,
    addOnEvents,
  });
  // Narrow to just the requested players (e.g. tonight's roster) before
  // doing any further per-player work — cheaper, and keeps the Claude
  // call's input (and therefore output) scoped to what was asked for.
  const targetIds = args.playerIds ? new Set(args.playerIds) : null;
  const scopedStats = targetIds
    ? playerStats.filter((s) => targetIds.has(s.playerId))
    : playerStats;
  const facts: PlayerFacts[] = scopedStats.map((stats) => {
    const theirRoster = roster.filter((r) => r.player_id === stats.playerId);
    const history = buildPlayerTournamentHistory({
      tournaments,
      roster: theirRoster,
      payouts,
    }).slice(0, RECENT_HISTORY_COUNT);

    return {
      playerId: stats.playerId,
      name: stats.name,
      tournamentsPlayed: stats.tournamentsPlayed,
      wins: stats.wins,
      itmCount: stats.itmCount,
      points: stats.points,
      net: stats.net,
      avgFinish: stats.avgFinish,
      avgBustLevel: stats.avgBustLevel,
      rebuyRate: stats.rebuyRate,
      totalRebuys: stats.totalRebuys,
      totalAddOns: stats.totalAddOns,
      recentHistory: history.map((h) => {
        const checkpoints = checkpointsByKey.get(
          `${h.tournamentId}:${stats.playerId}`,
        );
        return {
          finishedAt: h.finishedAt,
          position: h.position,
          bustedAtLevel: h.bustedAtLevel,
          rebuys: h.rebuys,
          addOns: h.addOns,
          net: h.net,
          ...(checkpoints && checkpoints.length > 0
            ? { chipCheckpoints: checkpoints }
            : {}),
        };
      }),
    };
  });

  if (facts.length === 0) {
    return {
      ok: false,
      error: targetIds
        ? "None of the given players have recorded stats yet"
        : "No players to summarize yet",
    };
  }

  const anthropic = new Anthropic({ apiKey });
  const response = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: JSON.stringify(facts) }],
    output_config: { format: zodOutputFormat(ImpressionsResponseSchema) },
  });

  // `.parse()` throws (caught by the outer wrapper) if the response text
  // doesn't validate against the schema at all — this check catches the
  // milder case where it validated but got cut off before covering every
  // player, which a token-limit truncation could still produce even at
  // MAX_OUTPUT_TOKENS for a large enough roster.
  if (response.stop_reason === "max_tokens") {
    const message = `Claude's response was cut off at the ${MAX_OUTPUT_TOKENS}-token limit`;
    console.error(`refreshAllPlayerImpressions: ${message}`);
    return { ok: false, error: message };
  }
  if (!response.parsed_output) {
    const message = "Claude's response didn't match the expected format";
    console.error(`refreshAllPlayerImpressions: ${message}`);
    return { ok: false, error: message };
  }

  const knownIds = new Set(facts.map((f) => f.playerId));
  const rows = response.parsed_output.impressions
    .filter(
      (entry) => knownIds.has(entry.playerId) && entry.impression.trim().length > 0,
    )
    .map((entry) => ({
      player_id: entry.playerId,
      is_sandbox: args.isSandbox,
      impression: entry.impression.trim(),
      model: MODEL,
      source_tournament_id: sourceTournamentId,
      generated_at: new Date().toISOString(),
    }));

  if (rows.length === 0) {
    const message = "Claude's response had no usable impressions";
    console.error(`refreshAllPlayerImpressions: ${message}`);
    return { ok: false, error: message };
  }

  const { error } = await supabase
    .from("player_impressions")
    .upsert(rows, { onConflict: "player_id,is_sandbox" });
  if (error) {
    console.error("refreshAllPlayerImpressions: upsert failed", error);
    return { ok: false, error: error.message };
  }

  return { ok: true, count: rows.length };
}
