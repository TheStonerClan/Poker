"use client";

import { useEffect } from "react";

/**
 * Error boundary for the /play tree. Replaces the generic Next 16
 * "page can't load" surface with something that tells the player what
 * to try and gives the admin a way to read the actual error.
 *
 * Errors thrown during a server-component render of the player view
 * land here. Production builds redact the message inside `error.message`
 * (Next 16 default) but `error.digest` is preserved — that's what the
 * admin can grep for in Vercel logs to find the underlying stack.
 */
export default function PlayErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error in the browser console so the admin can copy it
    // out without digging through Vercel logs (digest is the searchable
    // ID for prod tracebacks).
    // eslint-disable-next-line no-console
    console.error("/play error boundary caught:", error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 py-10 text-center">
      <p className="text-label text-xs uppercase tracking-[0.3em] text-fg/60">
        Holdem Clock
      </p>
      <h1 className="text-2xl font-semibold text-fg">
        Couldn&rsquo;t load the player view
      </h1>
      <p className="max-w-md text-sm text-fg/70">
        Something went wrong rendering this page. Try the button below — if
        it keeps failing, ask the admin to check the tournament setup.
      </p>
      {error.digest ? (
        <p className="font-mono text-[10px] text-fg/40">
          ref: {error.digest}
        </p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-2 h-12 min-h-[44px] rounded-md bg-gold px-6 text-sm font-semibold text-bg"
      >
        Try again
      </button>
    </main>
  );
}
