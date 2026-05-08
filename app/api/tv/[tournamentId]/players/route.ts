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

  const [{ data: rosterData, error: rosterErr }, { data: eventsData }] =
    await Promise.all([
      supabase
        .from("tournament_players")
        .select(
          `
            id,
            tournament_id,
            player_id,
            seat_number,
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
    ]);

  if (rosterErr) {
    return NextResponse.json({ error: rosterErr.message }, { status: 500 });
  }

  return NextResponse.json(
    { players: rosterData ?? [], events: eventsData ?? [] },
    { headers: { "cache-control": "no-store" } },
  );
}
