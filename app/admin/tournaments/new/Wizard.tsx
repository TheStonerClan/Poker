"use client";

import { useMemo, useState, useTransition } from "react";

import type { Player, TournamentTemplate } from "@/lib/admin/queries";
import { formatChips, formatMoney } from "@/lib/admin/format";

import { startTournament } from "./actions";

type Step = "template" | "confirm" | "players";

export function NewTournamentWizard({
  templates,
  players,
}: {
  templates: TournamentTemplate[];
  players: Player[];
}) {
  const [step, setStep] = useState<Step>("template");
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const template = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );

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
          error={error}
          pending={pending}
          onStart={() => {
            setError(null);
            start(async () => {
              const res = await startTournament({
                templateId: template.id,
                playerIds: [...picked],
              });
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
    tokensPerPlayer?: number;
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
  onStart,
  pending,
  error,
}: {
  players: Player[];
  picked: Set<string>;
  onToggle: (id: string) => void;
  onBack: () => void;
  onStart: () => void;
  pending: boolean;
  error: string | null;
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

      {error ? (
        <p role="alert" className="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-sm text-danger">
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
          disabled={pending || picked.size < 2}
          className="h-12 min-h-[44px] flex-1 rounded-md bg-gold text-sm font-semibold text-bg disabled:opacity-50"
        >
          {pending ? "Starting…" : `Start (${picked.size})`}
        </button>
      </StickyActions>
    </>
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
