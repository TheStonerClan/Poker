import Link from "next/link";

import LocalDateTime from "@/components/admin/LocalDateTime";
import { TopBar } from "@/components/admin/TopBar";
import { SandboxBadge } from "@/components/SandboxBadge";
import { computePayouts } from "prize-math";
import {
  currentLevel,
  getActiveTournament,
  getPendingColorUpRequests,
  getTournamentRoster,
  nextLevel,
} from "@/lib/admin/queries";
import { formatBlinds, formatMoney } from "@/lib/admin/format";
import { createClient } from "@/lib/supabase/server";
import {
  fetchUpcomingTournaments,
  type UpcomingTournament,
} from "@/lib/admin/upcoming";

import { AutoAdvanceWatcher } from "@/app/admin/_components/AutoAdvanceWatcher";
import { LevelControls } from "@/app/admin/_components/LevelControls";
import { QuickBustList } from "@/app/admin/_components/QuickBustList";

/**
 * Shared body for /admin and /sandboxadmin. `isSandbox` scopes the
 * active-tournament + upcoming lookups to real vs. sandbox rows and
 * points the "start"/"empty state" CTAs at the matching wizard.
 */
export default async function AdminDashboardBody({
  isSandbox,
}: {
  isSandbox: boolean;
}) {
  const tournament = await getActiveTournament({ sandbox: isSandbox });

  // Always fetch upcoming — surfaced in BOTH the active and empty
  // dashboard states. While a tournament is running the admin still
  // wants to see / prep next week's; when nothing's running it's the
  // primary call-to-action under "Start tournament". `adminLinks`
  // makes each row tappable: materialized scheduled tournaments link
  // to /admin/tournaments/[id]; recurrence projections link to the
  // template's Schedule tab.
  const supabase = await createClient();
  const upcoming = await fetchUpcomingTournaments(supabase, {
    adminLinks: true,
    sandbox: isSandbox,
  });
  // When there's an active tournament, hide IT from the upcoming
  // list. The admin is already operating it from the page above; it
  // doesn't belong in the "upcoming" section.
  const upcomingFiltered = tournament
    ? upcoming.filter((u) => u.key !== `t:${tournament.id}`)
    : upcoming;

  if (!tournament) {
    return <EmptyDashboard upcoming={upcomingFiltered} isSandbox={isSandbox} />;
  }

  const [roster, pendingColorUps] = await Promise.all([
    getTournamentRoster(tournament.id),
    getPendingColorUpRequests(tournament.id),
  ]);

  const inPlay = roster.filter((r) => !r.busted_at_time);
  // Count actual buybacks (rebuys + addons) using the per-row counters
  // added in 0003. With tokensPerPlayer>1 a single roster row can carry
  // multiple paid entries, so a `filter(buyback_used).length` would
  // undercount the prize-pool contribution.
  const buybacks = roster.reduce(
    (s, r) => s + (r.rebuys_used ?? 0) + (r.addons_used ?? 0),
    0,
  );

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
      <AutoAdvanceWatcher
        tournament={{
          id: tournament.id,
          status: tournament.status,
          current_level: tournament.current_level,
          level_started_at: tournament.level_started_at,
          level_paused_at: tournament.level_paused_at,
          accumulated_pause_ms: tournament.accumulated_pause_ms,
          blind_structure_snapshot: tournament.blind_structure_snapshot,
        }}
      />
      <TopBar
        title="Tonight"
        subtitle={`${tournament.status.toUpperCase()} · Level ${tournament.current_level}`}
        action={
          <div className="flex items-center gap-2">
            {isSandbox ? <SandboxBadge /> : null}
            <Link
              href={`/admin/tournaments/${tournament.id}`}
              className="rounded-md border border-fg/15 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-fg/80 hover:text-fg"
            >
              Full
            </Link>
          </div>
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

        <UpcomingAdminSection upcoming={upcomingFiltered} />
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

function EmptyDashboard({
  upcoming,
  isSandbox,
}: {
  upcoming: UpcomingTournament[];
  isSandbox: boolean;
}) {
  const newTournamentHref = isSandbox
    ? "/sandboxadmin/tournaments/new"
    : "/admin/tournaments/new";
  return (
    <>
      <TopBar
        title="Holdem Clock"
        subtitle="No tournament running"
        action={isSandbox ? <SandboxBadge /> : undefined}
      />
      {/* Layout was `justify-center` when this view only held the start
          CTA; with the upcoming list below it now flows top-down. The
          start block stays the visual anchor (gold CTA), the upcoming
          list sits underneath, and there's a bottom margin so nothing
          collides with the BottomNav. */}
      <main className="flex flex-1 flex-col items-center gap-8 px-6 pt-12 pb-6 text-center">
        <div>
          <p className="text-label text-xs font-semibold uppercase tracking-[0.3em]">
            Ready when you are
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-fg">
            Start a tournament
          </h2>
          <p className="mx-auto mt-2 max-w-xs text-sm text-fg/60">
            {isSandbox
              ? "Pick a template, choose a test roster, and start a sandbox game."
              : "Pick a template, choose tonight's players, and we're off."}
          </p>
        </div>
        <Link
          href={newTournamentHref}
          className="block w-full max-w-xs rounded-md bg-gold px-4 py-3 text-center text-base font-semibold text-bg"
        >
          Start tournament
        </Link>
        <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
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

        <div className="w-full max-w-md text-left">
          <UpcomingAdminSection upcoming={upcoming} />
        </div>
      </main>
    </>
  );
}

/**
 * Upcoming-tournaments list as it appears on /admin (and /sandboxadmin).
 * Materialized scheduled tournaments link to /admin/tournaments/[id]
 * where the admin can edit settings, add players in advance, and
 * start the event when the room is ready. Projected (recurrence)
 * rows link to the template's Schedule tab so the admin can move /
 * cancel that occurrence — they pre-date any roster, so there's no
 * tournament page to land on yet. (Sandbox mode never has projected
 * rows — see fetchUpcomingTournaments.)
 */
function UpcomingAdminSection({
  upcoming,
}: {
  upcoming: UpcomingTournament[];
}) {
  if (upcoming.length === 0) return null;
  return (
    <section
      aria-label="Upcoming tournaments"
      className="rounded-lg border border-fg/10 p-4"
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
          Upcoming
        </h2>
        <span className="text-[10px] uppercase tracking-widest text-fg/45">
          Tap to edit · add players · start
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {upcoming.map((u) => {
          const inner = (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-fg">
                  {u.templateName}
                  {u.kind === "projected" ? (
                    <span className="ml-2 rounded-full border border-fg/20 px-1.5 py-px text-[9px] uppercase tracking-wider text-fg/55">
                      Recurring
                    </span>
                  ) : null}
                </p>
                <p className="font-mono text-xs tabular-nums text-fg/70">
                  <UpcomingDate
                    iso={u.iso}
                    dateOnly={u.dateOnly}
                    timezone={u.timezone}
                  />
                </p>
              </div>
              {u.location ? (
                <p className="text-xs text-fg/55">{u.location}</p>
              ) : null}
            </>
          );
          // u.href is always present here because the caller asked for
          // adminLinks, but type-narrow with a fallback so a future
          // caller change doesn't crash the page.
          return (
            <li key={u.key}>
              {u.href ? (
                <Link
                  href={u.href}
                  className="flex flex-col gap-1 rounded-md border border-fg/10 px-3 py-2.5 hover:border-gold/40"
                >
                  {inner}
                </Link>
              ) : (
                <div className="flex flex-col gap-1 rounded-md border border-fg/10 px-3 py-2.5">
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Shared date renderer — see the matching helper on the public
 * landing page (app/page.tsx). When the template has a timezone we
 * format in the venue's zone with a short TZ abbreviation; date-only
 * projections drop the time entirely.
 */
function UpcomingDate({
  iso,
  dateOnly,
  timezone,
}: {
  iso: string | null;
  dateOnly: boolean;
  timezone: string | null;
}) {
  if (!iso) {
    return (
      <span className="uppercase tracking-widest text-[10px] text-fg/45">
        TBD
      </span>
    );
  }
  const options: Intl.DateTimeFormatOptions = dateOnly
    ? { weekday: "short", month: "short", day: "numeric" }
    : {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      };
  if (timezone) options.timeZone = timezone;
  return <LocalDateTime iso={iso} options={options} />;
}
