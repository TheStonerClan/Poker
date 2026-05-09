/**
 * Per-table config + balanced randomization + per-table chip stats.
 *
 * Migration 0005 introduced flat (num_tables, max_seats_per_table). 0006
 * adds an optional `tables_config` JSONB so each table can have its own
 * name, color, and seat cap. Most callers should go through
 * `resolveTablesConfig()` which falls back to defaults when the config
 * is absent (legacy tournaments).
 */

// ─── Color palette ──────────────────────────────────────────────────────────

export type TableColor =
  | "gold"
  | "red"
  | "blue"
  | "green"
  | "purple"
  | "orange"
  | "teal"
  | "pink";

export const TABLE_COLORS: readonly TableColor[] = [
  "gold",
  "red",
  "blue",
  "green",
  "purple",
  "orange",
  "teal",
  "pink",
] as const;

/**
 * CSS values for each table color. Used by both admin and TV. Keeping
 * the swatch list short means we can render hard-coded swatches without
 * resorting to dynamic Tailwind classes (which the JIT can't see).
 */
export const TABLE_COLOR_CSS: Record<
  TableColor,
  { bg: string; text: string; border: string; hex: string }
> = {
  gold: {
    bg: "rgba(215, 162, 38, 0.15)",
    text: "#d7a226",
    border: "rgba(215, 162, 38, 0.6)",
    hex: "#d7a226",
  },
  red: {
    bg: "rgba(204, 46, 46, 0.15)",
    text: "#ef5757",
    border: "rgba(204, 46, 46, 0.6)",
    hex: "#cc2e2e",
  },
  blue: {
    bg: "rgba(44, 111, 191, 0.15)",
    text: "#5a93d3",
    border: "rgba(44, 111, 191, 0.6)",
    hex: "#2c6fbf",
  },
  green: {
    bg: "rgba(44, 139, 74, 0.15)",
    text: "#46b367",
    border: "rgba(44, 139, 74, 0.6)",
    hex: "#2c8b4a",
  },
  purple: {
    bg: "rgba(107, 58, 160, 0.15)",
    text: "#9c6cd8",
    border: "rgba(107, 58, 160, 0.6)",
    hex: "#6b3aa0",
  },
  orange: {
    bg: "rgba(217, 122, 44, 0.15)",
    text: "#e89143",
    border: "rgba(217, 122, 44, 0.6)",
    hex: "#d97a2c",
  },
  teal: {
    bg: "rgba(38, 166, 154, 0.15)",
    text: "#3cc4b6",
    border: "rgba(38, 166, 154, 0.6)",
    hex: "#26a69a",
  },
  pink: {
    bg: "rgba(207, 106, 138, 0.15)",
    text: "#e486a1",
    border: "rgba(207, 106, 138, 0.6)",
    hex: "#cf6a8a",
  },
};

export function isTableColor(v: unknown): v is TableColor {
  return typeof v === "string" && (TABLE_COLORS as readonly string[]).includes(v);
}

// ─── Config resolution ──────────────────────────────────────────────────────

export type TableConfig = {
  name: string;
  color: TableColor;
  max_seats: number;
};

/**
 * Default name + rotating color for a 1-indexed table position. Used as
 * the fallback when a tournament was created before per-table config
 * existed (legacy 0005-era data) or when migrating in.
 */
export function defaultTableEntry(index1: number, maxSeats: number): TableConfig {
  return {
    name: `Table ${index1}`,
    color: TABLE_COLORS[(index1 - 1) % TABLE_COLORS.length],
    max_seats: maxSeats,
  };
}

/**
 * Build the tables_config used everywhere (wizard, randomizer, TV) given
 * what's stored on a tournament row. Falls back to (num_tables of
 * max_seats_per_table) defaults when the JSONB column is absent.
 */
export function resolveTablesConfig(args: {
  tablesConfig: unknown;
  numTables: number | null;
  maxSeatsPerTable: number | null;
}): TableConfig[] {
  const fromJson = parseTablesConfig(args.tablesConfig);
  if (fromJson) return fromJson;
  const n = args.numTables ?? 0;
  const seats = args.maxSeatsPerTable ?? 9;
  if (n <= 0) return [];
  return Array.from({ length: n }, (_, i) => defaultTableEntry(i + 1, seats));
}

