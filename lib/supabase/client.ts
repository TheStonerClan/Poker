"use client";

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";

/**
 * Browser-side Supabase client. Safe to call from any Client Component;
 * it reads/writes the same auth cookie the server helper uses, so an admin
 * who signs in via magic link stays signed in across server + client.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
