"use client";

import { useEffect, useState } from "react";

type Props = {
  /** ISO-8601 string from Supabase (UTC). */
  iso: string | null;
  /** Optional date-time format options forwarded to `toLocaleString`. */
  options?: Intl.DateTimeFormatOptions;
  /** Fallback shown before hydration and when `iso` is null. */
  placeholder?: string;
};

const DEFAULT_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

/**
 * Renders a Supabase ISO timestamp in the user's local timezone.
 *
 * Server-rendered output uses `placeholder` (defaults to "—") so the
 * SSR pass and the first client render agree — no hydration mismatch.
 * After hydration, useEffect formats the date with `toLocaleString()`,
 * which on the client picks up the browser's locale + timezone.
 *
 * Without this, calling `toLocaleString` on the server uses the host's
 * timezone (Vercel = UTC) and the user sees UTC times in /admin/history.
 */
export default function LocalDateTime({
  iso,
  options = DEFAULT_OPTIONS,
  placeholder = "—",
}: Props) {
  const [text, setText] = useState<string>(placeholder);

  useEffect(() => {
    if (!iso) {
      setText(placeholder);
      return;
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      setText(placeholder);
      return;
    }
    setText(d.toLocaleString(undefined, options));
  }, [iso, options, placeholder]);

  return <span suppressHydrationWarning>{text}</span>;
}
