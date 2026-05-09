"use client";

import { useEffect, useState } from "react";

/**
 * Error boundary for the /play tree.
 *
 * Surfaces enough detail on screen that the admin can read off the
 * actual error from the player's phone — Next 16 redacts SERVER error
 * messages in production but client-side `error.message` survives, and
 * even server errors carry a `digest` we can grep against Vercel logs.
 *
 * The collapsible "details" payload is plain text the player can
 * screenshot or copy + paste into a message.
 */
export default function PlayErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    // Always log to the browser console — invisible on iOS without a
    // dev console, but valuable when somebody DOES debug from a Mac.
    // eslint-disable-next-line no-console
    console.error("/play error boundary caught:", error);
  }, [error]);

  const stackHead = (error.stack ?? "")
    .split("\n")
    .slice(0, 4)
    .join("\n")
    .trim();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 py-10 text-center">
      <p className="text-label text-xs uppercase tracking-[0.3em] text-fg/60">
        Holdem Clock
      </p>
      <h1 className="text-2xl font-semibold text-fg">
        Couldn&rsquo;t load the player view
      </h1>
      <p className="max-w-md text-sm text-fg/70">
        Something went wrong rendering this page. Tap &ldquo;Try again.&rdquo;
        If it keeps failing, tap &ldquo;Show details&rdquo; and send the text
        to the admin.
      </p>

      <button
        type="button"
        onClick={reset}
        className="mt-2 h-12 min-h-[44px] rounded-md bg-gold px-6 text-sm font-semibold text-bg"
      >
        Try again
      </button>

      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        className="text-xs text-fg/50 underline-offset-4 hover:underline"
      >
        {showDetails ? "Hide details" : "Show details"}
      </button>

      {showDetails ? (
        <pre
          className="mt-2 max-w-full overflow-auto rounded-md border border-fg/15 bg-fg/[0.03] p-3 text-left text-[11px] leading-snug text-fg/80"
          style={{ fontFamily: "ui-monospace, monospace" }}
        >
          {[
            error.name ? `name:    ${error.name}` : null,
            error.message ? `message: ${error.message}` : null,
            error.digest ? `digest:  ${error.digest}` : null,
            stackHead ? `\n${stackHead}` : null,
          ]
            .filter(Boolean)
            .join("\n")}
        </pre>
      ) : null}
    </main>
  );
}
