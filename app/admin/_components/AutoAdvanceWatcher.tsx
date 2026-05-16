"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useDriftSync } from "@/lib/timer/useDriftSync";
import { useLevelClock } from "@/lib/timer/useLevelClock";
import { getLevel, parseLevels } from "@/lib/tv/levels";

/**
 * Headless companion to the TV's auto-advance effect. The TV is the
 * primary trigger source for `/api/tv/[tournamentId]/auto-advance`,
 * but it's only reliable when a TV browser tab is actually loaded and
 * the device hasn't backgrounded — phones lock, tabs sleep, networks
 * drop. The admin's phone is the most reliable client during a game
 * (they're using the app continuously), so mounting this watcher on
 * the admin pages gives auto-advance a second client to retry from.
 *
 * The endpoint is server-validated and idempotent (CAS on
 * current_level) — even if both the TV and admin fire at the same
 * instant, only the first lands the write. No coordination needed.
 *
 * No UI; returns null. Mount inside server-rendered pages that show a
 * running tournament.
 */
type TournamentSnapshot = {
  id: string;
  status: string;
  current_level: number;
  level_started_at: string | null;
  level_paused_at: string | null;
  accumulated_pause_ms: number | null;
  blind_structure_snapshot: unknown;
};

export function AutoAdvanceWatcher({
  tournament: initial,
}: {
  tournament: TournamentSnapshot;
}) {
  const [tournament, setTournament] = useState<TournamentSnapshot>(initial);

  const onTournament = useCallback((row: Record<string, unknown>) => {
    setTournament((prev) => ({ ...prev, ...(row as Partial<TournamentSnapshot>) }));
  }, []);
  // Roster updates aren't relevant to the auto-advance decision; the
  // hook still needs the callback so realtime player events don't blow
  // up the channel subscription.
  const onPlayers = useCallback(() => {}, []);

  useDriftSync({ tournamentId: tournament.id, onTournament, onPlayers });

  const levels = parseLevels(tournament.blind_structure_snapshot);
  const currentLevel = getLevel(levels, tournament.current_level);
  const durationSec = currentLevel?.duration_sec ?? 0;

  const clock = useLevelClock({
    status: tournament.status,
    durationSec,
    levelStartedAt: tournament.level_started_at,
    levelPausedAt: tournament.level_paused_at,
    accumulatedPauseMs: tournament.accumulated_pause_ms ?? 0,
  });

  // Same conditions as TvDisplay's auto-advance effect (see
  // components/tv/TvDisplay.tsx). Keep them aligned — the server
  // enforces them too, so divergence here just means more no-op
  // requests, never wrong behavior.
  const autoAdvanceRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !currentLevel ||
      currentLevel.is_break ||
      tournament.status !== "running" ||
      clock.isPaused ||
      clock.remainingSec > 0 ||
      durationSec <= 0
    ) {
      return;
    }
    const key = `${currentLevel.level_num}:${tournament.level_started_at ?? ""}`;
    if (autoAdvanceRef.current === key) return;
    autoAdvanceRef.current = key;

    fetch(`/api/tv/${tournament.id}/auto-advance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedLevel: currentLevel.level_num }),
      cache: "no-store",
    }).catch(() => {
      // Network blip — clear so the next drift-sync re-render gets a
      // fresh chance to fire.
      autoAdvanceRef.current = null;
    });
  }, [
    tournament.id,
    tournament.status,
    tournament.level_started_at,
    currentLevel,
    clock.remainingSec,
    clock.isPaused,
    durationSec,
  ]);

  return null;
}
