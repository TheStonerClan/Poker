import Link from "next/link";

export const dynamic = "force-static";

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
 * The page intentionally does NO data fetching — it's the cold-start
 * surface and stays static so it can render on the very first hit
 * regardless of Supabase availability.
 */
export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-bg text-fg px-6 py-10">
      <header className="mb-12 flex flex-col items-center gap-3 text-center">
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
