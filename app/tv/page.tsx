import { headers } from "next/headers";

import TvAutoRefresh from "@/components/tv/TvAutoRefresh";
import TvDisplay from "@/components/tv/TvDisplay";
import TvPregame from "@/components/tv/TvPregame";
import TvRecap from "@/components/tv/TvRecap";
import { createServiceClient } from "@/lib/supabase/service";
import type {
  TournamentPlayerWithName,
  TournamentRow,
} from "@/lib/tv/types";

// How long after `finished_at` the TV keeps showing the recap. After this
// the screen falls back to the "waiting for tournament" state. 6 hours is
// long enough to cover a slow late-night settle-up but short enough that
// the next morning the screen is clean.
const RECAP_WINDOW_MS = 6 * 60 * 60 * 1000;

// The TV display reads live state (active tournament, headers for the QR
// origin); never prerender it at build time.
export const dynamic = "force-dynamic";

function WaitingScreen({ subtitle }: { subtitle?: string }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-bg text-fg">
      {/* Reload every minute so the screen flips to the live display the
          moment the admin starts a tournament — no need to refresh the
          TV by hand at the start of poker night. */}
      <TvAutoRefresh intervalSec={60} />
      <span className="text-label uppercase tracking-[0.4em] text-sm">
        Holdem Clock
      </span>
      <h1 className="mt-4 font-mono text-fg text-[clamp(2rem,7vw,3.75rem)] tabular-nums">
        Waiting for tournament…
      </h1>
      <p className="mt-6 text-fg/60 max-w-md text-center px-6">
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
    // No active tournament — check if there's a recently-finalized one to
    // show as a recap. Anything finished within RECAP_WINDOW_MS is fair
    // game; older results live on /admin/history.
    const recapCutoff = new Date(Date.now() - RECAP_WINDOW_MS).toISOString();
    const { data: recapTournament } = await supabase
      .from("tournaments")
      .select("*")
      .eq("status", "finished")
      .gte("finished_at", recapCutoff)
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!recapTournament) {
      return <WaitingScreen />;
    }

    const recapRow = recapTournament as TournamentRow;
    const [
      { data: recapPlayers },
      { data: recapPayouts },
      { data: recapSnapshots },
      { data: recapGameEvents },
    ] = await Promise.all([
      supabase
        .from("tournament_players")
        .select(
          "id, player_id, current_chips, buyback_used, buyback_used_as, busted_at_level, busted_at_time, finishing_position, payout_amount, players(id, name)",
        )
        .eq("tournament_id", recapRow.id),
      supabase
        .from("prize_distributions")
        .select("position, amount, player_id, is_chopped")
        .eq("tournament_id", recapRow.id)
        .order("position", { ascending: true }),
      // Chip snapshots for the "Biggest swings" section. Ordered ASC
      // so biggestChipSwings can scan in order without resorting.
      supabase
        .from("tournament_events")
        .select("type, payload, created_at")
        .eq("tournament_id", recapRow.id)
        .eq("type", "chip_snapshot")
        .order("created_at", { ascending: true }),
      // Bust / rebuy / addon events power the per-player history
      // timeline on the Stats slide ("bust L4 → rebuy L5 → bust L7").
      // Ordered ASC so each player's history reads chronologically.
      supabase
        .from("tournament_events")
        .select("type, payload, created_at")
        .eq("tournament_id", recapRow.id)
        .in("type", ["bust", "rebuy", "addon"])
        .order("created_at", { ascending: true }),
    ]);

    return (
      <TvRecap
        tournament={recapRow}
        players={(recapPlayers ?? []) as unknown as TournamentPlayerWithName[]}
        payouts={recapPayouts ?? []}
        chipSnapshots={
          (recapSnapshots ?? []) as Array<{
            type: string;
            payload: Record<string, unknown> | null;
            created_at: string;
          }>
        }
        gameEvents={
          (recapGameEvents ?? []) as Array<{
            type: string;
            payload: Record<string, unknown> | null;
            created_at: string;
          }>
        }
      />
    );
  }

  const tournamentRow = tournament as TournamentRow;

  // Build the player-view base URL from the request host so QR codes work in
  // any environment (localhost, staging, prod) without a separate env var.
  // Hoisted above the pregame branch so the pregame QR uses the same origin.
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  const playSessionBaseUrl = `${proto}://${host}/play`;

  // Pre-game view: when the tournament is `scheduled` (admin hasn't
  // started the timer yet), show the table assignments instead of the
  // live timer. The 30s auto-refresh inside <TvPregame> flips the screen
  // to <TvDisplay> as soon as status -> running.
  if (tournamentRow.status === "scheduled") {
    const { data: pregamePlayers } = await supabase
      .from("tournament_players")
      .select("*, players(id, name)")
      .eq("tournament_id", tournamentRow.id)
      .order("table_number", { ascending: true, nullsFirst: false })
      .order("seat_number", { ascending: true, nullsFirst: false });

    return (
      <TvPregame
        tournament={tournamentRow}
        players={(pregamePlayers ?? []) as unknown as TournamentPlayerWithName[]}
        playSessionBaseUrl={playSessionBaseUrl}
      />
    );
  }

  const [{ data: players }, { data: events }, { data: colorUpData }] =
    await Promise.all([
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
        .eq("tournament_id", tournamentRow.id),
      // Bust + break events power the TV's "last segment" bust counter so it
      // survives rebuys (which clear busted_at_time on the player row).
      supabase
        .from("tournament_events")
        .select("type, payload, created_at")
        .eq("tournament_id", tournamentRow.id)
        .in("type", ["bust", "break_start", "break_end"])
        .order("created_at", { ascending: true })
        .limit(500),
      // Approved color-up exchanges. Sum of net_change is added to the
      // tournament-wide chip total so round-ups (e.g. 23 → 25) show the
      // +2 in the pool. Per-player rows let aggregateByTable attribute
      // each delta to whichever table the player is currently sitting at.
      supabase
        .from("color_up_requests")
        .select("player_id, exchange_for_chips")
        .eq("tournament_id", tournamentRow.id)
        .eq("status", "approved"),
    ]);

  const initialPlayers = (players ?? []) as unknown as TournamentPlayerWithName[];
  const initialEvents = (events ?? []) as Array<{
    type: string;
    payload: Record<string, unknown> | null;
    created_at: string;
  }>;
  const initialColorUpGains = (colorUpData ?? [])
    .map((row) => {
      const efc = row.exchange_for_chips as { net_change?: number } | null;
      const delta =
        efc && typeof efc.net_change === "number" ? efc.net_change : 0;
      return { player_id: row.player_id ?? "", net_change: delta };
    })
    .filter((g) => g.player_id !== "" && g.net_change !== 0);

  return (
    <TvDisplay
      tournamentId={tournamentRow.id}
      initialTournament={tournamentRow}
      initialPlayers={initialPlayers}
      initialEvents={initialEvents}
      initialColorUpGains={initialColorUpGains}
      playSessionBaseUrl={playSessionBaseUrl}
    />
  );
}
