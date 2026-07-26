import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Resolve the $20 bounty target for a brand-new tournament: the highest-
 * placed player from the most recent FINISHED tournament (scoped to the
 * same is_sandbox flag) who is also seated in tonight's roster. Walks
 * 1st -> 2nd -> 3rd -> ... until it finds someone who's back. Returns
 * null if there's no prior finished tournament, or none of its finishers
 * are playing tonight.
 *
 * Called once, at tournament creation — the result is persisted on
 * `tournaments.bounty_target_player_id` rather than recomputed live, so
 * it stays stable for the night even as busts/rebuys change the roster.
 */
export async function resolveBountyTarget(args: {
  isSandbox: boolean;
  rosterPlayerIds: string[];
}): Promise<string | null> {
  const supabase = await createClient();

  const { data: prior } = await supabase
    .from("tournaments")
    .select("id")
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
  for (const f of finishers ?? []) {
    if (f.player_id && roster.has(f.player_id)) return f.player_id;
  }
  return null;
}
