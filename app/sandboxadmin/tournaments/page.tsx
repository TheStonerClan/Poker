import Link from "next/link";

import { TopBar } from "@/components/admin/TopBar";
import { SandboxBadge } from "@/components/SandboxBadge";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatBlinds, formatMoney } from "@/lib/admin/format";
import { blindLevels, type Tournament } from "@/lib/admin/queries";

export const dynamic = "force-dynamic";

/**
 * Sandbox variant of /admin/tournaments — same list UI, scoped to
 * `is_sandbox = true` rows. Row links still go to the shared
 * /admin/tournaments/[id] detail page (it works by id regardless of
 * the flag and shows its own SandboxBadge).
 */
export default async function SandboxTournamentsListPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: tournaments } = await supabase
    .from("tournaments")
    .select("*")
    .eq("is_sandbox", true)
    .order("created_at", { ascending: false })
    .limit(40);

  const list = (tournaments ?? []) as Tournament[];
  const active = list.find((t) => t.status !== "finished" && t.status !== "cancelled");
  const finished = list.filter((t) => t.status === "finished" || t.status === "cancelled");

  return (
    <>
      <TopBar
        title="Sandbox tournaments"
        action={
          <div className="flex items-center gap-2">
            <SandboxBadge />
            <Link
              href="/sandboxadmin/tournaments/new"
              className="rounded-md bg-gold px-3 py-2 text-xs font-semibold uppercase tracking-wider text-bg"
            >
              New
            </Link>
          </div>
        }
      />
      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        {active ? (
          <Link
            href={`/admin/tournaments/${active.id}`}
            className="block rounded-lg border border-gold/40 bg-gold/5 p-4"
          >
            <p className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
              Active · {active.status}
            </p>
            <p className="mt-1 text-base font-semibold text-fg">
              Level {active.current_level} ·{" "}
              {formatBlinds(
                blindLevels(active.blind_structure_snapshot).find(
                  (l) => l.level_num === active.current_level,
                ) ?? null,
              )}
            </p>
            <p className="text-xs text-fg/60">
              Buy-in {formatMoney(active.buy_in_snapshot)} · started{" "}
              {active.started_at
                ? new Date(active.started_at).toLocaleString()
                : "—"}
            </p>
          </Link>
        ) : (
          <Link
            href="/sandboxadmin/tournaments/new"
            className="block rounded-md bg-gold px-4 py-3 text-center text-base font-semibold text-bg"
          >
            Start tournament
          </Link>
        )}

        <section>
          <h2 className="text-label mb-2 text-[11px] font-semibold uppercase tracking-[0.25em]">
            Recent
          </h2>
          {finished.length === 0 ? (
            <p className="text-sm text-fg/50">No finished sandbox tournaments yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {finished.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/admin/tournaments/${t.id}`}
                    className="flex items-center gap-2 rounded-md border border-fg/10 px-3 py-2 text-sm transition hover:border-fg/25 hover:bg-fg/[0.02]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-fg">
                        {t.finished_at
                          ? new Date(t.finished_at).toLocaleDateString()
                          : "—"}
                      </p>
                      <p className="text-xs text-fg/50">
                        {t.status} · level {t.current_level} · buy-in{" "}
                        {formatMoney(t.buy_in_snapshot)}
                      </p>
                    </div>
                    <span className="text-fg/40">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
