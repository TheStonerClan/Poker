"use client";

import { useState, useTransition } from "react";

import { finalizeTournament } from "@/app/admin/tournaments/[id]/actions";

export function FinalizeButton({
  tournamentId,
  disabled,
}: {
  tournamentId: string;
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  if (disabled) {
    return (
      <p className="mt-3 rounded-md border border-fg/10 px-3 py-2 text-xs text-fg/50">
        Already finalized.
      </p>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="h-12 min-h-[44px] rounded-md border border-fg/20 text-sm font-semibold text-fg/80"
        >
          Finalize tournament
        </button>
      ) : (
        <>
          <p className="text-xs text-danger">
            Snapshot results and lock the tournament?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => start(() => finalizeTournament(tournamentId))}
              className="h-12 min-h-[44px] flex-1 rounded-md bg-danger/90 text-sm font-semibold text-bg disabled:opacity-50"
            >
              {pending ? "Finalizing…" : "Yes, finalize"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="h-12 min-h-[44px] flex-1 rounded-md border border-fg/15 text-sm font-semibold text-fg/80 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
