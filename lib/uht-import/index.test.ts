import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  InvalidUhtBackupError,
  parseUhtBackup,
  uhtTournamentToTemplate,
} from './index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURE_BACKUP = join(__dirname, '__fixtures__/bluff-and-baffoons.backup');
const SEED_JSON = join(__dirname, '../../seed/bluff-and-baffoons.json');

/**
 * Keys that are allowed to differ between the parser output and the seed file:
 *   - `_comment` keys: hand-written annotations the parser doesn't emit.
 *   - `buyback` / `sidePots`: hand-curated house-rule extras that go beyond the
 *     UHT export (the seed file itself flags `sidePots` as placeholders).
 *   - `rebuy`: parser emits `rebuy` (per spec) but seed uses `buyback` instead;
 *     the rebuy block is verified independently in its own test below.
 */
const IGNORED_KEYS_IN_SEED = new Set(['_comment', 'buyback', 'sidePots']);
const IGNORED_KEYS_IN_PARSED = new Set(['rebuy']);

type Json = unknown;

function stripIgnoredKeys(value: Json, ignored: Set<string>): Json {
  if (Array.isArray(value)) {
    return value.map((v) => stripIgnoredKeys(v, ignored));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value as Record<string, Json>)) {
      if (ignored.has(k)) continue;
      out[k] = stripIgnoredKeys(v, ignored);
    }
    return out;
  }
  return value;
}

describe('parseUhtBackup — round-trip against seed fixture', () => {
  const backup = readFileSync(FIXTURE_BACKUP, 'utf-8');
  const seed = JSON.parse(readFileSync(SEED_JSON, 'utf-8'));
  const parsed = parseUhtBackup(backup);

  it('reports the UHT app version from the file', () => {
    expect(parsed.version).toBe('1.23.0');
  });

  it('emits exactly one tournament', () => {
    expect(parsed.tournaments).toHaveLength(1);
  });

  it('matches the seed (modulo allowlisted keys)', () => {
    const tournament = parsed.tournaments[0]!;
    const expected = stripIgnoredKeys(seed, IGNORED_KEYS_IN_SEED);
    const actual = stripIgnoredKeys(tournament, IGNORED_KEYS_IN_PARSED);
    expect(actual).toEqual(expected);
  });

  it('produces the rebuy block from UHT reentry fields', () => {
    expect(parsed.tournaments[0]!.rebuy).toEqual({
      allowReentry: true,
      reentryPrice: 20,
      reentryChips: 500,
      reentryCount: 0,
      finalReentryLevel: 6,
    });
  });

  it('blind levels include break levels with parsed colorUp arrays', () => {
    const levels = parsed.tournaments[0]!.blindStructure;
    const break5 = levels.find((l) => l.level === 5);
    expect(break5).toEqual({
      level: 5,
      durationMin: 10,
      isBreak: true,
      colorUp: [1, 5],
    });
    const break8 = levels.find((l) => l.level === 8);
    expect(break8).toEqual({
      level: 8,
      durationMin: 10,
      isBreak: true,
      colorUp: [10, 25],
    });
  });

  it('play levels carry blinds + ante and no colorUp', () => {
    const level1 = parsed.tournaments[0]!.blindStructure[0];
    expect(level1).toEqual({
      level: 1,
      smallBlind: 1,
      bigBlind: 2,
      ante: 2,
      durationMin: 15,
      isBreak: false,
    });
  });

  it('chipDenominations drop zero-value placeholders', () => {
    expect(parsed.tournaments[0]!.chipDenominations).toEqual([
      { color: 'white', value: 1 },
      { color: 'red', value: 5 },
      { color: 'blue', value: 10 },
      { color: 'green', value: 25 },
      { color: 'black', value: 100 },
    ]);
  });

  it('startingStackComposition drops zero-amount placeholders and renames amount → count', () => {
    expect(parsed.tournaments[0]!.startingStackComposition).toEqual([
      { color: 'white', count: 20 },
      { color: 'red', count: 16 },
      { color: 'blue', count: 10 },
      { color: 'green', count: 4 },
      { color: 'black', count: 2 },
    ]);
  });

  it('parses staticDistribution with mixed % and fixed entries', () => {
    expect(parsed.tournaments[0]!.prizeDistribution.rules).toEqual([
      { position: 1, kind: 'percentRemainder', value: 70 },
      { position: 2, kind: 'percentRemainder', value: 30 },
      { position: 3, kind: 'fixed', value: 20 },
    ]);
    expect(parsed.tournaments[0]!.prizeDistribution.rounding.increment).toBe(10);
  });

  it('maps defaultAnte === "BB" to anteMode "BB"', () => {
    expect(parsed.tournaments[0]!.anteMode).toBe('BB');
  });

  it('extracts currency symbol from the currency object', () => {
    expect(parsed.tournaments[0]!.currency).toBe('USD');
  });
});

