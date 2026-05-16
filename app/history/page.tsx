import Link from "next/link";

import HistogramBars from "@/components/admin/HistogramBars";
import LocalDateTime from "@/components/admin/LocalDateTime";
import { formatChips, formatMoney } from "@/lib/admin/format";
import {
  applyHistoryRange,
  buildBreakShiftStats,
  buildBustHistogram,
  buildLeaderboard,
  buildPlayerStats,
  buildTournamentSummaries,
  F1_POINTS_TABLE,
  HISTORY_RANGES,
  isHistoryRange,
  rangeLabel,
  tokenCounts,
  type BustEvent,
  type ChipSnapshotEvent,
  type FinishedTournament,
  type HistoryRange,
  type PayoutRow,
  type RosterRow,
  type TokenEvent,
} from "@/lib/admin/history-stats";
import { createServiceClient } from "@/lib/supabase/service";

import { PerPlayerStatsTable } from "./_components/PerPlayerStatsTable";
import { SeasonLeaderboardTable } from "./_components/SeasonLeaderboardTable";

export const dynamic = "force-dynamic";

// Cap the upstream window at 60 finished tournaments. With ~10 players
// and a handful of events per tournament, that's still a small payload
// (a few thousand rows total) and it's well above the largest filter
// window we surface ("past 12 months").
const TOURNAMENT_LIMIT = 60;

