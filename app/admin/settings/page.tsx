import Link from "next/link";

import { TopBar } from "@/components/admin/TopBar";
import { getTemplates } from "@/lib/admin/queries";

import { RecurrenceEditor } from "./RecurrenceEditor";
import { SignalCard } from "./SignalCard";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const templates = await getTemplates();
  const primary = templates[0] ?? null;
  const signalConfigured = !!process.env.SIGNAL_BRIDGE_URL;
  const signalGroupId = process.env.SIGNAL_GROUP_ID ?? null;

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
              Edit blind structure, prizes, buyback rules
            </p>
          </div>
          <span className="text-fg/40">›</span>
        </Link>

        <SignalCard
          configured={signalConfigured}
          groupId={signalGroupId}
        />

        <section className="rounded-lg border border-fg/10 p-4">
          <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
            Recurring tournament
          </h2>
          {primary ? (
            <RecurrenceEditor
              templateId={primary.id}
              templateName={primary.name}
              ruleString={primary.recurrence_rule}
            />
          ) : (
            <p className="mt-2 text-sm text-fg/70">
              Create a tournament template first to set its schedule.
            </p>
          )}
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
