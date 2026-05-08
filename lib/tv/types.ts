import type { Database } from "@/lib/database.types";

export type TournamentRow = Database["public"]["Tables"]["tournaments"]["Row"];
export type TournamentPlayerRow =
  Database["public"]["Tables"]["tournament_players"]["Row"];

export type TournamentPlayerWithName = TournamentPlayerRow & {
  players?: { id: string; name: string } | null;
};

export type ChipDenomination = {
  color: string;
  value: number;
};

export type BlindLevelEntry = {
  level_num: number;
  small?: number;
  big?: number;
  ante?: number;
  duration_sec: number;
  is_break: boolean;
  color_up_chips?: number[];
};

export type PrizeRule =
  | { kind: "fixed"; position: number; value: number }
  | { kind: "percentRemainder"; position: number; value: number }
  | { kind: "percentTotal"; position: number; value: number };

export type PrizeRules = {
  type?: "static";
  rules: PrizeRule[];
  rounding: { increment: 0 | 1 | 5 | 10 | 20; surplusToFirst: boolean };
  guarantee?: number;
  overlay?: boolean;
};

export type BuybackConfig = {
  tokensPerPlayer?: number;
  price?: number;
  rebuyChips?: number;
  rebuyAllowedThroughLevel?: number;
  addOnAtBreakLevel?: number;
  addOnChips?: number;
};

export type PlayerCounts = {
  players: number;
  entries: number;
  reEntries: number;
  addOns: number;
  totalChips: number;
  averageChips: number;
};