type SearchParams = { range?: string };

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { range: rangeParam } = await searchParams;
  const range: HistoryRange = isHistoryRange(rangeParam) ? rangeParam : "all";

  const supabase = createServiceClient();

  // Pull the maximal candidate window once. The filter slices it down
  // in-memory; the upstream cap is a safety net so we never accidentally
  // drag the entire DB through the wire on an empty filter.
  const { data: tournamentsData } = await supabase
    .from("tournaments")
    .select(
      "id, template_id, status, finished_at, started_at, buy_in_snapshot, current_level, rebuy_price_snapshot, buyback_config_snapshot",
    )
    .eq("status", "finished")
    .order("finished_at", { ascending: false })
    .limit(TOURNAMENT_LIMIT);

  const allTournaments = (tournamentsData ?? []) as FinishedTournament[];
  const tournaments = applyHistoryRange(allTournaments, range);

  if (allTournaments.length === 0) {
    return (
      <PageShell range={range} subtitle="No finished tournaments yet.">
        <div className="rounded-md border border-dashed border-fg/15 p-6 text-center text-sm text-fg/60">
          Finish a tournament to seed the leaderboard, bust histogram,
          and per-player stats. The filter pills above will start
          working as soon as there&apos;s a finished game on record.
        </div>
      </PageShell>
    );
  }

  if (tournaments.length === 0) {
    return (
      <PageShell
        range={range}
        subtitle={`No tournaments in this window (${rangeLabel(range).toLowerCase()}).`}
      >
        <div className="rounded-md border border-dashed border-fg/15 p-6 text-center text-sm text-fg/60">
          Try a wider window — &quot;All time&quot; will always include
          everything we&apos;ve ever recorded ({allTournaments.length}{" "}
          tournament{allTournaments.length === 1 ? "" : "s"}).
        </div>
      </PageShell>
    );
  }

  const tournamentIds = tournaments.map((t) => t.id);

  const [
    { data: rosterData },
    { data: payoutsData },
    { data: bustData },
    { data: rebuyData },
    { data: addOnData },
    { data: snapshotData },
  ] = await Promise.all([
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
    supabase
      .from("tournament_events")
      .select("tournament_id, payload, created_at")
      .in("tournament_id", tournamentIds)
      .eq("type", "rebuy"),
    supabase
      .from("tournament_events")
      .select("tournament_id, payload, created_at")
      .in("tournament_id", tournamentIds)
      .eq("type", "addon"),
    supabase
      .from("tournament_events")
      .select("tournament_id, payload, created_at")
      .in("tournament_id", tournamentIds)
      .eq("type", "chip_snapshot"),
  ]);

  const roster = (rosterData ?? []) as unknown as RosterRow[];
  const payouts = (payoutsData ?? []) as PayoutRow[];
  const bustEvents = (bustData ?? []) as BustEvent[];
  const rebuyEvents = (rebuyData ?? []) as TokenEvent[];
  const addOnEvents = (addOnData ?? []) as TokenEvent[];
  const snapshotEvents = (snapshotData ?? []) as ChipSnapshotEvent[];

  const leaderboard = buildLeaderboard({ roster, payouts });
  const histogram = buildBustHistogram(bustEvents);
  const summaries = buildTournamentSummaries({ tournaments, roster, payouts });
  const playerStats = buildPlayerStats({
    tournaments,
    roster,
    payouts,
    rebuyEvents,
    addOnEvents,
  });
  const breakShifts = buildBreakShiftStats({
    tournaments,
    roster,
    events: snapshotEvents,
  });

  // Headline counts.
  const totalEntries = roster.length;
  let totalRebuys = 0;
  let totalAddOns = 0;
  for (const r of roster) {
    const c = tokenCounts(r);
    totalRebuys += c.rebuys;
    totalAddOns += c.addOns;
  }
  const totalPool = payouts.reduce((s, p) => s + p.amount, 0);

  // Top / bottom lists for the qualitative cohorts.
  const eligibleForRebuyRate = playerStats.filter((p) => p.tournamentsPlayed >= 2);
  const alwaysRebuys = [...eligibleForRebuyRate]
    .sort((a, b) => b.rebuyRate - a.rebuyRate || b.totalRebuys - a.totalRebuys)
    .slice(0, 5);
  const rarelyRebuys = [...eligibleForRebuyRate]
    .sort((a, b) => a.rebuyRate - b.rebuyRate || a.totalRebuys - b.totalRebuys)
    .slice(0, 5);
  const addOnLeaders = [...playerStats]
    .filter((p) => p.totalAddOns > 0)
    .sort((a, b) => b.totalAddOns - a.totalAddOns)
    .slice(0, 5);

  // Break-shift cohorts.
  const eligibleForRatio = breakShifts.filter((b) => b.snapshotCount >= 2);
  const consistentlyAbove = [...eligibleForRatio]
    .sort((a, b) => b.avgChipsRatio - a.avgChipsRatio)
    .slice(0, 5);
  const consistentlyBelow = [...eligibleForRatio]
    .sort((a, b) => a.avgChipsRatio - b.avgChipsRatio)
    .slice(0, 5);
  const biggestSwingers = [...breakShifts]
    .filter((b) => b.biggestSwing > 0)
    .sort((a, b) => b.biggestSwing - a.biggestSwing)
    .slice(0, 5);

  return (
    <PageShell
      range={range}
      subtitle={`${rangeLabel(range)} · ${tournaments.length} tournament${tournaments.length === 1 ? "" : "s"} · ${leaderboard.length} player${leaderboard.length === 1 ? "" : "s"}`}
    >
      {/* Headline cards. Entries is starting players only; rebuys
          and add-ons are their own cards so the same number isn't
          getting mixed in twice (matches the per-tournament summary
          rows below). */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Headline label="Tournaments" value={tournaments.length.toString()} />
        <Headline label="Entries" value={formatChips(totalEntries)} />
        <Headline label="Rebuys" value={formatChips(totalRebuys)} />
        <Headline label="Add-ons" value={formatChips(totalAddOns)} />
        <Headline label="Pool paid" value={formatMoney(totalPool)} />
      </section>

      {/* Season leaderboard — points-first, sortable by every other
          metric on header click. */}
      <section className="rounded-md border border-fg/10 p-4">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
            Leaderboard
          </h2>
          <span className="text-[10px] uppercase tracking-widest text-fg/40">
            Tap a header to re-sort
          </span>
        </div>
        <SeasonLeaderboardTable rows={playerStats} maxRows={15} />
        <PointsLegend />
      </section>

      {/* Win counts (legacy leaderboard) — kept as a quick "who's
          actually winning" view distinct from the net view above. */}
      <section className="rounded-md border border-fg/10 p-4">
        <h2 className="text-label mb-3 text-[11px] font-semibold uppercase tracking-[0.25em]">
          Most wins
        </h2>
        <ol className="flex flex-col gap-1">
          {leaderboard
            .filter((r) => r.wins > 0)
            .slice(0, 10)
            .map((row, i) => (
              <li
                key={row.playerId}
                className="flex items-baseline justify-between gap-2 px-2 py-1 text-sm"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono w-6 tabular-nums text-fg/55 text-xs">
                    {i + 1}
                  </span>
                  <span className="font-semibold text-fg">{row.name}</span>
                </div>
                <div className="flex items-baseline gap-3 font-mono text-xs tabular-nums text-fg/55">
                  <span>
                    {row.wins} win{row.wins === 1 ? "" : "s"}
                  </span>
                  <span className="text-fg w-20 text-right">
                    {formatMoney(row.totalPayout)}
                  </span>
                </div>
              </li>
            ))}
          {leaderboard.filter((r) => r.wins > 0).length === 0 ? (
            <li className="text-xs italic text-fg/40">
              No wins recorded yet in this window.
            </li>
          ) : null}
        </ol>
      </section>

      {/* Per-player rebuy / addon / bust stats — the granular view.
          Sortable on every numeric column. */}
      <section className="rounded-md border border-fg/10 p-4">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
            Per-player stats
          </h2>
          <span className="text-[10px] uppercase tracking-widest text-fg/40">
            Tap a header to re-sort
          </span>
        </div>
        <PerPlayerStatsTable rows={playerStats} />
      </section>

      {/* Rebuy + addon cohorts — three short ranked lists. */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CohortList
          title="Always rebuys"
          subtitle="Highest rebuy rate (≥2 played)"
          rows={alwaysRebuys.map((p) => ({
            id: p.playerId,
            name: p.name,
            value: `${Math.round(p.rebuyRate * 100)}% · ${p.totalRebuys}r`,
          }))}
        />
        <CohortList
          title="Rarely rebuys"
          subtitle="Lowest rebuy rate (≥2 played)"
          rows={rarelyRebuys.map((p) => ({
            id: p.playerId,
            name: p.name,
            value: `${Math.round(p.rebuyRate * 100)}% · ${p.totalRebuys}r`,
          }))}
        />
        <CohortList
          title="Add-on kings"
          subtitle="Most add-ons taken"
          rows={addOnLeaders.map((p) => ({
            id: p.playerId,
            name: p.name,
            value: `${p.totalAddOns} add-on${p.totalAddOns === 1 ? "" : "s"}`,
          }))}
        />
      </section>

      {/* Break-shift analysis — three more ranked lists, gated on
          chip_snapshot data being available. Empty state when nobody
          has reported during a break in the window. */}
      {breakShifts.length === 0 ? (
        <section className="rounded-md border border-dashed border-fg/15 p-4 text-center text-xs text-fg/55">
          Break-shift analytics need player-reported chip snapshots from
          the /play view. None recorded in this window yet.
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CohortList
            title="Above average"
            subtitle="Highest avg chip ratio at breaks"
            rows={consistentlyAbove.map((b) => ({
              id: b.playerId,
              name: b.name,
              value: `${b.avgChipsRatio.toFixed(2)}× · ${b.snapshotCount}`,
            }))}
          />
          <CohortList
            title="Below average"
            subtitle="Lowest avg chip ratio at breaks"
            rows={consistentlyBelow.map((b) => ({
              id: b.playerId,
              name: b.name,
              value: `${b.avgChipsRatio.toFixed(2)}× · ${b.snapshotCount}`,
            }))}
          />
          <CohortList
            title="Biggest swings"
            subtitle="Largest single between-break swing"
            rows={biggestSwingers.map((b) => ({
              id: b.playerId,
              name: b.name,
              value: `${formatChips(b.biggestSwing)}${
                b.avgSwingRatio != null
                  ? ` · ±${Math.round(b.avgSwingRatio * 100)}%`
                  : ""
              }`,
            }))}
          />
        </section>
      )}

      {/* Bust histogram (existing). */}
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
          xLabel="across the filtered window"
          aspect={3}
        />
      </section>

      {/* Per-tournament summaries (existing, unchanged). */}
      <section>
        <h2 className="text-label mb-2 text-[11px] font-semibold uppercase tracking-[0.25em]">
          Tournaments
        </h2>
        <ul className="flex flex-col gap-2">
          {summaries.map((t) => (
            <li
              key={t.id}
              className="block rounded-md border border-fg/10 px-3 py-3"
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
            </li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}

function PageShell({
  range,
  subtitle,
  children,
}: {
  range: HistoryRange;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="flex items-baseline justify-between gap-3 border-b border-fg/10 px-5 py-4">
        <div>
          <p className="text-label uppercase tracking-[0.3em] text-[10px] font-semibold">
            Holdem Clock
          </p>
          <h1 className="mt-0.5 text-xl font-semibold text-fg">Historics</h1>
          <p className="mt-0.5 text-xs text-fg/55">{subtitle}</p>
        </div>
        <Link
          href="/"
          className="text-[11px] uppercase tracking-widest text-fg/55 hover:text-fg"
        >
          ← Home
        </Link>
      </header>
      <div className="flex flex-1 flex-col gap-5 px-5 py-4">
        <RangeFilter active={range} />
        {children}
      </div>
    </main>
  );
}

function RangeFilter({ active }: { active: HistoryRange }) {
  return (
    <nav
      aria-label="Filter by time window"
      className="flex flex-wrap gap-2"
    >
      {HISTORY_RANGES.map((r) => {
        const isActive = r === active;
        const cls = isActive
          ? "border-gold bg-gold/15 text-gold"
          : "border-fg/15 text-fg/70 hover:border-gold/40 hover:text-fg";
        return (
          <Link
            key={r}
            href={r === "all" ? "/history" : `/history?range=${r}`}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider ${cls}`}
          >
            {rangeLabel(r)}
          </Link>
        );
      })}
    </nav>
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

function PointsLegend() {
  // Render the 1..9 row from F1_POINTS_TABLE (index 0 is the unused
  // sentinel). The text below explains the > 9 rule so the admin
  // doesn't have to count cells.
  const entries = F1_POINTS_TABLE.slice(1).map((pts, i) => ({
    position: i + 1,
    points: pts,
  }));
  return (
    <div className="mt-3 rounded-md border border-fg/10 bg-fg/[0.02] px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-fg/55">
        How points work
      </p>
      <p className="mt-1 text-xs text-fg/70">
        F1-style scoring per tournament. Sum across the window = season
        total. Position 10+ scores zero.
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-fg/70">
        {entries.map((e) => (
          <li key={e.position}>
            <span className="text-fg/45">P{e.position}</span>{" "}
            <span className="font-semibold text-fg">{e.points}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CohortList({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: Array<{ id: string; name: string; value: string }>;
}) {
  return (
    <div className="rounded-md border border-fg/10 p-3">
      <p className="text-label text-[10px] font-semibold uppercase tracking-[0.25em]">
        {title}
      </p>
      <p className="mt-0.5 text-[10px] text-fg/40">{subtitle}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs italic text-fg/40">Not enough data.</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1 text-sm">
          {rows.map((r, i) => (
            <li
              key={r.id}
              className="flex items-baseline justify-between gap-2"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono w-5 tabular-nums text-fg/40 text-xs">
                  {i + 1}
                </span>
                <span className="font-semibold text-fg">{r.name}</span>
              </div>
              <span className="font-mono text-xs tabular-nums text-fg/70">
                {r.value}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
