"use client";

import { useSyncExternalStore } from "react";

import { computeElapsedMs } from "./elapsed";
import type { ClockInputs } from "./elapsed";

// Re-exported so existing client consumers can keep importing these from
// `useLevelClock`. The implementation lives in the server-safe `./elapsed`
// module — the auto-advance API route needs to call `computeElapsedMs` on
// the server, which is impossible when it's exported from a "use client"
// module (the import becomes an uncallable client-reference stub).
export { computeElapsedMs };
export type { ClockInputs };

export type ClockState = {
  remainingSec: number;
  elapsedSec: number;
  durationSec: number;
  isPaused: boolean;
  isRunning: boolean;
};

// External clock store: a single 250ms heartbeat shared by every consumer.
let nowMs = 0;
const listeners = new Set<() => void>();
let intervalId: number | null = null;

function notify() {
  nowMs = Date.now();
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (intervalId == null && typeof window !== "undefined") {
    nowMs = Date.now();
    intervalId = window.setInterval(notify, 250);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && intervalId != null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getSnapshot(): number {
  return nowMs || Date.now();
}

function getServerSnapshot(): number {
  // Stable on the server so SSR doesn't crash hydration. The clock
  // becomes accurate as soon as the client subscribes.
  return 0;
}

/**
 * Tick the level clock. Subscribes to a shared 250ms heartbeat so every
 * consumer re-renders together; reads `nowMs` via useSyncExternalStore so
 * the body remains a pure function of inputs.
 */
export function useLevelClock(inputs: ClockInputs): ClockState {
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const elapsedMs = now > 0 ? computeElapsedMs(inputs, now) : 0;
  const elapsedSec = Math.floor(elapsedMs / 1000);
  const remainingSec = Math.max(0, inputs.durationSec - elapsedSec);

  return {
    elapsedSec,
    remainingSec,
    durationSec: inputs.durationSec,
    isPaused: inputs.status === "paused",
    isRunning: inputs.status === "running",
  };
}
