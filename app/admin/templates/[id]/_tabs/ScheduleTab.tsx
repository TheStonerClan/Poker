import { NextNightCard } from "@/app/admin/settings/NextNightCard";
import { RecurrenceEditor } from "@/app/admin/settings/RecurrenceEditor";
import type { TournamentTemplate } from "@/lib/admin/queries";
import { toIsoDate } from "@/lib/schedule/next-night";
import { resolveNextNight } from "@/lib/schedule/server";
import { createClient } from "@/lib/supabase/server";

type Props = {
  template: TournamentTemplate;
};

/**
 * Per-template Schedule tab. Wraps the existing RecurrenceEditor +
 * NextNightCard so each template owns its own schedule + override flow.
 *
 * Before this tab existed, both UIs lived on /admin/settings and only
 * surfaced for `templates[0]` — adding a second template silently lost
 * its scheduling controls. Hosting them here means each template gets
 * full schedule management.
 *
 * Server component so we can call resolveNextNight() with the same
 * Supabase client the rest of the page uses.
 */
export async function ScheduleTab({ template }: Props) {
  const supabase = await createClient();
  const nextNight = await resolveNextNight(supabase, template);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-fg/10 p-4">
        <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
          Recurring schedule
        </h2>
        <RecurrenceEditor
          templateId={template.id}
          templateName={template.name}
          ruleString={template.recurrence_rule}
        />
      </section>

      {nextNight.kind === "ok" ? (
        <section className="rounded-lg border border-fg/10 p-4">
          <NextNightCard
            templateId={template.id}
            originalDate={toIsoDate(nextNight.next.originalDate)}
            overriddenDate={
              nextNight.next.isMoved
                ? toIsoDate(nextNight.next.effectiveDate)
                : null
            }
            hasOverride={nextNight.next.overrideId !== null}
            note={nextNight.next.note}
          />
        </section>
      ) : nextNight.kind === "no-rule" ? (
        <p className="rounded-md border border-fg/10 px-3 py-3 text-sm text-fg/60">
          Enable a recurring schedule above to manage one-off date changes
          (move or skip a specific occurrence).
        </p>
      ) : (
        <p className="rounded-md border border-fg/10 px-3 py-3 text-sm text-fg/60">
          The next {nextNight.lookedAhead} occurrences are all cancelled.
          Restore one above to schedule a poker night.
        </p>
      )}
    </div>
  );
}
