"use client";

import { useActionState } from "react";

import { updateTemplateBasics } from "@/app/admin/templates/actions";
import type { TournamentTemplate } from "@/lib/admin/queries";

const INITIAL = { status: "idle" as const };

export function BasicsTab({ template }: { template: TournamentTemplate }) {
  const [state, action, pending] = useActionState(
    updateTemplateBasics,
    INITIAL,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="templateId" value={template.id} />
      <Field
        label="Name"
        name="name"
        defaultValue={template.name}
        required
      />
      <Field
        label="Location"
        name="location"
        defaultValue={template.location ?? ""}
        placeholder="(optional)"
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Buy-in"
          name="buy_in"
          type="number"
          defaultValue={String(template.buy_in)}
          inputMode="numeric"
          required
        />
        <Field
          label="Starting stack"
          name="starting_stack"
          type="number"
          defaultValue={String(template.starting_stack)}
          inputMode="numeric"
          required
        />
      </div>
      <Field
        label="Ante mode"
        name="ante_mode"
        defaultValue={template.ante_mode}
        placeholder="BB"
        required
      />

      <Footer state={state} pending={pending} label="Save basics" />
    </form>
  );
}

export function Field({
  label,
  ...rest
}: {
  label: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label text-[11px] font-semibold uppercase tracking-widest">
        {label}
      </span>
      <input
        {...rest}
        className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-3 py-2 text-base text-fg placeholder:text-fg/30 focus:border-gold focus:outline-none"
      />
    </label>
  );
}

export function Footer({
  state,
  pending,
  label,
}: {
  state: { status: "idle" | "ok" | "error"; message?: string };
  pending: boolean;
  label: string;
}) {
  return (
    <>
      {state.status === "error" && state.message ? (
        <p
          role="alert"
          className="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.message}
        </p>
      ) : null}
      {state.status === "ok" ? (
        <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          Saved.
        </p>
      ) : null}
      <div
        className="sticky bottom-[64px] -mx-4 mt-auto flex gap-2 border-t border-fg/10 bg-bg/95 px-4 py-3 backdrop-blur"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0), 12px)" }}
      >
        <button
          type="submit"
          disabled={pending}
          className="h-12 min-h-[44px] flex-1 rounded-md bg-gold text-sm font-semibold text-bg disabled:opacity-50"
        >
          {pending ? "Saving…" : label}
        </button>
      </div>
    </>
  );
}
