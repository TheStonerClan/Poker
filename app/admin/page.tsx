import Link from "next/link";

import { TopBar } from "@/components/admin/TopBar";
import { computePayouts } from "prize-math";
import {
  currentLevel,
  getActiveTournament,
  getPendingColorUpRequests,
  getTournamentRoster,
  nextLevel,
} from "@/lib/admin/queries";
import { formatBlinds, formatMoney } from "@/lib/admin/format";

import { LevelControls } from "./_components/LevelControls";
import { QuickBustList } from "./_components/QuickBustList";

export default async function AdminDashboardPage() {
  const tournament = await getActiveTournament();

  if (!tournament) {
    return <EmptyDashboard />;
  }

  const [roster, pendingColorUps] = await Promise.all([
    getTournamentRoster(tournament.id),
    getPendingColorUpRequests(tournament.id),
  ]);

  const inPlay = roster.filter((r) => !r.busted_at_time);
  const buybacks = roster.filter((r) => r.buyback_used).length;

  const payouts = computePayouts(
    tournament.prize_rules_snapshot as Parameters<typeof computePayouts>[0],
    {
      buyIns: roster.length,
      buybacks,
      buyInPrice: tournament.buy_in_snapshot,
    },
  );

  const cur = currentLevel(tournament);
  const nxt = nextLevel(tournament);

  return (
    <>
      <TopBar
        title="Tonight"
        subtitle={`${tournament.status.toUpperCase()} · Level ${tournament.current_level}`}
        action={
          <Link
            href={`/admin/tournaments/${tournament.id}`}
            className="rounded-md border border-fg/15 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-fg/80 hover:text-fg"
          >
            Full
          </Link>
        }
      />

      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        <section className="rounded-lg border border-gold/30 bg-gold/5 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
              Current Level
            </span>
            <span className="text-xs text-fg/60">
              Next: {formatBlinds(nxt)}
            </span>
          </div>
          <p className="mt-2 text-3xl font-semibold text-fg">
            {cur?.is_break ? "Break" : formatBlinds(cur)}
          </p>
          <p className="mt-1 text-xs text-fg/60">
            {cur?.duration_sec
              ? `${Math.round(cur.duration_sec / 60)} min`
              : "—"}
          </p>
        </section>

        <LevelControls tournament={tournament} />

        <section className="grid grid-cols-3 gap-2">
          <Stat label="In play" value={inPlay.length.toString()} />
          <Stat label="Players" value={roster.length.toString()} />
          <Stat label="Buybacks" value={buybacks.toString()} />
        </section>

        <section className="rounded-lg border border-fg/10 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
              Prize Pool
            </span>
            <span className="text-base font-semibold text-fg">
              {formatMoney(payouts.effectivePool)}
            </span>
          </div>
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {payouts.payouts.map((p) => (
              <li key={p.position} className="flex justify-between">
                <span className="text-fg/70">
                  {ordinal(p.position)} place
                </span>
                <span className="font-mono">{formatMoney(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>

        {pendingColorUps.length > 0 ? (
          <section className="rounded-lg border border-gold/40 bg-gold/5 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
                Color-up inbox
              </span>
              <span className="text-xs text-fg/60">
                {pendingColorUps.length} pending
              </span>
            </div>
            <Link
              href={`/admin/tournaments/${tournament.id}#color-up`}
              className="mt-3 block rounded-md bg-gold px-3 py-2 text-center text-sm font-semibold text-bg"
            >
              Review requests
            </Link>
          </section>
        ) : null}

        <section className="rounded-lg border border-fg/10 p-4">
          <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
            Mark player out
          </h2>
          <QuickBustList
            tournamentId={tournament.id}
            currentLevel={tournament.current_level}
            roster={inPlay.map((r) => ({
              tournament_player_id: r.id,
              name: r.player?.name ?? "—",
              chips: r.current_chips,
            }))}
          />
        </section>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-fg/10 p-3 text-center">
      <p className="text-label text-[10px] font-semibold uppercase tracking-widest">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-fg">{value}</p>
    </div>
  );
}

function ordinal(n: number): string {
  const v = n % 100;
  const suffix =
    v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd", "th"][Math.min(n % 10, 4)];
  return `${n}${suffix}`;
}

function EmptyDashboard() {
  return (
    <>
      <TopBar title="Holdem Clock" subtitle="No tournament running" />
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center">
        <div>
          <p className="text-label text-xs font-semibold uppercase tracking-[0.3em]">
            Ready when you are
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-fg">
            Start a tournament
          </h2>
          <p className="mx-auto mt-2 max-w-xs text-sm text-fg/60">
            Pick a template, choose tonight&apos;s players, and we&apos;re off.
          </p>
        </div>
        <Link
          href="/admin/tournaments/new"
          className="block w-full max-w-xs rounded-md bg-gold px-4 py-3 text-center text-base font-semibold text-bg"
        >
          Start tournament
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-sm">
          <Link
            href="/admin/templates"
            className="text-fg/70 underline-offset-4 hover:underline"
          >
            Edit template
          </Link>
          <span className="text-fg/30">·</span>
          <Link
            href="/admin/players"
            className="text-fg/70 underline-offset-4 hover:underline"
          >
            Manage players
          </Link>
        </div>
      </main>
    </>
  );
}

export const dynamic = "force-dynamic";
