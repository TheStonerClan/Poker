import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getUser } from "@/lib/auth";

import { UpdatePasswordForm } from "./UpdatePasswordForm";

export const metadata: Metadata = {
  title: "Set new password — Holdem Clock",
  robots: { index: false, follow: false },
};

export default async function ResetConfirmPage() {
  // The user lands here after /auth/callback exchanges the recovery `code`
  // for a session. If they aren't authed, the recovery link expired or
  // failed — bounce them back to request a new one.
  const user = await getUser();
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
