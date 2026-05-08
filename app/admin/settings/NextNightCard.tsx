"use client";

import { useState, useTransition } from "react";

import {
  cancelNextNight,
  clearScheduleOverride,
  moveNextNight,
} from "./actions";

type Props = {
  templateId: string;
  /** ISO YYYY-MM-DD — the rule-computed date for the upcoming occurrence. */
  originalDate: string;
  /** ISO YYYY-MM-DD if moved; null if cancelled or unchanged. */
  overriddenDate: string | null;
  /** True iff a row exists in schedule_overrides for this originalDate. */
  hasOverride: boolean;
  note: string | null;
};

type Status = { kind: "ok" | "error"; message?: string } | null;

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export function NextNightCard({
  templateId,
  originalDate,
  overriddenDate,
  hasOverride,
  note,
}: Props) {
  const [mode, setMode] = useState<"idle" | "moving" | "cancelling">("idle");
  const [pickedDate, setPickedDate] = useState(overriddenDate ?? originalDate);
  const [pickedNote, setPickedNote] = useState(note ?? "");
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<Status>(null);

  const isMoved = hasOverride && overriddenDate !== null;
  const isCancelled = hasOverride && overriddenDate === null;

  function reset() {
    setMode("idle");
    setStatus(null);
    setPickedDate(overriddenDate ?? originalDate);
    setPickedNote(note ?? "");
  }

  function submitMove() {
    setStatus(null);
    start(async () => {
      const res = await moveNextNight({
        templateId,
        originalDate,
        overriddenDate: pickedDate,
        note: pickedNote.trim() || undefined,
      });
      setStatus(
        res.status === "ok"
          ? { kind: "ok", message: "Moved." }
          : { kind: "error", message: res.message ?? "Could not move." },
      );
      if (res.status === "ok") setMode("idle");
    });
  }

  function submitCancel() {
    setStatus(null);
    start(async () => {
      const res = await cancelNextNight({
        templateId,
        originalDate,
        note: pickedNote.trim() || undefined,
      });
      setStatus(
        res.status === "ok"
          ? { kind: "ok", message: "Cancelled." }
          : { kind: "error", message: res.message ?? "Could not cancel." },
      );
      if (res.status === "ok") setMode("idle");
    });
  }

  function submitClear() {
    setStatus(null);
    start(async () => {
      const res = await clearScheduleOverride({ templateId, originalDate });
      setStatus(
        res.status === "ok"
          ? { kind: "ok", message: "Restored." }
          : { kind: "error", message: res.message ?? "Could not restore." },
      );
      if (res.status === "ok") reset();
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
          Next poker night
        </p>
        {isCancelled ? (
          <p className="text-base text-fg">
            <span className="text-fg/60 line-through">{fmt(originalDate)}</span>{" "}
            <span className="text-danger">· cancelled</span>
          </p>
        ) : isMoved && overriddenDate ? (
          <p className="text-base text-fg">
            <span className="font-semibold text-gold">{fmt(overriddenDate)}</span>
            <span className="ml-2 text-xs text-fg/60">
              moved from {fmt(originalDate)}
            </span>
          </p>
        ) : (
          <p className="text-base font-semibold text-fg">{fmt(originalDate)}</p>
        )}
        {note ? (
          <p className="text-xs italic text-fg/60">&ldquo;{note}&rdquo;</p>
        ) : null}
      </div>

      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          {hasOverride ? (
            <button
              type="button"
              disabled={pending}
              onClick={submitClear}
              className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 px-3 text-sm font-semibold text-fg/80 disabled:opacity-50"
            >
              {pending ? "…" : "Restore original date"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setMode("moving")}
                className="h-11 min-h-[44px] flex-1 rounded-md bg-gold px-3 text-sm font-semibold text-bg"
              >
                Move
              </button>
              <button
                type="button"
                onClick={() => setMode("cancelling")}
                className="h-11 min-h-[44px] flex-1 rounded-md border border-danger/40 px-3 text-sm font-semibold text-danger"
              >
                Cancel this one
              </button>
            </>
          )}
        </div>
      ) : null}

      {mode === "moving" ? (
        <div className="flex flex-col gap-2 rounded-md border border-fg/15 p-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
              New date
            </span>
            <input
              type="date"
              value={pickedDate}
              min={originalDate}
              onChange={(e) => setPickedDate(e.target.value)}
              className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
              Why (optional)
            </span>
            <input
              type="text"
              value={pickedNote}
              maxLength={200}
              placeholder="Holiday weekend"
              onChange={(e) => setPickedNote(e.target.value)}
              className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={reset}
              className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 text-sm font-semibold text-fg/80"
            >
              Back
            </button>
            <button
              type="button"
              disabled={pending || pickedDate === originalDate || !pickedDate}
              onClick={submitMove}
              className="h-11 min-h-[44px] flex-1 rounded-md bg-gold text-sm font-semibold text-bg disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save move"}
            </button>
          </div>
        </div>
      ) : null}

      {mode === "cancelling" ? (
        <div className="flex flex-col gap-2 rounded-md border border-danger/40 p-3">
          <p className="text-sm text-fg/80">
            Skip the {fmt(originalDate)} night? The next scheduled night will
            be the rule&rsquo;s following occurrence.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
              Why (optional)
            </span>
            <input
              type="text"
              value={pickedNote}
              maxLength={200}
              placeholder="Out of town"
              onChange={(e) => setPickedNote(e.target.value)}
              className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={reset}
              className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 text-sm font-semibold text-fg/80"
            >
              Back
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={submitCancel}
              className="h-11 min-h-[44px] flex-1 rounded-md bg-danger text-sm font-semibold text-bg disabled:opacity-50"
            >
              {pending ? "Cancelling…" : "Confirm cancel"}
            </button>
          </div>
        </div>
      ) : null}

      {status?.kind === "error" ? (
        <p
          role="alert"
          className="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {status.message}
        </p>
      ) : null}
      {status?.kind === "ok" ? (
        <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          {status.message}
        </p>
      ) : null}

      <p className="text-xs text-fg/50">
        One-off changes don&rsquo;t affect the recurring rule above. Signal
        reminders will follow this date.
      </p>
    </div>
  );
}
