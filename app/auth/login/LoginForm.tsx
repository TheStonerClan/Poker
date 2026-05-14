"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import {
  sendMagicLink,
  signInWithPassword,
  type MagicLinkState,
  type PasswordSignInState,
} from "./actions";

const PASSWORD_INITIAL: PasswordSignInState = { status: "idle" };
const MAGIC_INITIAL: MagicLinkState = { status: "idle" };

export function LoginForm({ next }: { next: string }) {
  const [showMagic, setShowMagic] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <PasswordForm next={next} />

      <div className="flex items-center gap-3 text-xs text-fg/40">
        <span className="h-px flex-1 bg-fg/10" />
        <span className="uppercase tracking-widest">or</span>
        <span className="h-px flex-1 bg-fg/10" />
      </div>

      {showMagic ? (
        <MagicLinkForm next={next} />
      ) : (
        <button
          type="button"
          onClick={() => setShowMagic(true)}
          className="h-12 min-h-[44px] rounded-md border border-fg/15 px-4 text-base font-semibold text-fg transition-colors hover:bg-fg/5"
        >
          Email me a sign-in link
        </button>
      )}
    </div>
  );
}

function PasswordForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(
    signInWithPassword,
    PASSWORD_INITIAL,
  );

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
          defaultValue={state.email ?? ""}
          placeholder="you@example.com"
          className="h-12 min-h-[44px] rounded-md border border-fg/15 bg-bg px-3 text-base text-fg placeholder:text-fg/30 focus:border-gold focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between">
          <span className="text-label text-xs font-semibold uppercase tracking-widest">
            Password
          </span>
          <Link
            href="/auth/reset"
            className="text-xs text-fg/60 hover:text-fg"
          >
            Forgot?
          </Link>
        </span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
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
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

function MagicLinkForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(sendMagicLink, MAGIC_INITIAL);

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
        className="h-12 min-h-[44px] rounded-md border border-gold/60 px-4 text-base font-semibold text-gold transition-opacity disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send magic link"}
      </button>
    </form>
  );
}
