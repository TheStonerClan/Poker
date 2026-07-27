-- Holdem Clock — let undo reopen an auto-finalized tournament, and let
-- the bounty be collected/corrected after finalize
--
-- `tournaments_block_finalized_writes` (0001) blocks EVERY update to a
-- tournament row once `finished_at` is set, to keep finalized results
-- immutable. That's correct for ordinary edits, but 0014's admin
-- corrections both legitimately need to write to an already-finalized
-- row and were never exempted, so both fail in production today with
-- "tournament <id> is finalized and immutable":
--
--   1. undoEvent() reopening a tournament that auto-finalized off a
--      mistaken bust — sets status back to 'paused' and finished_at back
--      to null.
--   2. collectBounty() / reopenBounty() recording (or correcting) who
--      busted the bounty target — settling up the bounty is a
--      post-game, at-the-table conversation that often happens after
--      the admin has already hit Finalize, and bounty_collected_by_player_id
--      is bookkeeping, not a result that needs to stay frozen.
--
-- Fix: allow exactly two shapes of write to an already-finalized row —
-- un-finalizing it (finished_at going back to null, the reopen case) and
-- changing only bounty_collected_by_player_id (the bounty-correction
-- case) — and keep blocking everything else, preserving the original
-- immutability guarantee for the snapshot/timing/result columns.

create or replace function public.tournaments_block_finalized_writes()
returns trigger
language plpgsql
as $$
declare
  new_without_bounty_and_updated_at public.tournaments;
begin
  if old.finished_at is null then
    return new;
  end if;

  -- Un-finalizing (undo reopening an auto-finalized tournament) is
  -- always allowed — it's the deliberate escape hatch for "this
  -- tournament was finalized by mistake."
  if new.finished_at is null then
    return new;
  end if;

  -- Otherwise the row stays finalized. Allow the write only if
  -- bounty_collected_by_player_id is the sole column changing (compare
  -- the whole row with that column, and the trigger-maintained
  -- updated_at, normalized back to OLD's value).
  new_without_bounty_and_updated_at := new;
  new_without_bounty_and_updated_at.bounty_collected_by_player_id :=
    old.bounty_collected_by_player_id;
  new_without_bounty_and_updated_at.updated_at := old.updated_at;

  if new_without_bounty_and_updated_at is not distinct from old then
    return new;
  end if;

  raise exception 'tournament % is finalized and immutable', old.id
    using errcode = 'check_violation';
end;
$$;