function parseTablesConfig(raw: unknown): TableConfig[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TableConfig[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] as Record<string, unknown>;
    if (!entry || typeof entry !== "object") return null;
    const name =
      typeof entry.name === "string" && entry.name.trim().length > 0
        ? entry.name
        : `Table ${i + 1}`;
    const color = isTableColor(entry.color)
      ? entry.color
      : TABLE_COLORS[i % TABLE_COLORS.length];
    const max_seats =
      typeof entry.max_seats === "number" && entry.max_seats > 0
        ? Math.floor(entry.max_seats)
        : 9;
    out.push({ name, color, max_seats });
  }
  return out;
}

// ─── Randomization ─────────────────────────────────────────────────────────

export type Assignment = {
  player_id: string;
  table_number: number;
  seat_number: number;
};

export type RandomizeArgs = {
  playerIds: readonly string[];
  tables: readonly TableConfig[];
  /** Injected RNG so tests can be deterministic. Defaults to Math.random. */
  random?: () => number;
};

/**
 * Greedy "assign to most-remaining-seats" randomization. With equal-
 * capacity tables this round-robins (any table tied for most-remaining
 * is fine; first-found wins on ties). With mixed capacities, smaller
 * tables fill at the same rate as larger ones BUT they hit their cap
 * sooner — so the leftover stragglers naturally land at the larger
 * tables. Example (caps 9/9/7, 18 players → 6/6/6; 24 players → 9/8/7).
 */
export function randomizeAssignments(args: RandomizeArgs): Assignment[] {
  const { playerIds, tables, random = Math.random } = args;
  if (tables.length === 0) {
    throw new Error("at least one table is required");
  }
  const cap = tables.reduce((s, t) => s + t.max_seats, 0);
  if (playerIds.length > cap) {
    throw new Error(
      `${playerIds.length} players don't fit in ${cap} configured seats. Add a table or raise a seat cap.`,
    );
  }

  // Fisher-Yates shuffle on a copy.
  const shuffled = [...playerIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const T = tables.length;
  const filled = new Array(T).fill(0);
  const seatsAtTable: string[][] = Array.from({ length: T }, () => []);

  for (const id of shuffled) {
    // Find the table with the most remaining capacity. Ties break to the
    // lowest-indexed table so the result is deterministic given the
    // shuffle order — useful for the "stragglers go to larger tables"
    // contract: when caps are 9/9/7 and we're past the 7-mark, table 2
    // (cap 7) is full, so the remaining capacity is in tables 0/1.
    let bestIdx = -1;
    let bestRemaining = -1;
    for (let i = 0; i < T; i++) {
      const remaining = tables[i].max_seats - filled[i];
      if (remaining > bestRemaining) {
        bestIdx = i;
        bestRemaining = remaining;
      }
    }
    if (bestIdx < 0 || bestRemaining <= 0) {
      // Should not happen given the cap check above.
      throw new Error("ran out of seats during assignment");
    }
    filled[bestIdx]++;
    seatsAtTable[bestIdx].push(id);
  }

  const out: Assignment[] = [];
  for (let i = 0; i < T; i++) {
    seatsAtTable[i].forEach((id, seatIdx) => {
      out.push({
        player_id: id,
        table_number: i + 1,
        seat_number: seatIdx + 1,
      });
    });
  }
  return out;
}

/**
 * Group player rows by table_number for rendering. Tables with no
 * players are still included so the layout stays predictable when a
 * table sits empty (rare but possible mid-tournament once everyone at
 * a table busts).
 */
export function groupByTable<
  T extends { table_number: number | null },
>(rows: T[], numTables: number): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (let t = 1; t <= numTables; t++) out.set(t, []);
  for (const r of rows) {
    if (r.table_number == null) continue;
    const arr = out.get(r.table_number);
    if (arr) arr.push(r);
  }
  return out;
}

