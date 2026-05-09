/**
 * Pure helpers for assigning players to tables/seats.
 *
 * Round-robin balance: with N players spread across T tables, the result
 * has exactly ceil(N/T) at the busy tables and floor(N/T) at the rest.
 * This is the standard tournament-poker shape — no table starts the
 * night meaningfully short-handed.
 */

export type Assignment = {
  player_id: string;
  table_number: number;
  /** Seat number within the table, 1..maxSeatsPerTable. */
  seat_number: number;
};

export type RandomizeArgs = {
  playerIds: readonly string[];
  numTables: number;
  maxSeatsPerTable: number;
  /**
   * Optional injected RNG so callers (and tests) can make output
   * deterministic. Defaults to `Math.random`.
   */
  random?: () => number;
};

export function randomizeAssignments(args: RandomizeArgs): Assignment[] {
  const { playerIds, numTables, maxSeatsPerTable, random = Math.random } = args;

  if (numTables <= 0) {
    throw new Error("numTables must be positive");
  }
  if (maxSeatsPerTable <= 0) {
    throw new Error("maxSeatsPerTable must be positive");
  }
  const cap = numTables * maxSeatsPerTable;
  if (playerIds.length > cap) {
    throw new Error(
      `${playerIds.length} players don't fit in ${numTables} × ${maxSeatsPerTable} = ${cap} seats. Increase numTables or maxSeatsPerTable.`,
    );
  }

  // Fisher-Yates shuffle in-place on a copy, using the injected RNG.
  const shuffled = [...playerIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Round-robin assignment so player counts stay balanced across tables.
  // Player at index `i` lands at table (i % numTables) + 1, seat
  // floor(i / numTables) + 1.
  return shuffled.map((id, i) => ({
    player_id: id,
    table_number: (i % numTables) + 1,
    seat_number: Math.floor(i / numTables) + 1,
  }));
}

/**
 * Group an assignment list by `table_number` for rendering. Tables with
 * no players (rare — only when randomize was skipped or roster is < 1
 * per table) are still included so the layout shape stays predictable.
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
 * Suggest a sensible default tables × seats split for a given roster
 * size. Keeps tables under 9 — beyond that play gets sluggish — and
 * prefers fewer tables when the roster is small.
 */
export function suggestTableSplit(playerCount: number): {
  numTables: number;
  maxSeatsPerTable: number;
} {
  if (playerCount <= 0) return { numTables: 1, maxSeatsPerTable: 9 };
  if (playerCount <= 9) return { numTables: 1, maxSeatsPerTable: 9 };
  if (playerCount <= 18) return { numTables: 2, maxSeatsPerTable: 9 };
  if (playerCount <= 27) return { numTables: 3, maxSeatsPerTable: 9 };
  // Beyond 27 we keep capping max seats at 9 and add tables.
  const numTables = Math.ceil(playerCount / 9);
  return { numTables, maxSeatsPerTable: 9 };
}
