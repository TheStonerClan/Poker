/**
 * Helpers for digesting `tournament_events.type = 'chip_snapshot'` rows
 * into the shapes the admin live page and the TV recap consume.
 *
 * Snapshot payload (written by `submitChipSnapshot` in
 * /app/play/[sessionId]/actions.ts):
 *
 *   {
 *     player_id: string,
 *     level_num: number,
 *     chips: number,
 *     previous_chips: number,
 *     delta: number,
 *     anon_session: string,
 *     reported_by: 'player'
 *   }
 */

export type ChipSnapshotEvent = {
  type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export type LatestSnapshot = {
  /** Most recent submitted total. */
  chips: number;
  /** Level the most recent submission was logged at. */
  levelNum: number;
  /** Δ from the previous submission. 0 if this is the first. */
  deltaFromPrevious: number;
  /** ISO timestamp of the submission. */
  at: string;
};

function isChipSnapshot(e: ChipSnapshotEvent): boolean {
  return e.type === "chip_snapshot" && e.payload != null;
}

function readPayload(e: ChipSnapshotEvent): {
  playerId: string | null;
  levelNum: number | null;
  chips: number | null;
  delta: number | null;
} {
  const p = e.payload ?? {};
  return {
    playerId: typeof p.player_id === "string" ? p.player_id : null,
    levelNum: typeof p.level_num === "number" ? p.level_num : null,
    chips: typeof p.chips === "number" ? p.chips : null,
    delta: typeof p.delta === "number" ? p.delta : null,
  };
}

/**
 * Returns a map of player_id → latest snapshot for each player who has
 * submitted at least one. Events that don't parse cleanly are skipped.
 *
 * Input is expected to be ordered ascending by created_at (matching the
 * existing /api/tv events feed and the admin queries on this page).
 */
export function latestChipSnapshotPerPlayer(
  events: ChipSnapshotEvent[],
): Map<string, LatestSnapshot> {
  const out = new Map<string, LatestSnapshot>();
  for (const e of events) {
    if (!isChipSnapshot(e)) continue;
    const { playerId, levelNum, chips, delta } = readPayload(e);
    if (playerId == null || levelNum == null || chips == null) continue;
    out.set(playerId, {
      chips,
      levelNum,
      deltaFromPrevious: delta ?? 0,
      at: e.created_at,
    });
  }
  return out;
}

export type BiggestSwing = {
  playerId: string;
  delta: number;
  levelNum: number;
  newChips: number;
  at: string;
};

/**
 * Identify the biggest single-break gain and loss across all snapshots.
 * Returns null for either side when no snapshot of that direction exists.
 *
 * "Biggest gain" = max positive delta among all chip_snapshot events.
 * "Biggest loss" = min negative delta. The first snapshot for any
 * given player has delta=0 by convention (no previous total to compare),
 * so it never wins.
 */
export function biggestChipSwings(events: ChipSnapshotEvent[]): {
  biggestGain: BiggestSwing | null;
  biggestLoss: BiggestSwing | null;
} {
  let biggestGain: BiggestSwing | null = null;
  let biggestLoss: BiggestSwing | null = null;
  for (const e of events) {
    if (!isChipSnapshot(e)) continue;
    const { playerId, levelNum, chips, delta } = readPayload(e);
    if (
      playerId == null ||
      levelNum == null ||
      chips == null ||
      delta == null
    ) {
      continue;
    }
    if (delta > 0 && (biggestGain == null || delta > biggestGain.delta)) {
      biggestGain = {
        playerId,
        delta,
        levelNum,
        newChips: chips,
        at: e.created_at,
      };
    } else if (
      delta < 0 &&
      (biggestLoss == null || delta < biggestLoss.delta)
    ) {
      biggestLoss = {
        playerId,
        delta,
        levelNum,
        newChips: chips,
        at: e.created_at,
      };
    }
  }
  return { biggestGain, biggestLoss };
}
