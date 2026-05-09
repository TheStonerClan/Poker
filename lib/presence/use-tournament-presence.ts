"use client";

import { useEffect, useState } from "react";

import { safeRandomId } from "@/lib/safe-uuid";
import { createClient } from "@/lib/supabase/client";

import { presenceChannelName, type PresencePayload } from "./types";

/**
 * Observer-only presence hook used by the name picker. Subscribes to the
 * tournament's claim channel without tracking — so the picker itself does
 * not appear as a claim — and exposes the set of `player_id`s currently
 * held by other tabs. Once a player taps a name, the dedicated
 * `usePlayerClaim` hook takes over for the actual claim.
 *
 * `enabled` is critical: supabase-js v2 dedupes channels by name on a
 * single client, so if this observer subscribes to the same topic that
 * `usePlayerClaim` is about to subscribe to, the second hook sees an
 * already-`joined` channel and throws "cannot add presence callbacks for
 * realtime:... after 'subscribe()'". The picker UI flips `enabled` to
 * `false` the moment the user taps a name; this hook tears down its
 * channel synchronously, freeing the topic for `usePlayerClaim` to
 * create a fresh subscription.
 */
export function useTournamentPresence(
  sessionId: string,
  options?: { enabled?: boolean },
): {
  ready: boolean;
  claimedPlayerIds: Set<string>;
} {
  const enabled = options?.enabled ?? true;
  const [ready, setReady] = useState(false);
  const [claimedPlayerIds, setClaimedPlayerIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    if (!enabled) {
      // When disabled, surface the picker as "ready" with an empty
      // claimed-set so the UI doesn't sit on a "Connecting…" spinner.
      // The observer was either never started or was just torn down by
      // an earlier cleanup, and `usePlayerClaim` now owns the channel.
      setReady(true);
      setClaimedPlayerIds(new Set());
      return;
    }

    const supabase = createClient();
    const channel = supabase.channel(presenceChannelName(sessionId), {
      config: { presence: { key: `observer-${safeRandomId()}` } },
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
      // removeChannel removes the channel from the client's internal
      // map synchronously (the unsubscribe is sent over the wire async,
      // but the LOCAL slot frees immediately), so the next
      // `supabase.channel(name)` call from usePlayerClaim returns a
      // fresh instance — safe to .on() before .subscribe().
      void supabase.removeChannel(channel);
    };
  }, [sessionId, enabled]);

  return { ready, claimedPlayerIds };
}
