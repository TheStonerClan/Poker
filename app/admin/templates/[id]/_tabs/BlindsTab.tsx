"use client";

import { useState, useTransition } from "react";

import { updateBlindStructure } from "@/app/admin/templates/actions";
import type { BlindLevel } from "@/lib/admin/queries";

type Level = BlindLevel & { _key: string };

function withKeys(levels: BlindLevel[]): Level[] {
  return levels.map((l, i) => ({ ...l, _key: `${i}-${Math.random().toString(36).slice(2)}` }));
}

function stripKey(level: Level): BlindLevel {
  const { _key: _drop, ...rest } = level;
  void _drop;
  return rest;
}

export function BlindsTab({
  structureId,
  levels: initial,
}: {
  structureId: string;
  levels: BlindLevel[];
}) {
  const [levels, setLevels] = useState<Level[]>(withKeys(initial));
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ kind: "ok" | "error"; message?: string } | null>(
    null,
  );

  function move(i: number, dir: -1 | 1) {
    setLevels((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function update(i: number, patch: Partial<BlindLevel>) {
    setLevels((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }

  function remove(i: number) {
    setLevels((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addPlayLevel() {
    setLevels((prev) => [
      ...prev,
      {
        _key: `new-${Date.now()}`,
        level_num: prev.length + 1,
        small: 0,
        big: 0,
        ante: 0,
        duration_sec: 900,
        is_break: false,
      },
    ]);
  }

  function addBreakLevel() {
    setLevels((prev) => [
      ...prev,
      {
        _key: `new-${Date.now()}`,
        level_num: prev.length + 1,
        duration_sec: 600,
        is_break: true,
        color_up_chips: [],
      },
    ]);
  }

  function save() {
    setStatus(null);
    const payload = levels.map((l) => stripKey(l));
    start(async () => {
      const res = await updateBlindStructure({
        blindStructureId: structureId,
        levels: payload,
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
      <p className="text-xs text-fg/60">
        Levels run top-to-bottom. Use the arrows to reorder; numbering is
        auto-applied on save.
      </p>

      <ul className="flex flex-col gap-2">
        {levels.map((l, i) => {
          // Position label matches the TV / tournament detail page:
          // "L4" for the 4th playable level so far, "B2" for the 2nd
          // break. Counted via filter rather than mutable counters so
          // the render stays pure (React's reassignment lint rule).
          const sameKindCount = levels
            .slice(0, i + 1)
            .filter((x) => x.is_break === l.is_break).length;
          const label = `${l.is_break ? "B" : "L"}${sameKindCount}`;
          return (
          <li
            key={l._key}
            className={`rounded-md border ${
              l.is_break ? "border-gold/40 bg-gold/5" : "border-fg/15"
            } p-3`}
          >
            <div className="flex items-baseline justify-between">
              <p className="text-label text-[11px] font-semibold uppercase tracking-widest">
                {label} {l.is_break ? "· Break" : ""}
              </p>
              <div className="flex items-center gap-1">
                <IconBtn
                  label="Up"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  glyph="↑"
                />
                <IconBtn
                  label="Down"
                  disabled={i === levels.length - 1}
                  onClick={() => move(i, 1)}
                  glyph="↓"
                />
                <IconBtn
                  label="Remove"
                  onClick={() => remove(i)}
                  glyph="✕"
                  variant="danger"
                />
              </div>
            </div>

            {l.is_break ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <NumField
                  label="Duration (min)"
                  value={Math.round((l.duration_sec ?? 0) / 60)}
                  onChange={(v) => update(i, { duration_sec: v * 60 })}
                />
                <TextField
                  label="Color-up chips (csv)"
                  value={(l.color_up_chips ?? []).join(", ")}
                  onChange={(v) =>
                    update(i, {
                      color_up_chips: v
                        .split(",")
                        .map((s) => Number(s.trim()))
                        .filter((n) => Number.isFinite(n) && n > 0),
                    })
                  }
                />
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <NumField
                  label="Small"
                  value={l.small ?? 0}
                  onChange={(v) => update(i, { small: v })}
                />
                <NumField
                  label="Big"
                  value={l.big ?? 0}
                  onChange={(v) => update(i, { big: v })}
                />
                <NumField
                  label="Ante"
                  value={l.ante ?? 0}
                  onChange={(v) => update(i, { ante: v })}
                />
                <NumField
                  label="Duration (min)"
                  value={Math.round((l.duration_sec ?? 0) / 60)}
                  onChange={(v) => update(i, { duration_sec: v * 60 })}
                />
              </div>
            )}
          </li>
          );
        })}
      </ul>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={addPlayLevel}
          className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 text-xs font-semibold uppercase tracking-wider text-fg/80"
        >
          + Level
        </button>
        <button
          type="button"
          onClick={addBreakLevel}
          className="h-11 min-h-[44px] flex-1 rounded-md border border-gold/40 text-xs font-semibold uppercase tracking-wider text-gold"
        >
          + Break
        </button>
      </div>

      {status?.kind === "error" ? (
        <p
          role="alert"
          className="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
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
          {pending ? "Saving…" : "Save structure"}
        </button>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
        {label}
      </span>
      <input
        type="number"
        inputMode="numeric"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-h-[40px] rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none"
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[40px] rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none"
      />
    </label>
  );
}

function IconBtn({
  glyph,
  label,
  onClick,
  disabled,
  variant = "neutral",
}: {
  glyph: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "neutral" | "danger";
}) {
  const styles =
    variant === "danger"
      ? "border-danger/40 text-danger"
      : "border-fg/15 text-fg/70";
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-md border text-sm disabled:opacity-30 ${styles}`}
    >
      {glyph}
    </button>
  );
}
