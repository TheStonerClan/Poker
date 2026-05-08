import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/database.types";

/**
 * Build a Supabase client tied to the proxy request/response cookie cycle.
 *
 * The returned `response` is what Proxy must hand back so the refreshed auth
 * cookie reaches the browser. Callers who want to redirect/rewrite should
 * copy the cookies onto their own NextResponse before returning it.
 */
export function createProxySupabase(request: NextRequest): {
  supabase: ReturnType<typeof createServerClient<Database>>;
  response: NextResponse;
} {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  return { supabase, response };
}