/**
 * Suggest sensible (numTables, maxSeats) defaults for the wizard based
 * on the picked roster size. Caps tables at 9 seats — beyond that play
 * gets sluggish — and prefers fewer tables when the field is small.
 */
export function suggestTableSplit(playerCount: number): {
  numTables: number;
  maxSeatsPerTable: number;
} {
  if (playerCount <= 0) return { numTables: 1, maxSeatsPerTable: 9 };
  if (playerCount <= 9) return { numTables: 1, maxSeatsPerTable: 9 };
  if (playerCount <= 18) return { numTables: 2, maxSeatsPerTable: 9 };
  if (playerCount <= 27) return { numTables: 3, maxSeatsPerTable: 9 };
  return { numTables: Math.ceil(playerCount / 9), maxSeatsPerTable: 9 };
}

// ─── Per-table chip stats ───────────────────────────────────────────────────

export type PerTableRow = {
  table_number: number | null;
  player_id: string | null;
  current_chips: number;
  busted_at_time: string | null;
  buyback_used: boolean;
  buyback_used_as: string | null;
  rebuys_used?: number | null;
  addons_used?: number | null;
  players?: { id: string; name: string } | null;
};

export type ChipsCfg = {
  startingStack: number;
  rebuyChips: number;
  addOnChips: number;
};

export type TableStats = {
  tableNumber: number;
  name: string;
  color: TableColor;
  /** Configured cap for this table (from tables_config). */
  maxSeats: number;
  /** Active = not yet busted. Drives the per-table average denominator. */
  activePlayers: number;
  /** Total ever-seated at this table (active + busted). Used for chip math. */
  seatedPlayers: number;
  /**
   * Conservation-of-chips: seatedPlayers × startingStack +
   * tableRebuys × rebuyChips + tableAddOns × addOnChips. Reflects the
   * real chip count on that table even after some players bust (their
   * stacks transfer to whoever knocked them out).
   */
  totalChips: number;
  averageChips: number;
  rebuys: number;
  addOns: number;
  /**
   * Active player with the largest current_chips. Null if table has
   * zero active players.
   */
  chipLeader: { playerId: string; name: string; chips: number } | null;
};

export function aggregateByTable(args: {
  rows: PerTableRow[];
  tablesConfig: TableConfig[];
  chipsCfg: ChipsCfg;
}): TableStats[] {
  const { rows, tablesConfig, chipsCfg } = args;
  const out: TableStats[] = [];

  for (let i = 0; i < tablesConfig.length; i++) {
    const cfg = tablesConfig[i];
    const tableNumber = i + 1;
    const tableRows = rows.filter((r) => r.table_number === tableNumber);

    let activePlayers = 0;
    let rebuys = 0;
    let addOns = 0;
    let chipLeader: TableStats["chipLeader"] = null;

    for (const r of tableRows) {
      const tk = tokenCountsForRow(r);
      rebuys += tk.rebuys;
      addOns += tk.addOns;
      if (r.busted_at_time == null) {
        activePlayers += 1;
        const chips = r.current_chips ?? 0;
        if (chipLeader == null || chips > chipLeader.chips) {
          chipLeader = {
            playerId: r.player_id ?? "",
            name: r.players?.name ?? "—",
            chips,
          };
        }
      }
    }

    const seatedPlayers = tableRows.length;
    const totalChips =
      seatedPlayers * chipsCfg.startingStack +
      rebuys * chipsCfg.rebuyChips +
      addOns * chipsCfg.addOnChips;
    const averageChips =
      activePlayers > 0 ? Math.round(totalChips / activePlayers) : 0;

    out.push({
      tableNumber,
      name: cfg.name,
      color: cfg.color,
      maxSeats: cfg.max_seats,
      activePlayers,
      seatedPlayers,
      totalChips,
      averageChips,
      rebuys,
      addOns,
      chipLeader,
    });
  }
  return out;
}

function tokenCountsForRow(r: PerTableRow): { rebuys: number; addOns: number } {
  const rebuys =
    typeof r.rebuys_used === "number" && r.rebuys_used > 0
      ? r.rebuys_used
      : r.buyback_used && r.buyback_used_as === "rebuy"
        ? 1
        : 0;
  const addOns =
    typeof r.addons_used === "number" && r.addons_used > 0
      ? r.addons_used
      : r.buyback_used && r.buyback_used_as === "addon"
        ? 1
        : 0;
  return { rebuys, addOns };
}

