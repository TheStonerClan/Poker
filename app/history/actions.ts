"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import {
  refreshAllPlayerImpressions,
  type RefreshImpressionsResult,
} from "@/lib/admin/impressions";

export type RefreshImpressionsActionResult =
  | { status: "ok"; count: number }
  | { status: "error"; message: string };

/**
 * Admin-only, on-demand version of the impression refresh that
 * normally only runs automatically at the end of `performFinalize`.
 * Useful right after a manual stats correction (a backfilled rebuy, a
 * fixed payout, ...) so the AI blurbs don't sit stale until the next
 * tournament finishes. Regenerates EVERY player with at least one
 * recorded game in this scope (real league or sandbox) — not scoped
 * to whichever player's page the admin happened to be on, and
 * deliberately broader than performFinalize's own call, which only
 * covers that night's roster to keep the routine per-finalize refresh
 * cheap.
 */
export async function refreshPlayerImpressions(input: {
  isSandbox: boolean;
}): Promise<RefreshImpressionsActionResult> {
  await requireAdmin();

  const result: RefreshImpressionsResult = await refreshAllPlayerImpressions({
    isSandbox: input.isSandbox,
  });
  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  // Every player's profile page reads the impression it just wrote, so
  // invalidate the whole history subtree rather than one player's path.
  revalidatePath(input.isSandbox ? "/sandboxadmin/history" : "/history", "layout");

  return { status: "ok", count: result.count };
}
