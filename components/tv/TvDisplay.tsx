"use client";

import { QRCodeSVG } from "qrcode.react";
import { useCallback, useState } from "react";

import BlindLevel from "@/components/tv/BlindLevel";
import BottomBanner from "@/components/tv/BottomBanner";
import BreakPanel from "@/components/tv/BreakPanel";
import ChipStack from "@/components/tv/ChipStack";
import ClockRing from "@/components/tv/ClockRing";
import NextLevel from "@/components/tv/NextLevel";
import { PlayerHeader, StackStats } from "@/components/tv/PlayerStats";
import PrizePool from "@/components/tv/PrizePool";
import { useDriftSync } from "@/lib/timer/useDriftSync";
import { useLevelClock } from "@/lib/timer/useLevelClock";
import { aggregatePlayers } from "@/lib/tv/aggregate";
import {
  getLevel,
  getNextPlayingLevel,
  parseLevels,
  secondsUntilNextBreak,
} from "@/lib/tv/levels";
import { computePayouts, computePool } from "@/lib/tv/prize";
import type {
  BuybackConfig,
  ChipDenomination,
  PrizeRules,
  TournamentPlayerWithName,
  TournamentRow,
} from "@/lib/tv/types";

type Props = {
  tournamentId: string;
  initialTournament: TournamentRow;
  initialPlayers: TournamentPlayerWithName[];
  playSessionBaseUrl: string;
};