// ─── Balance + Merge moves ─────────────────────────────────────────────────

/** A single (table, seat) reassignment for one tournament_player row. */
export type Move = {
  /** tournament_players.id */
  id: string;
  table_number: number;
  seat_number: number;
};

export type BalanceMergeRow = {
  id: string;
  table_number: number | null;
  seat_number: number | null;
  busted_at_time: string | null;
};

/**
 * Compute the moves needed to balance ACTIVE players across the
 * configured tables. Picks the table with the most active players and
 * moves a random player to the table with the fewest, repeating until
 * the spread is ≤ 1. Doesn't touch busted players (they stay assigned
 * to their original table for the historical record).
 *
 * Empty array means already balanced.
 *
 * Each move's destination seat is the lowest unused seat at the
 * destination table, accounting for both stayers and previous moves
 * in the same balance run, so multiple sequential row updates don't
 * collide on the partial unique index `(tournament_id, table_number,
 * seat_number)`.
 */
export function computeBalanceMoves(args: {
  rows: readonly BalanceMergeRow[];
  tablesConfig: readonly TableConfig[];
  random?: () => number;
}): Move[] {
  const random = args.random ?? Math.random;
  const T = args.tablesConfig.length;
  if (T <= 1) return [];

  // Track active-player occupied seats so we don't reassign into a slot
  // currently held by an active player. Busted players are intentionally
  // skipped: their seats are about to be cleared by the action wrapper
  // (see balanceTables in /app/admin/tournaments/[id]/actions.ts) so
  // they're effectively free for reuse. Including them here would cause
  // "no free seat at table N (cap N)" errors on tables where many busts
  // had stacked up.
  const occupied = new Set<string>();
  for (const r of args.rows) {
    if (r.busted_at_time != null) continue;
    if (r.table_number != null && r.seat_number != null) {
      occupied.add(seatKey(r.table_number, r.seat_number));
    }
  }

  // Group active players by their current table. Use mutable arrays so
  // we can splice as we move players.
  const byTable = new Map<number, BalanceMergeRow[]>();
  for (let i = 1; i <= T; i++) byTable.set(i, []);
  for (const r of args.rows) {
    if (r.busted_at_time != null) continue;
    if (r.table_number == null) continue;
    const list = byTable.get(r.table_number);
    if (list) list.push(r);
  }

  const moves: Move[] = [];
  const SAFETY = args.rows.length * 2 + 16; // bound the loop defensively
  for (let iter = 0; iter < SAFETY; iter++) {
    const counts = Array.from(byTable.values()).map((arr) => arr.length);
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    if (max - min <= 1) break;

    const fromIdx = counts.indexOf(max);
    const toIdx = counts.indexOf(min);
    const fromTable = fromIdx + 1;
    const toTable = toIdx + 1;

    const sourceList = byTable.get(fromTable) as BalanceMergeRow[];
    const pickIdx = Math.floor(random() * sourceList.length);
    const player = sourceList.splice(pickIdx, 1)[0];

    // Free the player's old seat so a later iteration could fill it.
    if (player.seat_number != null) {
      occupied.delete(seatKey(fromTable, player.seat_number));
    }

    // Lowest unused seat at destination, capped by the table's max.
    const destCap = args.tablesConfig[toIdx].max_seats;
    let newSeat = 1;
    while (newSeat <= destCap && occupied.has(seatKey(toTable, newSeat))) {
      newSeat++;
    }
    if (newSeat > destCap) {
      // Shouldn't be possible — destination has fewer than `max` actives
      // before this move, so cap can't be exceeded. Bail loudly if a
      // future change to the algorithm breaks the invariant.
      throw new Error(
        `No free seat at table ${toTable} during balance (cap ${destCap}).`,
      );
    }
    occupied.add(seatKey(toTable, newSeat));

    moves.push({ id: player.id, table_number: toTable, seat_number: newSeat });
    (byTable.get(toTable) as BalanceMergeRow[]).push({
      ...player,
      table_number: toTable,
      seat_number: newSeat,
    });
  }

  return moves;
}

