# @poker/color-up

Pure-TS library for computing color-up chip exchanges at a poker tournament break.

Zero runtime dependencies. TypeScript + Vitest only.

## What is a color-up?

When the small denominations stop being useful (e.g. the $1 and $5 chips
once blinds reach $40/$80), the host pulls them off the table and exchanges
each player's small chips for an equivalent number of larger chips.

Because chip values are coarse, the exchange almost never lands exactly on
the player's submitted total — somebody has to absorb the rounding. This
library computes:

- the chips to hand back, and
- the dollar discrepancy (`netChange`).

It does **not** decide who eats the difference; that's a house rule. It
just reports the number so the host can apply it.

## API

```ts
import { computeExchange, type Denomination } from "@poker/color-up";

type Denomination = { color: string; value: number };

function computeExchange(args: {
  submittedTotal: number;            // dollar value of chips player handed in
  removingDenominations: number[];   // chip values being colored up away (e.g. [1, 5])
  remainingDenominations: Denomination[]; // active denoms after the color-up
  roundingMode: "up" | "down";       // see semantics below
}): {
  exchangeFor: Array<{ value: number; count: number }>; // chips to hand back, largest first
  netChange: number; // newTotal − submittedTotal
  newTotal: number;  // dollar value of returned chips
};
```

### Rounding modes

Let `S = submittedTotal` and let `R` be the set of values that can be made
from any combination of `remainingDenominations` (with unlimited supply).

- **`"down"`**: pick the largest `v ∈ R` with `v ≤ S`.
  Player walks away with chips worth slightly less than they handed in;
  the host owes them the difference (or it's lost to the floor — house rule).
- **`"up"`**: pick the smallest `v ∈ R` with `v ≥ S`.
  Player walks away with chips worth slightly more; they owe the host the
  difference (or the host eats it — house rule).

`netChange` follows the sign convention `newTotal − submittedTotal`:

| sign      | meaning                              |
| --------- | ------------------------------------ |
| `+ n`     | player got `$n` extra → owes host    |
| `− n`     | player got `$n` short → host owes    |
| `0`       | exact exchange                       |

`exchangeFor` is sorted largest denomination first. The chip count is
minimized for canonical poker chip systems (any subset of
`{1, 5, 10, 25, 100, ...}`); a DP fallback handles non-canonical denom
sets exactly.

`removingDenominations` is currently informational — the algorithm reads
only `remainingDenominations`. It's part of the input so callers can pass
the level's `colorUp` array verbatim from the tournament config without
rebuilding it.

### Edge cases

- `submittedTotal = 0` → `{ exchangeFor: [], netChange: 0, newTotal: 0 }`.
- Throws on negative or non-integer `submittedTotal`.
- Throws if `remainingDenominations` is empty and `submittedTotal > 0`.
- `submittedTotal < min(remainingDenominations)` with `roundingMode: "down"`
  yields `newTotal = 0` (host owes the full submitted total).

## Worked example — Travis's color-up at L5

The `Bluff and Baffoons` config (see `seed/bluff-and-baffoons.json`) colors up
the $1 and $5 chips at the level-5 break. After the break, the active
denominations are `[10, 25, 100]`.

A player walks up with $23 worth of small chips (e.g. 3×$1 + 4×$5):

```ts
import { computeExchange } from "@poker/color-up";

const remaining = [
  { color: "blue",  value: 10 },
  { color: "green", value: 25 },
  { color: "black", value: 100 },
];

// House rule: round up — players never lose value at color-up.
computeExchange({
  submittedTotal: 23,
  removingDenominations: [1, 5],
  remainingDenominations: remaining,
  roundingMode: "up",
});
// → {
//     exchangeFor: [{ value: 25, count: 1 }],
//     newTotal: 25,
//     netChange: 2,        // player got $2 extra
//   }
```

Note that `"up"` returned **25**, not 30. The naive interpretation
"ceil to a multiple of the smallest remaining denomination" would give
$30 (one extra blue). But $25 is also reachable — it's just one green
chip — and it overshoots by less, so it's the right choice.

The `"down"` mode for the same input:

```ts
computeExchange({
  submittedTotal: 23,
  removingDenominations: [1, 5],
  remainingDenominations: remaining,
  roundingMode: "down",
});
// → {
//     exchangeFor: [{ value: 10, count: 2 }],
//     newTotal: 20,
//     netChange: -3,       // host owes player $3
//   }
```

## Running the tests

```sh
npm install
npm test
```
