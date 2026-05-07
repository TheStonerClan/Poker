-- Holdem Clock — initial schema
--
-- One migration that lays down every table, foreign key, index, trigger, and
-- RLS policy needed for Phases 1-4 of the build plan. Designed to be applied
-- against a fresh Supabase project (auth schema must already exist).
--
-- Money columns are stored as INTEGER whole-dollar amounts to match the
-- "Bluff and Baffoons" seed and avoid floating-point rounding drift in the
-- prize-math engine. Chip counts are also INTEGER.

-- ─────────────────────────────────────────────────────────────────────────────
-- Extensions + helpers
-- ─────────────────────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";        -- gen_random_uuid()
create extension if not exists "citext";          -- case-insensitive emails

-- Generic updated_at maintainer.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- admins — email allow-list backing is_admin()
-- ─────────────────────────────────────────────────────────────────────────────
create table public.admins (
  email       citext primary key,
  note        text,
  created_at  timestamptz not null default now()
);

-- Identify the current request as an admin. Used in every RLS policy below.
-- SECURITY DEFINER so callers don't need select on public.admins themselves.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.admins a
    where a.email = coalesce(((auth.jwt()) ->> 'email')::citext, '')
      and (auth.jwt()) ->> 'email' is not null
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- players — master roster (the inactive queue between tournaments)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.players (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(trim(name)) > 0),
  signal_handle   text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index players_name_lower_idx on public.players (lower(name));
create index players_signal_handle_idx     on public.players (signal_handle) where signal_handle is not null;

create trigger players_set_updated_at
  before update on public.players
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- blind_structures — versioned reusable structures
-- ─────────────────────────────────────────────────────────────────────────────
-- levels is a JSONB array of:
--   { level_num, small, big, ante, duration_sec, is_break, color_up_chips[] }
create table public.blind_structures (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  levels      jsonb not null,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint blind_structures_levels_is_array check (jsonb_typeof(levels) = 'array')
);

create unique index blind_structures_name_idx on public.blind_structures (lower(name));

