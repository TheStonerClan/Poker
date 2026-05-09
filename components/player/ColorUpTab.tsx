"use client";

import { useMemo, useState } from "react";

import {
  submitChipSnapshot,
  submitColorUpRequest,
} from "@/app/play/[sessionId]/actions";
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
  /**
   * True when the tournament is paused at a break level. The chip-count
   * submission form only renders during breaks; the exchange form
   * additionally requires currentColorUp.length > 0.
   */
  isBreak: boolean;
  /** Current level number — included in the chip-snapshot event payload. */
  currentLevelNum: number;
  /**
   * Player's most recent server-side chip count. Pre-fills the
   * "post-color-up total" input with the previous value as a starting
   * point so they don't have to retype the whole number.
   */
  currentChips: number;
};

type Submission = "idle" | "submitting" | "submitted" | "error";

export function ColorUpTab({
  sessionId,
  playerId,
  chipDenominations,
  currentColorUp,
  isBreak,
  currentLevelNum,
  currentChips,
}: Props) {
  const colorUpActive = currentColorUp.length > 0;

  if (!isBreak) {
    return (
      <div className="rounded-2xl border border-gold/30 bg-bg/40 p-5">
        <p className="text-label text-xs uppercase tracking-widest">
          Wait for the next break
        </p>
        <p className="mt-2 text-sm text-fg/70">
          Color-up exchanges and chip-count check-ins happen during breaks.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {colorUpActive ? (
        <ExchangeForm
          sessionId={sessionId}
          playerId={playerId}
          chipDenominations={chipDenominations}
          currentColorUp={currentColorUp}
        />
      ) : (
        <div className="rounded-2xl border border-gold/30 bg-bg/40 p-5">
          <p className="text-label text-xs uppercase tracking-widest">
            No color-up this break
          </p>
          <p className="mt-2 text-sm text-fg/70">
            The admin didn&apos;t flag this level for a color-up exchange. You
            can still log your stack below for analytics.
          </p>
        </div>
      )}

      <StackCountForm
        tournamentId={sessionId}
        playerId={playerId}
        currentLevelNum={currentLevelNum}
        currentChips={currentChips}
      />
    </div>
  );
}

function ExchangeForm({
  sessionId,
  playerId,
  chipDenominations,
  currentColorUp,
}: {
  sessionId: string;
  playerId: string;
  chipDenominations: Array<{ color: string; value: number }>;
  currentColorUp: number[];
}) {
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

function StackCountForm({
  tournamentId,
  playerId,
  currentLevelNum,
  currentChips,
}: {
  tournamentId: string;
  playerId: string;
  currentLevelNum: number;
  currentChips: number;
}) {
  const [stackInput, setStackInput] = useState(String(currentChips));
  const [status, setStatus] = useState<Submission>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const parsed = Number.parseInt(stackInput, 10);
  const valid = Number.isFinite(parsed) && parsed >= 0;
  const delta = valid ? parsed - currentChips : 0;

  async function submit() {
    if (!valid) return;
    setStatus("submitting");
    setErrorMsg(null);
    const res = await submitChipSnapshot({
      tournamentId,
      playerId,
      anonSession: getOrCreateAnonSession(),
      chips: parsed,
    });
    if (res.ok) {
      setStatus("submitted");
    } else {
      setStatus("error");
      setErrorMsg(res.error);
    }
  }

  return (
    <div className="rounded-2xl border border-fg/15 bg-bg/40 p-5">
      <p className="text-label text-xs uppercase tracking-widest">
        Log your stack — Level {currentLevelNum}
      </p>
      <p className="mt-2 text-sm text-fg/60">
        After you finish coloring up, count your chips and submit your total.
        We use this for break-over-break analytics. Last logged total:{" "}
        <span className="font-mono text-fg">
          ${currentChips.toLocaleString()}
        </span>
        .
      </p>

      <label className="mt-4 block">
        <span className="text-label text-xs uppercase tracking-widest">
          Total chips
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={stackInput}
          onChange={(e) => {
            setStackInput(e.target.value);
            if (status === "submitted") setStatus("idle");
          }}
          className="mt-2 w-full rounded-xl border border-fg/20 bg-bg px-4 py-4 text-3xl tabular-nums text-fg outline-none focus:border-gold-bright"
          aria-invalid={!valid}
        />
      </label>

      {valid && delta !== 0 ? (
        <p className="mt-3 text-sm text-fg/70">
          {delta > 0 ? "Up" : "Down"}{" "}
          <span
            className={`font-mono ${delta > 0 ? "text-success" : "text-danger"}`}
          >
            ${Math.abs(delta).toLocaleString()}
          </span>{" "}
          since the last update.
        </p>
      ) : null}

      {errorMsg ? (
        <p className="mt-3 rounded-2xl border border-danger/60 bg-danger/10 p-3 text-sm text-danger">
          {errorMsg}
        </p>
      ) : null}

      {status === "submitted" ? (
        <p className="mt-3 rounded-2xl border border-success/60 bg-success/10 p-3 text-sm text-success">
          Logged. Average stack on the TV will reflect your total.
        </p>
      ) : (
        <button
          type="button"
          disabled={!valid || status === "submitting"}
          onClick={submit}
          className="mt-3 w-full rounded-2xl border border-gold-bright bg-gold/15 px-5 py-4 text-base font-semibold uppercase tracking-widest text-gold-bright disabled:border-fg/10 disabled:bg-fg/5 disabled:text-fg/30"
        >
          {status === "submitting" ? "Logging…" : "Log my stack"}
        </button>
      )}
    </div>
  );
}
