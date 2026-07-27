"use client";

import { useState, useTransition } from "react";

import { submitTableChipSnapshots } from "@/app/admin/tournaments/[id]/chip-snapshot-actions";
import { formatChips } from "@/lib/admin/format";

type PlayerRow = {
  tournamentPlayerId: string;
  name: string;
  currentChips: number;
};

type Props = {
  tournamentId: string;
  tableNumber: number;
  players: PlayerRow[];
};

/**
 * Bulk chip-count check-in for a whole table — call out stacks during a
 * break (or at the final table) and log all of them in one save instead
 * of one player at a time. Feeds /history's break-shift analytics via
 * the same `chip_snapshot` event the player self-report screen writes.
 *
 * Inputs default to each player's current chip total so leaving a field
 * untouched is a safe no-op; a field cleared entirely is skipped rather
 * than submitted as zero.
 */
export function ChipSnapshotPanel({ tournamentId, tableNumber, players }: Props) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [pending, start] = useTransition();

  function openPanel() {
    setValues(
      Object.fromEntries(
        players.map((p) => [p.tournamentPlayerId, String(p.currentChips)]),
      ),
    );
    setError(null);
    setSavedCount(null);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setValues({});
    setError(null);
    setSavedCount(null);
  }

  function save() {
    const entries = players
      .map((p) => {
        const raw = values[p.tournamentPlayerId]?.trim() ?? "";
        if (raw === "") return null;
        const chips = Number.parseInt(raw, 10);
        if (!Number.isFinite(chips) || chips < 0) return null;
        return { tournamentPlayerId: p.tournamentPlayerId, chips };
      })
      .filter((e): e is { tournamentPlayerId: string; chips: number } => e != null);

    if (entries.length === 0) {
      setError("Enter at least one chip count.");
      return;
    }

    setError(null);
    start(async () => {
      const res = await submitTableChipSnapshots({
        tournamentId,
        tableNumber,
        entries,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedCount(res.count);
    });
  }

  if (players.length === 0) return null;

  if (!open) {
    return (
      <section className="flex items-center gap-3 rounded-lg border border-fg/10 p-3">
        <div className="min-w-0 flex-1">
          <p className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
            Chip count check-in
          </p>
          <p className="mt-0.5 text-xs text-fg/55">
            Log everyone&apos;s stack at once — break or final table.
          </p>
        </div>
        <button
          type="button"
          onClick={openPanel}
          className="inline-flex h-11 min-h-[44px] items-center justify-center rounded-md border border-fg/15 px-4 text-xs font-semibold uppercase tracking-wider text-fg/80"
        >
          Count chips
        </button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-fg/20 bg-fg/[0.03] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
          Chip count check-in
        </p>
        <p className="text-[10px] text-fg/45">Blank = skip that player</p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {players.map((p) => (
          <li key={p.tournamentPlayerId} className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
              {p.name}
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={values[p.tournamentPlayerId] ?? ""}
              onChange={(e) =>
                setValues((v) => ({
                  ...v,
                  [p.tournamentPlayerId]: e.target.value,
                }))
              }
              placeholder={formatChips(p.currentChips)}
              className="min-h-[40px] w-28 rounded-md border border-fg/15 bg-bg px-2 text-right font-mono text-sm tabular-nums text-fg focus:border-gold focus:outline-none"
            />
          </li>
        ))}
      </ul>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/60 bg-danger/10 px-2 py-1.5 text-xs text-danger"
        >
          {error}
        </p>
      ) : null}
      {savedCount != null ? (
        <p className="rounded-md border border-success/50 bg-success/10 px-2 py-1.5 text-xs text-success">
          Saved {savedCount} chip count{savedCount === 1 ? "" : "s"}.
        </p>
      ) : null}
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={close}
          className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 text-xs font-semibold uppercase tracking-wider text-fg/80 disabled:opacity-50"
        >
          {savedCount != null ? "Done" : "Cancel"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="h-11 min-h-[44px] flex-1 rounded-md bg-gold text-xs font-semibold uppercase tracking-wider text-bg disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save all"}
        </button>
      </div>
    </section>
  );
}
