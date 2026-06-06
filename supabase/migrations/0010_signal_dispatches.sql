-- Holdem Clock — Signal dispatch ledger
--
-- Tracks every Signal-bridge send the app initiates (week-out reminders,
-- post-tournament recaps, future ad-hoc messages). Two jobs:
--
--   1. Idempotency. A unique `key` per logical event prevents double sends
--      when a cron fires twice (Vercel retries), an admin clicks the test
--      endpoint after the natural trigger already ran, or finalize is
--      somehow re-invoked. The dispatcher inserts BEFORE calling the
--      bridge so the unique-violation short-circuits a duplicate request.
--
--   2. Audit trail. Every attempt records bridge_response and status so we
--      can see why a send failed and whether to retry.
--
-- This is append-only by convention (the app never updates a row), and
-- admin-only by RLS — only admins can read history; only the service-role
-- key (used by the dispatcher) can insert.

create table public.signal_dispatches (
  id uuid primary key default gen_random_uuid(),
  -- Logical kind of message. Constrain to the dispatcher's known set so a
  -- typo doesn't quietly land in the table.
  kind text not null check (kind in ('week-out', 'recap')),
  -- Deterministic key per event, used for idempotency:
  --   week-out:<template_id>:<YYYY-MM-DD effective date>
  --   recap:<tournament_id>
  -- UNIQUE so a duplicate INSERT raises 23505 instead of double-sending.
  key text not null unique,
  -- The Signal group id we sent to. Sandbox in preview, real in production.
  group_id text not null,
  -- 'sent'   → bridge returned 2xx, message accepted by signal-cli
  -- 'failed' → bridge returned non-2xx, fetch threw, or env config missing
  -- 'skipped' → dispatcher decided not to send (e.g. dry-run mode)
  status text not null check (status in ('sent', 'failed', 'skipped')),
  -- Whatever the bridge returned (timestamp on success, error text on
  -- failure) plus arbitrary context useful for debugging.
  bridge_response jsonb,
  created_at timestamptz not null default now()
);

-- Query patterns:
--   - "did we send for this key already?" → unique index on key (above)
--   - "show me recent dispatches in admin UI" → list by created_at desc
create index signal_dispatches_created_at_idx
  on public.signal_dispatches (created_at desc);

-- RLS. Admins can read everything (for the admin debug page); writes go
-- exclusively through the service-role key, which bypasses RLS — so no
-- INSERT/UPDATE/DELETE policies are intentional.
alter table public.signal_dispatches enable row level security;

create policy "admins can read signal_dispatches"
  on public.signal_dispatches
  for select
  using (public.is_admin());
