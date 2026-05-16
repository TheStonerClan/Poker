"use client";

import { useState, useTransition } from "react";

import { applyManualColorUp } from "@/app/admin/tournaments/[id]/actions";
import { formatChips } from "@/lib/admin/format";

type Props = {
  tournamentPlayerId: string;
  playerName: string;
  /**
   * Current chip count, used as the default for "Received total" so
   * the admin can confirm a no-op exchange or tweak from a known
   * starting point. Re-fetched via revalidatePath after submit.
   */
  currentChips: number;
};

/**
 * Admin-side color-up entry that mirrors the /play submission. The
 * admin types the player's submitted total (chips handed in) and the
 * received total (chips coming back, of the higher denomination). The
 * delta = received − submitted is the round-up gain (or zero) and
 * gets applied to current_chips + recorded as an approved
 * color_up_request so the tournament-wide chip-pool math stays
 * consistent with the /play flow.
 *
 * Inline expand-in-place: the row stays in the PlayerGrid; clicking
 * the button reveals the form below the tile's action row.
 */
export function ManualColorUpButton({
  tournamentPlayerId,
  playerName,
  currentChips,
}: Props) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState<string>("");
  const [received, setReceived] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submittedN = Number.parseInt(submitted, 10);
  const receivedN = Number.parseInt(received, 10);
  const submittedOk = Number.isFinite(submittedN) && submittedN >= 0;
  const receivedOk = Number.isFinite(receivedN) && receivedN >= 0;
  const netChange = submittedOk && receivedOk ? receivedN - submittedN : null;

  function close() {
    setOpen(false);
    setSubmitted("");
    setReceived("");
    setError(null);
  }

  function apply() {
    if (!submittedOk || !receivedOk) return;
    setError(null);
    start(async () => {
      const res = await applyManualColorUp({
        tournamentPlayerId,
        submittedTotal: submittedN,
        receivedTotal: receivedN,
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
        onClick={() => setOpen(true)}
        className="inline-flex h-11 min-h-[44px] items-center justify-center rounded-md border border-gold/40 px-3 text-xs font-semibold uppercase tracking-wider text-gold"
      >
        Color-up
      </button>
    );
  }

  return (
    <div className="mt-2 flex w-full flex-col gap-2 rounded-md border border-gold/30 bg-gold/[0.04] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gold">
          Color-up · {playerName}
        </p>
        <p className="font-mono text-[10px] tabular-nums text-fg/55">
          Current {formatChips(currentChips)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Submitted"
          hint="Chips handed in"
          value={submitted}
          onChange={setSubmitted}
        />
        <NumberField
          label="Received"
          hint="New chip total"
          value={received}
          onChange={setReceived}
        />
      </div>
      <p className="text-[10px] tabular-nums text-fg/60">
        Net change:{" "}
        <span
          className={`font-mono ${
            netChange == null
              ? "text-fg/40"
              : netChange > 0
                ? "text-success"
                : netChange < 0
                  ? "text-danger"
                  : "text-fg/60"
          }`}
        >
          {netChange == null
            ? "—"
            : `${netChange > 0 ? "+" : ""}${formatChips(netChange)}`}
        </span>
      </p>
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
          disabled={pending || !submittedOk || !receivedOk}
          onClick={apply}
          className="h-11 min-h-[44px] flex-1 rounded-md bg-gold text-xs font-semibold uppercase tracking-wider text-bg disabled:opacity-50"
        >
          {pending ? "Saving…" : "Apply"}
        </button>
      </div>
    </div>
  );
}

function NumberField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
        {label}
        <span className="ml-1 normal-case tracking-normal text-fg/40">
          {hint}
        </span>
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[40px] rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none"
      />
    </label>
  );
}
