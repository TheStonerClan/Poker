import "server-only";

import { createClient } from "@/lib/supabase/server";

/** House rule: the bounty stacks by this amount each time it goes unclaimed. */
export const BASE_BOUNTY_AMOUNT = 20;

export type ResolvedBounty = {
  targetPlayerId: string;
  amount: number;
};

/**
 * Resolve the bounty for a brand-new tournament: the highest-placed
 * player from the most recent FINISHED tournament (scoped to the same
 * is_sandbox flag) who is also seated in tonight's roster. Walks
 * 1st -> 2nd -> 3rd -> ... until it finds someone who's back. Returns
 * null if there's no prior finished tournament, or none of its finishers
 * are playing tonight.
 *
 * Stacking: if that same player was ALSO the prior tournament's bounty
 * target and nobody collected it (they won outright, or it just never
 * got recorded), the bounty didn't pay out — so instead of resetting to
 * the base $20, it carries forward and grows by another $20. Breaks the
 * moment a different player becomes the target (a bounty on someone who
 * isn't playing tonight doesn't carry to whoever inherits it).
 *
 * Called once, at tournament creation — the result is persisted on
 * `tournaments.bounty_target_player_id` / `bounty_amount` rather than
 * recomputed live, so it stays stable for the night even as busts/
 * rebuys change the roster.
 */
export async function resolveBounty(args: {
  isSandbox: boolean;
  rosterPlayerIds: string[];
}): Promise<ResolvedBounty | null> {
  const supabase = await createClient();

  const { data: prior } = await supabase
    .from("tournaments")
    .select("id, bounty_target_player_id, bounty_amount, bounty_collected_by_player_id")
    .eq("status", "finished")
    .eq("is_sandbox", args.isSandbox)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!prior) return null;

  const { data: finishers } = await supabase
    .from("tournament_players")
    .select("player_id, finishing_position")
    .eq("tournament_id", prior.id)
    .not("finishing_position", "is", null)
    .order("finishing_position", { ascending: true });

  const roster = new Set(args.rosterPlayerIds);
  let targetPlayerId: string | null = null;
  for (const f of finishers ?? []) {
    if (f.player_id && roster.has(f.player_id)) {
      targetPlayerId = f.player_id;
      break;
    }
  }
  if (!targetPlayerId) return null;

  const bountyWentUnclaimed =
    prior.bounty_target_player_id === targetPlayerId &&
    prior.bounty_collected_by_player_id == null;

  // Number(...) guards against Postgres `numeric` columns coming back as
  // strings — without it, a stacked amount could silently string-concat
  // ("20" + 20 -> "2020") instead of adding.
  const amount = bountyWentUnclaimed
    ? Number(prior.bounty_amount ?? BASE_BOUNTY_AMOUNT) + BASE_BOUNTY_AMOUNT
    : BASE_BOUNTY_AMOUNT;

  return { targetPlayerId, amount };
}
