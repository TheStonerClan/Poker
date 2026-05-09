-- Holdem Clock — recurring schedule time-of-day + timezone
--
-- Templates can now carry a default start time. Without this, the
-- "Upcoming tournaments" list could only show a calendar date — and
-- a date-only string parsed by JS in a non-UTC timezone reads as the
-- previous day for any user west of UTC ("Thu May 14" for a 5/15
-- recurrence).
--
-- Two columns:
--   - start_time      text, "HH:MM" 24-hour wall-clock time
--                     in the template's timezone. NULL = no time set
--                     (the homepage falls back to date-only display).
--   - start_timezone  text, IANA zone like "America/Chicago".
--                     Required when start_time is set so we know which
--                     wall clock the HH:MM refers to. NULL when
--                     start_time is also NULL.
--
-- Stored as text rather than time + text so JSON-driven actions don't
-- need to reach for PG-specific casts. The app validates the shape.

alter table public.tournament_templates
  add column if not exists start_time text,
  add column if not exists start_timezone text;

-- Cheap defensive check: either both NULL or both set. Catches typos
-- like setting time without zone — the app would otherwise project a
-- date-only entry and quietly drop the time the admin entered.
--
-- DROP-then-ADD is the idempotent pattern (`add constraint if not
-- exists` doesn't exist in PG <17). Re-running this migration after
-- a partial apply is now a no-op rather than a 42710 error.
alter table public.tournament_templates
  drop constraint if exists tournament_templates_start_time_zone_paired;
alter table public.tournament_templates
  add constraint tournament_templates_start_time_zone_paired
  check (
    (start_time is null and start_timezone is null)
    or (start_time is not null and start_timezone is not null)
  );

-- HH:MM 24-hour. Belt-and-suspenders against bad client payloads.
alter table public.tournament_templates
  drop constraint if exists tournament_templates_start_time_format;
alter table public.tournament_templates
  add constraint tournament_templates_start_time_format
  check (
    start_time is null
    or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  );
