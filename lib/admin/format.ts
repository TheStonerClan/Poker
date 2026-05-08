export function formatMoney(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${amount}`;
  }
}

export function formatChips(chips: number): string {
  return new Intl.NumberFormat("en-US").format(chips);
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} min` : `${m}m ${s}s`;
}

export function formatBlinds(level: {
  small?: number;
  big?: number;
  ante?: number;
  is_break?: boolean;
} | null | undefined): string {
  if (!level) return "—";
  if (level.is_break) return "Break";
  const ante = level.ante ? ` (${level.ante})` : "";
  return `${level.small ?? "—"} / ${level.big ?? "—"}${ante}`;
}
