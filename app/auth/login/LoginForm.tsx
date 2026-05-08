"use client";

import { useActionState } from "react";

import { sendMagicLink, type LoginState } from "./actions";

const INITIAL: LoginState = { status: "idle" };

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(sendMagicLink, INITIAL);

  if (state.status === "sent") {
    return (
      <div className="rounded-lg border border-gold/40 bg-gold/5 p-5 text-center">
        <p className="text-base text-fg">
          Check <span className="font-semibold">{state.email}</span> for a sign-in link.
        </p>
        <p className="mt-3 text-xs text-fg/60">
          Tap the link on this device to finish signing in. The link is valid
          for one hour.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1.5">
        <span className="text-label text-xs font-semibold uppercase tracking-widest">
          Email
        </span>
        <input
          type="email"
          name="email"
          required
          autoFocus
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
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
        {pending ? "Sending…" : "Send magic link"}
      </button>
    </form>
  );
}
