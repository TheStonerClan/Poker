// Pure formatter for the 1-week-out tournament reminder.
//
// Data-in / string-out. The scheduling layer (see lib/schedule/next-night.ts
// → `resolveNextNight`) is responsible for picking the date the reminder
// fires for and the date embedded in the message body — this builder
// trusts the date it's given.
//
// Output is plain text with `\n` line breaks. The `[PokerBot]` prefix is
// added downstream by send.ts; do not include it here.

export interface WeekOutInput {
  tournamentName: string;
  /** Tournament start instant. Formatted in `timezone` for display. */
  date: Date;
  /** IANA timezone, e.g. 'America/Chicago'. */
  timezone: string;
  /** Optional location line. Omitted if undefined. */
  location?: string;
}

export function buildWeekOutMessage(input: WeekOutInput): string {
  const { tournamentName, date, timezone, location } = input;

  const day = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: timezone,
  }).format(date);
  const md = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: timezone,
  }).format(date);
  const tm = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  }).format(date);

  const lines: string[] = [];
  lines.push(`🃏 1 week until ${tournamentName}`);
  lines.push(`📅 ${day}, ${md} · ${tm}`);
  if (location) lines.push(`📍 ${location}`);
  lines.push('');
  lines.push('Are you in?');
  lines.push('✅ Yes   ❌ No   ❓ Maybe');
  lines.push('(react to this message)');

  return lines.join('\n');
}
