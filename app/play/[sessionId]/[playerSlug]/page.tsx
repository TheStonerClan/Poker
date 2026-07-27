import { notFound, redirect } from "next/navigation";

import { PlayerHome } from "@/components/player/PlayerHome";
import { levelAt, parseBlindLevels } from "@/lib/player/blind-helpers";
import type { PrizeConfig } from "prize-math";
import { computePayouts } from "prize-math";
import {
  buildPlayerStats,
  type FinishedTournament,
  type PayoutRow,
  type RosterRow,
  type TokenEvent,
} from "@/lib/admin/history-stats";
import { slugifyPlayerName } from "@/lib/player/slug";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ sessionId: string; playerSlug: string }>;
};

export default async function PlayerHomePage({ params }: Props) {
  const { sessionId, playerSlug } = await params;
  // Service-role read for the same reason as the picker page: any phone
  // that scanned the QR can land here, and they don't need to be an
  // admin to see their own slot. Without service role the `players(name)`
  // join is blocked by RLS for anonymous visitors and `me` ends up
  // undefined → redirect-loop back to the picker.
  const supabase = createServiceClient();

  const { data: tournament, error: tErr } = await supabase
    .from("tournaments")
    .select(
      "id, status, current_level, finished_at, buy_in_snapshot, buyback_config_snapshot, prize_rules_snapshot, rounding_mode_snapshot, blind_structure_snapshot, chip_denominations_snapshot, template:tournament_templates(name)",
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (tErr || !tournament) notFound();

  const { data: rosterRows } = await supabase
    .from("tournament_players")
    .select(
      "id, player_id, current_chips, busted_at_time, busted_at_level, finishing_position, payout_amount, buyback_used, buyback_used_as, players!tournament_players_player_id_fkey(name)",
    )
    .eq("tournament_id", sessionId);

  const roster = (rosterRows ?? []).filter(
    (r): r is typeof r & { players: { name: string } } =>
      Boolean(r.players?.name),
  );

  const me = roster.find((r) => slugifyPlayerName(r.players.name) === playerSlug);
  if (!me) {
    redirect(`/play/${sessionId}`);
  }

  // Active = not busted. Position-if-busted-now = current active count.
  const active = roster.filter((r) => !r.busted_at_time);
  const sortedActive = [...active].sort(
    (a, b) => b.current_chips - a.current_chips,
  );
  const myActiveRank =
    sortedActive.findIndex((r) => r.id === me.id) + 1 || null;

  const buyIns = roster.length;
  const buybacks = roster.filter((r) => r.buyback_used).length;

  const blindLevels = parseBlindLevels(
    tournament.blind_structure_snapshot as unknown,
  );
  const currentLevel = levelAt(blindLevels, tournament.current_level);

  // The schema stores prize_rules_snapshot as the FULL PrizeConfig object,
  // but historic tournaments may have a partial snapshot (missing rules,
  // missing rounding, etc.) and we don't want a render-time crash on the
  // player view to take the page down. Build a defensive PrizeConfig and
  // wrap the actual computation in try/catch.
  const rawPrize = tournament.prize_rules_snapshot as
    | Record<string, unknown>
    | null;
  const prizeConfig: PrizeConfig = {
    rules: Array.isArray(rawPrize?.rules)
      ? (rawPrize.rules as PrizeConfig["rules"])
      : [],
    rounding:
      (rawPrize?.rounding as PrizeConfig["rounding"] | undefined) ?? {
        increment: 1,
        surplusToFirst: true,
      },
    guarantee:
      typeof rawPrize?.guarantee === "number" ? rawPrize.guarantee : undefined,
    overlay:
      typeof rawPrize?.overlay === "boolean" ? rawPrize.overlay : undefined,
  };

  let payouts: ReturnType<typeof computePayouts>;
  try {
    payouts = computePayouts(prizeConfig, {
      buyIns,
      buybacks,
      buyInPrice: tournament.buy_in_snapshot,
    });
  } catch {
    // Bad snapshot shape → render with zero payouts rather than 500-ing
    // the player view. The "Stats" tab still works; only "Position if
    // bust → $X" loses meaning, which is acceptable for a degraded
    // mode. Surface a hint in dev via console.
    if (process.env.NODE_ENV !== "production") {
      console.warn("computePayouts failed for player view", { rawPrize });
    }
    payouts = { payouts: [], effectivePool: 0, remainder: 0, overlay: 0 };
  }

  // Position if you bust next: you're the next to fall, so you finish at
  // the current active count.
  const positionIfBust = me.busted_at_time
    ? me.finishing_position
    : active.length;
  const payoutIfBust = positionIfBust
    ? (payouts.payouts.find((p) => p.position === positionIfBust)?.amount ?? 0)
    : 0;

  const tournamentName =
    (tournament.template as { name?: string } | null)?.name ?? "Tournament";

  const chipDenoms = Array.isArray(tournament.chip_denominations_snapshot)
    ? (tournament.chip_denominations_snapshot as Array<{
        color: string;
        value: number;
      }>)
    : [];

  // ─── Player history (all-time, finished tournaments only) ──────────────
  //
  // Build a per-player aggregate plus a list of recent results to show on
  // the new "History" tab. Reuses the same buildPlayerStats helper the
  // public /history page uses so the numbers stay consistent. We cap at
  // the most recent 60 finished tournaments — that's well past any
  // reasonable league season and keeps the payload small.
  //
  // Errors here degrade gracefully: if any fetch fails, history is null
  // and the tab shows an empty state. The current-tournament view (the
  // primary surface) never depends on history loading.
  const history = await loadPlayerHistory(supabase, me.player_id).catch(() => null);

  return (
    <PlayerHome
      sessionId={sessionId}
      tournamentName={tournamentName}
      tournamentFinishedAt={tournament.finished_at}
      player={{
        playerId: me.player_id,
        name: me.players.name,
        slug: playerSlug,
        currentChips: me.current_chips,
        bustedAtTime: me.busted_at_time,
        bustedAtLevel: me.busted_at_level,
        finishingPosition: me.finishing_position,
        payoutAmount: me.payout_amount,
        buybackUsed: me.buyback_used,
        buybackUsedAs: me.buyback_used_as,
      }}
      stats={{
        bigBlind: currentLevel?.bigBlind ?? null,
        smallBlind: currentLevel?.smallBlind ?? null,
        ante: currentLevel?.ante ?? null,
        currentLevelNum: tournament.current_level,
        isBreak: Boolean(currentLevel?.isBreak),
        activeCount: active.length,
        myActiveRank,
        positionIfBust,
        payoutIfBust,
        prizePool: payouts.effectivePool,
      }}
      colorUp={{
        chipDenominations: chipDenoms,
        currentColorUp: currentLevel?.colorUp ?? [],
      }}
      history={history}
    />
  );
}

/**
 * Compute the player's all-time history. Cap at the most recent 60
 * finished tournaments — well past any reasonable league season,
 * small enough to ship over the wire and aggregate client-side.
 *
 * Returns null only when the player has never played a finished
 * tournament, so the UI can show an empty state with a clear message
 * rather than zeroes everywhere.
 */
async function loadPlayerHistory(
  supabase: ReturnType<typeof createServiceClient>,
  playerId: string,
) {
  const { data: finished } = await supabase
    .from("tournaments")
    .select(
      "id, template_id, finished_at, started_at, buy_in_snapshot, current_level, rebuy_price_snapshot, buyback_config_snapshot, template:tournament_templates(name)",
    )
    .eq("status", "finished")
    .order("finished_at", { ascending: false })
    .limit(60);

  const tournaments = (finished ?? []) as Array<
    FinishedTournament & {
      template: { name?: string } | null;
    }
  >;
  if (tournaments.length === 0) return null;

  const tournamentIds = tournaments.map((t) => t.id);

  // Just THIS player's rows; saves pulling everyone else's history.
  const { data: rosterData } = await supabase
    .from("tournament_players")
    .select("*, player:players!tournament_players_player_id_fkey(id, name)")
    .eq("player_id", playerId)
    .in("tournament_id", tournamentIds);
  const roster = (rosterData ?? []) as unknown as RosterRow[];
  if (roster.length === 0) return null;

  const { data: payoutsData } = await supabase
    .from("prize_distributions")
    .select("tournament_id, position, amount, player_id, is_chopped")
    .eq("player_id", playerId)
    .in("tournament_id", tournamentIds);
  const payouts = (payoutsData ?? []) as PayoutRow[];

  // Events store player_id inside the JSON payload, not as a column,
  // so we have to pull all rebuy/addon events for the tournaments
  // this player was in and filter in JS. Volume is small.
  const playedTournamentIds = roster.map((r) => r.tournament_id);
  const { data: rebuyData } = await supabase
    .from("tournament_events")
    .select("tournament_id, payload, created_at")
    .eq("type", "rebuy")
    .in("tournament_id", playedTournamentIds);
  const { data: addOnData } = await supabase
    .from("tournament_events")
    .select("tournament_id, payload, created_at")
    .eq("type", "addon")
    .in("tournament_id", playedTournamentIds);

  // Supabase types payload as `Json` (any), but buildPlayerStats reads
  // `payload?.player_id` defensively. Cast through to TokenEvent[] after
  // checking the player_id matches — the rest of the shape is fine.
  const matchesPlayer = (e: { payload: unknown }) => {
    const p = e.payload as { player_id?: unknown } | null;
    return typeof p?.player_id === "string" && p.player_id === playerId;
  };
  const rebuyEvents = (rebuyData ?? []).filter(matchesPlayer) as unknown as TokenEvent[];
  const addOnEvents = (addOnData ?? []).filter(matchesPlayer) as unknown as TokenEvent[];

  const stats = buildPlayerStats({
    tournaments,
    roster,
    payouts,
    rebuyEvents,
    addOnEvents,
  });
  const mine = stats.find((s) => s.playerId === playerId);
  if (!mine) return null;

  // Recent results: walk the player's roster rows in tournaments-DESC
  // order so the most recent finishes lead the list. Pick five.
  const tournamentById = new Map(tournaments.map((t) => [t.id, t]));
  const payoutByTournament = new Map(
    payouts.map((p) => [p.tournament_id, p.amount]),
  );
  const myRosterById = new Map(roster.map((r) => [r.tournament_id, r]));
  const recent = tournamentIds
    .filter((id) => myRosterById.has(id))
    .slice(0, 5)
    .map((id) => {
      const t = tournamentById.get(id)!;
      const r = myRosterById.get(id)!;
      return {
        tournamentId: id,
        finishedAt: t.finished_at,
        templateName: t.template?.name ?? "Tournament",
        finishingPosition: r.finishing_position,
        payoutAmount: payoutByTournament.get(id) ?? 0,
        bustedAtLevel: r.busted_at_level,
      };
    });

  // `bestFinish` (lowest finishing_position) isn't on PlayerStatsRow —
  // compute it inline from the roster, which is already this player's.
  let bestFinish: number | null = null;
  for (const r of roster) {
    if (r.finishing_position == null) continue;
    if (bestFinish == null || r.finishing_position < bestFinish) {
      bestFinish = r.finishing_position;
    }
  }

  return {
    tournamentsPlayed: mine.tournamentsPlayed,
    wins: mine.wins,
    itmCount: mine.itmCount,
    bestFinish,
    avgFinish: mine.avgFinish,
    grossWinnings: mine.grossWinnings,
    costBasis: mine.costBasis,
    net: mine.net,
    avgBustLevel: mine.avgBustLevel,
    avgRebuyLevel: mine.avgRebuyLevel,
    totalRebuys: mine.totalRebuys,
    totalAddOns: mine.totalAddOns,
    rebuyRate: mine.rebuyRate,
    recent,
  };
}
