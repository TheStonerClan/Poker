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
