"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

import { presenceChannelName, type PresencePayload } from "./types";

/**
 * Observer-only presence hook used by the name picker. Subscribes to the
 * tournament's claim channel without tracking — so the picker itself does
 * not appear as a claim — and exposes the set of `player_id`s currently
 * held by other tabs. Once a player taps a name, the dedicated
 * `usePlayerClaim` hook takes over for the actual claim.
 */
export function useTournamentPresence(sessionId: string): {
  ready: boolean;
  claimedPlayerIds: Set<string>;
} {
  const [ready, setReady] = useState(false);
  const [claimedPlayerIds, setClaimedPlayerIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(presenceChannelName(sessionId), {
      config: { presence: { key: `observer-${crypto.randomUUID()}` } },
    });

    function refresh() {
      const state = channel.presenceState<PresencePayload>();
      const ids = new Set<string>();
      for (const entries of Object.values(state)) {
        for (const e of entries) {
          if (e?.player_id) ids.add(e.player_id);
        }
      }
      setClaimedPlayerIds(ids);
      setReady(true);
    }

    channel
      .on("presence", { event: "sync" }, refresh)
      .on("presence", { event: "join" }, refresh)
      .on("presence", { event: "leave" }, refresh)
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sessionId]);

  return { ready, claimedPlayerIds };
}
