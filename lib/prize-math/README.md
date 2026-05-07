# prize-math

A pure-TypeScript prize-payout calculator for poker tournaments.

Zero infrastructure dependencies — no database, no React, no Next.js. Just TypeScript + Vitest. Drop the folder into any Node-or-browser project and import from `./index`.

## Install / run

```sh
cd lib/prize-math
npm install
npm test          # vitest run
npm run typecheck # tsc --noEmit
```

## Public API

```ts
import { computePayouts } from './index';
import type { PrizeConfig, Pool, PayoutResult } from './types';

function computePayouts(config: PrizeConfig, pool: Pool): PayoutResult;
```

### Types

```ts
type PrizeRule =
  | { kind: 'fixed';            position: number; value: number } // dollar amount
  | { kind: 'percentRemainder'; position: number; value: number } // % after fixed payouts subtracted
  | { kind: 'percentTotal';     position: number; value: number }; // % of full pool

type PrizeConfig = {
  rules: PrizeRule[];
  rounding: { increment: 0 | 1 | 5 | 10 | 20; surplusToFirst: boolean };
  guarantee?: number;   // advertised minimum pool; defaults to 0
  overlay?: boolean;    // if true and pool < guarantee, the host eats the diff
};

type Pool = {
  buyIns: number;
  buybacks: number;       // count of buyback tokens redeemed (any mode); each contributes buyInPrice
  buyInPrice: number;     // dollars per entry/buyback
  rakePerEntry?: number;  // applied to every entry AND every buyback
};

type PayoutResult = {
  payouts: Array<{ position: number; amount: number }>; // sorted ascending by position
  effectivePool: number;  // pool used for payout math (post-overlay)
  remainder: number;      // unallocated dollars; always 0 when surplusToFirst=true
  overlay: number;        // dollars the host had to cover; 0 when no overlay activated
};
```

> Note: the spec sketch in the original ticket described the return as a bare
> `Array<{position, amount}>`, but rule (6) requires returning the unallocated
> remainder. `PayoutResult.payouts` is the array; `remainder` and the rest are
> additional metadata.

## Calculation rules

The implementation follows these steps in exactly this order:

1. **Raw pool.** `rawPool = (buyIns + buybacks) * buyInPrice − (buyIns + buybacks) * (rakePerEntry ?? 0)`. `buyInPrice` is part of the `Pool` argument so the library is agnostic to where the price comes from in the host app.
2. **Overlay.** If `overlay` is true and `guarantee > rawPool`, `effectivePool = guarantee` and the host's overlay contribution is recorded in `overlay`. Otherwise `effectivePool = rawPool`.
3. **Pay fixed rules first**, in position order. Each fixed rule is capped to whatever pool is left so a misconfigured `$20 fixed` against a `$5` pool can never push the remainder negative.
4. **`percentRemainder`** rules use `remainder = effectivePool − Σ fixed paid`. Each amount = `floor((remainder × pct) / 100, increment)`.
5. **`percentTotal`** rules use the full `effectivePool` (they ignore fixed rules). Each amount = `floor((effectivePool × pct) / 100, increment)`.
6. **Surplus.** After every amount is computed, leftover = `effectivePool − Σ payouts`. If `surplusToFirst` is true, the leftover is added to position 1; otherwise it's returned in `remainder` and the host keeps it.
7. **Floor only.** Percent payouts always round *down*. `increment: 0` means floor to the nearest cent ($0.01).

## Worked example: Travis's "Bluff and Baffoons"

Config (from `seed/bluff-and-baffoons.json`):

- Buy-in: **$20**
- Entries: **5**
- Rules: 1st = 70% remainder, 2nd = 30% remainder, 3rd = $20 fixed
- Rounding: `$10` increment, `surplusToFirst: true`

Step by step:

| Step | Calculation | Result |
| --- | --- | --- |
| Raw pool | `5 × $20` | `$100` |
| 3rd (fixed) | `$20` | `$20` |
| Remainder | `$100 − $20` | `$80` |
| 1st | `floor(70% × $80 / $10) × $10 = floor($56/$10) × $10` | `$50` |
| 2nd | `floor(30% × $80 / $10) × $10 = floor($24/$10) × $10` | `$20` |
| Sum | `$50 + $20 + $20` | `$90` |
| Surplus → 1st | `$100 − $90 = $10`, added to 1st | 1st becomes `$60` |
| **Total** | `$60 + $20 + $20` | `$100` ✓ |

Code:

```ts
import { computePayouts } from './index';

const result = computePayouts(
  {
    rules: [
      { position: 1, kind: 'percentRemainder', value: 70 },
      { position: 2, kind: 'percentRemainder', value: 30 },
      { position: 3, kind: 'fixed', value: 20 },
    ],
    rounding: { increment: 10, surplusToFirst: true },
    guarantee: 0,
    overlay: true,
  },
  { buyIns: 5, buybacks: 0, buyInPrice: 20 },
);

// result.payouts → [
//   { position: 1, amount: 60 },
//   { position: 2, amount: 20 },
//   { position: 3, amount: 20 },
// ]
// result.effectivePool → 100
// result.remainder     → 0
// result.overlay       → 0
```

## Tests

`index.test.ts` covers:

- The Travis worked example above (exact `60 / 20 / 20` payouts).
- 0 entries with no overlay → all zero payouts.
- Large fields (50 players × $20).
- No-rebuy field.
- Overlay activation when pool < guarantee.
- Guarantee with `overlay: false` is informational only.
- Rake reduces the pool.
- Fixed rule larger than the pool is capped, not negative.
- `surplusToFirst: false` returns leftover in `remainder`.
- Every supported rounding increment: `0`, `1`, `5`, `10`, `20`.
- `percentTotal` rules ignore fixed payouts.
- A property-style test sweeping rule sets × increments × entry counts, asserting `Σ payouts == effectivePool` whenever overlay covers the pool and `surplusToFirst` is on.
