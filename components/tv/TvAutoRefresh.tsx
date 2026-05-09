"use client";

import { useEffect } from "react";

type Props = {
  /** Delay between page reloads in seconds. */
  intervalSec?: number;
};

/**
 * Drop-in for the static /tv views (waiting screen, recap). Triggers a
 * full page reload every N seconds so the route re-evaluates which view
 * to render — once a new tournament goes live (or the recap window
 * expires), the next reload picks up the change without anyone having
 * to refresh the TV manually.
 *
 * Don't add this to the live <TvDisplay>: that component already pulls
 * fresh state via Realtime + 5s drift sync without a full reload, and a
 * forced reload would interrupt the running timer.
 *
 * Implemented as a client component with `setTimeout` rather than a
 * `<meta httpEquiv="refresh">` tag because Next 16 hoists `<meta>` only
 * when used at the top of the metadata graph; embedding one inside a
 * component leaves it in `<body>` where browser support is inconsistent.
 *
 * The reload is cheap: /tv is `force-dynamic` and serves a fresh server
 * render, which is exactly what we want.
 */
export default function TvAutoRefresh({ intervalSec = 60 }: Props) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.setTimeout(() => {
      window.location.reload();
    }, intervalSec * 1000);
    return () => window.clearTimeout(id);
  }, [intervalSec]);

  return null;
}
