"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

export type DriftSyncOptions = {
  tournamentId: string;
  intervalMs?: number;
  onTournament: (row: Record<string, unknown>) => void;
  onPlayers: () => void;
};

/**
 * Realtime + periodic drift sync for the TV display.
 *
 * Channels:
 *
 * - `tournaments` UPDATE — level / status / timer changes.
 * - `tournament_players` * (INSERT/UPDATE/DELETE) — counts, chips,
 *   table assignments, busts, rebuys, color-up exchanges.
 * - `tournament_events` INSERT — bust / rebuy / addon / merge / balance
 *   admin actions all write here. Each insert triggers an `onPlayers`
 *   refetch, which catches the cases where Supabase realtime is slow
 *   to deliver the matching `tournament_players` row updates (multi-
 *   row admin actions like Merge can get batched on the wire and
 *   appear to "drop" until the next poll).
 *
 * Falls back to a `intervalMs` (default 3s) drift poll for both the
 * tournament and the player list, in case realtime drops a message
 * entirely. Tightened from 5s → 3s after the user reported having to
 * hard-refresh the TV after a merge — three layers of belt-and-
 * suspenders so screen state never lags by more than a few seconds.
 */
export function useDriftSync({
  tournamentId,
  intervalMs = 3000,
  onTournament,
  onPlayers,
}: DriftSyncOptions): void {
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`tv:${tournamentId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tournaments",
          filter: `id=eq.${tournamentId}`,
        },
        (payload) => {
          if (payload.new) onTournament(payload.new as Record<string, unknown>);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tournament_players",
          filter: `tournament_id=eq.${tournamentId}`,
        },
        () => {
          onPlayers();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tournament_events",
          filter: `tournament_id=eq.${tournamentId}`,
        },
        () => {
          // Admin actions (bust, rebuy, addon, merge, balance, finalize)
          // all write at least one event. Refetching on the event delivers
          // the visible state change even when the matching row updates
          // get batched or delayed by realtime.
          onPlayers();
        },
      )
      .subscribe();

    const id = window.setInterval(async () => {
      const { data } = await supabase
        .from("tournaments")
        .select("*")
        .eq("id", tournamentId)
        .maybeSingle();
      if (data) onTournament(data as unknown as Record<string, unknown>);
      onPlayers();
    }, intervalMs);

    return () => {
      window.clearInterval(id);
      supabase.removeChannel(channel);
    };
  }, [tournamentId, intervalMs, onTournament, onPlayers]);
}