export type MergePlan =
  | { kind: "ok"; moves: Move[]; targetTable: number }
  | { kind: "blocked"; reason: string };

/**
 * Compute the moves needed to consolidate every active player onto a
 * single table — the one with the largest configured capacity (lowest
 * index breaks ties). Active players already at the target keep their
 * existing seat numbers; everyone else gets randomized into the
 * remaining lowest-numbered free seats.
 *
 * Returns `kind: 'blocked'` when the active count exceeds the largest
 * table's cap (so the merge wouldn't fit), or when there are no active
 * players, or when there's only one table to begin with.
 */
export function computeMergeMoves(args: {
  rows: readonly BalanceMergeRow[];
  tablesConfig: readonly TableConfig[];
  random?: () => number;
}): MergePlan {
  if (args.tablesConfig.length <= 1) {
    return { kind: "blocked", reason: "Only one table — nothing to merge." };
  }
  // Largest cap; lowest index wins ties so the result is stable.
  let targetIdx = 0;
  for (let i = 1; i < args.tablesConfig.length; i++) {
    if (
      args.tablesConfig[i].max_seats > args.tablesConfig[targetIdx].max_seats
    ) {
      targetIdx = i;
    }
  }
  const targetTable = targetIdx + 1;
  const targetCap = args.tablesConfig[targetIdx].max_seats;

  const active = args.rows.filter((r) => r.busted_at_time == null);
  if (active.length === 0) {
    return { kind: "blocked", reason: "No active players to merge." };
  }
  if (active.length > targetCap) {
    return {
      kind: "blocked",
      reason: `${active.length} active players don't fit at the ${targetCap}-seat target table.`,
    };
  }

  const stayers = active.filter((r) => r.table_number === targetTable);
  const movers = active.filter((r) => r.table_number !== targetTable);
  if (movers.length === 0) {
    return {
      kind: "blocked",
      reason: "Everyone is already at the target table.",
    };
  }

  const usedSeats = new Set<number>();
  for (const s of stayers) {
    if (s.seat_number != null) usedSeats.add(s.seat_number);
  }

  // Shuffle movers so their seating around the existing players is fresh.
  const random = args.random ?? Math.random;
  const shuffled = [...movers];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const moves: Move[] = [];
  for (const m of shuffled) {
    let seat = 1;
    while (usedSeats.has(seat)) seat++;
    if (seat > targetCap) {
      // Defensive — already checked active.length <= targetCap.
      return {
        kind: "blocked",
        reason: "Ran out of seats at the target table.",
      };
    }
    usedSeats.add(seat);
    moves.push({ id: m.id, table_number: targetTable, seat_number: seat });
  }

  return { kind: "ok", moves, targetTable };
}

function seatKey(table: number, seat: number): string {
  return `${table}:${seat}`;
}

// ─── Eligibility helpers (drive admin button enable/disable) ────────────────

/**
 * True when balance would actually do something: more than one table
 * AND a spread of ≥ 2 active players between busiest and quietest.
 */
export function canBalance(stats: TableStats[]): boolean {
  if (stats.length <= 1) return false;
  const counts = stats.map((s) => s.activePlayers);
  return Math.max(...counts) - Math.min(...counts) >= 2;
}

/**
 * True when the active player count fits at the largest configured
 * table — i.e. a merge to one table is feasible. Hidden when there's
 * only one table or the field is too big to consolidate.
 */
export function canMerge(stats: TableStats[]): boolean {
  if (stats.length <= 1) return false;
  const totalActive = stats.reduce((s, t) => s + t.activePlayers, 0);
  if (totalActive === 0) return false;
  const largestCap = Math.max(...stats.map((s) => s.maxSeats));
  // Already-on-one-table check: if every active player is at the same
  // table, no merge needed.
  const tablesWithActives = stats.filter((s) => s.activePlayers > 0).length;
  if (tablesWithActives <= 1) return false;
  return totalActive <= largestCap;
}
