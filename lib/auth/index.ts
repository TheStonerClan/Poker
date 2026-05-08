import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

export type AdminUser = User;

/**
 * Returns the currently signed-in Supabase user, or null if there is no
 * session. Memoized for the duration of one server render pass so multiple
 * components in the same tree don't all hit Supabase.
 */
export const getUser = cache(async (): Promise<AdminUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
});

/**
 * Returns true iff the given email exists in the public.admins allow-list.
 * Uses the request user's session, so RLS on `admins` (admin-only select) is
 * automatically respected — admin reads succeed; everyone else gets nothing.
 */
export async function isAdmin(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("admins")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

/**
 * Same as getUser() but returns null unless the user is also in the admins
 * table. Use this in admin Server Components / Actions where you only want
 * to act on a confirmed admin identity.
 */
export const getAdminUser = cache(async (): Promise<AdminUser | null> => {
  const user = await getUser();
  if (!user?.email) return null;
  const ok = await isAdmin(user.email);
  return ok ? user : null;
});

/**
 * Hard guard for admin-only Server Components, Server Actions, and Route
 * Handlers. Redirects to /auth/login if the request is unauthenticated or
 * not on the admin allow-list. The redirect throws, so callers can treat
 * the return value as a definite admin User.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const user = await getAdminUser();
  if (!user) redirect("/auth/login");
  return user;
}
