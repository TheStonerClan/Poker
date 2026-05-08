/**
 * Helpers that read into the `blind_structure_snapshot` JSONB column on
 * `tournaments`. The DB stores rows in snake_case (matching the
 * `blind_structures.levels` JSONB seeded from supabase/seed.sql:
 *   { level_num, small, big, ante, duration_sec, is_break, color_up_chips }
 * ), but the player UI consumes them as camelCase. parseBlindLevels does
 * the translation in one place so the rest of the player code stays in
 * camelCase.
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

type RawLevel = {
  level_num?: number;
  level?: number;
  small?: number;
  big?: number;
  ante?: number;
  duration_sec?: number;
  duration_min?: number;
  durationMin?: number;
  smallBlind?: number;
  bigBlind?: number;
  is_break?: boolean;
  isBreak?: boolean;
  color_up_chips?: number[];
  colorUp?: number[];
};

export function parseBlindLevels(raw: unknown): BlindLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): BlindLevel[] => {
    if (!entry || typeof entry !== "object") return [];
    const r = entry as RawLevel;
    const level = r.level_num ?? r.level;
    if (typeof level !== "number") return [];
    return [
      {
        level,
        smallBlind: r.small ?? r.smallBlind,
        bigBlind: r.big ?? r.bigBlind,
        ante: r.ante,
        durationMin:
          typeof r.duration_sec === "number"
            ? Math.round(r.duration_sec / 60)
            : (r.duration_min ?? r.durationMin),
        isBreak: r.is_break ?? r.isBreak,
        colorUp: r.color_up_chips ?? r.colorUp,
      },
    ];
  });
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
