import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { UpdatePasswordForm } from "./UpdatePasswordForm";

export const metadata: Metadata = {
  title: "Set new password — Holdem Clock",
  robots: { index: false, follow: false },
};

export default async function ResetConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const supabase = await createClient();

  // Recovery links arrive here as `/auth/reset/confirm?code=…`. Exchange
  // the (single-use) PKCE code for a session. On refresh the exchange
  // fails, but the session cookie from the first load still carries us.
  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/reset?error=Recovery+link+expired.+Request+a+new+one.");
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-10">
      <header className="mb-10 text-center">
        <p className="text-label text-xs font-semibold uppercase tracking-[0.3em]">
          Holdem Clock
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-fg">Set new password</h1>
        <p className="mt-2 text-sm text-fg/60">
          Pick something at least 8 characters long.
        </p>
      </header>

      <UpdatePasswordForm />
    </main>
  );
}
