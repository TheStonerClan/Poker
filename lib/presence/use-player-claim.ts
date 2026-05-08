"use client";

import { useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

import { getOrCreateAnonSession } from "./anon-session";
import { presenceChannelName, type PresencePayload } from "./types";

export type ClaimStatus = "idle" | "claimed" | "lost" | "error";

/**
 * Hold a presence claim on `player_id` for the lifetime of this hook.
 *
 * Conflict resolution: if two tabs `track()` the same `player_id`, the one
 * with the *earlier* `claimed_at` wins (with `anon_session` as a
 * deterministic tiebreaker). The losing tab `untrack`s itself and reports
 * `status: "lost"` so the UI can bounce back to the picker.
 *
 * Tab-close behavior: `pagehide` and `beforeunload` proactively `untrack`
 * so the slot frees instantly on the happy path. If the browser drops the
 * connection without firing those (iOS Safari background, network drop),
 * Supabase Realtime expires the presence after its heartbeat timeout
 * (~30 s by default) and the slot becomes available again.
 */
export function usePlayerClaim(
  sessionId: string,
  playerId: string | null,
): {
  status: ClaimStatus;
} {
  const [status, setStatus] = useState<ClaimStatus>("idle");
  const lostRef = useRef(false);

  useEffect(() => {
    if (!playerId) return;
    lostRef.current = false;

    const supabase = createClient();
    const anon = getOrCreateAnonSession();
    const claimedAt = new Date().toISOString();

    const channel = supabase.channel(presenceChannelName(sessionId), {
      config: { presence: { key: anon } },
    });

    function evaluate() {
      if (lostRef.current) return;
      const state = channel.presenceState<PresencePayload>();
      let mineFound = false;
      let lost = false;
      for (const [key, entries] of Object.entries(state)) {
        for (const entry of entries) {
          if (entry?.player_id !== playerId) continue;
          if (key === anon) {
            mineFound = true;
            continue;
          }
          // Another tab is also holding this player_id. Earlier claim wins;
          // identical timestamps fall back to lexicographic anon_session.
          const otherWins =
            entry.claimed_at < claimedAt ||
            (entry.claimed_at === claimedAt && key < anon);
          if (otherWins) lost = true;
        }
      }
      if (lost) {
        lostRef.current = true;
        void channel.untrack();
        setStatus("lost");
      } else if (mineFound) {
        setStatus("claimed");
      }
    }

    channel
      .on("presence", { event: "sync" }, evaluate)
      .on("presence", { event: "join" }, evaluate)
      .on("presence", { event: "leave" }, evaluate)
      .subscribe(async (s) => {
        if (s === "SUBSCRIBED") {
          await channel.track({
            player_id: playerId,
            anon_session: anon,
            claimed_at: claimedAt,
          } satisfies PresencePayload);
        } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
          if (!lostRef.current) setStatus("error");
        }
      });

    function release() {
      void channel.untrack();
    }

    window.addEventListener("pagehide", release);
    window.addEventListener("beforeunload", release);

    return () => {
      window.removeEventListener("pagehide", release);
      window.removeEventListener("beforeunload", release);
      void channel.untrack();
      void supabase.removeChannel(channel);
    };
  }, [sessionId, playerId]);

  return { status };
}
