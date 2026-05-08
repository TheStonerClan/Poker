"use client";

import { useMemo, useState } from "react";

import { submitColorUpRequest } from "@/app/play/[sessionId]/actions";
import {
  computeExchange,
  type ComputeExchangeResult,
} from "@poker/color-up";
import { getOrCreateAnonSession } from "@/lib/presence";

type Props = {
  sessionId: string;
  playerId: string;
  chipDenominations: Array<{ color: string; value: number }>;
  currentColorUp: number[];
};

type Submission = "idle" | "submitting" | "submitted" | "error";

export function ColorUpTab({
  sessionId,
  playerId,
  chipDenominations,
  currentColorUp,
}: Props) {
  const [chipTotal, setChipTotal] = useState("");
  const [submission, setSubmission] = useState<Submission>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const removingDenominations = currentColorUp;
  const remainingDenominations = useMemo(
    () =>
      chipDenominations.filter(
        (d) => !removingDenominations.includes(d.value),
      ),
    [chipDenominations, removingDenominations],
  );

  const parsedTotal = Number.parseInt(chipTotal, 10);
  const validTotal = Number.isFinite(parsedTotal) && parsedTotal >= 0;

  let preview: ComputeExchangeResult | null = null;
  let previewError: string | null = null;
  if (validTotal && remainingDenominations.length > 0) {
    try {
      preview = computeExchange({
        submittedTotal: parsedTotal,
        removingDenominations,
        remainingDenominations,
        roundingMode: "up",
      });
    } catch (e) {
      previewError = e instanceof Error ? e.message : "Could not compute";
    }
  }

  if (removingDenominations.length === 0) {
    return (
      <div className="rounded-2xl border border-gold/30 bg-bg/40 p-5">
        <p className="text-label text-xs uppercase tracking-widest">
          No color-up active
        </p>
        <p className="mt-2 text-sm text-fg/70">
          The current level isn&apos;t a color-up break. Wait for the admin to
          announce one.
        </p>
      </div>
    );
  }

  async function handleSubmit() {
    if (!preview) return;
    setSubmission("submitting");
    setErrorMsg(null);
    const res = await submitColorUpRequest({
      tournamentId: sessionId,
      playerId,
      anonSession: getOrCreateAnonSession(),
      submittedTotal: parsedTotal,
      submittedChips: removingDenominations.map((value) => ({
        value,
        count: 0,
      })),
      exchangeFor: preview.exchangeFor,
      netChange: preview.netChange,
      newTotal: preview.newTotal,
    });
    if (res.ok) {
      setSubmission("submitted");
    } else {
      setSubmission("error");
      setErrorMsg(res.error);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-gold/30 bg-bg/40 p-5">
        <p className="text-label text-xs uppercase tracking-widest">
          Coloring up
        </p>
        <p className="mt-2 text-fg">
          Removing{" "}
          <strong>${removingDenominations.join(" + $")}</strong> chips. Count up
          everything you have in those denominations and enter the total.
        </p>
      </div>

      <label className="rounded-2xl border border-gold/30 bg-bg/40 p-5">
        <span className="text-label text-xs uppercase tracking-widest">
          Chip total ($)
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={chipTotal}
          onChange={(e) => {
            setChipTotal(e.target.value);
            if (submission === "submitted") setSubmission("idle");
          }}
          className="mt-3 w-full rounded-xl border border-fg/20 bg-bg px-4 py-4 text-3xl tabular-nums text-fg outline-none focus:border-gold-bright"
          placeholder="0"
          aria-invalid={!validTotal}
        />
      </label>

      {previewError && (
        <p className="rounded-2xl border border-danger/60 bg-danger/10 p-4 text-sm text-danger">
          {previewError}
        </p>
      )}

      {preview && parsedTotal > 0 && (
        <div className="rounded-2xl border border-gold/60 bg-gold/5 p-5">
          <p className="text-label text-xs uppercase tracking-widest">
            Bring to admin
          </p>
          <p className="mt-2 text-3xl font-semibold text-fg">
            ${parsedTotal.toLocaleString()} → ${preview.newTotal.toLocaleString()}
          </p>
          <ul className="mt-3 flex flex-col gap-1 text-fg/80">
            {preview.exchangeFor.map((c) => (
              <li key={c.value}>
                {c.count} × ${c.value} chip{c.count === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-fg/70">
            {preview.netChange === 0
              ? "Exact exchange."
              : preview.netChange > 0
                ? `You owe an extra $${preview.netChange}.`
                : `Admin owes you $${Math.abs(preview.netChange)}.`}
          </p>
        </div>
      )}

      {errorMsg && (
        <p className="rounded-2xl border border-danger/60 bg-danger/10 p-4 text-sm text-danger">
          {errorMsg}
        </p>
      )}

      {submission === "submitted" ? (
        <div className="rounded-2xl border border-success/60 bg-success/10 p-4 text-success">
          Sent to admin. Bring your chips up to be counted.
        </div>
      ) : (
        <button
          type="button"
          disabled={!preview || parsedTotal <= 0 || submission === "submitting"}
          onClick={handleSubmit}
          className="rounded-2xl border border-gold-bright bg-gold/15 px-5 py-5 text-lg font-semibold uppercase tracking-widest text-gold-bright disabled:border-fg/10 disabled:bg-fg/5 disabled:text-fg/30"
        >
          {submission === "submitting" ? "Sending…" : "Send to admin"}
        </button>
      )}
    </div>
  );
}
