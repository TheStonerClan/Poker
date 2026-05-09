import Link from "next/link";

import { TopBar } from "@/components/admin/TopBar";
import { getPlayers, getTemplates } from "@/lib/admin/queries";

import { NewTournamentWizard } from "./Wizard";

export const dynamic = "force-dynamic";

type SearchParams = { templateId?: string };

/**
 * The "new tournament" wizard.
 *
 * Accepts an optional `?templateId=<id>` query param so the
 * upcoming-tournaments lists on / and /admin can deep-link a
 * recurrence-projected occurrence straight here with the right
 * template pre-selected — the admin lands on the Settings step (one
 * past the template picker) and walks through Players → Tables → Start.
 */
export default async function NewTournamentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [templates, players, sp] = await Promise.all([
    getTemplates(),
    getPlayers(),
    searchParams,
  ]);

  if (templates.length === 0) {
    return (
      <>
        <TopBar title="New tournament" back={{ href: "/admin" }} />
        <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <p className="text-sm text-fg/70">No templates yet.</p>
          <Link
            href="/admin/templates"
            className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-bg"
          >
            Create a template
          </Link>
        </main>
      </>
    );
  }

  // Validate the optional preset against the actual template list so
  // a stale link doesn't drop the wizard into a "selected nothing"
  // state. If the param is missing or unknown, fall through to the
  // first template (the wizard's existing default).
  const presetTemplateId =
    sp.templateId && templates.some((t) => t.id === sp.templateId)
      ? sp.templateId
      : null;

  return (
    <>
      <TopBar title="New tournament" back={{ href: "/admin" }} />
      <main className="flex flex-1 flex-col px-4 py-4">
        <NewTournamentWizard
          templates={templates}
          players={players}
          initialTemplateId={presetTemplateId}
        />
      </main>
    </>
  );
}
