import "server-only";

import Anthropic from "@anthropic-ai/sdk";

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

const MODEL = "claude-sonnet-5";
const TOURNAMENT_LIMIT = 60;
const RECENT_HISTORY_COUNT = 3;

const SYSTEM_PROMPT = `You write extremely short "post-tournament impression" blurbs for a home poker league's public stats page.

You will receive a JSON array of players, each with verified stats and recent tournament history pulled straight from the league's database. For each player, write ONE blurb (2 sentences max, under ~50 words) using ONLY the facts given in that player's own data — never invent, estimate, or embellish a specific number, date, level, or event that isn't present. A warm, lightly playful recap-writer tone is good; unverifiable claims about mindset, feelings, or intent are not.

If a player has very little data (0-1 recorded tournaments), keep the blurb brief and don't overstate what one data point means.

Some tournaments in a player's recentHistory include a "chipCheckpoints" list — their reported chip count at specific levels that night, in order. When present, you may describe their stack trajectory (e.g., built an early lead before fading, or ground up from a short stack) using only those exact chip counts and levels. Most tournaments won't have this — never imply a trajectory for one that doesn't.

Respond with ONLY a JSON array, no markdown fences, no commentary, one entry per player in the input, same order:
[{"playerId": "...", "impression": "..."}, ...]`;

type PlayerFacts = {
  playerId: string;
  name: string;
  tournamentsPlayed: number;
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

/**
 * Regenerate every player's "post-tournament impression" blurb for one
 * scope (real league or sandbox — never mixed), in a single batched
 * Claude call rather than one call per player. Batching keeps this
 * fast and cheap even as the roster grows, and lets the model see the
 * whole field at once (useful context for anything relative, like who
 * else is on a streak) without actually asking it to compare players
 * against each other in the output.
 *
 * Always "all time" for the scope — impressions are a standing
 * synopsis of the relationship, not scoped to whatever range filter a
 * viewer happens to have picked on the profile page.
 *
 * Never throws in a way the caller needs to handle specially: a
 * missing API key, a malformed response, or a network failure all
 * just log and return. Called from performFinalize, which must never
 * fail or stall because impression generation had a bad day.
 */
export async function refreshAllPlayerImpressions(args: {
  isSandbox: boolean;
  sourceTournamentId: string;
}): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "refreshAllPlayerImpressions: ANTHROPIC_API_KEY is not set, skipping",
    );
    return;
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
  if (tournaments.length === 0) return;

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
  if (roster.length === 0) return;
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
  const facts: PlayerFacts[] = playerStats.map((stats) => {
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

  if (facts.length === 0) return;

  const anthropic = new Anthropic({ apiKey });
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: JSON.stringify(facts) }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    console.error("refreshAllPlayerImpressions: no text block in response");
    return;
  }

  // Strip a markdown fence defensively in case the model wraps the JSON
  // despite being told not to.
  const raw = textBlock.text.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("refreshAllPlayerImpressions: failed to parse JSON", err, raw);
    return;
  }
  if (!Array.isArray(parsed)) {
    console.error("refreshAllPlayerImpressions: response was not an array");
    return;
  }

  const knownIds = new Set(facts.map((f) => f.playerId));
  const rows = parsed
    .filter(
      (entry): entry is { playerId: string; impression: string } =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { playerId?: unknown }).playerId === "string" &&
        knownIds.has((entry as { playerId: string }).playerId) &&
        typeof (entry as { impression?: unknown }).impression === "string" &&
        (entry as { impression: string }).impression.trim().length > 0,
    )
    .map((entry) => ({
      player_id: entry.playerId,
      is_sandbox: args.isSandbox,
      impression: entry.impression.trim(),
      model: MODEL,
      source_tournament_id: args.sourceTournamentId,
      generated_at: new Date().toISOString(),
    }));

  if (rows.length === 0) {
    console.error("refreshAllPlayerImpressions: no valid rows to write");
    return;
  }

  const { error } = await supabase
    .from("player_impressions")
    .upsert(rows, { onConflict: "player_id,is_sandbox" });
  if (error) {
    console.error("refreshAllPlayerImpressions: upsert failed", error);
  }
}
