import Link from "next/link";

import HistogramBars from "@/components/admin/HistogramBars";
import LocalDateTime from "@/components/admin/LocalDateTime";
import { TopBar } from "@/components/admin/TopBar";
import { requireAdmin } from "@/lib/auth";
import { formatChips, formatMoney } from "@/lib/admin/format";
import {
  buildBustHistogram,
  buildLeaderboard,
  buildTournamentSummaries,
  tokenCounts,
  type BustEvent,
  type FinishedTournament,
  type PayoutRow,
  type RosterRow,
} from "@/lib/admin/history-stats";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Hard cap on the season window. Forty tournaments × ~10 players × handful
// of payouts is small enough for client-side aggregation; larger seasons
// can either bump this or move the math to a SQL view.
const TOURNAMENT_LIMIT = 40;

export default async function HistoryPage() {
  await requireAdmin();
  const supabase = await createClient();

  // 1. Fetch the finished-tournament window.
  const { data: tournamentsData } = await supabase
    .from("tournaments")
    .select(
      "id, status, finished_at, started_at, buy_in_snapshot, current_level",
    )
    .eq("status", "finished")
    .order("finished_at", { ascending: false })
    .limit(TOURNAMENT_LIMIT);

  const tournaments = (tournamentsData ?? []) as FinishedTournament[];

  if (tournaments.length === 0) {
    return (
      <>
        <TopBar title="History" subtitle="0 finished" />
        <main className="flex flex-1 flex-col gap-3 px-4 py-4">
          <div className="rounded-md border border-dashed border-fg/15 p-6 text-center text-sm text-fg/60">
            No completed tournaments yet. Finish one to see the leaderboard
            and bust histogram populate.
          </div>
        </main>
      </>
    );
  }

  const tournamentIds = tournaments.map((t) => t.id);

  // 2. Pull the supporting tables in one round trip. The bust events
  //    feed the histogram; the roster + payouts feed both the leaderboard
  //    and the per-tournament summary list.
  const [
    { data: rosterData },
    { data: payoutsData },
    { data: eventsData },
  ] = await Promise.all([
    // SELECT * so the query doesn't fail on a DB that hasn't run
    // migration 0003 (which adds rebuys_used / addons_used). The
    // history-stats helpers fall back to the legacy buyback_used flag
    // for token counts when the new columns aren't there. Using `*`
    // alongside the players relation join is supported by postgrest.
    supabase
      .from("tournament_players")
      .select("*, player:players(id, name)")
      .in("tournament_id", tournamentIds),
    supabase
      .from("prize_distributions")
      .select("tournament_id, position, amount, player_id, is_chopped")
      .in("tournament_id", tournamentIds),
    supabase
      .from("tournament_events")
      .select("tournament_id, payload, created_at")
      .in("tournament_id", tournamentIds)
      .eq("type", "bust"),
  ]);

  const roster = (rosterData ?? []) as unknown as RosterRow[];
  const payouts = (payoutsData ?? []) as PayoutRow[];
  const bustEvents = (eventsData ?? []) as BustEvent[];

  // 3. Aggregations.
  const leaderboard = buildLeaderboard({ roster, payouts });
  const histogram = buildBustHistogram(bustEvents);
  const summaries = buildTournamentSummaries({ tournaments, roster, payouts });

  // 4. Headline counts above the leaderboard. Use tokenCounts so we get
  //    the right rebuy/addon totals whether or not migration 0003 has
  //    been applied to the DB.
  const totalEntries = roster.length;
  let totalRebuys = 0;
  let totalAddOns = 0;
  for (const r of roster) {
    const c = tokenCounts(r);
    totalRebuys += c.rebuys;
    totalAddOns += c.addOns;
  }
  void totalAddOns; // surfaced indirectly through summaries; reserved for a future "add-ons" headline
  const totalPool = payouts.reduce((s, p) => s + p.amount, 0);
  const choppedCount = summaries.filter((s) => s.chopped).length;

  return (
    <>
      <TopBar
        title="History"
        subtitle={`${tournaments.length} finished · ${leaderboard.length} player${leaderboard.length === 1 ? "" : "s"}`}
      />
      <main className="flex flex-1 flex-col gap-5 px-4 py-4">
        {/* Headline stats */}
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Headline label="Tournaments" value={tournaments.length.toString()} />
          <Headline label="Entries" value={formatChips(totalEntries + totalRebuys)} />
          <Headline label="Pool paid" value={formatMoney(totalPool)} />
          <Headline
            label="Chopped"
            value={`${choppedCount}/${tournaments.length}`}
          />
        </section>

        {/* Leaderboard */}
        <section className="rounded-md border border-fg/10 p-4">
          <h2 className="text-label mb-3 text-[11px] font-semibold uppercase tracking-[0.25em]">
            Season leaderboard
          </h2>
          <ol className="flex flex-col gap-1">
            {leaderboard.slice(0, 12).map((row, i) => (
              <li
                key={row.playerId}
                className={`flex items-baseline justify-between gap-2 rounded-sm px-2 py-1.5 ${
                  i === 0 ? "border border-gold/40 bg-gold/5" : ""
                }`}
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono w-6 tabular-nums text-fg/55 text-sm">
                    {i + 1}
                  </span>
                  <span className="text-sm font-semibold text-fg">
                    {row.name}
                  </span>
                </div>
                <div className="flex items-baseline gap-3 font-mono text-xs tabular-nums">
                  <span className="text-fg/55">
                    {row.tournamentsPlayed} pl
                  </span>
                  <span className="text-fg/55">{row.itmCount} itm</span>
                  <span className="text-fg/55">
                    {row.wins} {row.wins === 1 ? "win" : "wins"}
                  </span>
                  <span className="text-fg w-20 text-right">
                    {formatMoney(row.totalPayout)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
          {leaderboard.length > 12 ? (
            <p className="mt-2 text-[10px] uppercase tracking-widest text-fg/40">
              +{leaderboard.length - 12} more players. Showing top 12 by wins,
              total payout, then tournaments played.
            </p>
          ) : null}
        </section>

        {/* Bust histogram */}
        <section>
          <h2 className="text-label mb-2 text-[11px] font-semibold uppercase tracking-[0.25em]">
            Bust-out distribution by level
          </h2>
          <HistogramBars
            buckets={histogram.map((b) => ({
              label: `L${b.levelNum}`,
              count: b.count,
            }))}
            yLabel="busts"
            xLabel="across all finished tournaments"
            aspect={3}
          />
        </section>

        {/* Recent tournaments */}
        <section>
          <h2 className="text-label mb-2 text-[11px] font-semibold uppercase tracking-[0.25em]">
            Recent tournaments
          </h2>
          <ul className="flex flex-col gap-2">
            {summaries.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/admin/tournaments/${t.id}`}
                  className="block rounded-md border border-fg/10 px-3 py-3 hover:border-gold/40"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-fg">
                      <LocalDateTime iso={t.finishedAt} />
                    </p>
                    <p className="font-mono text-xs tabular-nums text-fg/70">
                      {formatMoney(t.prizePool)} pool
                      {t.buyIn > 0 ? (
                        <span className="ml-2 text-fg/40">
                          · {formatMoney(t.buyIn)} buy-in
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-2 text-xs text-fg/60">
                    <p>
                      {t.winnerName ? `Winner: ${t.winnerName}` : "—"}
                      {t.chopped ? (
                        <span className="ml-1.5 rounded-full border border-gold/50 px-1.5 py-px text-[9px] uppercase tracking-wider text-gold/80">
                          chop
                        </span>
                      ) : null}
                    </p>
                    <p className="font-mono tabular-nums">
                      {t.entries} entries · {t.rebuys} rebuy
                      {t.rebuys === 1 ? "" : "s"} · {t.addOns} add-on
                      {t.addOns === 1 ? "" : "s"}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {tournaments.length === TOURNAMENT_LIMIT ? (
            <p className="mt-2 text-[10px] uppercase tracking-widest text-fg/40">
              Showing the most recent {TOURNAMENT_LIMIT} finished tournaments.
            </p>
          ) : null}
        </section>
      </main>
    </>
  );
}

function Headline({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-fg/10 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-fg/55">
        {label}
      </p>
      <p className="mt-1 font-mono text-2xl tabular-nums text-fg">{value}</p>
    </div>
  );
}
