// Server-safe clock math. Deliberately has NO "use client" directive so it
// can be imported from server routes/actions (e.g. the auto-advance API) as
// a real, callable function. When this logic lived in `useLevelClock.ts`
// (a "use client" module), importing it into the server-side auto-advance
// route turned `computeElapsedMs` into a client-reference stub — calling it
// threw at runtime, the route 500'd, and levels never auto-advanced.

export type ClockInputs = {
  status: string;
  durationSec: number;
  levelStartedAt: string | null;
  levelPausedAt: string | null;
  accumulatedPauseMs: number;
};

/**
 * Compute the elapsed milliseconds within the current level, given the
 * server's authoritative timestamps. The clock is "frozen" while paused
 * and resumes from where it left off — accumulated pause time is stored
 * server-side in `accumulated_pause_ms`.
 */
export function computeElapsedMs(inputs: ClockInputs, nowMs: number): number {
  if (!inputs.levelStartedAt) return 0;
  const start = Date.parse(inputs.levelStartedAt);
  if (Number.isNaN(start)) return 0;

  const referenceMs =
    inputs.status === "paused" && inputs.levelPausedAt
      ? Date.parse(inputs.levelPausedAt)
      : nowMs;

  const elapsed = referenceMs - start - (inputs.accumulatedPauseMs ?? 0);
  return Math.max(0, elapsed);
}
