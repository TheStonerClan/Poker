"use client";

import { useState, useTransition } from "react";

import { collectBounty } from "@/app/admin/tournaments/[id]/actions";
import { formatMoney } from "@/lib/admin/format";

type Props = {
  tournamentId: string;
  targetName: string;
  amount: number;
  targetBusted: boolean;
  collectedByName: string | null;
  /** Other still-active players, candidates for "who busted them". */
  activePlayers: { playerId: string; name: string }[];
};

/**
 * Shows the resolved bounty and, once the target busts, prompts the
 * admin to record who eliminated them. Server-state-driven rather than
 * tied to a specific bust click, so it surfaces correctly on this page
 * regardless of whether the bust happened here or from a table admin's
 * view.
 */
export function BountyPanel({
  tournamentId,
  targetName,
  amount,
  targetBusted,
  collectedByName,
  activePlayers,
}: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  return (
    <section className="rounded-lg border border-gold/40 bg-gold/5 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
          Bounty
        </h2>
        <span className="font-mono text-sm text-gold-bright">
          {formatMoney(amount)}
        </span>
      </div>

      {collectedByName ? (
        <p className="mt-1 text-sm text-fg/80">
          Won by <span className="font-semibold">{collectedByName}</span> —
          busted <span className="font-semibold">{targetName}</span>.
        </p>
      ) : !targetBusted ? (
        <p className="mt-1 text-sm text-fg/70">
          On <span className="font-semibold">{targetName}</span> (returning
          from last game&apos;s top finish).
        </p>
      ) : dismissed ? (
        <p className="mt-1 text-sm text-fg/50">
          {targetName} is out — bounty not recorded.
        </p>
      ) : (
        <div className="mt-2">
          <p className="text-sm text-fg/80">
            <span className="font-semibold">{targetName}</span> is out — who
            busted them?
          </p>
          {error ? (
            <p role="alert" className="mt-1 text-xs text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {activePlayers.map((p) => (
              <button
                key={p.playerId}
                type="button"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  start(async () => {
                    const res = await collectBounty({
                      tournamentId,
                      collectedByPlayerId: p.playerId,
                    });
                    if (!res.ok) setError(res.error);
                  });
                }}
                className="inline-flex h-9 items-center justify-center rounded-md border border-gold/50 px-3 text-xs font-semibold uppercase tracking-wider text-gold-bright disabled:opacity-50"
              >
                {p.name}
              </button>
            ))}
            <button
              type="button"
              disabled={pending}
              onClick={() => setDismissed(true)}
              className="inline-flex h-9 items-center justify-center rounded-md border border-fg/15 px-3 text-xs uppercase tracking-wider text-fg/60"
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
