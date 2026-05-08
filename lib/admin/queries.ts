import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/database.types";

export type Tournament = Tables<"tournaments">;
export type TournamentPlayer = Tables<"tournament_players">;
export type Player = Tables<"players">;
export type TournamentTemplate = Tables<"tournament_templates">;
export type BlindStructure = Tables<"blind_structures">;
export type ColorUpRequest = Tables<"color_up_requests">;

export type BlindLevel = {
  level_num: number;
  small?: number;
  big?: number;
  ante?: number;
  duration_sec: number;
  is_break: boolean;
  color_up_chips?: number[];
};

const ACTIVE_STATUSES = ["scheduled", "running", "paused"] as const;

export const getActiveTournament = cache(async (): Promise<Tournament | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tournaments")
    .select("*")
    .in("status", ACTIVE_STATUSES as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
});

export const getTournament = cache(async (id: string): Promise<Tournament | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tournaments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
});

export type TournamentRosterRow = TournamentPlayer & {
  player: Pick<Player, "id" | "name" | "signal_handle"> | null;
};

export async function getTournamentRoster(
  tournamentId: string,
): Promise<TournamentRosterRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tournament_players")
    .select("*, player:players(id, name, signal_handle)")
    .eq("tournament_id", tournamentId)
    .order("seat_number", { ascending: true, nullsFirst: false });
  return (data ?? []) as TournamentRosterRow[];
}

export async function getPendingColorUpRequests(
  tournamentId: string,
): Promise<Array<ColorUpRequest & { player: Pick<Player, "id" | "name"> | null }>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("color_up_requests")
    .select("*, player:players(id, name)")
    .eq("tournament_id", tournamentId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  return (data ?? []) as Array<
    ColorUpRequest & { player: Pick<Player, "id" | "name"> | null }
  >;
}

export const getTemplates = cache(async (): Promise<TournamentTemplate[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tournament_templates")
    .select("*")
    .order("name");
  return data ?? [];
});

export const getTemplate = cache(
  async (id: string): Promise<TournamentTemplate | null> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("tournament_templates")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return data ?? null;
  },
);

export const getBlindStructure = cache(
  async (id: string): Promise<BlindStructure | null> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("blind_structures")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return data ?? null;
  },
);

export const getPlayers = cache(async (): Promise<Player[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("players")
    .select("*")
    .order("name");
  return data ?? [];
});

export function blindLevels(value: unknown): BlindLevel[] {
  if (!Array.isArray(value)) return [];
  return value as BlindLevel[];
}

export function currentLevel(t: Tournament): BlindLevel | null {
  const levels = blindLevels(t.blind_structure_snapshot);
  return levels.find((l) => l.level_num === t.current_level) ?? null;
}

export function nextLevel(t: Tournament): BlindLevel | null {
  const levels = blindLevels(t.blind_structure_snapshot);
  return levels.find((l) => l.level_num === t.current_level + 1) ?? null;
}
