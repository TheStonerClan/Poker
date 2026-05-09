"use client";

import { useMemo, useState, useTransition } from "react";

import {
  addPlayersToTournament,
  removePlayerFromTournament,
} from "@/app/admin/tournaments/[id]/actions";

type Player = { id: string; name: string };

type Props = {
  tournamentId: string;
  /** Master roster — every player in `public.players`. Drives the "Add" picker. */
  allPlayers: Player[];
  /** Players already on this tournament's roster (matches ids in allPlayers). */
  rosteredPlayerIds: ReadonlyArray<string>;
};

/**
 * Pre-game "add players" picker shown on the scheduled-tournament
 * detail page. Lets the admin stage RSVPs as they confirm over the
 * days leading up to game night without re-running the wizard.
 *
 * Multi-select on purpose: at-the-table-of-friends use case is
 * "three more confirmed today, add them all in one click."
 */
export function AddPlayersPicker({
  tournamentId,
  allPlayers,
  rosteredPlayerIds,
}: Props) {
  const rosteredSet = useMemo(
    () => new Set(rosteredPlayerIds),
    [rosteredPlayerIds],
  );
  const eligible = useMemo(
    () =>
      allPlayers
        .filter((p) => !rosteredSet.has(p.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allPlayers, rosteredSet],
  );

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function add() {
    if (picked.size === 0) return;
    setError(null);
    start(async () => {
      const res = await addPlayersToTournament({
        tournamentId,
        playerIds: [...picked],
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPicked(new Set());
    });
  }

  if (eligible.length === 0) {
    return (
      <p className="text-xs italic text-fg/45">
        Every player in the master list is already on the roster. Add
        players to the master list under Players, then they&apos;ll show up here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border border-fg/10 p-2">
        {eligible.map((p) => {
          const checked = picked.has(p.id);
          return (
            <li key={p.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-fg/5">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(p.id)}
                  className="h-5 w-5 accent-[var(--color-gold)]"
                />
                <span className="text-sm text-fg">{p.name}</span>
              </label>
            </li>
          );
        })}
      </ul>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={pending || picked.size === 0}
        onClick={add}
        className="h-11 min-h-[44px] rounded-md bg-gold text-sm font-semibold text-bg disabled:opacity-50"
      >
        {pending
          ? "Adding…"
          : picked.size === 0
            ? "Add players"
            : `Add ${picked.size} player${picked.size === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}

/**
 * Tiny per-row "✕" button that drops a staged player from the
 * scheduled-tournament roster. Only mounted when the tournament is
 * still scheduled — the detail page hides it once status flips to
 * running, and the server action enforces the same check.
 */
export function RemovePlayerButton({
  tournamentId,
  tournamentPlayerId,
  playerName,
}: {
  tournamentId: string;
  tournamentPlayerId: string;
  /** Used in the confirm dialog so the admin doesn't drop the wrong person. */
  playerName: string;
}) {
  const [pending, start] = useTransition();

  function remove() {
    if (
      !window.confirm(
        `Remove ${playerName} from the roster? Their seat will free up for someone else.`,
      )
    ) {
      return;
    }
    start(async () => {
      const res = await removePlayerFromTournament({
        tournamentId,
        tournamentPlayerId,
      });
      if (!res.ok) {
        window.alert(res.error);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={pending}
      title={`Remove ${playerName}`}
      aria-label={`Remove ${playerName}`}
      className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-fg/40 hover:bg-danger/15 hover:text-danger disabled:opacity-50"
    >
      ✕
    </button>
  );
}
