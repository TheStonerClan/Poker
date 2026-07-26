"use client";

import Link from "next/link";

export type TabKey = "stats" | "history" | "color-up" | "bust";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "stats", label: "Stats" },
  { key: "history", label: "History" },
  { key: "color-up", label: "Color up" },
  { key: "bust", label: "Bust" },
];

type Props = {
  active: TabKey;
  onChange: (key: TabKey) => void;
  disableActions?: boolean;
  /**
   * Leaderboard is a real page (it needs table-wide data no single
   * player's claimed session has), not a local tab — rendered as a
   * navigation link rather than a state-setting button. Always enabled,
   * even for busted/finished players, since standings are public info
   * already shown on the TV.
   */
  sessionId: string;
};

export function TabBar({ active, onChange, disableActions = false, sessionId }: Props) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 border-t border-gold/30 bg-bg/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur"
      aria-label="Player view tabs"
    >
      <ul className="grid grid-cols-5 gap-1">
        {TABS.map(({ key, label }) => {
          const isActive = key === active;
          // Stats + History are always readable; color-up + bust are
          // admin-locked (busted or finished tournaments disable them).
          const isDisabled =
            disableActions && key !== "stats" && key !== "history";
          return (
            <li key={key}>
              <button
                type="button"
                className={`flex w-full flex-col items-center justify-center rounded-xl px-2 py-3 text-xs uppercase tracking-widest transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-bright ${
                  isActive
                    ? "bg-gold/15 text-gold-bright"
                    : isDisabled
                      ? "text-fg/20"
                      : "text-fg/60 active:bg-fg/5"
                }`}
                aria-current={isActive ? "page" : undefined}
                aria-disabled={isDisabled}
                disabled={isDisabled}
                onClick={() => onChange(key)}
              >
                {label}
              </button>
            </li>
          );
        })}
        <li>
          <Link
            href={`/play/${sessionId}/leaderboard`}
            className="flex w-full flex-col items-center justify-center rounded-xl px-2 py-3 text-xs uppercase tracking-widest text-fg/60 transition active:bg-fg/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-bright"
          >
            Leaders
          </Link>
        </li>
      </ul>
    </nav>
  );
}
