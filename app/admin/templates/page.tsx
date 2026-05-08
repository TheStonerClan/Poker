import Link from "next/link";

import { TopBar } from "@/components/admin/TopBar";
import { getTemplates } from "@/lib/admin/queries";
import { formatChips, formatMoney } from "@/lib/admin/format";

export const dynamic = "force-dynamic";

export default async function TemplatesIndexPage() {
  const templates = await getTemplates();

  return (
    <>
      <TopBar
        title="Templates"
        subtitle={`${templates.length} configured`}
      />
      <main className="flex flex-1 flex-col gap-3 px-4 py-4">
        {templates.length === 0 ? (
          <p className="rounded-md border border-dashed border-fg/15 p-6 text-center text-sm text-fg/70">
            No templates yet. The seed migration creates &quot;Bluff and
            Baffoons&quot; — apply it to your Supabase project to get started.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {templates.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/admin/templates/${t.id}`}
                  className="block rounded-md border border-fg/10 px-3 py-3 hover:border-gold/50"
                >
                  <p className="text-sm font-semibold text-fg">{t.name}</p>
                  <p className="text-xs text-fg/60">
                    Buy-in {formatMoney(t.buy_in)} ·{" "}
                    {formatChips(t.starting_stack)} chips · {t.ante_mode} ante
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
