"use client";

export type TabKey = "stats" | "color-up" | "bust";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "stats", label: "Stats" },
  { key: "color-up", label: "Color up" },
  { key: "bust", label: "Bust" },
];

type Props = {
  active: TabKey;
  onChange: (key: TabKey) => void;
  disableActions?: boolean;
};

export function TabBar({ active, onChange, disableActions = false }: Props) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 border-t border-gold/30 bg-bg/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur"
      aria-label="Player view tabs"
    >
      <ul className="grid grid-cols-3 gap-1">
        {TABS.map(({ key, label }) => {
          const isActive = key === active;
          const isDisabled = disableActions && key !== "stats";
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
      </ul>
    </nav>
  );
}
