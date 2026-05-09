"use client";

import { useState, useTransition } from "react";

import { bustPlayer } from "@/app/admin/tournaments/[id]/actions";
import { formatChips } from "@/lib/admin/format";

type Row = {
  tournament_player_id: string;
  name: string;
  chips: number;
};

export function QuickBustList({
  roster,
}: {
  tournamentId: string;
  currentLevel: number;
  roster: Row[];
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();

  if (roster.length === 0) {
    return (
      <p className="mt-2 text-sm text-fg/60">No active players.</p>
    );
  }

  return (
    <ul className="mt-2 flex flex-col gap-1.5">
      {roster.map((r) => (
        <li
          key={r.tournament_player_id}
          className="flex items-center justify-between rounded-md border border-fg/10 bg-fg/[0.02] px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-fg">{r.name}</p>
            <p className="text-xs text-fg/50">{formatChips(r.chips)} chips</p>
          </div>
          <button
            type="button"
            disabled={pendingId === r.tournament_player_id}
            onClick={() => {
              setPendingId(r.tournament_player_id);
              start(async () => {
                // bustPlayer now returns { ok, error? } so production
                // error messages aren't redacted by Next 16. We don't
                // surface them on the dashboard's quick list (simpler
                // UX), but we still wait for the action to finish
                // before clearing the spinner.
                await bustPlayer({
                  tournamentPlayerId: r.tournament_player_id,
                });
                setPendingId(null);
              });
            }}
            className="ml-3 inline-flex h-11 min-h-[44px] items-center justify-center rounded-md border border-danger/60 px-3 text-xs font-semibold uppercase tracking-wider text-danger disabled:opacity-50"
          >
            {pendingId === r.tournament_player_id ? "…" : "Out"}
          </button>
        </li>
      ))}
    </ul>
  );
}
