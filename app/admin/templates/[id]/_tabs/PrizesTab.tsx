"use client";

import { useMemo, useState, useTransition } from "react";

import { updateTemplatePrizes } from "@/app/admin/templates/actions";
import { computePayouts } from "prize-math";
import { formatMoney } from "@/lib/admin/format";
import type { TournamentTemplate } from "@/lib/admin/queries";

type RuleKind = "fixed" | "percentRemainder" | "percentTotal";
type Rule = { _key: string; kind: RuleKind; position: number; value: number };

const INCREMENTS = [0, 1, 5, 10, 20] as const;
type Increment = (typeof INCREMENTS)[number];

function isIncrement(v: number): v is Increment {
  return (INCREMENTS as readonly number[]).includes(v);
}

export function PrizesTab({ template }: { template: TournamentTemplate }) {
  const initial = useMemo(() => {
    const pr = template.prize_rules as {
      rules?: Array<{ kind: RuleKind; position: number; value: number }>;
      rounding?: { increment?: number; surplusToFirst?: boolean };
      guarantee?: number;
      overlay?: boolean;
    };
    return {
      rules: (pr.rules ?? []).map((r, i) => ({
        ...r,
        _key: `r-${i}`,
      })),
      increment: isIncrement(pr.rounding?.increment ?? 10)
        ? (pr.rounding!.increment as Increment)
        : 10,
      surplusToFirst: pr.rounding?.surplusToFirst ?? true,
      guarantee: pr.guarantee ?? 0,
      overlay: pr.overlay ?? false,
    };
  }, [template]);

  const [rules, setRules] = useState<Rule[]>(initial.rules);
  const [increment, setIncrement] = useState<Increment>(initial.increment);
  const [surplusToFirst, setSurplusToFirst] = useState(initial.surplusToFirst);
  const [guarantee, setGuarantee] = useState(initial.guarantee);
  const [overlay, setOverlay] = useState(initial.overlay);
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{
    kind: "ok" | "error";
    message?: string;
  } | null>(null);

  // Worked example using current settings — 5 entries, no buybacks.
  const preview = computePayouts(
    {
      rules: rules.map(({ _key: _drop, ...r }) => {
        void _drop;
        return r;
      }),
      rounding: { increment, surplusToFirst },
      guarantee,
      overlay,
    },
    { buyIns: 5, buybacks: 0, buyInPrice: template.buy_in },
  );

  function update(i: number, patch: Partial<Rule>) {
    setRules((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }

  function remove(i: number) {
    setRules((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addRule(kind: RuleKind) {
    setRules((prev) => [
      ...prev,
      {
        _key: `new-${Date.now()}`,
        kind,
        position: prev.length + 1,
        value: kind === "fixed" ? 20 : 50,
      },
    ]);
  }

  function save() {
    setStatus(null);
    start(async () => {
      const res = await updateTemplatePrizes({
        templateId: template.id,
        rules: rules.map(({ _key: _drop, ...r }) => {
          void _drop;
          return r;
        }),
        rounding_increment: increment,
        surplus_to_first: surplusToFirst,
        guarantee,
        overlay,
      });
      setStatus(
        res.status === "ok"
          ? { kind: "ok", message: "Saved." }
          : { kind: "error", message: res.message ?? "Could not save." },
      );
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {rules.map((r, i) => (
          <li
            key={r._key}
            className="rounded-md border border-fg/15 p-3"
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                value={r.position}
                onChange={(e) =>
                  update(i, { position: Number(e.target.value) })
                }
                className="min-h-[44px] w-16 rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none"
                aria-label="Position"
              />
              <select
                value={r.kind}
                onChange={(e) =>
                  update(i, { kind: e.target.value as RuleKind })
                }
                className="min-h-[44px] flex-1 rounded-md border border-fg/15 bg-bg px-2 text-sm text-fg focus:border-gold focus:outline-none"
                aria-label="Kind"
              >
                <option value="percentRemainder">% of remainder</option>
                <option value="percentTotal">% of total</option>
                <option value="fixed">Fixed $</option>
              </select>
              <input
                type="number"
                inputMode="numeric"
                value={r.value}
                onChange={(e) =>
                  update(i, { value: Number(e.target.value) })
                }
                className="min-h-[44px] w-20 rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none"
                aria-label="Value"
              />
              <button
                type="button"
                aria-label="Remove rule"
                onClick={() => remove(i)}
                className="inline-flex h-11 min-h-[44px] w-11 items-center justify-center rounded-md border border-danger/40 text-danger"
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => addRule("percentRemainder")}
          className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 text-xs font-semibold uppercase tracking-wider text-fg/80"
        >
          + % rule
        </button>
        <button
          type="button"
          onClick={() => addRule("fixed")}
          className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 text-xs font-semibold uppercase tracking-wider text-fg/80"
        >
          + $ rule
        </button>
      </div>

      <section className="rounded-md border border-fg/10 p-3">
        <h3 className="text-label text-[11px] font-semibold uppercase tracking-widest">
          Rounding
        </h3>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
              Increment ($)
            </span>
            <select
              value={increment}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (isIncrement(next)) setIncrement(next);
              }}
              className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none"
            >
              {INCREMENTS.map((inc) => (
                <option key={inc} value={inc}>
                  {inc === 0 ? "Cents" : `$${inc}`}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={surplusToFirst}
              onChange={(e) => setSurplusToFirst(e.target.checked)}
              className="h-5 w-5 accent-[var(--color-gold)]"
            />
            <span className="text-sm text-fg/80">Surplus to 1st</span>
          </label>
        </div>
      </section>

      <section className="rounded-md border border-fg/10 p-3">
        <h3 className="text-label text-[11px] font-semibold uppercase tracking-widest">
          Guarantee
        </h3>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
              Minimum pool ($)
            </span>
            <input
              type="number"
              inputMode="numeric"
              value={guarantee}
              onChange={(e) => setGuarantee(Number(e.target.value))}
              className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={overlay}
              onChange={(e) => setOverlay(e.target.checked)}
              className="h-5 w-5 accent-[var(--color-gold)]"
            />
            <span className="text-sm text-fg/80">Overlay if short</span>
          </label>
        </div>
      </section>

      <section className="rounded-md border border-gold/30 bg-gold/5 p-3">
        <h3 className="text-label text-[11px] font-semibold uppercase tracking-widest">
          Preview · 5 entries
        </h3>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {preview.payouts.map((p) => (
            <li key={p.position} className="flex justify-between">
              <span className="text-fg/70">Position {p.position}</span>
              <span className="font-mono">{formatMoney(p.amount)}</span>
            </li>
          ))}
          <li className="flex justify-between border-t border-gold/30 pt-1 text-xs text-fg/60">
            <span>Pool</span>
            <span className="font-mono">
              {formatMoney(preview.effectivePool)}
            </span>
          </li>
        </ul>
      </section>

      {status?.kind === "error" ? (
        <p role="alert" className="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-sm text-danger">
          {status.message}
        </p>
      ) : null}
      {status?.kind === "ok" ? (
        <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          {status.message}
        </p>
      ) : null}

      <div
        className="sticky bottom-[64px] -mx-4 mt-auto flex gap-2 border-t border-fg/10 bg-bg/95 px-4 py-3 backdrop-blur"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0), 12px)" }}
      >
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="h-12 min-h-[44px] flex-1 rounded-md bg-gold text-sm font-semibold text-bg disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save prizes"}
        </button>
      </div>
    </div>
  );
}
