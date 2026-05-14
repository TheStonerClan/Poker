"use client";

import Link from "next/link";
import { useActionState } from "react";

import { requestPasswordReset, type ResetRequestState } from "../login/actions";

const INITIAL: ResetRequestState = { status: "idle" };

export function ResetRequestForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, INITIAL);

  if (state.status === "sent") {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-gold/40 bg-gold/5 p-5 text-center">
          <p className="text-base text-fg">
            If <span className="font-semibold">{state.email}</span> has an
            account, a reset link is on its way.
          </p>
          <p className="mt-3 text-xs text-fg/60">
            Tap the link on this device. It&apos;s valid for one hour.
          </p>
        </div>
        <Link
          href="/auth/login"
          className="text-center text-sm text-fg/60 hover:text-fg"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
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
          defaultValue={state.email ?? ""}
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
        {pending ? "Sending…" : "Send reset link"}
      </button>

      <Link
        href="/auth/login"
        className="text-center text-sm text-fg/60 hover:text-fg"
      >
        Back to sign in
      </Link>
    </form>
  );
}
