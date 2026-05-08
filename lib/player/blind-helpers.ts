/**
 * Helpers that read into the `blind_structure_snapshot` JSONB column on
 * `tournaments`. The snapshot mirrors the shape in
 * `seed/bluff-and-baffoons.json` — an array of level objects with optional
 * `smallBlind`, `bigBlind`, `ante`, `isBreak`, `colorUp`, `durationMin`.
 */

export type BlindLevel = {
  level: number;
  smallBlind?: number;
  bigBlind?: number;
  ante?: number;
  durationMin?: number;
  isBreak?: boolean;
  colorUp?: number[];
};

export function parseBlindLevels(raw: unknown): BlindLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((l): l is BlindLevel => !!l && typeof l === "object");
}

export function levelAt(
  levels: BlindLevel[],
  currentLevel: number,
): BlindLevel | undefined {
  if (currentLevel <= 0) return undefined;
  return (
    levels.find((l) => l.level === currentLevel) ?? levels[currentLevel - 1]
  );
}

export function nextPlayLevel(
  levels: BlindLevel[],
  currentLevel: number,
): BlindLevel | undefined {
  return levels.find((l) => l.level > currentLevel && !l.isBreak);
}
