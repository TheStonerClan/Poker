import { createClient as createBaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * Server-only Supabase client using the service-role key. Bypasses RLS.
 * Used by TV pages / route handlers that need to read public-display data
 * across tables that are otherwise admin-locked (e.g. the master `players`
 * table for showing names on the bust list).
 *
 * NEVER import this file from a Client Component.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase service-role env vars missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  return createBaseClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