create trigger blind_structures_set_updated_at
  before update on public.blind_structures
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- tournament_templates — recurring config (e.g., "3rd Friday Monthly")
-- ─────────────────────────────────────────────────────────────────────────────
create table public.tournament_templates (
  id                            uuid primary key default gen_random_uuid(),
  name                          text not null,
  location                      text,
  currency                      text not null default 'USD',
  recurrence_rule               text,                   -- iCal RRULE string, nullable
  buy_in                        integer not null check (buy_in >= 0),
  starting_stack                integer not null check (starting_stack > 0),
  max_rebuys                    integer not null default 1 check (max_rebuys >= 0),
  rebuy_price                   integer not null default 0 check (rebuy_price >= 0),
  rebuy_chips                   integer not null default 0 check (rebuy_chips >= 0),
  ante_mode                     text not null default 'BB',
  buyback_config                jsonb not null default '{}'::jsonb,
  side_pots                     jsonb not null default '{}'::jsonb,
  rounding_mode                 jsonb not null default '{"increment":10,"surplusToFirst":true}'::jsonb,
  prize_rules                   jsonb not null,
  chip_denominations            jsonb not null default '[]'::jsonb,
  starting_stack_composition    jsonb not null default '[]'::jsonb,
  blind_structure_id            uuid not null references public.blind_structures(id) on delete restrict,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create unique index tournament_templates_name_idx on public.tournament_templates (lower(name));
create index tournament_templates_blind_structure_idx on public.tournament_templates (blind_structure_id);

create trigger tournament_templates_set_updated_at
  before update on public.tournament_templates
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- tournaments — one instance per poker night
-- ─────────────────────────────────────────────────────────────────────────────
-- All "*_snapshot" columns are copied from the template + structure at
-- launch so historical tournaments don't change when settings are edited.
-- Once finished_at is set, a trigger blocks further mutations.
create table public.tournaments (
  id                                uuid primary key default gen_random_uuid(),
  template_id                       uuid not null references public.tournament_templates(id) on delete restrict,
  scheduled_at                      timestamptz,
  started_at                        timestamptz,
  finished_at                       timestamptz,
  status                            text not null default 'scheduled'
                                      check (status in ('scheduled','running','paused','finished','cancelled')),

  -- Snapshot of every setting that affects gameplay or accounting.
  buy_in_snapshot                   integer not null,
  starting_stack_snapshot           integer not null,
  max_rebuys_snapshot               integer not null,
  rebuy_price_snapshot              integer not null,
  rebuy_chips_snapshot              integer not null,
  ante_mode_snapshot                text not null,
  buyback_config_snapshot           jsonb not null,
  side_pots_snapshot                jsonb not null,
  rounding_mode_snapshot            jsonb not null,
  prize_rules_snapshot              jsonb not null,
  chip_denominations_snapshot       jsonb not null,
  starting_stack_composition_snapshot jsonb not null,
  blind_structure_snapshot          jsonb not null,    -- the full levels array

  -- Live clock state.
  current_level                     integer not null default 0 check (current_level >= 0),
  level_started_at                  timestamptz,
  level_paused_at                   timestamptz,
  accumulated_pause_ms              bigint not null default 0 check (accumulated_pause_ms >= 0),

  created_at                        timestamptz not null default now(),
  updated_at                        timestamptz not null default now(),

  constraint tournaments_finished_implies_started
    check (finished_at is null or started_at is not null),
  constraint tournaments_finished_after_started
    check (finished_at is null or finished_at >= started_at)
);

create index tournaments_template_idx     on public.tournaments (template_id);
create index tournaments_status_idx       on public.tournaments (status);
create index tournaments_scheduled_at_idx on public.tournaments (scheduled_at desc nulls last);

create trigger tournaments_set_updated_at
  before update on public.tournaments
  for each row execute function public.set_updated_at();

-- Once finished, the row is immutable. Service role bypasses this if a
-- correction is ever genuinely needed (set finished_at to NULL first).
create or replace function public.tournaments_block_finalized_writes()
returns trigger
language plpgsql
as $$
begin
  if old.finished_at is not null then
    raise exception 'tournament % is finalized and immutable', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger tournaments_block_finalized_writes
  before update on public.tournaments
  for each row execute function public.tournaments_block_finalized_writes();

-- ─────────────────────────────────────────────────────────────────────────────
-- tournament_players — who's playing tonight + their per-tournament state
-- ─────────────────────────────────────────────────────────────────────────────
create table public.tournament_players (
  id                      uuid primary key default gen_random_uuid(),
  tournament_id           uuid not null references public.tournaments(id) on delete cascade,
  player_id               uuid not null references public.players(id) on delete restrict,
  seat_number             integer check (seat_number is null or seat_number > 0),
  claimed_session_id      text,
  claimed_at              timestamptz,
  current_chips           integer not null default 0 check (current_chips >= 0),

  -- Buyback token state (per BUILD_PLAN house rules).
  buyback_used            boolean not null default false,
  buyback_used_as         text check (buyback_used_as is null or buyback_used_as in ('rebuy','addon')),
  buyback_used_at_level   integer,
  buyback_used_at_time    timestamptz,

  -- Bust + final standing.
  busted_at_level         integer,
  busted_at_time          timestamptz,
  finishing_position      integer check (finishing_position is null or finishing_position > 0),
  payout_amount           integer check (payout_amount is null or payout_amount >= 0),

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint tournament_players_buyback_consistency check (
    (buyback_used and buyback_used_as is not null and buyback_used_at_time is not null)
    or (not buyback_used and buyback_used_as is null and buyback_used_at_level is null and buyback_used_at_time is null)
  )
);

create unique index tournament_players_tourney_player_idx on public.tournament_players (tournament_id, player_id);
create unique index tournament_players_tourney_seat_idx   on public.tournament_players (tournament_id, seat_number)
  where seat_number is not null;
create unique index tournament_players_tourney_position_idx on public.tournament_players (tournament_id, finishing_position)
  where finishing_position is not null;
create index tournament_players_claim_idx on public.tournament_players (claimed_session_id)
  where claimed_session_id is not null;

create trigger tournament_players_set_updated_at
  before update on public.tournament_players
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- tournament_events — append-only log for history & analytics
-- ─────────────────────────────────────────────────────────────────────────────
create table public.tournament_events (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid not null references public.tournaments(id) on delete cascade,
  type            text not null check (type in (
                    'bust','rebuy','addon','color_up','level_advance',
                    'level_pause','level_resume','break_start','break_end',
                    'finalize','claim','release','prize_payout','admin_note'
                  )),
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index tournament_events_tourney_time_idx on public.tournament_events (tournament_id, created_at);
create index tournament_events_type_idx          on public.tournament_events (type);

-- Enforce append-only: no UPDATE or DELETE on rows. Trigger rejects.
create or replace function public.tournament_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'tournament_events is append-only';
end;
$$;

create trigger tournament_events_no_update
  before update on public.tournament_events
  for each row execute function public.tournament_events_append_only();

create trigger tournament_events_no_delete
  before delete on public.tournament_events
  for each row execute function public.tournament_events_append_only();

-- ─────────────────────────────────────────────────────────────────────────────
-- color_up_requests — player-submitted exchange requests
-- ─────────────────────────────────────────────────────────────────────────────
create table public.color_up_requests (
  id                    uuid primary key default gen_random_uuid(),
  tournament_id         uuid not null references public.tournaments(id) on delete cascade,
  player_id             uuid not null references public.players(id) on delete restrict,
  session_id            text not null,
  submitted_chips       jsonb not null,            -- e.g. [{"color":"white","count":23}]
  exchange_for_chips    jsonb not null,
  status                text not null default 'pending'
                          check (status in ('pending','approved','denied','superseded')),
  created_at            timestamptz not null default now(),
  processed_at          timestamptz,
  processed_by          uuid                       -- auth.users.id, not FK'd to keep schema portable
);

create index color_up_requests_tourney_status_idx on public.color_up_requests (tournament_id, status);
create index color_up_requests_player_idx          on public.color_up_requests (player_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- prize_distributions — snapshot of payouts per tournament
-- ─────────────────────────────────────────────────────────────────────────────
create table public.prize_distributions (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid not null references public.tournaments(id) on delete cascade,
  position        integer not null check (position > 0),
  amount          integer not null check (amount >= 0),
  player_id       uuid references public.players(id) on delete set null,
  paid_at         timestamptz,
  created_at      timestamptz not null default now()
);

create unique index prize_distributions_tourney_position_idx
  on public.prize_distributions (tournament_id, position);
create index prize_distributions_player_idx
  on public.prize_distributions (player_id) where player_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.admins                enable row level security;
alter table public.players               enable row level security;
alter table public.tournament_templates  enable row level security;
alter table public.blind_structures      enable row level security;
alter table public.tournaments           enable row level security;
alter table public.tournament_players    enable row level security;
alter table public.tournament_events     enable row level security;
alter table public.color_up_requests     enable row level security;
alter table public.prize_distributions   enable row level security;

-- admins: only admins can read; only service-role writes (no policy = denied).
create policy "admins_select_admin_only"
  on public.admins for select
  to authenticated
  using (public.is_admin());

-- players: admin read/write only.
create policy "players_admin_all"
  on public.players for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- tournament_templates: admin read/write only.
create policy "tournament_templates_admin_all"
  on public.tournament_templates for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- blind_structures: admin read/write only.
create policy "blind_structures_admin_all"
  on public.blind_structures for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- tournaments: public read, admin write.
create policy "tournaments_public_read"
  on public.tournaments for select
  to anon, authenticated
  using (true);

create policy "tournaments_admin_write"
  on public.tournaments for insert
  to authenticated
  with check (public.is_admin());

create policy "tournaments_admin_update"
  on public.tournaments for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "tournaments_admin_delete"
  on public.tournaments for delete
  to authenticated
  using (public.is_admin());

-- tournament_players: public read, admin write. Player claims happen via
-- a server function that uses the service role to set claimed_session_id.
create policy "tournament_players_public_read"
  on public.tournament_players for select
  to anon, authenticated
  using (true);

create policy "tournament_players_admin_write"
  on public.tournament_players for insert
  to authenticated
  with check (public.is_admin());

create policy "tournament_players_admin_update"
  on public.tournament_players for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "tournament_players_admin_delete"
  on public.tournament_players for delete
  to authenticated
  using (public.is_admin());

-- tournament_events: public read, admin insert. UPDATE/DELETE blocked
-- by triggers above for everyone (including service role).
create policy "tournament_events_public_read"
  on public.tournament_events for select
  to anon, authenticated
  using (true);

create policy "tournament_events_admin_insert"
  on public.tournament_events for insert
  to authenticated
  with check (public.is_admin());

-- color_up_requests:
--   - anon/authenticated INSERT only when the (tournament_id, player_id,
--     session_id) tuple matches a current claim. This ties the request
--     to a player who is actively at the table.
--   - public read so the player UI can show their own request status.
--   - admin UPDATE to mark approved/denied/superseded.
create policy "color_up_requests_public_read"
  on public.color_up_requests for select
  to anon, authenticated
  using (true);

create policy "color_up_requests_session_insert"
  on public.color_up_requests for insert
  to anon, authenticated
  with check (
    exists (
      select 1
      from public.tournament_players tp
      where tp.tournament_id      = color_up_requests.tournament_id
        and tp.player_id          = color_up_requests.player_id
        and tp.claimed_session_id = color_up_requests.session_id
    )
  );

create policy "color_up_requests_admin_update"
  on public.color_up_requests for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- prize_distributions: public read, admin write.
create policy "prize_distributions_public_read"
  on public.prize_distributions for select
  to anon, authenticated
  using (true);

create policy "prize_distributions_admin_write"
  on public.prize_distributions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime publication — let clients subscribe to live tournament state.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.tournaments,
      public.tournament_players,
      public.tournament_events,
      public.color_up_requests,
      public.prize_distributions;
  end if;
end
$$;
