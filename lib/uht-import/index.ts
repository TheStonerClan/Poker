import type {
  AnteMode,
  BlindLevel,
  BreakLevel,
  ChipDenomination,
  ParsedUhtBackup,
  PlayLevel,
  PrizeDistribution,
  PrizeRule,
  PrizeRuleKind,
  RebuyConfig,
  StackChip,
  TournamentTemplate,
} from './types';

export * from './types';

export class InvalidUhtBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidUhtBackupError';
  }
}

function decodeBase64(input: string): string {
  // Strip whitespace (the .backup files are typically a single base64 blob,
  // but tolerate stray newlines from copy/paste).
  const trimmed = input.replace(/\s+/g, '');
  if (trimmed.length === 0) {
    throw new InvalidUhtBackupError('input is empty');
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
    throw new InvalidUhtBackupError('input is not valid base64');
  }
  try {
    return Buffer.from(trimmed, 'base64').toString('utf-8');
  } catch {
    throw new InvalidUhtBackupError('failed to decode base64 payload');
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new InvalidUhtBackupError(`decoded payload is not valid JSON: ${reason}`);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireKey<T extends string>(
  obj: Record<string, unknown>,
  key: T,
  what: string,
): unknown {
  if (!(key in obj)) {
    throw new InvalidUhtBackupError(`${what} is missing required field "${key}"`);
  }
  return obj[key];
}

/** Parse "1, 5" → [1, 5]. Empty string → []. */
function parseColorUp(raw: unknown): number[] {
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (trimmed === '') return [];
  return trimmed
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

function mapBlindLevel(raw: unknown, index: number): BlindLevel {
  if (!isObject(raw)) {
    throw new InvalidUhtBackupError(`blindStructure[${index}] is not an object`);
  }
  const level = index + 1;
  const isBreak = Boolean(raw['break']);
  const durationMin = Number(raw['duration'] ?? 0);
  if (isBreak) {
    const colorUp = parseColorUp(raw['colorUp']);
    const out: BreakLevel = { level, durationMin, isBreak: true };
    if (colorUp.length > 0) out.colorUp = colorUp;
    return out;
  }
  const out: PlayLevel = {
    level,
    smallBlind: Number(raw['smallBlind'] ?? 0),
    bigBlind: Number(raw['bigBlind'] ?? 0),
    ante: Number(raw['ante'] ?? 0),
    durationMin,
    isBreak: false,
  };
  return out;
}

/** Map UHT static distribution entries like "70%", "30%", "20" to PrizeRule[]. */
function mapStaticDistribution(raw: unknown): PrizeRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: PrizeRule[] = [];
  raw.forEach((entry, i) => {
    if (typeof entry !== 'string') return;
    const trimmed = entry.trim();
    if (trimmed === '') return;
    const isPercent = trimmed.endsWith('%');
    const numericPart = isPercent ? trimmed.slice(0, -1) : trimmed;
    const value = Number(numericPart);
    if (!Number.isFinite(value)) return;
    const kind: PrizeRuleKind = isPercent ? 'percentRemainder' : 'fixed';
    rules.push({ position: i + 1, kind, value });
  });
  return rules;
}

function mapPrizeDistribution(raw: unknown): PrizeDistribution {
  if (!isObject(raw)) {
    throw new InvalidUhtBackupError('tournament is missing prizeDistribution');
  }
  const rules = mapStaticDistribution(raw['staticDistribution']);
  const incrementRaw = raw['roundPrizes'];
  const increment = Number.isFinite(Number(incrementRaw)) ? Number(incrementRaw) : 0;
  return {
    type: 'static',
    rules,
    rounding: { increment, surplusToFirst: true },
    guarantee: Number(raw['guarantee'] ?? 0),
    overlay: Boolean(raw['overlay']),
  };
}

function mapChipDenominations(designRaw: unknown): ChipDenomination[] {
  if (!isObject(designRaw)) return [];
  const chips = designRaw['chips'];
  if (!Array.isArray(chips)) return [];
  const out: ChipDenomination[] = [];
  for (const chip of chips) {
    if (!isObject(chip)) continue;
    const value = Number(chip['value']);
    if (!Number.isFinite(value) || value <= 0) continue;
    const color = String(chip['color'] ?? '');
    out.push({ color, value });
  }
  return out;
}

function mapStartingStackComposition(stackRaw: unknown): StackChip[] {
  if (!isObject(stackRaw)) return [];
  const chips = stackRaw['chips'];
  if (!Array.isArray(chips)) return [];
  const out: StackChip[] = [];
  for (const chip of chips) {
    if (!isObject(chip)) continue;
    const amount = Number(chip['amount']);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const color = String(chip['color'] ?? '');
    out.push({ color, count: amount });
  }
  return out;
}

function mapAnteMode(raw: unknown): AnteMode {
  return raw === 'BB' ? 'BB' : 'fixed';
}

function mapCurrency(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (isObject(raw)) {
    const symbol = raw['symbol'];
    if (typeof symbol === 'string') return symbol;
  }
  return undefined;
}

function mapRebuy(t: Record<string, unknown>): RebuyConfig {
  return {
    allowReentry: Boolean(t['allowReentry']),
    reentryPrice: Number(t['reentryPrice'] ?? 0),
    reentryChips: Number(t['reentryChips'] ?? 0),
    reentryCount: Number(t['reentryCount'] ?? 0),
    finalReentryLevel: Number(t['finalReentryLevel'] ?? 0),
  };
}

/**
 * Convert a single UHT tournament object to our TournamentTemplate shape.
 * Throws `InvalidUhtBackupError` if required fields are missing.
 */
export function uhtTournamentToTemplate(uhtT: unknown): TournamentTemplate {
  if (!isObject(uhtT)) {
    throw new InvalidUhtBackupError('tournament entry is not an object');
  }
  const name = requireKey(uhtT, 'name', 'tournament');
  const buyInRaw = requireKey(uhtT, 'buyIn', 'tournament');
  const startingStackRaw = requireKey(uhtT, 'startingStack', 'tournament');
  const blindStructureRaw = requireKey(uhtT, 'blindStructure', 'tournament');

  if (typeof name !== 'string') {
    throw new InvalidUhtBackupError('tournament.name must be a string');
  }
  const buyIn = Number(buyInRaw);
  const startingStack = Number(startingStackRaw);
  if (!Number.isFinite(buyIn)) {
    throw new InvalidUhtBackupError('tournament.buyIn must be a number');
  }
  if (!Number.isFinite(startingStack)) {
    throw new InvalidUhtBackupError('tournament.startingStack must be a number');
  }
  if (!Array.isArray(blindStructureRaw)) {
    throw new InvalidUhtBackupError('tournament.blindStructure must be an array');
  }

  const template: TournamentTemplate = {
    name,
    buyIn,
    startingStack,
    rebuy: mapRebuy(uhtT),
    anteMode: mapAnteMode(uhtT['defaultAnte']),
    blindStructure: blindStructureRaw.map(mapBlindLevel),
    prizeDistribution: mapPrizeDistribution(uhtT['prizeDistribution']),
    chipDenominations: mapChipDenominations(uhtT['denominationDesign']),
    startingStackComposition: mapStartingStackComposition(uhtT['startingStackConfig']),
  };

  const location = uhtT['location'];
  if (typeof location === 'string' && location.length > 0) {
    template.location = location;
  }
  const currency = mapCurrency(uhtT['currency']);
  if (currency !== undefined) {
    template.currency = currency;
  }

  return template;
}

/**
 * Parse the contents of a `.backup` file (the base64-encoded JSON produced by
 * ultimate-holdem-timer.com) into our app's internal shape.
 *
 * Throws `InvalidUhtBackupError` when the input is not valid base64, not valid
 * JSON, or doesn't match the expected top-level structure.
 */
export function parseUhtBackup(base64Contents: string): ParsedUhtBackup {
  if (typeof base64Contents !== 'string') {
    throw new InvalidUhtBackupError('input must be a string');
  }
  const decoded = decodeBase64(base64Contents);
  const json = parseJson(decoded);
  if (!isObject(json)) {
    throw new InvalidUhtBackupError('decoded payload is not a JSON object');
  }
  const versionRaw = json['version'];
  const tournamentsRaw = json['tournaments'];
  if (typeof versionRaw !== 'string') {
    throw new InvalidUhtBackupError('backup is missing string field "version"');
  }
  if (!Array.isArray(tournamentsRaw)) {
    throw new InvalidUhtBackupError('backup is missing array field "tournaments"');
  }
  return {
    version: versionRaw,
    tournaments: tournamentsRaw.map(uhtTournamentToTemplate),
  };
}
