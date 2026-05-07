import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/lib/database.types";

/**
 * Server-side Supabase client. Uses the user's auth cookie when available
 * (so admin pages reading data on the server respect RLS as that user) and
 * falls back to the anon key for public/read-only routes.
 *
 * Call inside a Server Component, Route Handler, or Server Action — never
 * cache the returned client across requests because each request has its
 * own cookie store.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll throws when called from a Server Component; the
            // middleware refresh path handles writes there. Safe to ignore.
          }
        },
      },
    },
  );
}
