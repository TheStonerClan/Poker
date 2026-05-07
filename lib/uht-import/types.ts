/**
 * Public types for the uht-import library.
 *
 * Source shape: ultimate-holdem-timer.com `.backup` files — base64-encoded JSON
 * with shape `{ version, tournaments[], designs[], sounds[], chips[], collections[] }`.
 *
 * Target shape: TournamentTemplate matches `seed/bluff-and-baffoons.json`. Only
 * fields the UHT export carries are emitted; hand-curated extras (buyback
 * tokens, side pots, comments) are out of scope and must be added later.
 */

export type AnteMode = 'BB' | 'fixed';

export type PrizeRuleKind = 'percentRemainder' | 'percentTotal' | 'fixed';

export type PrizeRule = {
  position: number;
  kind: PrizeRuleKind;
  value: number;
};

export type PrizeDistribution = {
  type: 'static';
  rules: PrizeRule[];
  rounding: { increment: number; surplusToFirst: boolean };
  guarantee: number;
  overlay: boolean;
};

export type PlayLevel = {
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  durationMin: number;
  isBreak: false;
};

export type BreakLevel = {
  level: number;
  durationMin: number;
  isBreak: true;
  colorUp?: number[];
};

export type BlindLevel = PlayLevel | BreakLevel;

export type ChipDenomination = { color: string; value: number };
export type StackChip = { color: string; count: number };

export type RebuyConfig = {
  allowReentry: boolean;
  reentryPrice: number;
  reentryChips: number;
  reentryCount: number;
  finalReentryLevel: number;
};

export type TournamentTemplate = {
  name: string;
  location?: string;
  buyIn: number;
  startingStack: number;
  currency?: string;
  rebuy: RebuyConfig;
  anteMode: AnteMode;
  blindStructure: BlindLevel[];
  prizeDistribution: PrizeDistribution;
  chipDenominations: ChipDenomination[];
  startingStackComposition: StackChip[];
};

export type ParsedUhtBackup = {
  version: string;
  tournaments: TournamentTemplate[];
};
