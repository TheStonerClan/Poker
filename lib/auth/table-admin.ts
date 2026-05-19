import "server-only";

import { cache } from "react";

import { createServiceClient } from "@/lib/supabase/service";

import { getUser, isAdmin, type AdminUser } from "./index";

/**
 * "Table admin" role.
 *
 * Each `public.players` row can be claimed by exactly one Supabase auth
 * user via `auth_user_id`. When that user signs in, whichever table they
 * are seated at in a currently `running` / `paused` tournament becomes
 * their managed table — they can bust other players at the same table,
 * approve color-ups, and adjust chip counts (logged as `chip_adjust`).
 *
 * The head admin (allow-listed in `public.admins`) is always permitted
 * on every table; these helpers compose with `isAdmin()` for the
 * "admin OR table admin" gate used by Server Actions on shared pages.
 *
 * Reads use the service-role client so a non-admin player can resolve
 * their own roster row + seat without RLS reshuffling. The auth check
 * (`getUser`) is session-tied, so we never trust a request-supplied
 * auth_user_id — we always start from the cookied auth.uid.
 */

export type SeatedTable = {
  tournament_id: string;
  tournament_player_id: string;
  player_id: string;
  table_number: number;
  seat_number: number | null;
};

/**
 * Returns the `players.id` for the signed-in user, or null if the user
 * isn't linked to any roster spot. Cached for the duration of one
 * server render pass so multiple gate checks on the same request don't
 * each hit the DB.
 */
export const getPlayerIdForCurrentUser = cache(
  async (): Promise<string | null> => {
    const user = await getUser();
    if (!user) return null;
    const service = createServiceClient();
    const { data } = await service
      .from("players")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    return data?.id ?? null;
  },
);

/**
 * Returns the table the current user is currently seated at across all
 * `running` / `paused` tournaments. Filters out busted spots so a
 * player who busted earlier in the night loses their table-admin
 * powers automatically.
 *
 * If the user has multiple active seats (shouldn't happen — one
 * roster spot per linked auth user, one active tournament per night
 * in practice), the most recently created tournament wins.
 */
export const getCurrentSeatedTable = cache(
  async (): Promise<SeatedTable | null> => {
    const playerId = await getPlayerIdForCurrentUser();
    if (!playerId) return null;
    const service = createServiceClient();

    // Two-query approach instead of an embedded-resource filter: fetch
    // every still-seated row for this player, then fetch the
    // tournaments that are live and pick the most recent. Avoids
    // PostgREST's quirky `.eq("foreign.col", ...)` syntax and keeps the
    // intent legible.
    const { data: rows } = await service
      .from("tournament_players")
      .select(
        "id, player_id, tournament_id, table_number, seat_number, busted_at_time",
      )
      .eq("player_id", playerId)
      .is("busted_at_time", null)
      .not("table_number", "is", null);
    if (!rows || rows.length === 0) return null;

    const { data: tournaments } = await service
      .from("tournaments")
      .select("id, status, created_at")
      .in("id", Array.from(new Set(rows.map((r) => r.tournament_id))))
      .in("status", ["running", "paused"])
      .order("created_at", { ascending: false });
    if (!tournaments || tournaments.length === 0) return null;

    for (const t of tournaments) {
      const row = rows.find((r) => r.tournament_id === t.id);
      if (row && row.table_number != null) {
        return {
          tournament_id: row.tournament_id,
          tournament_player_id: row.id,
          player_id: row.player_id,
          table_number: row.table_number,
          seat_number: row.seat_number ?? null,
        };
      }
    }
    return null;
  },
);

export type TableAdminContext = {
  user: AdminUser;
  isGlobalAdmin: boolean;
  seatedTable: SeatedTable | null;
};

/**
 * Resolve the current user's authorization context once. Returns null
 * if there is no signed-in user. Callers compose this with
 * `canManageTable` / `canManagePlayerSlot` to gate writes.
 */
