import Link from "next/link";

import { RefreshImpressionsButton } from "@/app/history/_components/RefreshImpressionsButton";
import { TopBar } from "@/components/admin/TopBar";
import { getTemplates } from "@/lib/admin/queries";
import { toIsoDate } from "@/lib/schedule/next-night";
import { resolveNextNight } from "@/lib/schedule/server";
import { createClient } from "@/lib/supabase/server";

import { SignalCard } from "./SignalCard";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const templates = await getTemplates();
  const signalConfigured = !!process.env.SIGNAL_BRIDGE_URL;
  const signalGroupId = process.env.SIGNAL_GROUP_ID ?? null;

  // Resolve the upcoming-night summary for every template. Each one's
  // recurrence + override controls live on its own Schedule tab now;
  // here we just surface the next-night line as a quick at-a-glance.
  const supabase = await createClient();
  const summaries = await Promise.all(
    templates.map(async (t) => {
      const next = await resolveNextNight(supabase, t);
      let line: string;
      if (next.kind === "ok") {
        const day = toIsoDate(next.next.effectiveDate);
        line = next.next.isMoved
          ? `${day} (moved from ${toIsoDate(next.next.originalDate)})`
          : day;
      } else if (next.kind === "no-rule") {
        line = "No recurring schedule set";
      } else {
        line = `Next ${next.lookedAhead} occurrences cancelled`;
      }
      return { id: t.id, name: t.name, line, hasRule: next.kind === "ok" };
    }),
  );

  return (
    <>
      <TopBar title="Settings" />
      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        <Link
          href="/admin/templates"
          className="flex items-center justify-between rounded-lg border border-fg/10 px-4 py-3 hover:border-gold/40"
        >
          <div>
            <p className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
              Templates
            </p>
            <p className="mt-1 text-sm text-fg/80">
              {templates.length} configured · clone, edit blinds / prizes /
              buyback / schedule
            </p>
          </div>
          <span className="text-fg/40">›</span>
        </Link>

        <Link
          href="/sandboxadmin"
          className="flex items-center justify-between rounded-lg border border-orange-500/30 px-4 py-3 hover:border-orange-500/60"
        >
          <div>
            <p className="text-label text-[11px] font-semibold uppercase tracking-[0.25em] text-orange-400">
              Sandbox
            </p>
            <p className="mt-1 text-sm text-fg/80">
              Test tournaments, TV display, and history — isolated from
              real leaderboards and Signal.
            </p>
          </div>
          <span className="text-fg/40">›</span>
        </Link>

        <SignalCard configured={signalConfigured} groupId={signalGroupId} />

        <section className="rounded-lg border border-fg/10 p-4">
          <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
            Upcoming poker nights
          </h2>
          {summaries.length === 0 ? (
            <p className="mt-2 text-sm text-fg/70">
              Create a template to set up a recurring schedule.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {summaries.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/admin/templates/${s.id}?tab=schedule`}
                    className="flex items-baseline justify-between rounded-md border border-fg/10 px-3 py-2.5 hover:border-gold/40"
                  >
                    <span className="text-sm font-semibold text-fg">
                      {s.name}
                    </span>
                    <span
                      className={`text-xs ${
                        s.hasRule ? "text-fg/70" : "text-fg/40"
                      }`}
                    >
                      {s.line}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-fg/50">
            Edit each template&rsquo;s recurring rule and one-off date overrides
            from its Schedule tab.
          </p>
        </section>

        <section className="rounded-lg border border-fg/10 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
              AI impressions
            </h2>
            <RefreshImpressionsButton isSandbox={false} />
          </div>
          <p className="mt-2 text-sm text-fg/70">
            Regenerates every player&rsquo;s &ldquo;post-tournament
            impression&rdquo; blurb — the AI-written summary shown on each
            player&rsquo;s /history profile. A tournament finalizing
            already refreshes that night&rsquo;s roster automatically; use
            this to cover everyone else too (e.g. after a manual stats
            correction).
          </p>
        </section>

        <section className="rounded-lg border border-fg/10 p-4">
          <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
            Account
          </h2>
          <form action="/auth/logout" method="post" className="mt-3">
            <button
              type="submit"
              className="h-12 min-h-[44px] w-full rounded-md border border-fg/15 text-sm font-semibold text-fg/80"
            >
              Sign out
            </button>
          </form>
          <p className="mt-3 text-xs text-fg/50">
            Manage admin allow-list directly in the Supabase{" "}
            <Link
              href="https://supabase.com/dashboard/project/_/sql/new"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              SQL editor
            </Link>{" "}
            for now (see <code>public.admins</code>).
          </p>
        </section>
      </main>
    </>
  );
}
