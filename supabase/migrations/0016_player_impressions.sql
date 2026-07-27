-- Holdem Clock — AI-generated player impressions
--
-- One short, factual "post-tournament impression" blurb per player,
-- shown on their /history/[player] profile page. Regenerated for every
-- player (real or sandbox scope, never mixed) each time a tournament in
-- that scope finalizes — see refreshAllPlayerImpressions in
-- lib/admin/impressions.ts, called from performFinalize.
--
-- Keyed (player_id, is_sandbox) with a unique index rather than an
-- append-only log: "refresh" means replace with the latest, not
-- accumulate a growing history of stale blurbs.

create table public.player_impressions (
  id                    uuid primary key default gen_random_uuid(),
  player_id             uuid not null references public.players(id) on delete cascade,
  is_sandbox            boolean not null default false,
  impression            text not null check (length(trim(impression)) > 0),
  model                 text not null,
  source_tournament_id  uuid references public.tournaments(id) on delete set null,
  generated_at          timestamptz not null default now(),
  created_at            timestamptz not null default now()
);

create unique index player_impressions_player_scope_idx
  on public.player_impressions (player_id, is_sandbox);

comment on table public.player_impressions is
  'One row per (player, real-vs-sandbox scope): the latest Claude-generated post-tournament blurb for that player, replaced wholesale on every finalize in that scope.';
comment on column public.player_impressions.source_tournament_id is
  'The tournament whose finalize triggered this generation. Nullable so a manual regen or a since-deleted tournament does not orphan the row.';

alter table public.player_impressions enable row level security;

-- Public read (same as everything else feeding /history); only the
-- service role writes, via refreshAllPlayerImpressions — no
-- insert/update policy for anon/authenticated.
create policy "player_impressions_public_read"
  on public.player_impressions for select
  to anon, authenticated
  using (true);
