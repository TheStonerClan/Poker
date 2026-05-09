import Link from "next/link";

import LocalDateTime from "@/components/admin/LocalDateTime";
import {
  fetchUpcomingTournaments,
  type UpcomingTournament,
} from "@/lib/admin/upcoming";
import { createServiceClient } from "@/lib/supabase/service";

// Adding the upcoming-tournaments section pulls live data from
// Supabase, so the page can no longer be statically prerendered. The
// menu tiles are still cheap to render so the cold-start cost is small.
export const dynamic = "force-dynamic";

/**
 * holdemclock.com landing page.
 *
 * Three doors, three audiences:
 *
 * - **TV** — for the operator pointing the family-room TV at the
 *   live screen. Public, no auth. Same destination phones can hit
 *   too (so guests can sneak a peek if they don't want to use the
 *   QR-driven /play view).
 * - **Historics** — for anyone (players, family, league members)
 *   who wants to see leaderboards, season stats, and per-player
 *   trends. Public, no auth.
 * - **Admin** — for Travis. Bounces through Supabase auth at
 *   /auth/login, lands on the admin dashboard. The middle door of
 *   the three has the most distinct visual treatment (gold border,
 *   chunky card) since most of the time the admin is the one
 *   actually using the site.
 *
 * Below the menu we surface "Upcoming tournaments" — a read-only
 * listing of scheduled games (name + location + date) so guests
 * scanning the home page can see what's on deck without clicking
 * into anything. Service-role read so it works without auth.
 */
export default async function LandingPage() {
  let upcoming: UpcomingTournament[] = [];
  // Guard the data fetch so the page still renders if Supabase is
  // misconfigured (e.g. missing env vars on a fresh deploy) — the
  // menu is the must-have, the upcoming list is the nice-to-have.
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    try {
      const supabase = createServiceClient();
      upcoming = await fetchUpcomingTournaments(supabase);
    } catch {
      upcoming = [];
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center bg-bg text-fg px-6 py-10">
      <header className="mb-12 mt-6 flex flex-col items-center gap-3 text-center">
        <span className="text-label uppercase tracking-[0.4em] text-xs font-semibold">
          Holdem Clock
        </span>
        <h1 className="font-mono text-fg text-[clamp(2.25rem,7vw,4rem)] tabular-nums">
          Tournament HQ
        </h1>
        <p className="max-w-md text-sm text-fg/60">
          Pick your view. The TV runs the live timer; Historics shows
          season trends and per-player stats; Admin runs the room.
        </p>
      </header>

      <nav
        aria-label="Site sections"
        className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3"
      >
        <Tile
          href="/tv"
          label="TV"
          subtitle="Live timer, blinds, prize pool"
          tone="default"
        />
        <Tile
          href="/history"
          label="Historics"
          subtitle="Season leaderboard & trends"
          tone="default"
        />
        <Tile
          href="/admin"
          label="Admin"
          subtitle="Run the next tournament"
          tone="primary"
        />
      </nav>

      <UpcomingSection upcoming={upcoming} />

      <footer className="mt-12 text-center text-[10px] uppercase tracking-[0.3em] text-fg/35">
        holdemclock.com
      </footer>
    </main>
  );
}

function Tile({
  href,
  label,
  subtitle,
  tone,
}: {
  href: string;
  label: string;
  subtitle: string;
  tone: "default" | "primary";
}) {
  const cls =
    tone === "primary"
      ? "border-gold bg-gold/10 hover:bg-gold/20"
      : "border-fg/15 bg-bg hover:border-gold/40";
  return (
    <Link
      href={href}
      className={`flex min-h-[10rem] flex-col items-start justify-end rounded-lg border-2 p-5 transition ${cls}`}
    >
      <span
        className={`text-label uppercase tracking-[0.3em] text-[11px] font-semibold ${
          tone === "primary" ? "text-gold" : ""
        }`}
      >
        {subtitle}
      </span>
      <span className="mt-1 font-mono text-fg text-3xl tabular-nums">
        {label}
      </span>
    </Link>
  );
}

/**
 * Read-only listing of scheduled tournaments. Public visitors don't
 * click through (no admin permissions) — they just see name,
 * location, and date so they know what's planned. Hidden entirely
 * when the list is empty so the landing stays clean during a quiet
 * stretch.
 */
function UpcomingSection({ upcoming }: { upcoming: UpcomingTournament[] }) {
  if (upcoming.length === 0) return null;
  return (
    <section
      aria-label="Upcoming tournaments"
      className="mt-10 w-full max-w-3xl"
    >
      <h2 className="mb-3 text-label uppercase tracking-[0.3em] text-[11px] font-semibold">
        Upcoming tournaments
      </h2>
      <ul className="flex flex-col gap-2">
        {upcoming.map((u) => (
          <li
            key={u.key}
            className="flex flex-col gap-1 rounded-lg border border-fg/10 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between"
          >
            <div>
              <p className="text-sm font-semibold text-fg">{u.templateName}</p>
              {u.location ? (
                <p className="mt-0.5 text-xs text-fg/55">{u.location}</p>
              ) : null}
            </div>
            <p className="font-mono text-xs tabular-nums text-fg/70">
              <UpcomingDate
                iso={u.iso}
                dateOnly={u.dateOnly}
                timezone={u.timezone}
              />
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Date renderer shared between materialized and projected rows.
 *
 * - `dateOnly`: only the calendar date — drop time-of-day to avoid
 *   misleading "12:00 AM" output. Calendar date stays stable
 *   everywhere because the iso is anchored at local-noon
 *   (`YYYY-MM-DDT12:00:00`, no zone) by the upstream helper.
 * - `timezone` set: format in the venue's timezone with the short
 *   TZ abbreviation appended ("Fri, May 15, 7:00 PM CDT") — viewers
 *   see venue time regardless of their own location.
 * - Otherwise: viewer's local zone.
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
