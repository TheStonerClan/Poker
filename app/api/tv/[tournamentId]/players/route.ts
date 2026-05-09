import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * Public TV-display players feed. Joins `tournament_players` with `players`
 * so the bust list and stack stats can render names without exposing the
 * master roster to anon clients (RLS keeps `players` admin-only).
 *
 * Returns only fields the read-only TV display needs.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ tournamentId: string }> },
) {
  const { tournamentId } = await ctx.params;
  const supabase = createServiceClient();

  const [
    { data: rosterData, error: rosterErr },
    { data: eventsData },
    { data: colorUpData },
  ] = await Promise.all([
    supabase
      .from("tournament_players")
      .select(
        `
          id,
          tournament_id,
          player_id,
          seat_number,
          table_number,
          current_chips,
          buyback_used,
          buyback_used_as,
          buyback_used_at_level,
          buyback_used_at_time,
          busted_at_level,
          busted_at_time,
          finishing_position,
          payout_amount,
          claimed_session_id,
          claimed_at,
          created_at,
          updated_at,
          rebuys_used,
          addons_used,
          players ( id, name )
        `,
      )
      .eq("tournament_id", tournamentId),
    // Bust events power the TV's "last segment bust outs" counter so the
    // count survives rebuys (which clear busted_at_time on the player
    // row). Limit is generous; the TV slices to a smaller window.
    supabase
      .from("tournament_events")
      .select("type, payload, created_at")
      .eq("tournament_id", tournamentId)
      .in("type", ["bust", "break_start", "break_end"])
      .order("created_at", { ascending: true })
      .limit(500),
    // Approved color-up exchanges. The TV adds the sum of `net_change`
    // to total chips in play (and per-table when multi-table) so a
    // round-up exchange (23 → 25) shows +2 in the pool right after the
    // admin approves.
    supabase
      .from("color_up_requests")
      .select("player_id, exchange_for_chips")
      .eq("tournament_id", tournamentId)
      .eq("status", "approved"),
  ]);

  if (rosterErr) {
    return NextResponse.json({ error: rosterErr.message }, { status: 500 });
  }

  const colorUpGains = (colorUpData ?? [])
    .map((row) => {
      const efc = row.exchange_for_chips as { net_change?: number } | null;
      const delta =
        efc && typeof efc.net_change === "number" ? efc.net_change : 0;
      return { player_id: row.player_id ?? "", net_change: delta };
    })
    .filter((g) => g.player_id !== "" && g.net_change !== 0);

  return NextResponse.json(
    {
      players: rosterData ?? [],
      events: eventsData ?? [],
      colorUpGains,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
