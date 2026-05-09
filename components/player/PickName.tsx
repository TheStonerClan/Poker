"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { usePlayerClaim, useTournamentPresence } from "@/lib/presence";

export type PickNameRosterEntry = {
  tournamentPlayerId: string;
  playerId: string;
  name: string;
  slug: string;
  busted: boolean;
  currentChips: number;
};

type Props = {
  sessionId: string;
  roster: PickNameRosterEntry[];
};

export function PickName({ sessionId, roster }: Props) {
  const router = useRouter();
  const [attempting, setAttempting] = useState<PickNameRosterEntry | null>(
    null,
  );
  // Disable the observer the moment the user starts a claim. Both hooks
  // would otherwise subscribe to the same Realtime topic, and supabase-js
  // v2 dedupes channels by name — the second subscriber lands on an
  // already-`joined` instance and throws "cannot add presence callbacks
  // ... after 'subscribe()'". With the observer disabled, its cleanup
  // tears the channel down synchronously and usePlayerClaim creates a
  // fresh subscription.
  const observerEnabled = attempting === null;
  const { ready, claimedPlayerIds } = useTournamentPresence(sessionId, {
    enabled: observerEnabled,
  });
  const { status } = usePlayerClaim(sessionId, attempting?.playerId ?? null);

  useEffect(() => {
    if (status === "claimed" && attempting) {
      router.replace(`/play/${sessionId}/${attempting.slug}`);
    }
  }, [status, attempting, router, sessionId]);

  const eligible = useMemo(
    () => roster.filter((r) => !r.busted),
    [roster],
  );

  return (
    <div className="flex flex-col gap-6">
      {status === "lost" && attempting && (
        <div
          className="rounded-2xl border border-danger/60 bg-danger/10 p-4 text-sm text-danger"
          role="alert"
        >
          <strong className="font-semibold">{attempting.name}</strong> is
          already claimed on another device. Pick someone else.
        </div>
      )}
      {status === "error" && (
        <div
          className="rounded-2xl border border-danger/60 bg-danger/10 p-4 text-sm text-danger"
          role="alert"
        >
          Connection problem. Tap again to retry.
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {eligible.map((entry) => {
          const claimedByOther =
            claimedPlayerIds.has(entry.playerId) &&
            attempting?.playerId !== entry.playerId;
          const isBeingClaimed =
            attempting?.playerId === entry.playerId && status === "idle";
          const disabled = !ready || claimedByOther || isBeingClaimed;
          return (
            <li key={entry.tournamentPlayerId}>
              <button
                type="button"
                className={`w-full rounded-2xl border px-5 py-5 text-left text-2xl font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-bright ${
                  claimedByOther
                    ? "border-fg/10 bg-fg/5 text-fg/30"
                    : "border-gold/60 bg-bg/40 text-fg active:bg-gold/10"
                }`}
                disabled={disabled}
                aria-disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  setAttempting(entry);
                }}
              >
                <span className="block">{entry.name}</span>
                <span className="mt-1 block text-xs uppercase tracking-widest text-fg/40">
                  {claimedByOther
                    ? "Claimed on another device"
                    : isBeingClaimed
                      ? "Claiming…"
                      : `${entry.currentChips.toLocaleString()} chips`}
                </span>
              </button>
            </li>
          );
        })}
        {eligible.length === 0 && (
          <li className="rounded-2xl border border-fg/10 bg-bg/40 p-6 text-center text-fg/60">
            Everyone has busted. See the TV for results.
          </li>
        )}
      </ul>

      {!ready && (
        <p className="text-center text-xs text-fg/50">
          Connecting to the tournament…
        </p>
      )}
    </div>
  );
}
