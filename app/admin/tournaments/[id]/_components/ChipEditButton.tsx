"use client";

import { useState, useTransition } from "react";

import { adjustChips } from "@/app/admin/tournaments/[id]/actions";
import { formatChips } from "@/lib/admin/format";

type Props = {
  tournamentPlayerId: string;
  playerName: string;
  /**
   * Current chip total. Used both as the input's default value (so the
   * admin can confirm or tweak from a known starting point) and to
   * preview the delta beneath the field.
   */
  currentChips: number;
};

/**
 * Inline chip-count editor for the head admin or a table admin. The
 * admin types the player's new total; we compute the delta and apply
 * it as a `chip_adjust` event so the events stream has a full audit
 * trail of "chips moved from $X to $Y at level N".
 *
 * Renders as an "Edit chips" button that expands into a small form
 * tucked into the player tile, mirroring ManualColorUpButton's UX.
 */
export function ChipEditButton({
  tournamentPlayerId,
  playerName,
  currentChips,
}: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const next = Number.parseInt(value, 10);
  const nextOk = Number.isFinite(next) && next >= 0;
  const delta = nextOk ? next - currentChips : null;

  function close() {
    setOpen(false);
    setValue("");
    setReason("");
    setError(null);
  }

  function open_() {
    setOpen(true);
    // Default the field to the current count so the admin can tweak
    // up/down without retyping the whole number.
    setValue(String(currentChips));
  }

  function apply() {
    if (!nextOk) return;
    setError(null);
    start(async () => {
      const res = await adjustChips({
        tournamentPlayerId,
        newChips: next,
        reason: reason.trim() || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      close();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={open_}
        className="inline-flex h-11 min-h-[44px] items-center justify-center rounded-md border border-fg/15 px-3 text-xs font-semibold uppercase tracking-wider text-fg/80"
      >
        Chips
      </button>
    );
  }

  return (
    <div className="mt-2 flex w-full flex-col gap-2 rounded-md border border-fg/20 bg-fg/[0.03] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-fg/80">
          Edit chips · {playerName}
        </p>
        <p className="font-mono text-[10px] tabular-nums text-fg/55">
          Current {formatChips(currentChips)}
        </p>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
          New total
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none"
        />
      </label>
      <p className="text-[10px] tabular-nums text-fg/60">
        Δ{" "}
        <span
          className={`font-mono ${
            delta == null
              ? "text-fg/40"
              : delta > 0
                ? "text-success"
                : delta < 0
                  ? "text-danger"
                  : "text-fg/60"
          }`}
        >
          {delta == null
            ? "—"
            : `${delta > 0 ? "+" : ""}${formatChips(delta)}`}
        </span>
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
          Reason
          <span className="ml-1 normal-case tracking-normal text-fg/40">
            (optional)
          </span>
        </span>
        <input
          type="text"
          maxLength={140}
          value={reason}
          placeholder="e.g. counted at break"
          onChange={(e) => setReason(e.target.value)}
          className="min-h-[40px] rounded-md border border-fg/15 bg-bg px-2 text-sm text-fg focus:border-gold focus:outline-none"
        />
      </label>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/60 bg-danger/10 px-2 py-1.5 text-xs text-danger"
        >
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={close}
          className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 text-xs font-semibold uppercase tracking-wider text-fg/80 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending || !nextOk || delta === 0}
          onClick={apply}
          className="h-11 min-h-[44px] flex-1 rounded-md bg-gold text-xs font-semibold uppercase tracking-wider text-bg disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
