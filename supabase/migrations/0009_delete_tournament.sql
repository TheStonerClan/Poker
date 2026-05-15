-- Holdem Clock — hard-delete a single tournament
--
-- Two UX needs map onto one DB operation:
--   1. Cancel a tournament that hasn't started yet (status='scheduled').
--   2. Delete a finalized tournament that turned out to be a dummy/test
--      (status='finished').
--
-- Both want to remove the tournament row plus every child row that
-- references it. Child tables (tournament_players, tournament_events,
-- color_up_requests, prize_distributions) already declare
-- `on delete cascade` against `tournaments`, so a single DELETE on
-- `tournaments` would normally cascade — EXCEPT that
-- `tournament_events` carries a BEFORE DELETE trigger
-- (`tournament_events_no_delete`, migration 0001) that enforces the
-- append-only invariant by raising on every row delete. The cascade
-- trips that trigger and aborts the whole transaction.
--
-- Same approach as the 0007 wipe migration, but scoped to a single
-- tournament and packaged as a SECURITY DEFINER function so the JS
-- client can invoke it via rpc(). The function disables the trigger,
-- runs the cascading delete, and re-enables it. PostgreSQL's DDL is
-- transactional, so if anything inside the function fails the implicit
-- rollback restores the trigger automatically — the no-delete
-- invariant cannot get stuck in the wrong state.
--
-- Admin guard mirrors the RLS policies elsewhere: `public.is_admin()`
-- checks the caller's JWT against `public.admins`. Anonymous /
-- unauthenticated callers, and signed-in non-admins, get rejected.

create or replace function public.delete_tournament(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'permission denied: admin required';
  end if;

  alter table public.tournament_events
    disable trigger tournament_events_no_delete;

  delete from public.tournaments where id = p_tournament_id;

  alter table public.tournament_events
    enable trigger tournament_events_no_delete;
end;
$$;

revoke all on function public.delete_tournament(uuid) from public;
grant execute on function public.delete_tournament(uuid) to authenticated;
