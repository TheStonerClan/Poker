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
  initialEvents?: TournamentEvent[];
  playSessionBaseUrl: string;
};

type TournamentEvent = {
  type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export default function TvDisplay({
  tournamentId,
  initialTournament,
  initialPlayers,
  initialEvents = [],
  playSessionBaseUrl,
}: Props) {
  const [tournament, setTournament] = useState<TournamentRow>(initialTournament);
  const [players, setPlayers] = useState<TournamentPlayerWithName[]>(initialPlayers);
  const [events, setEvents] = useState<TournamentEvent[]>(initialEvents);

  const onTournament = useCallback((row: Record<string, unknown>) => {
    setTournament((prev) => ({ ...prev, ...(row as TournamentRow) }));
  }, []);

  const onPlayers = useCallback(async () => {
    try {
      const res = await fetch(`/api/tv/${tournamentId}/players`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as {
        players?: TournamentPlayerWithName[];
        events?: TournamentEvent[];
      };
      if (json.players) setPlayers(json.players);
      if (json.events) setEvents(json.events);
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

  // Bust list for the previous segment, derived from `tournament_events`
  // rather than `tournament_players`. The latter clears `busted_at_time`
  // on rebuy, which would mask the original bust from the segment count;
  // events are append-only and survive rebuys correctly.
  //
  // "Last segment" = since the most recent break_start (or break_end —
  // whichever is later). Falls back to "all busts so far" when there's
  // been no break yet.
  const lastSegmentBoundary = (() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === "break_start" || e.type === "break_end") {
        return new Date(e.created_at).getTime();
      }
    }
    return 0;
  })();

  const playerNameById = new Map(
    players
      .filter((p) => p.players?.name)
      .map((p) => [p.player_id, p.players?.name ?? ""]),
  );
  const playerStateById = new Map(
    players.map((p) => [p.player_id, p]),
  );

  const lastSegmentBusted = isBreak
    ? events
        .filter(
          (e) =>
            e.type === "bust" &&
            new Date(e.created_at).getTime() >= lastSegmentBoundary,
        )
        .slice(-12)
        .reverse()
        .map((e) => {
          const playerId = (e.payload?.player_id as string | undefined) ?? null;
          const atLevel =
            (e.payload?.at_level as number | undefined | null) ?? null;
          const player = playerId ? playerStateById.get(playerId) : undefined;
          // "Rebought" reflects the player's CURRENT state — they busted in
          // this segment but may have rebought since. Useful info on the
          // break panel without losing the bust from the count.
          const rebought = !!(
            player?.buyback_used && player.buyback_used_as === "rebuy"
          );
          return {
            name:
              (playerId ? playerNameById.get(playerId) : null) ??
              "Unknown",
            level: atLevel,
            rebought,
          };
        })
    : [];

  // Show the add-ons counter once the add-on break has either started or
  // passed (per the buyback config). Before then it'd just read zero and
  // crowd the header. After then it stays visible so admin / players can
  // see how many add-ons were used at a glance.
  const showAddOns =
    typeof buyback.addOnAtBreakLevel === "number" &&
    (currentLevel?.level_num ?? 0) >= buyback.addOnAtBreakLevel;

  return (
    <div className="min-h-screen bg-bg text-fg flex flex-col">
      {/* TOP BAND */}
      <header className="grid grid-cols-2 items-center px-[clamp(1rem,3vw,3rem)] pt-[clamp(0.75rem,2vh,2rem)] pb-[clamp(0.5rem,1.5vh,1.5rem)]">
        <PlayerHeader counts={counts} showAddOns={showAddOns} />
        <div className="justify-self-end">
          <BlindLevel level={currentLevel} align="right" />
        </div>
      </header>

      <hr className="border-t border-gold/40 mx-[clamp(0.5rem,2vw,2rem)]" />

      {/* MIDDLE BAND */}
      <main className="flex-1 grid grid-cols-[1fr_auto_1fr] items-center px-[clamp(1rem,3vw,3rem)] py-[clamp(0.75rem,2vh,2rem)] gap-[clamp(0.75rem,2vw,2rem)]">
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

      <hr className="border-t border-gold/40 mx-[clamp(0.5rem,2vw,2rem)]" />

      {/* BOTTOM BAND */}
      <footer className="grid grid-cols-3 items-end px-[clamp(1rem,3vw,3rem)] pt-[clamp(0.5rem,1.5vh,1.5rem)] pb-[clamp(0.5rem,1vh,1rem)] gap-[clamp(0.75rem,2vw,2rem)]">
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
