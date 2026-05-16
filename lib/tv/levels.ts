import type { BlindLevelEntry } from "./types";

export function parseLevels(raw: unknown): BlindLevelEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is Record<string, unknown> => l !== null && typeof l === "object")
    .map((l) => ({
      level_num: Number(l.level_num),
      small: l.small != null ? Number(l.small) : undefined,
      big: l.big != null ? Number(l.big) : undefined,
      ante: l.ante != null ? Number(l.ante) : undefined,
      duration_sec: Number(l.duration_sec),
      is_break: Boolean(l.is_break),
      color_up_chips: Array.isArray(l.color_up_chips)
        ? (l.color_up_chips as unknown[]).map(Number)
        : undefined,
    }))
    .sort((a, b) => a.level_num - b.level_num);
}

export function getLevel(
  levels: BlindLevelEntry[],
  levelNum: number,
): BlindLevelEntry | null {
  return levels.find((l) => l.level_num === levelNum) ?? null;
}

export function getNextPlayingLevel(
  levels: BlindLevelEntry[],
  currentLevelNum: number,
): BlindLevelEntry | null {
  return (
    levels.find((l) => l.level_num > currentLevelNum && !l.is_break) ?? null
  );
}

/**
 * Short label for a level, separating breaks from playable rounds so
 * the room can tell at a glance whether they're at play or pause:
 *
 *   - Playable: "L1", "L2", "L3", … (count of playable levels up to here)
 *   - Break:    "B1", "B2", "B3", … (count of breaks up to here)
 *
 * The label is computed from the level's position in the structure,
 * not from `level_num` directly — `level_num` is the absolute segment
 * index (1..N including breaks) and a 6-playable + 2-break structure
 * would otherwise display "Level 8" when the player is actually at
 * their 6th playable round (with two breaks behind them).
 *
 * Returns "?" for an unknown level number — caller should already
 * have validated, but the empty fallback keeps a render path safe.
 */
export function formatLevelLabel(
  levels: BlindLevelEntry[],
  levelNum: number,
): string {
  const target = getLevel(levels, levelNum);
  if (!target) return "?";
  let count = 0;
  for (const l of levels) {
    if (l.is_break !== target.is_break) continue;
    if (l.level_num > levelNum) break;
    count += 1;
  }
  return `${target.is_break ? "B" : "L"}${count}`;
}

/**
 * Count of playable (non-break) and break levels in the structure.
 * Used alongside `levelLabel` to render "L4 of 10" style headers.
 */
export function levelCounts(levels: BlindLevelEntry[]): {
  playable: number;
  breaks: number;
} {
  let playable = 0;
  let breaks = 0;
  for (const l of levels) {
    if (l.is_break) breaks += 1;
    else playable += 1;
  }
  return { playable, breaks };
}

/**
 * Seconds remaining until the next break (inclusive of the current level's
 * remaining time). Returns null if no upcoming break is found.
 */
export function secondsUntilNextBreak(
  levels: BlindLevelEntry[],
  currentLevelNum: number,
  currentLevelRemainingSec: number,
): number | null {
  const current = getLevel(levels, currentLevelNum);
  if (!current) return null;
  if (current.is_break) return 0;

  let total = Math.max(0, currentLevelRemainingSec);
  for (const l of levels) {
    if (l.level_num <= currentLevelNum) continue;
    if (l.is_break) return total;
    total += l.duration_sec;
  }
  return null;
}
