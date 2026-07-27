"use client";

import { useState, useTransition } from "react";

import { clearKnockout, recordKnockout } from "@/app/admin/tournaments/[id]/actions";

type Candidate = { playerId: string; name: string };

type Props = {
  tournamentPlayerId: string;
  knockedOutByName: string | null;
  /** Every other roster player, already excluding the busted player themselves. */
  candidates: Candidate[];
};

/**
 * Inline "who busted them?" attribution for a busted PlayerGrid tile.
 * Closed by default (matches ManualColorUpButton's expand-in-place
 * pattern) so a long "Out" list doesn't turn into a wall of candidate
 * buttons — only the row being worked on opens up.
 *
 * Once set, shows the credited name + a small "Change" control; picking
 * a new candidate overwrites it (same "just re-record, no separate
 * uncollect" idea as BountyPanel). "Clear" reverts to unrecorded.
 */
export function KnockoutPicker({
  tournamentPlayerId,
  knockedOutByName,
  candidates,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (candidates.length === 0) return null;

  function pick(playerId: string) {
    setError(null);
    start(async () => {
      const res = await recordKnockout({
        tournamentPlayerId,
        knockedOutByPlayerId: playerId,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
    });
  }

  function clear() {
    setError(null);
    start(async () => {
      const res = await clearKnockout({ tournamentPlayerId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
    });
  }

  if (!open) {
    return knockedOutByName ? (
      <p className="mt-1 text-[10px] tracking-wider text-fg/55">
        <span className="uppercase">KO by</span>{" "}
        <span className="font-semibold text-fg/80">{knockedOutByName}</span>{" "}
        <button
          type="button"
          disabled={pending}
          onClick={() => setOpen(true)}
          className="ml-1 uppercase text-gold/80 underline-offset-2 hover:underline disabled:opacity-50"
        >
          Change
        </button>{" "}
        <button
          type="button"
          disabled={pending}
          onClick={clear}
          className="uppercase text-fg/40 underline-offset-2 hover:underline disabled:opacity-50"
        >
          Clear
        </button>
      </p>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-gold/80 underline-offset-2 hover:underline"
      >
        + Who KO&apos;d them?
      </button>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-gold/30 bg-gold/[0.04] p-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gold/80">
        Who busted them?
      </p>
      {error ? (
        <p role="alert" className="text-[10px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {candidates.map((c) => (
          <button
            key={c.playerId}
            type="button"
            disabled={pending}
            onClick={() => pick(c.playerId)}
            className="inline-flex h-9 items-center justify-center rounded-md border border-gold/50 px-2.5 text-xs font-semibold text-gold-bright disabled:opacity-50"
          >
            {c.name}
          </button>
        ))}
        <button
          type="button"
          disabled={pending}
          onClick={() => setOpen(false)}
          className="inline-flex h-9 items-center justify-center rounded-md border border-fg/15 px-2.5 text-xs uppercase tracking-wider text-fg/60 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
