"use client";

import { useState, useTransition } from "react";

import { collectBounty, reopenBounty } from "@/app/admin/tournaments/[id]/actions";
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
 *
 * Once collected, still lets the admin fix a mis-click: "Change" re-opens
 * the picker (calling collectBounty again just overwrites who gets
 * credit), and "Reopen" clears the collection back to unclaimed via
 * reopenBounty — for "I marked the wrong player out, undid the bust, but
 * the bounty had already been credited to whoever I *thought* busted
 * them."
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
  const [changing, setChanging] = useState(false);

  function collect(playerId: string) {
    setError(null);
    start(async () => {
      const res = await collectBounty({
        tournamentId,
        collectedByPlayerId: playerId,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setChanging(false);
    });
  }

  function reopen() {
    setError(null);
    start(async () => {
      const res = await reopenBounty({ tournamentId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setChanging(false);
    });
  }

  const showPicker = (collectedByName && changing) || (!collectedByName && targetBusted && !dismissed);

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

      {error ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {collectedByName && !changing ? (
        <div className="mt-1">
          <p className="text-sm text-fg/80">
            Won by <span className="font-semibold">{collectedByName}</span> —
            busted <span className="font-semibold">{targetName}</span>.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={pending}
              onClick={() => setChanging(true)}
              className="inline-flex h-9 items-center justify-center rounded-md border border-fg/15 px-3 text-xs uppercase tracking-wider text-fg/70 disabled:opacity-50"
            >
              Change
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={reopen}
              className="inline-flex h-9 items-center justify-center rounded-md border border-danger/50 px-3 text-xs uppercase tracking-wider text-danger disabled:opacity-50"
            >
              {pending ? "…" : "Reopen"}
            </button>
          </div>
        </div>
      ) : !collectedByName && !targetBusted ? (
        <p className="mt-1 text-sm text-fg/70">
          On <span className="font-semibold">{targetName}</span> (returning
          from last game&apos;s top finish).
        </p>
      ) : !collectedByName && dismissed ? (
        <p className="mt-1 text-sm text-fg/50">
          {targetName} is out — bounty not recorded.
        </p>
      ) : null}

      {showPicker ? (
        <div className="mt-2">
          <p className="text-sm text-fg/80">
            {changing ? (
              "Who actually busted them?"
            ) : (
              <>
                <span className="font-semibold">{targetName}</span> is out —
                who busted them?
              </>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {activePlayers.map((p) => (
              <button
                key={p.playerId}
                type="button"
                disabled={pending}
                onClick={() => collect(p.playerId)}
                className="inline-flex h-9 items-center justify-center rounded-md border border-gold/50 px-3 text-xs font-semibold uppercase tracking-wider text-gold-bright disabled:opacity-50"
              >
                {p.name}
              </button>
            ))}
            <button
              type="button"
              disabled={pending}
              onClick={() => (changing ? setChanging(false) : setDismissed(true))}
              className="inline-flex h-9 items-center justify-center rounded-md border border-fg/15 px-3 text-xs uppercase tracking-wider text-fg/60"
            >
              {changing ? "Cancel" : "Skip"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
