-- One-off date overrides for a template's recurring schedule.
--
-- The recurrence rule on tournament_templates produces a deterministic stream
-- of dates ("3rd Friday of each month"). Admins occasionally need to move or
-- cancel a single occurrence (holiday week, conflict, etc.) without touching
-- the rule itself. Each row in this table represents one such override:
--
--   overridden_date is not null  → "move the May 15 night to May 22"
--   overridden_date is null      → "skip the May 15 night entirely"
--
-- The resolver in lib/schedule/next-night.ts is the *only* thing that should
-- combine this table with the rule. Anything that asks "when is the next
-- poker night?" — the admin UI, Signal reminders, the TV banner — must go
-- through the resolver so overrides stay authoritative.
--
-- When the recurrence rule on a template changes, application code deletes
-- the template's overrides (see updateRecurrence in app/admin/settings/
-- actions.ts) so original_date entries stop pointing at dates the new rule
-- doesn't produce.

create table public.schedule_overrides (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references public.tournament_templates(id) on delete cascade,
  original_date   date not null,
  overridden_date date,
  note            text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint schedule_overrides_dates_differ
    check (overridden_date is null or overridden_date <> original_date)
);

create unique index schedule_overrides_template_original_idx
  on public.schedule_overrides (template_id, original_date);

create index schedule_overrides_template_effective_idx
  on public.schedule_overrides (template_id, coalesce(overridden_date, original_date));

create trigger schedule_overrides_set_updated_at
  before update on public.schedule_overrides
  for each row execute function public.set_updated_at();

alter table public.schedule_overrides enable row level security;

-- Admin-only. The service-role key bypasses RLS, which is what the reminder
-- cron will use; if/when public pages need to show "next poker night" we can
-- add a public-read policy then.
create policy "schedule_overrides_admin_all"
  on public.schedule_overrides for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.schedule_overrides;
  end if;
end
$$;
