"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import type { Player, TournamentTemplate } from "@/lib/admin/queries";
import { formatChips, formatMoney } from "@/lib/admin/format";
import {
  defaultTableEntry,
  suggestTableSplit,
  TABLE_COLOR_CSS,
  TABLE_COLORS,
  type TableColor,
  type TableConfig,
} from "@/lib/admin/tables";

import { startTournament } from "./actions";

type Step = "template" | "confirm" | "players" | "tables";

export function NewTournamentWizard({
  templates,
  players,
  initialTemplateId = null,
  isSandbox = false,
}: {
  templates: TournamentTemplate[];
  players: Player[];
  /**
   * When set (and matches an existing template), the wizard pre-
   * selects the template and starts on the Settings step so the
   * admin doesn't have to re-pick what the deep link already named.
   * Used by the upcoming-tournaments list on / and /admin to launch
   * a recurrence-projected occurrence straight into staging.
   */
  initialTemplateId?: string | null;
  /**
   * When true, the created tournament is flagged `is_sandbox` and
   * excluded from real history/leaderboards and Signal recap
   * dispatch. Used by /sandboxadmin/tournaments/new.
   */
  isSandbox?: boolean;
}) {
  // Start on the Settings step when a templateId came in via the URL
  // — otherwise the admin would land on a one-option picker just to
  // click the next button. Keep the picker visible if the deep link
  // didn't resolve so they can still pick anything.
  const [step, setStep] = useState<Step>(
    initialTemplateId ? "confirm" : "template",
  );
  const [templateId, setTemplateId] = useState<string>(
    initialTemplateId ?? templates[0]?.id ?? "",
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [tables, setTables] = useState<TableConfig[]>([defaultTableEntry(1, 9)]);
  const [tablesTouched, setTablesTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const template = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );

  // Suggest sensible table defaults based on the picked-player count, but
  // only until the admin manually adjusts. Once they touch the table list
  // (rename, recolor, add/remove, change a cap) we stop overriding.
  useEffect(() => {
    if (tablesTouched) return;
    const suggestion = suggestTableSplit(picked.size);
    setTables(
      Array.from({ length: suggestion.numTables }, (_, i) =>
        defaultTableEntry(i + 1, suggestion.maxSeatsPerTable),
      ),
    );
  }, [picked.size, tablesTouched]);

  function patchTable(idx: number, patch: Partial<TableConfig>) {
    setTablesTouched(true);
    setTables((prev) =>
      prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)),
    );
  }

  function addTable() {
    setTablesTouched(true);
    setTables((prev) => [...prev, defaultTableEntry(prev.length + 1, 9)]);
  }

  function removeTable(idx: number) {
    setTablesTouched(true);
    setTables((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Stepper step={step} />

      {step === "template" ? (
        <TemplateStep
          templates={templates}
          selected={templateId}
          onSelect={setTemplateId}
          onNext={() => setStep("confirm")}
        />
      ) : null}

      {step === "confirm" && template ? (
        <ConfirmStep
          template={template}
          onBack={() => setStep("template")}
          onNext={() => setStep("players")}
        />
      ) : null}

      {step === "players" && template ? (
        <PlayersStep
          players={players}
          picked={picked}
          onToggle={(id) =>
            setPicked((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onBack={() => setStep("confirm")}
          onNext={() => setStep("tables")}
        />
      ) : null}

      {step === "tables" && template ? (
        <TablesStep
          playerCount={picked.size}
          tables={tables}
          onPatch={patchTable}
          onAdd={addTable}
          onRemove={removeTable}
          onBack={() => setStep("players")}
          error={error}
          pending={pending}
          onStart={() => {
            setError(null);
            start(async () => {
              const res = await startTournament(
                {
                  templateId: template.id,
                  playerIds: [...picked],
                  tables,
                },
                { isSandbox },
              );
              if (res.status === "error") setError(res.message ?? "Could not start.");
            });
          }}
        />
      ) : null}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const labels: Array<[Step, string]> = [
    ["template", "Template"],
    ["confirm", "Settings"],
    ["players", "Players"],
    ["tables", "Tables"],
  ];
  const active = labels.findIndex(([s]) => s === step);
  return (
    <ol className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest">
      {labels.map(([s, label], i) => (
        <li key={s} className="flex flex-1 items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full border ${
              i <= active
                ? "border-gold bg-gold text-bg"
                : "border-fg/20 text-fg/40"
            }`}
          >
            {i + 1}
          </span>
          <span className={i === active ? "text-fg" : "text-fg/40"}>
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function TemplateStep({
  templates,
  selected,
  onSelect,
  onNext,
}: {
  templates: TournamentTemplate[];
  selected: string;
  onSelect: (id: string) => void;
  onNext: () => void;
}) {
  return (
    <>
      <ul className="flex flex-col gap-2">
        {templates.map((t) => (
          <li key={t.id}>
            <label
              className={`flex min-h-[64px] cursor-pointer items-center gap-3 rounded-md border px-3 py-3 ${
                selected === t.id
                  ? "border-gold bg-gold/5"
                  : "border-fg/15"
              }`}
            >
              <input
                type="radio"
                name="template"
                checked={selected === t.id}
                onChange={() => onSelect(t.id)}
                className="h-5 w-5 accent-[var(--color-gold)]"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg">{t.name}</p>
                <p className="text-xs text-fg/60">
                  Buy-in {formatMoney(t.buy_in)} · {formatChips(t.starting_stack)} chips
                </p>
              </div>
            </label>
          </li>
        ))}
      </ul>
      <StickyActions>
        <button
          type="button"
          onClick={onNext}
          className="h-12 min-h-[44px] flex-1 rounded-md bg-gold text-sm font-semibold text-bg"
        >
          Next
        </button>
      </StickyActions>
    </>
  );
}

function ConfirmStep({
  template,
  onBack,
  onNext,
}: {
  template: TournamentTemplate;
  onBack: () => void;
  onNext: () => void;
}) {
  const buyback = template.buyback_config as {
    rebuysPerPlayer?: number;
    addOnsPerPlayer?: number;
    price?: number;
    rebuyChips?: number;
    addOnChips?: number;
    rebuyAllowedThroughLevel?: number;
    addOnAtBreakLevel?: number;
  };
  return (
    <>
      <section className="rounded-lg border border-fg/10 p-4">
        <h2 className="text-base font-semibold text-fg">{template.name}</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <Row label="Buy-in" value={formatMoney(template.buy_in)} />
          <Row label="Starting stack" value={formatChips(template.starting_stack)} />
          <Row label="Ante mode" value={template.ante_mode} />
          <Row label="Buyback price" value={formatMoney(buyback.price ?? 0)} />
          <Row
            label="Rebuy chips"
            value={formatChips(buyback.rebuyChips ?? template.rebuy_chips)}
          />
          <Row label="Add-on chips" value={formatChips(buyback.addOnChips ?? 0)} />
          <Row
            label="Rebuy through"
            value={
              buyback.rebuyAllowedThroughLevel
                ? `Level ${buyback.rebuyAllowedThroughLevel}`
                : "—"
            }
          />
          <Row
            label="Add-on at break"
            value={
              buyback.addOnAtBreakLevel
                ? `Level ${buyback.addOnAtBreakLevel}`
                : "—"
            }
          />
        </dl>
      </section>
      <p className="text-xs text-fg/50">
        Settings will be snapshotted onto the tournament so editing the
        template later won&apos;t affect tonight&apos;s game.
      </p>
      <StickyActions>
        <button
          type="button"
          onClick={onBack}
          className="h-12 min-h-[44px] flex-1 rounded-md border border-fg/15 text-sm font-semibold text-fg/80"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="h-12 min-h-[44px] flex-1 rounded-md bg-gold text-sm font-semibold text-bg"
        >
          Pick players
        </button>
      </StickyActions>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-label text-[10px] font-semibold uppercase tracking-widest">
        {label}
      </dt>
      <dd className="text-sm font-medium text-fg">{value}</dd>
    </div>
  );
}

function PlayersStep({
  players,
  picked,
  onToggle,
  onBack,
  onNext,
}: {
  players: Player[];
  picked: Set<string>;
  onToggle: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <>
      {players.length === 0 ? (
        <div className="rounded-md border border-fg/10 p-4 text-center text-sm text-fg/60">
          No players in the master roster yet. Add some in{" "}
          <a href="/admin/players" className="text-gold underline">
            Players
          </a>
          .
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {players.map((p) => {
            const checked = picked.has(p.id);
            return (
              <li key={p.id}>
                <label
                  className={`flex min-h-[56px] cursor-pointer items-center gap-3 rounded-md border px-3 py-2 ${
                    checked ? "border-gold bg-gold/5" : "border-fg/15"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(p.id)}
                    className="h-5 w-5 accent-[var(--color-gold)]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-fg">
                      {p.name}
                    </p>
                    {p.signal_handle ? (
                      <p className="truncate text-xs text-fg/50">
                        {p.signal_handle}
                      </p>
                    ) : null}
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <StickyActions>
        <button
          type="button"
          onClick={onBack}
          className="h-12 min-h-[44px] flex-1 rounded-md border border-fg/15 text-sm font-semibold text-fg/80"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={picked.size < 2}
          className="h-12 min-h-[44px] flex-1 rounded-md bg-gold text-sm font-semibold text-bg disabled:opacity-50"
        >
          Configure tables ({picked.size})
        </button>
      </StickyActions>
    </>
  );
}

function TablesStep({
  playerCount,
  tables,
  onPatch,
  onAdd,
  onRemove,
  onBack,
  onStart,
  pending,
  error,
}: {
  playerCount: number;
  tables: TableConfig[];
  onPatch: (idx: number, patch: Partial<TableConfig>) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  onBack: () => void;
  onStart: () => void;
  pending: boolean;
  error: string | null;
}) {
  const totalSeats = tables.reduce((s, t) => s + t.max_seats, 0);
  const fits = playerCount <= totalSeats;

  return (
    <>
      <section className="flex flex-col gap-3 rounded-lg border border-fg/10 p-4">
        <p className="text-sm text-fg/70">
          {playerCount} player{playerCount === 1 ? "" : "s"} will be randomized
          across these tables when you start. Stragglers (when the count
          doesn&apos;t divide evenly) land at whichever table has the most
          remaining capacity.
        </p>

        <ul className="flex flex-col gap-2">
          {tables.map((t, idx) => {
            const css = TABLE_COLOR_CSS[t.color];
            return (
              <li
                key={idx}
                className="flex flex-col gap-2 rounded-md border p-3"
                style={{
                  borderColor: css.border,
                  background: css.bg,
                }}
              >
                <div className="flex items-baseline gap-2">
                  <span
                    className="text-[10px] font-semibold uppercase tracking-widest"
                    style={{ color: css.text }}
                  >
                    Table {idx + 1}
                  </span>
                  {tables.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => onRemove(idx)}
                      className="ml-auto text-[10px] uppercase tracking-widest text-fg/55 hover:text-danger"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <input
                  type="text"
                  value={t.name}
                  maxLength={40}
                  onChange={(e) => onPatch(idx, { name: e.target.value })}
                  placeholder={`Table ${idx + 1}`}
                  className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-3 text-base text-fg focus:border-gold focus:outline-none"
                />
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <ColorPicker
                    value={t.color}
                    onChange={(c) => onPatch(idx, { color: c })}
                  />
                  <NumberField
                    label="Seats"
                    value={t.max_seats}
                    min={2}
                    max={10}
                    onChange={(n) => onPatch(idx, { max_seats: n })}
                  />
                </div>
              </li>
            );
          })}
        </ul>

        {tables.length < 10 ? (
          <button
            type="button"
            onClick={onAdd}
            className="h-11 min-h-[44px] rounded-md border border-dashed border-fg/25 text-xs font-semibold uppercase tracking-wider text-fg/70 hover:border-gold/50 hover:text-fg"
          >
            + Add table
          </button>
        ) : null}

        <p className={`text-xs ${fits ? "text-fg/55" : "text-danger"}`}>
          {fits
            ? `${totalSeats} seats configured · ${totalSeats - playerCount} empty.`
            : `Only ${totalSeats} seats for ${playerCount} players. Add a table or raise a cap.`}
        </p>
      </section>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}

      <StickyActions>
        <button
          type="button"
          onClick={onBack}
          disabled={pending}
          className="h-12 min-h-[44px] flex-1 rounded-md border border-fg/15 text-sm font-semibold text-fg/80 disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onStart}
          disabled={pending || !fits || playerCount < 2}
          className="h-12 min-h-[44px] flex-1 rounded-md bg-gold text-sm font-semibold text-bg disabled:opacity-50"
        >
          {/* "Save" rather than "Start": this button stages the
              tournament with status='scheduled' (creates the row,
              seats players) and redirects to the detail page. The
              actual timer-start happens there via LevelControls. */}
          {pending ? "Saving…" : `Save (${playerCount})`}
        </button>
      </StickyActions>
    </>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  value: TableColor;
  onChange: (c: TableColor) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
        Color
      </span>
      <div className="flex flex-wrap gap-1.5">
        {TABLE_COLORS.map((c) => {
          const css = TABLE_COLOR_CSS[c];
          const active = c === value;
          return (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              aria-label={c}
              aria-pressed={active}
              className={`h-9 w-9 rounded-full border-2 ${
                active ? "ring-2 ring-fg/40" : ""
              }`}
              style={{
                background: css.hex,
                borderColor: active ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.4)",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
        {label}
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
        className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-3 text-base text-fg focus:border-gold focus:outline-none"
      />
    </label>
  );
}

function StickyActions({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="sticky bottom-[64px] z-10 -mx-4 mt-auto flex gap-2 border-t border-fg/10 bg-bg/95 px-4 py-3 backdrop-blur"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0), 12px)" }}
    >
      {children}
    </div>
  );
}
