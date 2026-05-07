# uht-import

Pure-TS importer for [ultimate-holdem-timer.com](https://ultimate-holdem-timer.com) `.backup` files. Decodes the base64 payload, parses the JSON inside, and converts each tournament into the app's `TournamentTemplate` shape (the same shape used by [`seed/bluff-and-baffoons.json`](../../seed/bluff-and-baffoons.json)).

No runtime dependencies — Node's `Buffer` for base64 decoding is the only external surface.

## Usage

```ts
import { parseUhtBackup, uhtTournamentToTemplate } from 'uht-import';
import { readFileSync } from 'node:fs';

const file = readFileSync('uht_backup_11_15_2025.backup', 'utf-8');
const { version, tournaments } = parseUhtBackup(file);

console.log(version);            // e.g. "1.23.0"
console.log(tournaments[0].name); // "Bluff and Baffoons"
```

`uhtTournamentToTemplate(uhtT)` is the lower-level converter for a single UHT tournament object — useful when you've already parsed the JSON yourself or want to feed in a synthetic tournament for tests.

## API

```ts
function parseUhtBackup(base64Contents: string): {
  version: string;
  tournaments: TournamentTemplate[];
};

function uhtTournamentToTemplate(uhtT: unknown): TournamentTemplate;

class InvalidUhtBackupError extends Error {}
```

The parser throws `InvalidUhtBackupError` (with a descriptive message) when the input is empty, not valid base64, not valid JSON, missing the `version` / `tournaments` top-level fields, or contains a tournament that's missing required fields (`name`, `buyIn`, `startingStack`, `blindStructure`).

## Field mapping

| UHT export                                | TournamentTemplate                                       |
| ----------------------------------------- | -------------------------------------------------------- |
| `name`                                    | `name`                                                   |
| `location` (non-empty)                    | `location`                                               |
| `buyIn`                                   | `buyIn`                                                  |
| `startingStack`                           | `startingStack`                                          |
| `currency.symbol`                         | `currency`                                               |
| `defaultAnte === 'BB'`                    | `anteMode: 'BB'` (else `'fixed'`)                        |
| `allowReentry`, `reentryPrice`, `reentryChips`, `reentryCount`, `finalReentryLevel` | `rebuy.{...}` |
| `blindStructure[i]`                       | `blindStructure[i]` (see below)                          |
| `prizeDistribution.staticDistribution`    | `prizeDistribution.rules` (see below)                    |
| `prizeDistribution.roundPrizes`           | `prizeDistribution.rounding.increment`                   |
| `prizeDistribution.guarantee`             | `prizeDistribution.guarantee`                            |
| `prizeDistribution.overlay`               | `prizeDistribution.overlay`                              |
| `denominationDesign.chips` (`value > 0`)  | `chipDenominations: [{ color, value }]`                  |
| `startingStackConfig.chips` (`amount > 0`)| `startingStackComposition: [{ color, count }]`           |

### Blind levels

Each entry in `blindStructure` is converted to one of two shapes, matching the seed:

```ts
// Play level
{ level: i+1, smallBlind, bigBlind, ante, durationMin: duration, isBreak: false }

// Break level
{ level: i+1, durationMin: duration, isBreak: true, colorUp?: number[] }
```

`colorUp` is a comma-separated string in the UHT export (e.g. `"1, 5"`) that gets parsed into a number array (`[1, 5]`). Empty strings are dropped — the `colorUp` key is only present on break levels that actually have one.

### Prize rules

The UHT `staticDistribution` is an array of strings like `["70%", "30%", "20"]`. Each becomes one rule, in order:

| UHT entry | Output rule                                                |
| --------- | ---------------------------------------------------------- |
| `"70%"`   | `{ position: 1, kind: 'percentRemainder', value: 70 }`     |
| `"30%"`   | `{ position: 2, kind: 'percentRemainder', value: 30 }`     |
| `"20"`    | `{ position: 3, kind: 'fixed', value: 20 }`                |

Strings ending in `%` map to `percentRemainder` (matching the seed and the `prize-math` library's default for "share of the leftover after fixed payouts"). Strings without `%` map to `fixed`. The parser sets `rounding.surplusToFirst: true` because the UHT export doesn't carry that bit and Travis's house rule has the surplus go to first place.

## What's NOT mapped

The UHT `.backup` format doesn't carry all of the structure the app needs. The parser is intentionally narrow — anything not in the export above is omitted, **including**:

- `buyback` (the seed's hand-curated buyback-token rules: `tokensPerPlayer`, `addOnAtBreakLevel`, `addOnChips`, etc.) — UHT only knows about generic re-entries
- `sidePots` (4-of-a-kind, straight-flush bonuses)
- `_comment` annotations
- Player roster, soundtrack, skin, bounty config, and other UHT-specific fields

Importing a `.backup` file gives you a starting template; the rest of the house rules need to be filled in by hand or by a separate UI.

## Tests

```sh
npm install
npm test
```

The test suite uses `vitest` and exercises:

1. **Round-trip**: parses [`__fixtures__/bluff-and-baffoons.backup`](./__fixtures__/bluff-and-baffoons.backup) (Travis's real export from 2025-11-15) and deep-compares against [`seed/bluff-and-baffoons.json`](../../seed/bluff-and-baffoons.json). The deep-equal pass strips an allowlist of keys before comparing:
   - From the seed: `_comment`, `buyback`, `sidePots` — hand-curated extras that the UHT export doesn't carry.
   - From the parser output: `rebuy` — emitted per spec but absent from the seed (the seed uses `buyback` instead). The `rebuy` block is verified by a dedicated test.
2. **Unit cases**: blind-level edge cases, anteMode default, currency string vs. object, empty `colorUp`.
3. **Error handling**: every `InvalidUhtBackupError` path (empty input, bad base64, bad JSON, wrong top-level shape, missing required tournament fields).
