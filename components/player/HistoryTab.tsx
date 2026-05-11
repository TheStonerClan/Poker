"use client";

import LocalDateTime from "@/components/admin/LocalDateTime";

export type PlayerHistoryProps = {
  /** Total finished tournaments this player has played. */
  tournamentsPlayed: number;
  wins: number;
  /** Tournaments where the player took home a non-zero payout. */
  itmCount: number;
  /** Lowest finishing_position the player ever recorded. Lower is better. */
  bestFinish: number | null;
  avgFinish: number | null;
  grossWinnings: number;
  /** Buy-in + rebuy_price × rebuys + addon_price × addons across all tournaments. */
  costBasis: number;
  /** grossWinnings − costBasis. Often negative even for winning players. */
  net: number;
  avgBustLevel: number | null;
  avgRebuyLevel: number | null;
  totalRebuys: number;
  totalAddOns: number;
  /** 0..1, fraction of played tournaments where the player rebought at least once. */
  rebuyRate: number;
  /** Last 5 finishes, most recent first. */
  recent: Array<{
    tournamentId: string;
    finishedAt: string | null;
    templateName: string;
    finishingPosition: number | null;
    payoutAmount: number;
    bustedAtLevel: number | null;
  }>;
};

/**
 * Player-facing history tab — appears when they tap "History" in the
 * bottom nav after claiming their name. Shows their all-time stats
 * (across every finished tournament we have on record) plus a quick
 * "last 5 results" list. Aggregated server-side; this component is
 * just presentation.
 *
 * Empty state when the player has zero finished tournaments — keeps
 * the rookie's first visit from showing a wall of zeroes.
 */
export function HistoryTab({ history }: { history: PlayerHistoryProps | null }) {
  if (!history) {
    return (
      <div className="rounded-2xl border border-fg/10 bg-bg/40 p-6 text-center text-fg/70">
        <p className="text-sm">No finished tournaments on record yet.</p>
        <p className="mt-2 text-xs text-fg/50">
          This fills in after your first finalized game.
        </p>
      </div>
    );
  }

  const itmPercent =
    history.tournamentsPlayed > 0
      ? Math.round((history.itmCount / history.tournamentsPlayed) * 100)
      : 0;
  const winPercent =
    history.tournamentsPlayed > 0
      ? Math.round((history.wins / history.tournamentsPlayed) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Headline four-up: tournaments, wins, ITM, net. */}
      <section className="grid grid-cols-2 gap-2">
        <Stat
          label="Played"
          value={history.tournamentsPlayed.toString()}
          sub={`${winPercent}% wins · ${itmPercent}% ITM`}
        />
        <Stat
          label="Wins"
          value={history.wins.toString()}
          sub={
            history.bestFinish != null
              ? `Best finish: ${ordinal(history.bestFinish)}`
              : null
          }
        />
        <Stat
          label="Gross"
          value={formatMoney(history.grossWinnings)}
          sub={`Cost basis ${formatMoney(history.costBasis)}`}
        />
        <Stat
          label="Net"
          value={`${history.net >= 0 ? "+" : ""}${formatMoney(history.net)}`}
          sub={history.net >= 0 ? "Up overall" : "Down overall"}
          tone={history.net >= 0 ? "success" : "danger"}
        />
      </section>

      {/* Granular per-player metrics. */}
      <section className="rounded-2xl border border-fg/10 bg-bg/40 p-4">
        <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
          Tendencies
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <Row
            label="Avg bust level"
            value={
              history.avgBustLevel != null
                ? `L${history.avgBustLevel.toFixed(1)}`
                : "—"
            }
          />
          <Row
            label="Avg finish"
            value={
              history.avgFinish != null ? history.avgFinish.toFixed(1) : "—"
            }
          />
          <Row
            label="Rebuy rate"
            value={`${Math.round(history.rebuyRate * 100)}%`}
            sub={`${history.totalRebuys} total`}
          />
          <Row
            label="Avg rebuy level"
            value={
              history.avgRebuyLevel != null
                ? `L${history.avgRebuyLevel.toFixed(1)}`
                : "—"
            }
          />
          <Row label="Add-ons" value={history.totalAddOns.toString()} />
          <Row
            label="In the money"
            value={`${history.itmCount}/${history.tournamentsPlayed}`}
          />
        </dl>
      </section>

      {/* Recent results — quick last-5 list, most recent first. */}
      <section className="rounded-2xl border border-fg/10 bg-bg/40 p-4">
        <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
          Last 5 results
        </h2>
        {history.recent.length === 0 ? (
          <p className="mt-2 text-xs italic text-fg/45">
            Nothing recent. Play a tournament to see results here.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {history.recent.map((r) => {
              const placedText =
                r.finishingPosition != null
                  ? ordinal(r.finishingPosition)
                  : r.bustedAtLevel != null
                    ? `Out L${r.bustedAtLevel}`
                    : "—";
              return (
                <li
                  key={r.tournamentId}
                  className="flex items-baseline justify-between gap-3 border-b border-fg/5 pb-2 last:border-0 last:pb-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-semibold text-fg">
                      {r.templateName}
                    </p>
                    <p className="mt-0.5 text-xs text-fg/55">
                      <LocalDateTime
                        iso={r.finishedAt}
                        options={{
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        }}
                      />
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm font-semibold text-fg">
                      {placedText}
                    </p>
                    {r.payoutAmount > 0 ? (
                      <p className="font-mono text-xs tabular-nums text-success">
                        {formatMoney(r.payoutAmount)}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string | null;
  tone?: "success" | "danger";
}) {
  const valueColor =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : "text-fg";
  return (
    <div className="rounded-2xl border border-fg/10 bg-bg/40 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-fg/55">
        {label}
      </p>
      <p className={`mt-1 font-mono text-2xl tabular-nums ${valueColor}`}>
        {value}
      </p>
      {sub ? (
        <p className="mt-1 text-[10px] uppercase tracking-widest text-fg/40">
          {sub}
        </p>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <>
      <dt className="text-xs text-fg/60">{label}</dt>
      <dd className="text-right font-mono tabular-nums text-fg">
        {value}
        {sub ? <span className="ml-1 text-xs text-fg/40">({sub})</span> : null}
      </dd>
    </>
  );
}

function ordinal(n: number): string {
  const v = n % 100;
  const suffix =
    v >= 11 && v <= 13
      ? "th"
      : ["th", "st", "nd", "rd", "th"][Math.min(n % 10, 4)];
  return `${n}${suffix}`;
}

function formatMoney(amount: number): string {
  // Match the existing player-side currency formatting (USD, no
  // trailing zeros on round dollars).
  const abs = Math.abs(amount);
  const formatted =
    abs % 1 === 0
      ? `$${abs.toLocaleString()}`
      : `$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return amount < 0 ? `-${formatted}` : formatted;
}
