"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import type { Player } from "@/lib/admin/queries";

import { upsertPlayer, type PlayerFormState } from "./actions";

const INITIAL: PlayerFormState = { status: "idle" };

export function PlayerEditor({ player }: { player: Player | null }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(upsertPlayer, INITIAL);

  useEffect(() => {
    if (state.status === "ok") {
      router.replace("/admin/players");
      router.refresh();
    }
  }, [state.status, router]);

  return (
    <form action={action} className="flex flex-col gap-4">
      {player ? <input type="hidden" name="id" value={player.id} /> : null}

      <Field
        label="Name"
        name="name"
        defaultValue={player?.name ?? ""}
        autoFocus
        required
        error={state.fieldErrors?.name}
      />
      <Field
        label="Signal handle"
        name="signal_handle"
        defaultValue={player?.signal_handle ?? ""}
        placeholder="@example.42"
        error={state.fieldErrors?.signal_handle}
      />
      <Field
        label="Notes"
        name="notes"
        defaultValue={player?.notes ?? ""}
        placeholder="(optional)"
        as="textarea"
        error={state.fieldErrors?.notes}
      />

      {state.status === "error" && state.message ? (
        <p
          role="alert"
          className="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.message}
        </p>
      ) : null}

      <div
        className="sticky bottom-[64px] -mx-4 mt-auto flex gap-2 border-t border-fg/10 bg-bg/95 px-4 py-3 backdrop-blur"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0), 12px)" }}
      >
        <Link
          href="/admin/players"
          className="flex h-12 min-h-[44px] flex-1 items-center justify-center rounded-md border border-fg/15 text-sm font-semibold text-fg/80"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="h-12 min-h-[44px] flex-1 rounded-md bg-gold text-sm font-semibold text-bg disabled:opacity-50"
        >
          {pending ? "Saving…" : player ? "Save" : "Add player"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  required,
  autoFocus,
  error,
  as = "input",
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  error?: string;
  as?: "input" | "textarea";
}) {
  const baseClass =
    "min-h-[44px] rounded-md border bg-bg px-3 py-2 text-base text-fg placeholder:text-fg/30 focus:outline-none";
  const borderClass = error ? "border-danger/60" : "border-fg/15 focus:border-gold";
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label text-[11px] font-semibold uppercase tracking-widest">
        {label}
      </span>
      {as === "textarea" ? (
        <textarea
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          rows={3}
          className={`${baseClass} ${borderClass}`}
        />
      ) : (
        <input
          type="text"
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          required={required}
          autoFocus={autoFocus}
          className={`${baseClass} ${borderClass}`}
        />
      )}
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </label>
  );
}
