import "server-only";

/**
 * Resolves the Signal group id messages should be sent to in the current
 * environment.
 *
 * - Production (`VERCEL_ENV === 'production'`)  → SIGNAL_TOURNAMENT_GROUP_ID
 * - Everything else (preview, dev, local)       → SIGNAL_SANDBOX_GROUP_ID
 *
 * This env-aware mapping is the single gate that keeps bot traffic out of
 * the real tournament chat. Any Preview deploy or local `next dev` run
 * physically cannot reach the production group from this code path — it
 * doesn't even read that env var.
 */
export function getTargetGroupId(): string {
  const key = isProductionTarget()
    ? "SIGNAL_TOURNAMENT_GROUP_ID"
    : "SIGNAL_SANDBOX_GROUP_ID";
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set in the current environment`);
  return value;
}

/** True iff this process would dispatch to the real tournament group. */
export function isProductionTarget(): boolean {
  return process.env.VERCEL_ENV === "production";
}
