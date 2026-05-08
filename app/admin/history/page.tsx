import Link from "next/link";

import { TopBar } from "@/components/admin/TopBar";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatMoney } from "@/lib/admin/format";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: tournaments } = await supabase
    .from("tournaments")
    .select("id, status, finished_at, started_at, buy_in_snapshot, current_level")
    .eq("status", "finished")
    .order("finished_at", { ascending: false })
    .limit(40);

  return (
    <>
      <TopBar title="History" subtitle={`${tournaments?.length ?? 0} finished`} />
      <main className="flex flex-1 flex-col gap-3 px-4 py-4">
        {(tournaments?.length ?? 0) === 0 ? (
          <div className="rounded-md border border-dashed border-fg/15 p-6 text-center text-sm text-fg/60">
            No completed tournaments yet. Finish one to see it here.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {(tournaments ?? []).map((t) => (
              <li key={t.id}>
                <Link
                  href={`/admin/tournaments/${t.id}`}
                  className="block rounded-md border border-fg/10 px-3 py-3 hover:border-gold/40"
                >
                  <p className="text-sm font-semibold text-fg">
                    {t.finished_at
                      ? new Date(t.finished_at).toLocaleString()
                      : "—"}
                  </p>
                  <p className="text-xs text-fg/60">
                    Level {t.current_level} · buy-in {formatMoney(t.buy_in_snapshot)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-fg/50">
          Full analytics dashboard ships with the integration phase. For now,
          this view shows the finalized tournaments only.
        </p>
      </main>
    </>
  );
}
