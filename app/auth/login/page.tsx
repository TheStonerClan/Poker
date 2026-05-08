import type { Metadata } from "next";

import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Admin sign in — Holdem Clock",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-10">
      <header className="mb-10 text-center">
        <p className="text-label text-xs font-semibold uppercase tracking-[0.3em]">
          Holdem Clock
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-fg">Admin sign in</h1>
        <p className="mt-2 text-sm text-fg/60">
          We&apos;ll email you a one-tap magic link.
        </p>
      </header>

      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      <LoginForm next={next ?? "/admin"} />
    </main>
  );
}
