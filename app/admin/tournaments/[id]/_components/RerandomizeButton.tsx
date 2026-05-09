"use client";

import { useState, useTransition } from "react";

import { randomizeTableAssignments } from "@/app/admin/tournaments/[id]/actions";

type Props = {
  tournamentId: string;
};

/**
 * Re-shuffle the roster across the existing tables. Only valid while the
 * tournament is in `scheduled` state — once the timer starts, players
 * are committed to their seats.
 *
 * The action returns `{ ok, error? }` so production error messages
 * survive Next 16's redaction. We surface them inline.
 */
export function RerandomizeButton({ tournamentId }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="h-11 min-h-[44px] rounded-md border border-fg/15 px-3 text-xs font-semibold uppercase tracking-wider text-fg/80"
        >
          Re-randomize tables
        </button>
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-fg/15 bg-fg/[0.02] p-3">
      <p className="text-xs text-fg/70">
        Reshuffle the roster across the existing tables? This wipes the
        current seating and assigns each player to a new (table, seat).
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 text-xs font-semibold uppercase tracking-wider text-fg/80 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              const res = await randomizeTableAssignments(tournamentId);
              if (!res.ok) setError(res.error);
              else setConfirming(false);
            });
          }}
          className="h-11 min-h-[44px] flex-1 rounded-md bg-gold text-xs font-semibold uppercase tracking-wider text-bg disabled:opacity-50"
        >
          {pending ? "Shuffling…" : "Yes, reshuffle"}
        </button>
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
