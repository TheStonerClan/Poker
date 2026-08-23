// Builds a RecapInput from Supabase.
//
// Two entry points:
//   loadRecapForTournament(id)  — used by the eventual finalization handler.
//   loadLastCompletedRecap()    — convenience wrapper for manual testing
//                                  via send-recap.ts; finds the most recently
//                                  finished tournament and delegates.
//
// Requires service-role access because RLS locks the cross-table reads.
// Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the shell
// (e.g. `set -a; source .env.local; set +a` from the project root).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/database.types';
import type { RecapFunFacts, RecapInput } from './recap';

type SupaClient = SupabaseClient<Database>;

// ── Narrow types for the JSON columns / event payloads ─────────────────────
interface BlindLevel {
  level_num: number;
  small?: number;
  big?: number;
  ante?: number;
  is_break: boolean;
  duration_sec?: number;
}
interface BustPayload {
  at_level?: number;
  player_id?: string;
}
interface LevelAdvancePayload {
  from_level?: number;
  to_level?: number;
}
interface ChipSnapshotPayload {
  chips?: number;
  level_num?: number;
  player_id?: string;
}

function maybeFirst<T>(value: T | T[] | null | undefined): T | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value[0];
  return value;
}

function getServiceClient(): SupaClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase env missing — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
        '(try: `set -a; source .env.local; set +a` from the project root).',
    );
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface LoadRecapOptions {
  /** Override the URL prefix for the tournament detail page. */
  detailUrlBase?: string;
  /** Inject a pre-built client (e.g. from the Next.js side). */
  client?: SupaClient;
}

const DEFAULT_DETAIL_URL_BASE = 'https://holdemclock.com/history';
const DEFAULT_TIMEZONE = 'America/Los_Angeles';
const DEFAULT_MAX_SEATS_PER_TABLE = 9;

export async function loadLastCompletedRecap(
  opts: LoadRecapOptions = {},
): Promise<RecapInput> {
  const sb = opts.client ?? getServiceClient();
  const { data, error } = await sb
    .from('tournaments')
    .select('id')
    .not('finished_at', 'is', null)
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`finding last tournament: ${error.message}`);
  if (!data) throw new Error('no finished tournament exists yet');

  return loadRecapForTournament(data.id, { ...opts, client: sb });
}

