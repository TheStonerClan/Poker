export function formatMMSS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

export function formatBlinds(small?: number, big?: number, _ante?: number): string {
  // Per house preference, the TV display shows only SB/BB. The `ante`
  // parameter is kept on the signature so existing callers don't need
  // updating, but it's intentionally unused.
  void _ante;
  if (small == null || big == null) return "—";
  return `${small.toLocaleString()} / ${big.toLocaleString()}`;
}

export function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

export function formatChips(value: number): string {
  return value.toLocaleString();
}
