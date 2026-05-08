"use client";

import { useMemo, useState, useTransition } from "react";

import { describe, nextOccurrence } from "@/lib/track-stubs/recurrence";
import type {
  NthWeekday,
  RecurrenceRule,
  Weekday,
} from "@/lib/track-stubs/recurrence";

type EditableRule =
  | { kind: "nthWeekdayOfMonth"; nth: NthWeekday; weekday: Weekday }
  | { kind: "everyNDays"; n: number };

import { updateRecurrence } from "./actions";

const NTHS: Array<{ value: NthWeekday; label: string }> = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
  { value: -1, label: "Last" },
];

const WEEKDAYS: Array<{ value: Weekday; label: string }> = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

function parseRule(raw: string | null | undefined): RecurrenceRule | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed?.kind === "nthWeekdayOfMonth" ||
      parsed?.kind === "everyNDays" ||
      parsed?.kind === "specificDates"
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export function RecurrenceEditor({
  templateId,
  templateName,
  ruleString,
}: {
  templateId: string;
  templateName: string;
  ruleString: string | null;
}) {
  const initial = useMemo(() => parseRule(ruleString), [ruleString]);
  const [enabled, setEnabled] = useState(initial != null);
  const [nth, setNth] = useState<NthWeekday>(
    initial?.kind === "nthWeekdayOfMonth" ? initial.nth : 3,
  );
  const [weekday, setWeekday] = useState<Weekday>(
    initial?.kind === "nthWeekdayOfMonth" ? initial.weekday : 5,
  );
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{
    kind: "ok" | "error";
    message?: string;
  } | null>(null);

  const rule: EditableRule | null = enabled
    ? { kind: "nthWeekdayOfMonth", nth, weekday }
    : null;
  const previewRule: RecurrenceRule | null = rule;

  let nextStr = "—";
  if (previewRule) {
    try {
      nextStr = nextOccurrence(previewRule, new Date()).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      nextStr = "—";
    }
  }

  function save() {
    setStatus(null);
    start(async () => {
      const res = await updateRecurrence({ templateId, rule });
      setStatus(
        res.status === "ok"
          ? { kind: "ok", message: "Saved." }
          : { kind: "error", message: res.message ?? "Could not save." },
      );
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-3">
      <p className="text-xs text-fg/60">Schedule for {templateName}.</p>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-5 w-5 accent-[var(--color-gold)]"
        />
        <span className="text-sm text-fg/80">Enable recurring schedule</span>
      </label>

      {enabled ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
                Which
              </span>
              <select
                value={String(nth)}
                onChange={(e) =>
                  setNth(Number(e.target.value) as NthWeekday)
                }
                className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none"
              >
                {NTHS.map((n) => (
                  <option key={n.value} value={n.value}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
                Day
              </span>
              <select
                value={String(weekday)}
                onChange={(e) =>
                  setWeekday(Number(e.target.value) as Weekday)
                }
                className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none"
              >
                {WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-fg/60">
            <span className="text-fg/80">{describe(previewRule!)}</span>. Next:{" "}
            <span className="text-fg/80">{nextStr}</span>.
          </p>
        </>
      ) : (
        <p className="text-xs text-fg/50">No schedule — tournaments are created on demand.</p>
      )}

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

      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="h-12 min-h-[44px] rounded-md bg-gold text-sm font-semibold text-bg disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save schedule"}
      </button>
    </div>
  );
}
