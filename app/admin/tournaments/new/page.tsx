import Link from "next/link";
import { redirect } from "next/navigation";

import { TopBar } from "@/components/admin/TopBar";
import { getPlayers, getTemplates } from "@/lib/admin/queries";
import { toIsoDate } from "@/lib/schedule/next-night";
import { resolveNextNight } from "@/lib/schedule/server";
import {
  isValidTimezone,
  localDateInTz,
} from "@/lib/schedule/zoned-time";
import { createClient } from "@/lib/supabase/server";

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
 *
 * If the admin has already saved a scheduled tournament for this
 * template's next occurrence, we redirect to its detail page instead
 * of re-rendering the wizard — clicking the "Recurring" projection
 * twice would otherwise look like it's trying to create a new
 * tournament when the admin just wanted to edit the existing roster.
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

  if (sp.templateId && templates.some((t) => t.id === sp.templateId)) {
    const supabase = await createClient();
    const template = templates.find((t) => t.id === sp.templateId);
    if (template?.recurrence_rule) {
      const next = await resolveNextNight(supabase, template);
      if (next.kind === "ok") {
        const targetDate = toIsoDate(next.next.effectiveDate);
        const { data: existing } = await supabase
          .from("tournaments")
          .select("id, scheduled_at")
          .eq("template_id", template.id)
          .eq("status", "scheduled");
        const match = (existing ?? []).find((row) => {
          if (!row.scheduled_at) return false;
          const tz = template.start_timezone;
          const rowDate =
            tz && isValidTimezone(tz)
              ? localDateInTz(new Date(row.scheduled_at), tz)
              : row.scheduled_at.slice(0, 10);
          return rowDate === targetDate;
        });
        if (match) {
          redirect(`/admin/tournaments/${match.id}`);
        }
      }
    }
  }

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
