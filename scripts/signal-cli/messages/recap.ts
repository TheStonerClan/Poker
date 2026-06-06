// Pure formatter for the post-tournament recap message.
//
// Eventually fired automatically when a tournament is finalized. For now,
// run send-recap.ts manually to iterate on copy.
//
// Output is plain text with `\n` line breaks. The `[PokerBot]` prefix is
// added downstream by send.ts; do not include it here.

export interface RecapPodiumEntry {
  place: 1 | 2 | 3;
  name: string;
  /** Payout in whole dollars. */
  payout: number;
}

export interface RecapFunFacts {
  /**
   * First knockout at the table — the earliest `bust` event in the stream.
   * The player may have rebought back in afterwards; this is "first sent to
   * the rail," not "first permanently out."
   */
  firstKnockout?: {
    name: string;
    blinds: { small: number; big: number };
    /** Elapsed minutes into the level at the time of bust (wall clock). */
    minutesIntoLevel: number;
  };
  /**
   * First player whose *final* bust happened — they actually left the game
   * (no further rebuys or addons). Computed from tournament_players.busted_at_time.
   */
  firstEliminated?: {
    name: string;
    blinds: { small: number; big: number };
    minutesIntoLevel: number;
  };
  longestSurvivor?: { name: string; durationMinutes: number };
  biggestPot?: { amount: number; handNumber: number; note?: string };
  chipLeaderFirstBreak?: { name: string; chips: number };
  chipLeaderSecondBreak?: { name: string; chips: number };
  chipLeaderFinalTable?: { name: string; chips: number };
  /** Largest absolute chip delta for any player between two consecutive breaks. */
  biggestSwing?: {
    name: string;
    /** Signed delta (positive = chips gained). */
    delta: number;
    /** Inclusive break ordinals, e.g. [1, 2] = "between break 1 and break 2". */
    betweenBreaks: [number, number];
  };
}

export interface RecapInput {
  tournamentName: string;
  /** Tournament date. Time-of-day is not rendered for the recap. */
  date: Date;
  timezone: string;
  entries: number;
  /** Total prize pool in whole dollars. */
  prizePool: number;
  podium: RecapPodiumEntry[];
  /**
   * Optional. Whatever's populated will render under "Fun facts"; lines for
   * undefined facts are simply omitted.
   */
  funFacts?: RecapFunFacts;
  /** Link to the tournament's detail page (hand history, leaderboard, etc.). */
  detailUrl: string;
}

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(n);

const chips = (n: number) => new Intl.NumberFormat('en-US').format(n);

function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtSigned(n: number): string {
  return `${n >= 0 ? '+' : '−'}${chips(Math.abs(n))}`;
}

const MEDALS: Record<1 | 2 | 3, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export function buildRecapMessage(input: RecapInput): string {
  const {
    tournamentName,
    date,
    timezone,
    entries,
    prizePool,
    podium,
    funFacts,
    detailUrl,
  } = input;

  const day = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: timezone,
  }).format(date);
  const md = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: timezone,
  }).format(date);

  const sortedPodium = [...podium].sort((a, b) => a.place - b.place);
  const winner = sortedPodium.find((p) => p.place === 1);

  const lines: string[] = [];
  lines.push(`🏆 ${tournamentName} · Recap`);
  lines.push(`📅 ${day}, ${md}`);
  lines.push('');
  if (winner) lines.push(`Winner: ${winner.name} 🎉`);
  lines.push(`Prize pool: ${usd(prizePool)} (${entries} entries)`);
  lines.push('');
  lines.push('Podium');
  for (const p of sortedPodium) {
    lines.push(`${MEDALS[p.place]} ${p.name} — ${usd(p.payout)}`);
  }

  const factLines: string[] = [];
  if (funFacts?.firstKnockout) {
    const { name, blinds, minutesIntoLevel } = funFacts.firstKnockout;
    factLines.push(
      `⚡ First out: ${name} (${blinds.small}/${blinds.big} ${minutesIntoLevel}min in)`,
    );
  }
  if (funFacts?.firstEliminated) {
    const { name, blinds, minutesIntoLevel } = funFacts.firstEliminated;
    factLines.push(
      `💀 First eliminated: ${name} (${blinds.small}/${blinds.big} ${minutesIntoLevel}min in)`,
    );
  }
  if (funFacts?.longestSurvivor) {
    const { name, durationMinutes } = funFacts.longestSurvivor;
    factLines.push(
      `🐢 Longest survivor (no cash): ${name} (${fmtDuration(durationMinutes)})`,
    );
  }
  if (funFacts?.biggestPot) {
    const { amount, handNumber, note } = funFacts.biggestPot;
    const suffix = note ? `, ${note}` : '';
    factLines.push(`💥 Biggest pot: ${usd(amount)} (hand #${handNumber}${suffix})`);
  }
  if (funFacts?.chipLeaderFirstBreak) {
    const { name, chips: c } = funFacts.chipLeaderFirstBreak;
    factLines.push(`📊 Chip leader at break 1: ${name} (${chips(c)})`);
  }
  if (funFacts?.chipLeaderSecondBreak) {
    const { name, chips: c } = funFacts.chipLeaderSecondBreak;
    factLines.push(`📊 Chip leader at break 2: ${name} (${chips(c)})`);
  }
  if (funFacts?.chipLeaderFinalTable) {
    const { name, chips: c } = funFacts.chipLeaderFinalTable;
    factLines.push(`🏁 Chip leader at final table: ${name} (${chips(c)})`);
  }
  if (funFacts?.biggestSwing) {
    const { name, delta, betweenBreaks } = funFacts.biggestSwing;
    factLines.push(
      `📈 Biggest swing (breaks ${betweenBreaks[0]}→${betweenBreaks[1]}): ${name} (${fmtSigned(delta)})`,
    );
  }
  if (factLines.length > 0) {
    lines.push('');
    lines.push('Fun facts');
    lines.push(...factLines);
  }

  lines.push('');
  lines.push(`Full hand history: ${detailUrl}`);

  return lines.join('\n');
}
