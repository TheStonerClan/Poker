"use client";

import { useTransition } from "react";

import {
  advanceLevel,
  pauseTournament,
  previousLevel,
  resumeTournament,
} from "@/app/admin/tournaments/[id]/actions";
import type { Tournament } from "@/lib/admin/queries";

export function LevelControls({ tournament }: { tournament: Tournament }) {
  const [pending, start] = useTransition();
  const isRunning = tournament.status === "running";

  return (
    <section className="flex items-stretch gap-2">
      <button
        type="button"
        disabled={pending || tournament.current_level <= 1}
        onClick={() => start(() => previousLevel(tournament.id))}
        className="flex h-12 min-h-[44px] flex-1 items-center justify-center rounded-md border border-fg/15 text-sm font-semibold text-fg/80 disabled:opacity-40"
      >
        ◀ Back
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(() =>
            isRunning ? pauseTournament(tournament.id) : resumeTournament(tournament.id),
          )
        }
        className={`flex h-12 min-h-[44px] flex-1 items-center justify-center rounded-md text-sm font-semibold ${
          isRunning ? "bg-danger/90 text-bg" : "bg-success/80 text-bg"
        } disabled:opacity-50`}
      >
        {isRunning ? "Pause" : tournament.status === "scheduled" ? "Start" : "Resume"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => advanceLevel(tournament.id))}
        className="flex h-12 min-h-[44px] flex-1 items-center justify-center rounded-md bg-gold text-sm font-semibold text-bg disabled:opacity-50"
      >
        Next ▶
      </button>
    </section>
  );
}
