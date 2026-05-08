import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * Service-role Supabase client. Bypasses RLS — only call from server-only
 * code (Server Actions, Route Handlers) where the action has been validated.
 *
 * The player view uses this to write `tournament_players.busted_at_*` and
 * `color_up_requests` rows on behalf of an un-authenticated player whose
 * claim is held purely in Realtime presence (no DB session marker).
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