export default function TvDisplay({
  tournamentId,
  initialTournament,
  initialPlayers,
  playSessionBaseUrl,
}: Props) {
  const [tournament, setTournament] = useState<TournamentRow>(initialTournament);
  const [players, setPlayers] = useState<TournamentPlayerWithName[]>(initialPlayers);

  const onTournament = useCallback((row: Record<string, unknown>) => {
    setTournament((prev) => ({ ...prev, ...(row as TournamentRow) }));
  }, []);

  const onPlayers = useCallback(async () => {
    try {
      const res = await fetch(`/api/tv/${tournamentId}/players`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as { players?: TournamentPlayerWithName[] };
      if (json.players) setPlayers(json.players);
    } catch {
      // Network blip during a refresh — keep the previous snapshot. The
      // realtime channel or the next 5s drift sync will retry.
    }
  }, [tournamentId]);

  useDriftSync({ tournamentId, onTournament, onPlayers });

  const levels = parseLevels(tournament.blind_structure_snapshot);
  const currentLevel = getLevel(levels, tournament.current_level);
  const nextPlayingLevel = currentLevel
    ? getNextPlayingLevel(levels, currentLevel.level_num)
    : null;

  const durationSec = currentLevel?.duration_sec ?? 0;

  const clock = useLevelClock({
    status: tournament.status,
    durationSec,
    levelStartedAt: tournament.level_started_at,
    levelPausedAt: tournament.level_paused_at,
    accumulatedPauseMs: tournament.accumulated_pause_ms ?? 0,
  });

  const counts = aggregatePlayers(players);

  const buyback = (tournament.buyback_config_snapshot ?? {}) as BuybackConfig;
  const buybackPrice = buyback.price ?? tournament.rebuy_price_snapshot ?? 0;
  const totalBuybacks = counts.reEntries + counts.addOns;

  const prizeRules = tournament.prize_rules_snapshot as unknown as PrizeRules;
  const rawPool = computePool({
    buyIn: tournament.buy_in_snapshot,
    buybackPrice,
    entries: counts.entries,
    buybacks: totalBuybacks,
  });
  const { payouts, effectivePool } = computePayouts(prizeRules, rawPool);

  const denominations =
    (tournament.chip_denominations_snapshot as unknown as ChipDenomination[]) ?? [];

  const isBreak = currentLevel?.is_break ?? false;
  const colorUpActive = isBreak && (currentLevel?.color_up_chips?.length ?? 0) > 0;

  const nextBreakSec = currentLevel
    ? secondsUntilNextBreak(levels, currentLevel.level_num, clock.remainingSec)
    : null;

  const bannerText = bannerFor({
    isBreak,
    nextBreakSec,
    rebuyAllowedThroughLevel: buyback.rebuyAllowedThroughLevel,
    addOnAtBreakLevel: buyback.addOnAtBreakLevel,
    currentLevelNum: currentLevel?.level_num ?? 0,
    isAddOnBreak:
      isBreak && currentLevel?.level_num === buyback.addOnAtBreakLevel,
  });

  // Bust list for the previous segment (since the most recent break_end
  // event isn't readily available, fall back to "all bust-outs at or below
  // the just-completed level"). Good enough for the TV during the break.
  const lastSegmentBusted = isBreak
    ? players
        .filter((p) => p.busted_at_time != null)
        .sort((a, b) => {
          const at = new Date(a.busted_at_time ?? 0).getTime();
          const bt = new Date(b.busted_at_time ?? 0).getTime();
          return bt - at;
        })
        .slice(0, 12)
        .map((p) => ({
          name: p.players?.name ?? `Seat ${p.seat_number ?? "?"}`,
          level: p.busted_at_level,
          rebought: p.buyback_used && p.buyback_used_as === "rebuy",
        }))
    : [];

  return (
    <div className="min-h-screen bg-bg text-fg flex flex-col">
      {/* TOP BAND */}
      <header className="grid grid-cols-2 items-center px-12 pt-8 pb-6">
        <PlayerHeader counts={counts} />
        <div className="justify-self-end">
          <BlindLevel level={currentLevel} align="right" />
        </div>
      </header>

      <hr className="border-t border-gold/40 mx-8" />

      {/* MIDDLE BAND */}
      <main className="flex-1 grid grid-cols-[1fr_auto_1fr] items-center px-12 py-8 gap-8">
        <div className="self-center justify-self-start">
          <ChipStack denominations={denominations} />
        </div>

        <div className="justify-self-center">
          {isBreak && currentLevel ? (
            <BreakPanel
              remainingSec={clock.remainingSec}
              level={currentLevel}
              nextLevel={nextPlayingLevel}
              busted={lastSegmentBusted}
            />
          ) : (
            <ClockRing
              levelLabel={`Level ${tournament.current_level || 1}`}
              remainingSec={clock.remainingSec}
              durationSec={durationSec}
              nextBreakSec={nextBreakSec}
              paused={clock.isPaused}
            />
          )}
        </div>

        <div className="self-center justify-self-end">
          <PrizePool totalPool={effectivePool} payouts={payouts} />
        </div>
      </main>

      <hr className="border-t border-gold/40 mx-8" />

      {/* BOTTOM BAND */}
      <footer className="grid grid-cols-3 items-end px-12 pt-6 pb-4 gap-8">
        <StackStats counts={counts} bigBlind={currentLevel?.big} />

        <div className="justify-self-center">
          <BottomBanner text={bannerText} />
        </div>

        <div className="justify-self-end flex items-end gap-6">
          {colorUpActive ? (
            <div className="flex flex-col items-center gap-1">
              <div className="bg-white p-2 rounded">
                <QRCodeSVG
                  value={`${playSessionBaseUrl}/${tournamentId}`}
                  size={88}
                  level="M"
                />
              </div>
              <span className="text-label uppercase tracking-[0.25em] text-[10px]">
                Color-up
              </span>
            </div>
          ) : null}
          <NextLevel next={nextPlayingLevel} />
        </div>
      </footer>
    </div>
  );
}

function bannerFor(args: {
  isBreak: boolean;
  nextBreakSec: number | null;
  rebuyAllowedThroughLevel?: number;
  addOnAtBreakLevel?: number;
  currentLevelNum: number;
  isAddOnBreak: boolean;
}): string {
  if (args.isBreak) {
    if (args.isAddOnBreak) return "L8 add-on available — see admin";
    return "Break — players, stretch your legs";
  }
  if (
    args.rebuyAllowedThroughLevel &&
    args.currentLevelNum > 0 &&
    args.currentLevelNum <= args.rebuyAllowedThroughLevel
  ) {
    return `(Re-)Entry until the end of Level ${args.rebuyAllowedThroughLevel}`;
  }
  if (args.addOnAtBreakLevel) {
    return `Next add-on opportunity: Level ${args.addOnAtBreakLevel} break`;
  }
  return "";
}
