"use client";

import Link from "next/link";
import { useTransition } from "react";

import type { Player } from "@/lib/admin/queries";

import { deletePlayer } from "./actions";

export function PlayersList({ players }: { players: Player[] }) {
  const [pending, start] = useTransition();

  if (players.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-fg/15 p-6 text-center">
        <p className="text-sm text-fg/70">No players yet.</p>
        <Link
          href="/admin/players?new"
          className="mt-3 inline-flex h-11 min-h-[44px] items-center justify-center rounded-md bg-gold px-4 text-sm font-semibold text-bg"
        >
          Add first player
        </Link>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {players.map((p) => (
        <li
          key={p.id}
          className="flex items-center gap-2 rounded-md border border-fg/10 px-3 py-2"
        >
          <Link href={`/admin/players?edit=${p.id}`} className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-fg">{p.name}</p>
            {p.signal_handle ? (
              <p className="truncate text-xs text-fg/50">{p.signal_handle}</p>
            ) : null}
          </Link>
          <Link
            href={`/admin/players?edit=${p.id}`}
            className="inline-flex h-11 min-h-[44px] items-center justify-center rounded-md border border-fg/15 px-3 text-xs font-semibold uppercase tracking-wider text-fg/80"
          >
            Edit
          </Link>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!confirm(`Remove ${p.name} from the roster?`)) return;
              start(() => deletePlayer(p.id));
            }}
            className="inline-flex h-11 min-h-[44px] items-center justify-center rounded-md border border-danger/40 px-3 text-xs font-semibold uppercase tracking-wider text-danger disabled:opacity-50"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