export async function loadRecapForTournament(
  tournamentId: string,
  opts: LoadRecapOptions = {},
): Promise<RecapInput> {
  const sb = opts.client ?? getServiceClient();
  const detailUrlBase = opts.detailUrlBase ?? DEFAULT_DETAIL_URL_BASE;

  const [tournamentRes, playersRes, prizesRes, eventsRes] = await Promise.all([
    sb
      .from('tournaments')
      .select(
        `id, finished_at, started_at, max_seats_per_table,
         blind_structure_snapshot,
         template:tournament_templates ( name, start_timezone )`,
      )
      .eq('id', tournamentId)
      .single(),
    sb
      .from('tournament_players')
      .select(
        `id, finishing_position, busted_at_time, busted_at_level,
         player_id, player:players!tournament_players_player_id_fkey ( name )`,
      )
      .eq('tournament_id', tournamentId),
    sb
      .from('prize_distributions')
      .select(
        `position, amount, is_chopped,
         player:players ( name )`,
      )
      .eq('tournament_id', tournamentId)
      .order('position', { ascending: true }),
    sb
      .from('tournament_events')
      .select('type, payload, created_at')
      .eq('tournament_id', tournamentId)
      .order('created_at', { ascending: true }),
  ]);

  if (tournamentRes.error) throw new Error(`tournaments: ${tournamentRes.error.message}`);
  if (playersRes.error) throw new Error(`tournament_players: ${playersRes.error.message}`);
  if (prizesRes.error) throw new Error(`prize_distributions: ${prizesRes.error.message}`);
  if (eventsRes.error) throw new Error(`tournament_events: ${eventsRes.error.message}`);

  const t = tournamentRes.data;
  if (!t) throw new Error(`tournament ${tournamentId} not found`);

  const tps = playersRes.data ?? [];
  const pds = prizesRes.data ?? [];
  const events = eventsRes.data ?? [];

  const template = maybeFirst(t.template);
  const tournamentName = template?.name ?? 'Tournament';
  const timezone = template?.start_timezone ?? DEFAULT_TIMEZONE;
  const date = new Date(t.finished_at ?? t.started_at ?? Date.now());
  const startedAt = t.started_at ? new Date(t.started_at) : null;
  const maxSeats = t.max_seats_per_table ?? DEFAULT_MAX_SEATS_PER_TABLE;

  const entries = tps.length;
  const prizePool = pds.reduce((sum, p) => sum + (p.amount ?? 0), 0);

  // ── name lookup for player_id → display name ─────────────────────────
  const nameById = new Map<string, string>();
  for (const tp of tps) {
    const pname = maybeFirst(tp.player)?.name;
    if (tp.player_id && pname) nameById.set(tp.player_id, pname);
  }

  // ── blind structure (JSON column, narrow defensively) ────────────────
  const blindStructure: BlindLevel[] = Array.isArray(t.blind_structure_snapshot)
    ? (t.blind_structure_snapshot as unknown as BlindLevel[])
    : [];
  const breakLevels = blindStructure
    .filter((l) => l.is_break)
    .map((l) => l.level_num)
    .sort((a, b) => a - b);

  // ── podium (positions 1/2/3, collapse chops onto one line) ───────────
  const podium: RecapInput['podium'] = [];
  for (const place of [1, 2, 3] as const) {
    const rows = pds.filter((p) => p.position === place);
    if (rows.length === 0) continue;
    const names =
      rows
        .map((r) => maybeFirst(r.player)?.name)
        .filter((n): n is string => Boolean(n))
        .join(' & ') || `Place ${place}`;
    const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
    const isChopped = rows.some((r) => r.is_chopped);
    podium.push({ place, name: names, payout: Math.round(total), isChopped });
  }

  // ── helpers over events ──────────────────────────────────────────────
  const sortedBusts = events
    .filter((e) => e.type === 'bust')
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

  const findLevelStart = (levelNum: number): Date | null => {
    if (levelNum === 1) return startedAt;
    const advance = events.find(
      (e) =>
        e.type === 'level_advance' &&
        (e.payload as LevelAdvancePayload | null)?.to_level === levelNum,
    );
    return advance ? new Date(advance.created_at) : null;
  };

  /**
   * Latest chip_snapshot per player taken during a specific level
   * (typically a break level). Returns {playerId → {chips, at}}.
   */
  const latestSnapshotsAtLevel = (
    levelNum: number,
  ): Map<string, { chips: number; at: Date }> => {
    const m = new Map<string, { chips: number; at: Date }>();
    for (const e of events) {
      if (e.type !== 'chip_snapshot') continue;
      const p = e.payload as ChipSnapshotPayload | null;
      if (!p || p.level_num !== levelNum || !p.player_id || p.chips == null) continue;
      const at = new Date(e.created_at);
      const existing = m.get(p.player_id);
      if (!existing || at > existing.at) {
        m.set(p.player_id, { chips: p.chips, at });
      }
    }
    return m;
  };

  const leaderFromSnapshots = (
    snapshots: Map<string, { chips: number; at: Date }>,
  ): { name: string; chips: number } | undefined => {
    let best: { playerId: string; chips: number } | null = null;
    for (const [pid, val] of snapshots) {
      if (!best || val.chips > best.chips) best = { playerId: pid, chips: val.chips };
    }
    if (!best) return undefined;
    const name = nameById.get(best.playerId);
    if (!name) return undefined;
    return { name, chips: best.chips };
  };

  // ── First knockout: blinds + minutes into that level ─────────────────
  let firstKnockout: RecapFunFacts['firstKnockout'] | undefined;
  const first = sortedBusts[0];
  if (first && startedAt) {
    const bp = first.payload as BustPayload | null;
    const atLevel = bp?.at_level;
    const playerId = bp?.player_id;
    const name = playerId ? nameById.get(playerId) : undefined;
    const level = atLevel != null
      ? blindStructure.find((l) => l.level_num === atLevel)
      : undefined;
    const levelStart = atLevel != null ? findLevelStart(atLevel) : null;
    if (
      name &&
      level &&
      !level.is_break &&
      level.small != null &&
      level.big != null &&
      levelStart
    ) {
      firstKnockout = {
        name,
        blinds: { small: level.small, big: level.big },
        minutesIntoLevel: Math.max(
          0,
          Math.round(
            (new Date(first.created_at).getTime() - levelStart.getTime()) / 60000,
          ),
        ),
      };
    }
  }

  // ── First eliminated: earliest `busted_at_time` on tournament_players ─
  //   That column reflects each player's *final* bust (after any rebuys),
  //   so the player with the earliest non-null value is the first to truly
  //   leave the game. Distinct from firstKnockout above (event-level).
  let firstEliminated: RecapFunFacts['firstEliminated'];
  {
    const finalBusts = tps
      .filter(
        (p) =>
          p.busted_at_time != null &&
          p.busted_at_level != null &&
          p.player_id != null,
      )
      .map((p) => ({
        playerId: p.player_id as string,
        bustedAt: new Date(p.busted_at_time as string),
        bustedAtLevel: p.busted_at_level as number,
      }))
      .sort((a, b) => a.bustedAt.getTime() - b.bustedAt.getTime());
    const earliest = finalBusts[0];
    if (earliest) {
      const name = nameById.get(earliest.playerId);
      const level = blindStructure.find(
        (l) => l.level_num === earliest.bustedAtLevel,
      );
      const levelStart = findLevelStart(earliest.bustedAtLevel);
      if (
        name &&
        level &&
        !level.is_break &&
        level.small != null &&
        level.big != null &&
        levelStart
      ) {
        firstEliminated = {
          name,
          blinds: { small: level.small, big: level.big },
          minutesIntoLevel: Math.max(
            0,
            Math.round(
              (earliest.bustedAt.getTime() - levelStart.getTime()) / 60000,
            ),
          ),
        };
      }
    }
  }

  // ── Longest survivor (no cash) ───────────────────────────────────────
  let longestSurvivor: RecapFunFacts['longestSurvivor'] | undefined;
  if (startedAt) {
    const inMoney = new Set(pds.map((p) => p.position));
    const noCashBusts = tps
      .filter((p) => p.busted_at_time && p.player_id)
      .filter(
        (p) =>
          p.finishing_position == null ||
          !inMoney.has(p.finishing_position),
      )
      .map((p) => ({
        playerId: p.player_id as string,
        bustedAt: new Date(p.busted_at_time as string),
      }))
      .sort((a, b) => b.bustedAt.getTime() - a.bustedAt.getTime());
    const latestNoCash = noCashBusts[0];
    if (latestNoCash) {
      const name = nameById.get(latestNoCash.playerId);
      if (name) {
        longestSurvivor = {
          name,
          durationMinutes: Math.max(
            0,
            Math.round(
              (latestNoCash.bustedAt.getTime() - startedAt.getTime()) / 60000,
            ),
          ),
        };
      }
    }
  }

  // ── Chip leaders at break 1 / break 2 ────────────────────────────────
  const break1Level = breakLevels[0];
  const break2Level = breakLevels[1];
  const snapsAtBreak1 =
    break1Level != null ? latestSnapshotsAtLevel(break1Level) : new Map();
  const snapsAtBreak2 =
    break2Level != null ? latestSnapshotsAtLevel(break2Level) : new Map();
  const chipLeaderFirstBreak = leaderFromSnapshots(snapsAtBreak1);
  const chipLeaderSecondBreak = leaderFromSnapshots(snapsAtBreak2);

  // ── Chip leader at final-table merge ─────────────────────────────────
  let chipLeaderFinalTable: RecapFunFacts['chipLeaderFinalTable'];
  let mergeAt: Date | null = null;
  {
    let remaining = entries;
    for (const b of sortedBusts) {
      remaining -= 1;
      if (remaining <= maxSeats) {
        mergeAt = new Date(b.created_at);
        break;
      }
    }
  }
  if (mergeAt) {
    const survivors = new Set<string>();
    for (const p of tps) {
      const bustedAt = p.busted_at_time ? new Date(p.busted_at_time) : null;
      if (!bustedAt || bustedAt.getTime() > mergeAt.getTime()) {
        if (p.player_id) survivors.add(p.player_id);
      }
    }
    // Latest chip_snapshot per survivor at or before mergeAt
    const snaps = new Map<string, { chips: number; at: Date }>();
    for (const e of events) {
      if (e.type !== 'chip_snapshot') continue;
      const p = e.payload as ChipSnapshotPayload | null;
      if (!p || !p.player_id || p.chips == null) continue;
      if (!survivors.has(p.player_id)) continue;
      const at = new Date(e.created_at);
      if (at > mergeAt) continue;
      const existing = snaps.get(p.player_id);
      if (!existing || at > existing.at) {
        snaps.set(p.player_id, { chips: p.chips, at });
      }
    }
    chipLeaderFinalTable = leaderFromSnapshots(snaps);
  }

  // ── Biggest swing between break 1 and break 2 ────────────────────────
  let biggestSwing: RecapFunFacts['biggestSwing'];
  if (snapsAtBreak1.size && snapsAtBreak2.size) {
    let best: { playerId: string; delta: number } | null = null;
    for (const [pid, b1] of snapsAtBreak1) {
      const b2 = snapsAtBreak2.get(pid);
      if (!b2) continue;
      const delta = b2.chips - b1.chips;
      if (!best || Math.abs(delta) > Math.abs(best.delta)) {
        best = { playerId: pid, delta };
      }
    }
    if (best) {
      const name = nameById.get(best.playerId);
      if (name) {
        biggestSwing = { name, delta: best.delta, betweenBreaks: [1, 2] };
      }
    }
  }

  const funFacts: RecapFunFacts = {
    ...(firstKnockout && { firstKnockout }),
    ...(firstEliminated && { firstEliminated }),
    ...(longestSurvivor && { longestSurvivor }),
    ...(chipLeaderFirstBreak && { chipLeaderFirstBreak }),
    ...(chipLeaderSecondBreak && { chipLeaderSecondBreak }),
    ...(chipLeaderFinalTable && { chipLeaderFinalTable }),
    ...(biggestSwing && { biggestSwing }),
  };

  return {
    tournamentName,
    date,
    timezone,
    entries,
    prizePool,
    podium,
    funFacts,
    detailUrl: `${detailUrlBase}/${tournamentId}`,
  };
}
