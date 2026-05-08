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
 * - Subscribes to UPDATE on `tournaments` (for level/status/timer changes)
 *   and INSERT/UPDATE/DELETE on `tournament_players` (for counts and chips).
 * - Every `intervalMs` (default 5s), polls the latest `tournaments` row to
 *   correct any clock drift if a realtime event was missed.
 */
export function useDriftSync({
  tournamentId,
  intervalMs = 5000,
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
