import Link from "next/link";

import { TopBar } from "@/components/admin/TopBar";
import { getPlayers, getTemplates } from "@/lib/admin/queries";

import { NewTournamentWizard } from "@/app/admin/tournaments/new/Wizard";

export const dynamic = "force-dynamic";

/**
 * Sandbox variant of /admin/tournaments/new. Reuses the same wizard
 * (templates + roster are shared, not sandbox-specific) but skips the
 * recurrence-projection deep-link handling from the real page — sandbox
 * tournaments are always ad-hoc, so no upcoming-list projection ever
 * links here with a `?templateId=`.
 */
export default async function NewSandboxTournamentPage() {
  const [templates, players] = await Promise.all([
    getTemplates(),
    getPlayers(),
  ]);

  if (templates.length === 0) {
    return (
      <>
        <TopBar title="New sandbox tournament" back={{ href: "/sandboxadmin" }} />
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

  return (
    <>
      <TopBar title="New sandbox tournament" back={{ href: "/sandboxadmin" }} />
      <main className="flex flex-1 flex-col px-4 py-4">
        <NewTournamentWizard
          templates={templates}
          players={players}
          isSandbox={true}
        />
      </main>
    </>
  );
}
