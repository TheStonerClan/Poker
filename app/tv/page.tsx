import { headers } from "next/headers";

import TvDisplay from "@/components/tv/TvDisplay";
import { createServiceClient } from "@/lib/supabase/service";
import type {
  TournamentPlayerWithName,
  TournamentRow,
} from "@/lib/tv/types";

// The TV display reads live state (active tournament, headers for the QR
// origin); never prerender it at build time.
export const dynamic = "force-dynamic";

function WaitingScreen({ subtitle }: { subtitle?: string }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-bg text-fg">
      <span className="text-label uppercase tracking-[0.4em] text-sm">
        Holdem Clock
      </span>
      <h1 className="mt-4 font-mono text-fg text-5xl tabular-nums">
        Waiting for tournament…
      </h1>
      <p className="mt-6 text-fg/60 max-w-md text-center">
        {subtitle ?? "The TV will pick up the next active tournament automatically."}
      </p>
    </main>
  );
}

export default async function TvPage() {
  // Touch headers() up front so this segment is always treated as dynamic
  // even when Cache Components isn't enabled.
  const h = await headers();

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return <WaitingScreen subtitle="Supabase not configured." />;
  }

  const supabase = createServiceClient();

  // Active tournament priority: running > paused > most-recently scheduled
  // not-yet-finished. Service role so this works without a signed-in admin.
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("*")
    .in("status", ["running", "paused", "scheduled"])
    .is("finished_at", null)
    .order("started_at", { ascending: false, nullsFirst: false })
    .order("scheduled_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!tournament) {
    return <WaitingScreen />;
  }

  const tournamentRow = tournament as TournamentRow;

  const { data: players } = await supabase
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
    .eq("tournament_id", tournamentRow.id);

  const initialPlayers = (players ?? []) as unknown as TournamentPlayerWithName[];

  // Build the player-view base URL from the request host so QR codes work in
  // any environment (localhost, staging, prod) without a separate env var.
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  const playSessionBaseUrl = `${proto}://${host}/play`;

  return (
    <TvDisplay
      tournamentId={tournamentRow.id}
      initialTournament={tournamentRow}
      initialPlayers={initialPlayers}
      playSessionBaseUrl={playSessionBaseUrl}
    />
  );
}
