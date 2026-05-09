"use client";

import { useActionState, useState } from "react";

import { createTournamentTemplate } from "./actions";

type Source = { id: string; name: string };

type Props = {
  sources: Source[];
};

const INITIAL = { status: "idle" as const };

/**
 * Inline "create new template" form. Renders collapsed by default to keep
 * the templates index uncluttered; expands to a name input + source-clone
 * picker when the admin clicks "New template". On submit, the action
 * creates the template + a fresh blind_structures row (deep-cloned from
 * the source) and redirects to the editor.
 */
export function NewTemplateForm({ sources }: Props) {
  const [state, action, pending] = useActionState(
    createTournamentTemplate,
    INITIAL,
  );
  const [open, setOpen] = useState(false);

  if (sources.length === 0) {
    // Without an existing template to clone from, there's nothing to copy.
    // The first template comes from the seed migration; future templates
    // clone from there. Keep the button hidden in this state to avoid
    // surfacing a non-functional flow.
    return null;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-12 min-h-[44px] w-full rounded-md border border-gold/40 bg-gold/5 px-4 text-sm font-semibold text-gold hover:bg-gold/10"
      >
        + New template
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3 rounded-md border border-gold/40 bg-gold/5 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gold/80">
        Clone a template
      </p>
      <p className="text-xs text-fg/60">
        New templates start as copies of an existing one — same blinds,
        prizes, buyback rules. Edit any of those once it&apos;s created.
        The recurring schedule is intentionally not copied so two templates
        don&apos;t double-book the same night.
      </p>

      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
          Name
        </span>
        <input
          type="text"
          name="name"
          required
          maxLength={80}
          autoFocus
          placeholder="Friday Night Stakes"
          className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-3 text-base text-fg focus:border-gold focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
          Clone from
        </span>
        <select
          name="sourceTemplateId"
          required
          defaultValue={sources[0].id}
          className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none"
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      {state.status === "error" ? (
        <p
          role="alert"
          className="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.message}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 text-sm font-semibold text-fg/80"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="h-11 min-h-[44px] flex-1 rounded-md bg-gold text-sm font-semibold text-bg disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}
