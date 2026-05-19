"use client";

import { useState, useTransition } from "react";

import { clearPlayerLogin, setPlayerLogin } from "./actions";

/**
 * Per-row sign-in manager for `/admin/players`. Split into a Trigger
 * (placed inline with the row's edit/delete buttons) and a Panel
 * (placed beneath the row when expanded) so the parent layout can
 * cleanly span the panel across the row without absolute positioning.
 *
 * Open state is owned by the parent (`PlayersList`) — only one panel
 * can be open at a time, and clicking another row's trigger
 * automatically closes the previous one.
 *
 * Once linked, the player signs in like any other user; whichever
 * table they're seated at in a running tournament becomes their
 * managed table (outs, color-up approvals, chip-count edits).
 *
 * "Unlink" detaches the auth user from the roster spot without
 * deleting the underlying auth account — preserves history if you
 * just want to move the link elsewhere.
 */

export function PlayerLoginTrigger({
  open,
  linkedEmail,
  onToggle,
}: {
  open: boolean;
  linkedEmail: string | null;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex h-11 min-h-[44px] items-center justify-center rounded-md border px-3 text-xs font-semibold uppercase tracking-wider ${
        linkedEmail ? "border-gold/50 text-gold" : "border-fg/15 text-fg/80"
      } ${open ? "bg-fg/[0.05]" : ""}`}
      title={linkedEmail ?? "No sign-in linked"}
    >
      {linkedEmail ? "Sign-in ✓" : "Sign-in"}
    </button>
  );
}

export function PlayerLoginPanel({
  playerId,
  playerName,
  linkedEmail,
  onClose,
}: {
  playerId: string;
  playerName: string;
  linkedEmail: string | null;
  onClose: () => void;
}) {
  const [email, setEmail] = useState<string>(linkedEmail ?? "");
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const res = await setPlayerLogin({
        playerId,
        email,
        password: password || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPassword("");
      onClose();
    });
  }

  function clear() {
    if (
      !confirm(
        `Unlink ${linkedEmail ?? "this email"} from ${playerName}? They keep their login but lose table-admin powers.`,
      )
    ) {
      return;
    }
    setError(null);
    start(async () => {
      const res = await clearPlayerLogin({ playerId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
    });
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-md border border-fg/20 bg-fg/[0.03] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-fg/80">
          Sign-in · {playerName}
        </p>
        {linkedEmail ? (
          <button
            type="button"
            disabled={pending}
            onClick={clear}
            className="text-[10px] uppercase tracking-wider text-danger disabled:opacity-50"
          >
            Unlink
          </button>
        ) : null}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
          Email
        </span>
        <input
          type="email"
          inputMode="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/60">
          Password
          <span className="ml-1 normal-case tracking-normal text-fg/40">
            {linkedEmail ? "leave blank to keep current" : "min 8 characters"}
          </span>
        </span>
        <input
          type="text"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none"
        />
      </label>
      <p className="text-[10px] text-fg/55">
        Share the email + password with {playerName} so they can sign in
        and manage their table. Reset anytime by re-saving.
      </p>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/60 bg-danger/10 px-2 py-1.5 text-xs text-danger"
        >
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={onClose}
          className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 text-xs font-semibold uppercase tracking-wider text-fg/80 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending || !email}
          onClick={save}
          className="h-11 min-h-[44px] flex-1 rounded-md bg-gold text-xs font-semibold uppercase tracking-wider text-bg disabled:opacity-50"
        >
          {pending ? "Saving…" : linkedEmail ? "Update" : "Link"}
        </button>
      </div>
    </div>
  );
}
