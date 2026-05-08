"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const LoginSchema = z.object({
  email: z.email({ message: "Enter a valid email." }).trim().toLowerCase(),
  next: z.string().startsWith("/").optional(),
});

export type LoginState = {
  status: "idle" | "sent" | "error";
  message?: string;
  email?: string;
};

export async function sendMagicLink(
  _state: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const { email, next } = parsed.data;
  const supabase = await createClient();

  // Build the absolute URL Supabase will redirect the magic link to. Must
  // match an allow-listed redirect URL in the Supabase dashboard. Origin
  // isn't always present on Server Action POSTs (e.g. some proxy setups
  // strip it); fall back to host + x-forwarded-proto so we don't end up
  // with `new URL("/auth/callback", "")` throwing.
  const hdrs = await headers();
  const origin =
    hdrs.get("origin") ??
    (() => {
      const host = hdrs.get("host");
      if (!host) return null;
      const proto = hdrs.get("x-forwarded-proto") ?? "https";
      return `${proto}://${host}`;
    })();

  if (!origin) {
    return {
      status: "error",
      message: "Could not determine app origin. Try refreshing the page.",
      email,
    };
  }

  const redirectTo = new URL("/auth/callback", origin);
  if (next) redirectTo.searchParams.set("next", next);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo.toString(),
      shouldCreateUser: false,
    },
  });

  if (error) {
    return { status: "error", message: error.message, email };
  }

  return { status: "sent", email };
}