export const getAuthContext = cache(
  async (): Promise<TableAdminContext | null> => {
    const user = await getUser();
    if (!user) return null;
    const [globalAdmin, seat] = await Promise.all([
      isAdmin(user.email ?? null),
      getCurrentSeatedTable(),
    ]);
    return {
      user,
      isGlobalAdmin: globalAdmin,
      seatedTable: seat,
    };
  },
);

/**
 * True if the current user can act on (tournament_id, table_number) —
 * either as a global admin or as the player seated at that table in
 * that tournament.
 */
export async function canManageTable(input: {
  tournamentId: string;
  tableNumber: number;
}): Promise<boolean> {
  const ctx = await getAuthContext();
  if (!ctx) return false;
  if (ctx.isGlobalAdmin) return true;
  const seat = ctx.seatedTable;
  return (
    seat != null &&
    seat.tournament_id === input.tournamentId &&
    seat.table_number === input.tableNumber
  );
}

/**
 * Gate helper for Server Actions that act on a specific
 * tournament_player row. Looks up the slot's (tournament, table) and
 * checks the current user has authority over it. Throws on rejection
 * so the calling action's `runAdminAction` wrapper surfaces a clean
 * error message to the client.
 *
 * Returns the slot's metadata so callers don't have to refetch.
 */
export async function requireManagePlayerSlot(
  tournamentPlayerId: string,
): Promise<{
  tournament_id: string;
  player_id: string | null;
  table_number: number | null;
  seat_number: number | null;
  current_chips: number;
  busted_at_time: string | null;
  isGlobalAdmin: boolean;
  actor: "admin" | "table_admin";
}> {
  const ctx = await getAuthContext();
  if (!ctx) throw new Error("Not signed in.");

  const service = createServiceClient();
  const { data: tp, error } = await service
    .from("tournament_players")
    .select(
      "id, tournament_id, player_id, table_number, seat_number, current_chips, busted_at_time",
    )
    .eq("id", tournamentPlayerId)
    .maybeSingle();
  if (error || !tp) throw new Error("Player slot not found.");

  if (ctx.isGlobalAdmin) {
    return {
      tournament_id: tp.tournament_id,
      player_id: tp.player_id ?? null,
      table_number: tp.table_number ?? null,
      seat_number: tp.seat_number ?? null,
      current_chips: tp.current_chips ?? 0,
      busted_at_time: tp.busted_at_time ?? null,
      isGlobalAdmin: true,
      actor: "admin",
    };
  }

  const seat = ctx.seatedTable;
  if (!seat) {
    throw new Error(
      "You don't have a seat at any running tournament right now.",
    );
  }
  if (seat.tournament_id !== tp.tournament_id) {
    throw new Error("That player isn't in your tournament.");
  }
  if (tp.table_number == null || seat.table_number !== tp.table_number) {
    throw new Error(
      "You can only manage players at your own table.",
    );
  }

  return {
    tournament_id: tp.tournament_id,
    player_id: tp.player_id ?? null,
    table_number: tp.table_number ?? null,
    seat_number: tp.seat_number ?? null,
    current_chips: tp.current_chips ?? 0,
    busted_at_time: tp.busted_at_time ?? null,
    isGlobalAdmin: false,
    actor: "table_admin",
  };
}

/**
 * Gate helper for Server Actions scoped to a whole table (e.g. the
 * scoped /table/[id]/[n] page renders need to confirm the viewer can
 * see this table). Throws on rejection.
 */
export async function requireManageTable(input: {
  tournamentId: string;
  tableNumber: number;
}): Promise<TableAdminContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new Error("Not signed in.");
  if (ctx.isGlobalAdmin) return ctx;
  const seat = ctx.seatedTable;
  if (
    !seat ||
    seat.tournament_id !== input.tournamentId ||
    seat.table_number !== input.tableNumber
  ) {
    throw new Error(
      "You can only manage your own table.",
    );
  }
  return ctx;
}
