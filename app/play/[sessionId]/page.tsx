import Link from "next/link";
import { notFound } from "next/navigation";

import { PickName } from "@/components/player/PickName";
import { SandboxBadge } from "@/components/SandboxBadge";
import { slugifyPlayerName } from "@/lib/player/slug";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type PlayPageProps = {
  params: Promise<{ sessionId: string }>;
};

export default async function PlayEntryPage({ params }: PlayPageProps) {
  const { sessionId } = await params;
  // Service-role read: the player picker is a public-facing surface
  // (anyone scanning the TV QR lands here), so it can't depend on the
  // user holding an admin auth cookie. Without service role, the
  // `players(name)` join is blocked by RLS for anon visitors and the
  // picker shows an empty list — exactly what private-browsing users
  // were hitting. The selected fields (id / name / busted-state /
  // chips) are all already public via the TV display, so service role
  // here doesn't expose anything new.
  const supabase = createServiceClient();

  const { data: tournament, error: tErr } = await supabase
    .from("tournaments")
    .select(
      "id, status, current_level, finished_at, is_sandbox, template:tournament_templates(name)",
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (tErr || !tournament) notFound();

  const { data: rosterRows } = await supabase
    .from("tournament_players")
    .select(
      "id, player_id, current_chips, busted_at_time, players!tournament_players_player_id_fkey(name)",
    )
    .eq("tournament_id", sessionId);

  const roster = (rosterRows ?? [])
    .filter((row): row is typeof row & { players: { name: string } } =>
      Boolean(row.players?.name),
    )
    .map((row) => ({
      tournamentPlayerId: row.id,
      playerId: row.player_id,
      name: row.players.name,
      slug: slugifyPlayerName(row.players.name),
      busted: Boolean(row.busted_at_time),
      currentChips: row.current_chips,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const tournamentName =
    (tournament.template as { name?: string } | null)?.name ?? "Tournament";

  return (
    <main className="flex flex-1 flex-col px-5 py-6">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <p className="text-label text-xs uppercase tracking-widest">
            {tournamentName}
          </p>
          {tournament.is_sandbox ? <SandboxBadge /> : null}
        </div>
        <h1 className="mt-1 text-3xl font-semibold text-fg">Pick your name</h1>
        <p className="mt-2 text-sm text-fg/60">
          Tap your name to claim your seat. One tap holds your spot until you
          close the tab.
        </p>
        <Link
          href={`/play/${sessionId}/leaderboard`}
          className="mt-3 inline-block text-sm text-gold underline"
        >
          View chip leaderboard →
        </Link>
      </header>

      {tournament.finished_at ? (
        <FinishedBanner />
      ) : roster.length === 0 ? (
        <EmptyBanner />
      ) : (
        <PickName sessionId={sessionId} roster={roster} />
      )}
    </main>
  );
}

function FinishedBanner() {
  return (
    <div className="rounded-2xl border border-gold/40 bg-bg/40 p-6">
      <p className="text-label text-xs uppercase tracking-widest">
        Tournament finished
      </p>
      <p className="mt-2 text-fg">Results are locked. See the TV for finals.</p>
    </div>
  );
}

function EmptyBanner() {
  return (
    <div className="rounded-2xl border border-gold/40 bg-bg/40 p-6">
      <p className="text-label text-xs uppercase tracking-widest">
        No players yet
      </p>
      <p className="mt-2 text-fg">
        The admin hasn&apos;t added the roster. Check back in a minute.
      </p>
    </div>
  );
}