describe('uhtTournamentToTemplate — direct unit cases', () => {
  it('defaults anteMode to "fixed" when defaultAnte is anything other than "BB"', () => {
    const out = uhtTournamentToTemplate({
      name: 'X',
      buyIn: 10,
      startingStack: 100,
      blindStructure: [],
      prizeDistribution: { staticDistribution: [], roundPrizes: 0 },
      defaultAnte: 'fixed',
    });
    expect(out.anteMode).toBe('fixed');
  });

  it('uses currency string directly when not an object', () => {
    const out = uhtTournamentToTemplate({
      name: 'X',
      buyIn: 10,
      startingStack: 100,
      blindStructure: [],
      prizeDistribution: { staticDistribution: [], roundPrizes: 0 },
      currency: 'EUR',
    });
    expect(out.currency).toBe('EUR');
  });

  it('omits location when missing or empty', () => {
    const out = uhtTournamentToTemplate({
      name: 'X',
      buyIn: 10,
      startingStack: 100,
      blindStructure: [],
      prizeDistribution: { staticDistribution: [], roundPrizes: 0 },
      location: '',
    });
    expect(out.location).toBeUndefined();
  });

  it('produces empty colorUp array → omits the key on break levels', () => {
    const out = uhtTournamentToTemplate({
      name: 'X',
      buyIn: 10,
      startingStack: 100,
      defaultAnte: 'BB',
      blindStructure: [
        { duration: 5, break: true, colorUp: '', smallBlind: -1, bigBlind: -1, ante: -1 },
      ],
      prizeDistribution: { staticDistribution: [], roundPrizes: 0 },
    });
    expect(out.blindStructure[0]).toEqual({ level: 1, durationMin: 5, isBreak: true });
  });
});

describe('parseUhtBackup — error handling', () => {
  it('throws InvalidUhtBackupError on empty input', () => {
    expect(() => parseUhtBackup('')).toThrow(InvalidUhtBackupError);
  });

  it('throws InvalidUhtBackupError on non-base64 input', () => {
    expect(() => parseUhtBackup('!!!not base64!!!')).toThrow(/not valid base64/);
  });

  it('throws InvalidUhtBackupError when decoded payload is not JSON', () => {
    const notJson = Buffer.from('this is not json', 'utf-8').toString('base64');
    expect(() => parseUhtBackup(notJson)).toThrow(/not valid JSON/);
  });

  it('throws InvalidUhtBackupError when decoded JSON is not an object', () => {
    const arr = Buffer.from('[1,2,3]', 'utf-8').toString('base64');
    expect(() => parseUhtBackup(arr)).toThrow(/not a JSON object/);
  });

  it('throws InvalidUhtBackupError when version field is missing', () => {
    const obj = Buffer.from(JSON.stringify({ tournaments: [] }), 'utf-8').toString(
      'base64',
    );
    expect(() => parseUhtBackup(obj)).toThrow(/version/);
  });

  it('throws InvalidUhtBackupError when tournaments field is missing', () => {
    const obj = Buffer.from(JSON.stringify({ version: '1.0.0' }), 'utf-8').toString(
      'base64',
    );
    expect(() => parseUhtBackup(obj)).toThrow(/tournaments/);
  });

  it('throws InvalidUhtBackupError when a tournament is missing required fields', () => {
    const obj = Buffer.from(
      JSON.stringify({ version: '1.0.0', tournaments: [{ name: 'X' }] }),
      'utf-8',
    ).toString('base64');
    expect(() => parseUhtBackup(obj)).toThrow(/buyIn/);
  });
});
