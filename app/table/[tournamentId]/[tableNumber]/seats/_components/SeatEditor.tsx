"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { confirmTableSeating } from "@/app/admin/tournaments/[id]/seat-actions";

type Player = {
  tournamentPlayerId: string;
  name: string;
  currentSeat: number | null;
  confirmed: boolean;
};

/**
 * Per-player seat picker. One row per active player at the table;
 * each row has a dropdown of seat numbers 1..max_seats. The save
 * button is disabled until every player has a seat and no two
 * players share a seat.
 *
 * On success, redirect back to the table page — the banner clears
 * automatically because `seat_confirmed_at` is now `now()` for every
 * row we touched.
 */
export function SeatEditor({
  tournamentId,
  tableNumber,
  maxSeats,
  players,
  locked,
}: {
  tournamentId: string;
  tableNumber: number;
  maxSeats: number;
  players: Player[];
  locked: boolean;
}) {
  const router = useRouter();
  const [assignments, setAssignments] = useState<Record<string, number | null>>(
    () =>
      Object.fromEntries(
        players.map((p) => [p.tournamentPlayerId, p.currentSeat]),
      ),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Detect duplicate seats client-side so the admin gets immediate
  // feedback. The server validates again before writing.
  const duplicateSeats = useMemo(() => {
    const seen = new Map<number, string[]>();
    for (const [pid, seat] of Object.entries(assignments)) {
      if (seat == null) continue;
      if (!seen.has(seat)) seen.set(seat, []);
      seen.get(seat)!.push(pid);
    }
    return new Set(
      [...seen.entries()]
        .filter(([, ids]) => ids.length > 1)
        .map(([seat]) => seat),
    );
  }, [assignments]);

  const everyoneSeated = players.every(
    (p) => assignments[p.tournamentPlayerId] != null,
  );
  const canSave = everyoneSeated && duplicateSeats.size === 0 && !locked;

  function setSeat(pid: string, seat: number | null) {
    setAssignments((prev) => ({ ...prev, [pid]: seat }));
  }

  function save() {
    setError(null);
    start(async () => {
      const payload = Object.entries(assignments)
        .filter(([, seat]) => seat != null)
        .map(([tournamentPlayerId, seatNumber]) => ({
          tournamentPlayerId,
          seatNumber: seatNumber as number,
        }));
      const res = await confirmTableSeating({
        tournamentId,
        tableNumber,
        assignments: payload,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/table/${tournamentId}/${tableNumber}`);
    });
  }

  if (players.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-fg/15 p-6 text-center">
        <p className="text-sm text-fg/70">
          No active players at this table.
        </p>
        <Link
          href={`/table/${tournamentId}/${tableNumber}`}
          className="mt-3 inline-flex h-11 min-h-[44px] items-center justify-center rounded-md border border-fg/15 px-4 text-sm font-semibold text-fg/80"
        >
          Back to table
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-fg/60">
        Pick the physical seat each player is sitting at. Save commits
        all assignments together and clears the seating banner.
      </p>

      <ul className="flex flex-col gap-2">
        {players.map((p) => {
          const seat = assignments[p.tournamentPlayerId];
          const isDuplicate = seat != null && duplicateSeats.has(seat);
          return (
            <li
              key={p.tournamentPlayerId}
              className={`flex items-center gap-3 rounded-md border px-3 py-2 ${
                isDuplicate
                  ? "border-danger/60 bg-danger/5"
                  : p.confirmed
                    ? "border-fg/10"
                    : "border-gold/40 bg-gold/[0.04]"
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
                {p.name}
              </span>
              {!p.confirmed ? (
                <span className="text-[10px] font-semibold uppercase tracking-widest text-gold/80">
                  unconfirmed
                </span>
              ) : null}
              <label className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/55">
                  Seat
                </span>
                <select
                  value={seat ?? ""}
                  onChange={(e) =>
                    setSeat(
                      p.tournamentPlayerId,
                      e.target.value === ""
                        ? null
                        : Number.parseInt(e.target.value, 10),
                    )
                  }
                  className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-2 text-sm text-fg focus:border-gold focus:outline-none"
                  disabled={locked}
                >
                  <option value="">—</option>
                  {Array.from({ length: maxSeats }, (_, i) => i + 1).map(
                    (n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </li>
          );
        })}
      </ul>

      {duplicateSeats.size > 0 ? (
        <p
          role="alert"
          className="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          Two players assigned to the same seat. Resolve before saving.
        </p>
      ) : null}

      {!everyoneSeated && duplicateSeats.size === 0 ? (
        <p className="rounded-md border border-fg/15 px-3 py-2 text-xs text-fg/60">
          Pick a seat for every player above.
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Link
          href={`/table/${tournamentId}/${tableNumber}`}
          className="inline-flex h-11 min-h-[44px] flex-1 items-center justify-center rounded-md border border-fg/15 text-xs font-semibold uppercase tracking-wider text-fg/80"
        >
          Cancel
        </Link>
        <button
          type="button"
          disabled={!canSave || pending}
          onClick={save}
          className="h-11 min-h-[44px] flex-1 rounded-md bg-gold text-xs font-semibold uppercase tracking-wider text-bg disabled:opacity-50"
        >
          {pending ? "Saving…" : "Confirm seats"}
        </button>
      </div>
    </div>
  );
}
