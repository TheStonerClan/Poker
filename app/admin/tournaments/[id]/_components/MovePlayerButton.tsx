"use client";

import { useState, useTransition } from "react";

import { movePlayerToTable } from "@/app/admin/tournaments/[id]/hand-actions";

type TableOption = { number: number; name: string };

/**
 * Per-tile "Move" affordance — global admin only. Opens a small
 * dropdown of all OTHER tables in this tournament; picking one fires
 * the manual move action.
 *
 * Hidden when there's only one table (nothing to move to).
 *
 * Blocked server-side if a hand is in progress at either the source
 * or destination — admin should finish/cancel the hand first.
 */
export function MovePlayerButton({
  tournamentPlayerId,
  playerName,
  currentTableNumber,
  tableOptions,
}: {
  tournamentPlayerId: string;
  playerName: string;
  currentTableNumber: number | null;
  tableOptions: TableOption[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const destinations = tableOptions.filter(
    (t) => t.number !== currentTableNumber,
  );
  if (destinations.length === 0) return null;

  function move(to: number) {
    setError(null);
    start(async () => {
      const res = await movePlayerToTable({
        tournamentPlayerId,
        toTableNumber: to,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 min-h-[44px] items-center justify-center rounded-md border border-fg/15 px-3 text-xs font-semibold uppercase tracking-wider text-fg/80"
      >
        Move
      </button>
    );
  }

  return (
    <div className="mt-2 flex w-full flex-col gap-2 rounded-md border border-fg/20 bg-fg/[0.03] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-fg/80">
        Move {playerName} to…
      </p>
      <div className="flex flex-col gap-1.5">
        {destinations.map((d) => (
          <button
            key={d.number}
            type="button"
            disabled={pending}
            onClick={() => move(d.number)}
            className="h-11 min-h-[44px] rounded-md border border-fg/15 text-xs font-semibold uppercase tracking-wider text-fg/80 disabled:opacity-50"
          >
            {d.name}
          </button>
        ))}
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/60 bg-danger/10 px-2 py-1.5 text-xs text-danger"
        >
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        className="h-11 min-h-[44px] rounded-md border border-fg/15 text-xs font-semibold uppercase tracking-wider text-fg/80 disabled:opacity-50"
      >
        Cancel
      </button>
    </div>
  );
}
