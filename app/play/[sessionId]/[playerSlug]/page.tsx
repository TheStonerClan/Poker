import { notFound, redirect } from "next/navigation";

import { PlayerHome } from "@/components/player/PlayerHome";
import { levelAt, parseBlindLevels } from "@/lib/player/blind-helpers";
import type {
  PrizeConfig,
  PrizeRounding,
  PrizeRule,
} from "@/lib/player/mock-prize-math";
import { computePayouts } from "@/lib/player/mock-prize-math";
import { slugifyPlayerName } from "@/lib/player/slug";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ sessionId: string; playerSlug: string }>;
};

export default async function PlayerHomePage({ params }: Props) {
  const { sessionId, playerSlug } = await params;
  const supabase = await createClient();

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
      "id, player_id, current_chips, busted_at_time, busted_at_level, finishing_position, payout_amount, buyback_used, buyback_used_as, players(name)",
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

  const prizeConfig: PrizeConfig = {
    rules: (tournament.prize_rules_snapshot as PrizeRule[]) ?? [],
    rounding: (tournament.rounding_mode_snapshot as PrizeRounding) ?? {
      increment: 1,
      surplusToFirst: true,
    },
  };

  const payouts = computePayouts(prizeConfig, {
    buyIns,
    buybacks,
    buyInPrice: tournament.buy_in_snapshot,
  });

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
    />
  );
}
