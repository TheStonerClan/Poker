"use client";

import { useMemo, useState, useTransition } from "react";

import { describe, nextOccurrence } from "@poker/recurrence";
import type {
  NthWeekday,
  RecurrenceRule,
  Weekday,
} from "@poker/recurrence";

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

/**
 * Curated short list of timezones — covers the US poker-night
 * universe plus a few common international zones for traveling
 * players. The admin can pick anything in this list. If their detected
 * zone isn't here, we slot it in as the first option so they can
 * still keep the default; full IANA list isn't worth the UI weight.
 */
const COMMON_TZS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "America/Los_Angeles", label: "Los Angeles (PT)" },
  { value: "America/Denver", label: "Denver (MT)" },
  { value: "America/Phoenix", label: "Phoenix (AZ, no DST)" },
  { value: "America/Chicago", label: "Chicago (CT)" },
  { value: "America/New_York", label: "New York (ET)" },
  { value: "America/Anchorage", label: "Anchorage (AK)" },
  { value: "Pacific/Honolulu", label: "Honolulu (HI)" },
  { value: "Europe/London", label: "London (UK)" },
  { value: "Europe/Berlin", label: "Berlin / Paris" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Australia/Sydney", label: "Sydney" },
  { value: "UTC", label: "UTC" },
];

function detectLocalTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

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

function isValidHhMm(s: string): boolean {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s);
}

export function RecurrenceEditor({
  templateId,
  templateName,
  ruleString,
  startTime,
  startTimezone,
}: {
  templateId: string;
  templateName: string;
  ruleString: string | null;
  startTime: string | null;
  startTimezone: string | null;
}) {
  const initial = useMemo(() => parseRule(ruleString), [ruleString]);
  const [enabled, setEnabled] = useState(initial != null);
  const [nth, setNth] = useState<NthWeekday>(
    initial?.kind === "nthWeekdayOfMonth" ? initial.nth : 3,
  );
  const [weekday, setWeekday] = useState<Weekday>(
    initial?.kind === "nthWeekdayOfMonth" ? initial.weekday : 5,
  );

  // Time-of-day controls. Default to whatever was saved; if nothing
  // saved, leave both empty so an admin who doesn't care about a
  // start time can keep the existing date-only behavior.
  const [time, setTime] = useState<string>(startTime ?? "");
  // The timezone select defaults to whatever was saved, falling back
  // to the admin's detected local zone on the first client render.
  // We can't seed `useState` with `Intl.DateTimeFormat(...)` directly
  // because that'd run on the server (UTC) and disagree with the
  // hydrated value. Instead: stay empty through SSR, then on the
  // first client render, compare-and-set during render — the
  // React-blessed pattern that doesn't trip
  // react-hooks/set-state-in-effect (see
  // https://react.dev/learn/you-might-not-need-an-effect).
  const [tz, setTz] = useState<string>(startTimezone ?? "");
  const [tzDetected, setTzDetected] = useState(false);
  if (!tzDetected && typeof window !== "undefined") {
    setTzDetected(true);
    if (!tz) setTz(detectLocalTz());
  }

  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{
    kind: "ok" | "error";
    message?: string;
  } | null>(null);

  const rule: EditableRule | null = enabled
    ? { kind: "nthWeekdayOfMonth", nth, weekday }
    : null;
  const previewRule: RecurrenceRule | null = rule;

  // The timezone select can offer the curated list plus a slot for
  // the admin's detected zone if it isn't in the curation.
  const tzOptions = useMemo(() => {
    const list = [...COMMON_TZS];
    const detected = detectLocalTz();
    if (detected && !list.some((o) => o.value === detected)) {
      list.unshift({ value: detected, label: `${detected} (your zone)` });
    }
    if (tz && !list.some((o) => o.value === tz)) {
      list.unshift({ value: tz, label: tz });
    }
    return list;
  }, [tz]);

  // Time + timezone validation. The save button is disabled when the
  // pair isn't valid so we don't fire an action that the server has
  // to reject.
  const timeTouched = time.length > 0;
  const timeValid = !timeTouched || isValidHhMm(time);
  const tzValid = !timeTouched || tz.length > 0;
  const canSave = !pending && timeValid && tzValid;

  let nextStr = "—";
  if (previewRule) {
    try {
      const next = nextOccurrence(previewRule, new Date());
      nextStr = next.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      if (timeTouched && timeValid && tzValid) {
        // Append the wall-clock time so the admin sees what the
        // homepage will show before they click save.
        nextStr += ` at ${time}`;
      }
    } catch {
      nextStr = "—";
    }
  }

  function save() {
    setStatus(null);
    start(async () => {
      const res = await updateRecurrence({
        templateId,
        rule,
        startTime: timeTouched ? time : null,
        startTimezone: timeTouched ? tz : null,
      });
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

          {/* Time + timezone — optional. Leaving Time empty preserves
              the legacy date-only behavior; setting it pairs with a
              required timezone (defaults to your local). */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[120px_1fr]">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
                Time (24h)
              </span>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder="--:--"
                className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
                Timezone
              </span>
              <select
                value={tz}
                onChange={(e) => setTz(e.target.value)}
                disabled={!timeTouched}
                className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none disabled:opacity-40"
              >
                {tzOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!timeValid ? (
            <p className="text-xs text-danger">
              Time must be HH:MM (24-hour), e.g. 19:00.
            </p>
          ) : null}

          <p className="text-xs text-fg/60">
            <span className="text-fg/80">{describe(previewRule!)}</span>. Next:{" "}
            <span className="text-fg/80">{nextStr}</span>
            {timeTouched && timeValid && tzValid ? (
              <span className="ml-1 text-fg/50">({tz})</span>
            ) : null}
            .
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
        disabled={!canSave}
        onClick={save}
        className="h-12 min-h-[44px] rounded-md bg-gold text-sm font-semibold text-bg disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save schedule"}
      </button>
    </div>
  );
}
