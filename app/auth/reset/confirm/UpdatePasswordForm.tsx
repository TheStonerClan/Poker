"use client";

import { useActionState } from "react";

import { updatePassword, type UpdatePasswordState } from "../../login/actions";

const INITIAL: UpdatePasswordState = { status: "idle" };

export function UpdatePasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-label text-xs font-semibold uppercase tracking-widest">
          New password
        </span>
        <input
          type="password"
          name="password"
          required
          autoFocus
          minLength={8}
          autoComplete="new-password"
          className="h-12 min-h-[44px] rounded-md border border-fg/15 bg-bg px-3 text-base text-fg placeholder:text-fg/30 focus:border-gold focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-label text-xs font-semibold uppercase tracking-widest">
          Confirm new password
        </span>
        <input
          type="password"
          name="confirm"
          required
          minLength={8}
          autoComplete="new-password"
          className="h-12 min-h-[44px] rounded-md border border-fg/15 bg-bg px-3 text-base text-fg placeholder:text-fg/30 focus:border-gold focus:outline-none"
        />
      </label>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="h-12 min-h-[44px] rounded-md bg-gold px-4 text-base font-semibold text-bg transition-opacity disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
