// Server-side Signal dispatcher.
//
// Wraps `sendToGroup()` from the signal-cli helper with:
//   1. Environment-aware group resolution (sandbox vs tournament).
//   2. Idempotency via the `signal_dispatches` table — a unique `key`
//      per logical event means a duplicate dispatch raises 23505 instead
//      of double-sending.
//   3. Audit trail — every attempt is recorded (sent / failed / skipped)
//      with bridge response or error text for after-the-fact debugging.
//
// Callers (cron route, finalize hook, admin test endpoint) construct the
// final message string themselves via the pure formatters in
// scripts/signal-cli/messages/*, then call dispatchMessage(). The split
// keeps presentation logic out of this file and side-effecty logic out
// of the formatters.

import "server-only";

import { sendToGroup } from "@/scripts/signal-cli/send";

import { createServiceClient } from "@/lib/supabase/service";

import type {
  SignalDispatchInsert,
  SignalDispatchUpdate,
} from "./db-augment";
import { getTargetGroupId } from "./group";

// signal_dispatches isn't in the generated database.types.ts until
// migration 0010 is applied + types are regenerated. We cast the typed
// query builder per call so the rest of the codebase stays strictly typed.
// Drop these casts once `supabase gen types` includes the table.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTableBuilder = any;

export type DispatchKind = "week-out" | "recap";

export interface DispatchInput {
  kind: DispatchKind;
  /**
   * Deterministic key that identifies the logical event being dispatched.
   *
   *   week-out → `week-out:<template_id>:<YYYY-MM-DD effective date>`
   *   recap    → `recap:<tournament_id>`
   *
   * A second call with the same key short-circuits via the unique
   * constraint on `signal_dispatches.key`.
   */
  key: string;
  /**
   * Message body. Do NOT include the `[PokerBot] ` prefix — `sendToGroup`
   * adds it. Build via the formatter layer
   * (`buildWeekOutMessage` / `buildRecapMessage`).
   */
  body: string;
  /**
   * When true: skip the bridge call, return a `skipped` result with reason
   * `dry-run`, and do NOT insert into the dispatch ledger. Use from the
   * admin test endpoint to preview without consuming the idempotency key.
   */
  dryRun?: boolean;
}

export interface DispatchResult {
  status: "sent" | "failed" | "skipped";
  /** Free-form reason for `failed` / `skipped` outcomes. */
  reason?: string;
  /** Whatever the bridge returned on success (typically `{timestamp}`). */
  bridgeResponse?: unknown;
  /** The Signal group id we targeted (after env-aware resolution). */
  groupId: string;
}

/**
 * Dispatch a Signal message via the bridge with idempotency + audit. Safe
 * to call multiple times with the same `key` — only the first lands on
 * Signal.
 *
 * Never throws to the caller for routine outcomes (already dispatched,
 * bridge unreachable). Only throws if the dispatch ledger itself is
 * unreachable, which is treated as a hard infra failure.
 */
export async function dispatchMessage(
  input: DispatchInput,
): Promise<DispatchResult> {
  const groupId = getTargetGroupId();

  if (input.dryRun) {
    return { status: "skipped", reason: "dry-run", groupId };
  }

  const supabase = createServiceClient();
  const dispatches = (): AnyTableBuilder =>
    supabase.from("signal_dispatches" as never);

  // Reserve the dispatch slot up front. If the unique constraint fires, a
  // prior call (cron retry, admin re-click) already sent. This MUST happen
  // before the bridge call so a re-entrant invocation can't double-send.
  const insertRow: SignalDispatchInsert = {
    kind: input.kind,
    key: input.key,
    group_id: groupId,
    status: "sent", // optimistic; updated to 'failed' below on bridge error
    bridge_response: {
      phase: "attempting",
      started_at: new Date().toISOString(),
    },
  };
  const { error: insertErr } = await dispatches().insert(insertRow);

  if (insertErr) {
    // 23505 = unique_violation on `key`. Means another caller beat us to it.
    if (insertErr.code === "23505") {
      return { status: "skipped", reason: "already-dispatched", groupId };
    }
    // Any other ledger error is infra-level — surface so the caller knows
    // not to assume the dispatch happened.
    throw new Error(`signal_dispatches insert failed: ${insertErr.message}`);
  }

  // Bridge call.
  let bridgeResponse: unknown;
  try {
    bridgeResponse = await sendToGroup(groupId, input.body);
  } catch (err) {
    const errorText = err instanceof Error ? err.message : String(err);
    const failUpdate: SignalDispatchUpdate = {
      status: "failed",
      bridge_response: {
        error: errorText,
        failed_at: new Date().toISOString(),
      },
    };
    await dispatches().update(failUpdate).eq("key", input.key);
    return { status: "failed", reason: errorText, groupId };
  }

  // Finalize the ledger row with the bridge response.
  const okUpdate: SignalDispatchUpdate = {
    bridge_response: bridgeResponse as Record<string, unknown>,
  };
  await dispatches().update(okUpdate).eq("key", input.key);

  return { status: "sent", bridgeResponse, groupId };
}
