export function formatMMSS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

export function formatBlinds(small?: number, big?: number, ante?: number): string {
  if (small == null || big == null) return "—";
  const left = `${small.toLocaleString()} / ${big.toLocaleString()}`;
  if (ante == null || ante === 0) return left;
  return `${left} / (${ante.toLocaleString()})`;
}

export function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

export function formatChips(value: number): string {
  return value.toLocaleString();
}
