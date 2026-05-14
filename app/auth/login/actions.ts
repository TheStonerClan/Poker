"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const EmailSchema = z.email({ message: "Enter a valid email." }).trim().toLowerCase();
const NextSchema = z.string().startsWith("/").optional();

const PasswordSignInSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, { message: "Enter your password." }),
  next: NextSchema,
});

const MagicLinkSchema = z.object({
  email: EmailSchema,
  next: NextSchema,
});

const ResetRequestSchema = z.object({
  email: EmailSchema,
});

const UpdatePasswordSchema = z
  .object({
    password: z.string().min(8, { message: "Password must be at least 8 characters." }),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords don't match.",
    path: ["confirm"],
  });

export type PasswordSignInState = {
  status: "idle" | "error";
  message?: string;
  email?: string;
};

export type MagicLinkState = {
  status: "idle" | "sent" | "error";
  message?: string;
  email?: string;
};

export type ResetRequestState = {
  status: "idle" | "sent" | "error";
  message?: string;
  email?: string;
};

export type UpdatePasswordState = {
  status: "idle" | "error";
  message?: string;
};

async function getOrigin(): Promise<string | null> {
  // Origin isn't always present on Server Action POSTs (e.g. some proxy
  // setups strip it); fall back to host + x-forwarded-proto.
  const hdrs = await headers();
  const origin = hdrs.get("origin");
  if (origin) return origin;
  const host = hdrs.get("host");
  if (!host) return null;
  const proto = hdrs.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function signInWithPassword(
  _state: PasswordSignInState,
  formData: FormData,
): Promise<PasswordSignInState> {
  const parsed = PasswordSignInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const { email, password, next } = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return {
      status: "error",
      message: "Invalid email or password.",
      email,
    };
  }

  redirect(next ?? "/admin");
}

export async function sendMagicLink(
  _state: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  const parsed = MagicLinkSchema.safeParse({
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

  const origin = await getOrigin();
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

export async function requestPasswordReset(
  _state: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const parsed = ResetRequestSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const { email } = parsed.data;
  const supabase = await createClient();

  const origin = await getOrigin();
  if (!origin) {
    return {
      status: "error",
      message: "Could not determine app origin. Try refreshing the page.",
      email,
    };
  }

  // Route through the existing callback so the recovery code is exchanged
  // for a session before the user lands on the new-password form.
  const redirectTo = new URL("/auth/callback", origin);
  redirectTo.searchParams.set("next", "/auth/reset/confirm");

  // Always report success, even if the email doesn't exist, to avoid
  // leaking which addresses have admin accounts.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirectTo.toString(),
  });

  return { status: "sent", email };
}

export async function updatePassword(
  _state: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const parsed = UpdatePasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const supabase = await createClient();

  // The user must already be authed (via the recovery link → /auth/callback
  // exchange). If they aren't, `updateUser` will fail.
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    return { status: "error", message: error.message };
  }

  redirect("/admin");
}
