-- Holdem Clock — configurable rebuy limit
--
-- Until now `tokensPerPlayer` in the buyback config was effectively ignored:
-- the rebuy and addon actions checked the boolean `buyback_used` flag and
-- refused once any token was spent. This adds two integer counters so the
-- actions can honor the configured limit (default still 1, but can be
-- raised to allow rebuys + addon, multiple rebuys, etc.).
--
-- Two counters instead of one so the TV's "Re-Entries" / "Add-ons" stats
-- and any analytics that distinguish them stay correct when the same
-- player uses both modes.

alter table public.tournament_players
  add column if not exists rebuys_used integer not null default 0
    check (rebuys_used >= 0),
  add column if not exists addons_used integer not null default 0
    check (addons_used >= 0);

-- Backfill: existing rows that already used a token under the legacy
-- single-token rule get a 1 in the matching counter. Idempotent: if you
-- run the migration twice, the inner condition (counter = 0) prevents
-- double-counting.
update public.tournament_players
   set rebuys_used = 1
 where buyback_used = true
   and buyback_used_as = 'rebuy'
   and rebuys_used = 0;

update public.tournament_players
   set addons_used = 1
 where buyback_used = true
   and buyback_used_as = 'addon'
   and addons_used = 0;

comment on column public.tournament_players.rebuys_used is
  'Count of rebuys spent by this player slot. Combined with addons_used to enforce the per-player tokensPerPlayer limit configured on the tournament.';

comment on column public.tournament_players.addons_used is
  'Count of add-ons spent by this player slot. Combined with rebuys_used to enforce the per-player tokensPerPlayer limit configured on the tournament.';
