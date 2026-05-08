import { NextResponse, type NextRequest } from "next/server";

import { createProxySupabase } from "@/lib/supabase/proxy";

/**
 * Next.js 16+ uses `proxy.ts` (the renamed successor of `middleware.ts`) for
 * pre-render gating. We refresh the Supabase session cookie on every request
 * and redirect any non-admin away from /admin/*.
 *
 * The `admins` allow-list is checked at the data layer (RLS + lib/auth/),
 * not here — proxy just refreshes the session and verifies "is signed in"
 * for the admin tree. The Server Components and Server Actions inside
 * /admin do their own admin-role check (defense in depth, since Server
 * Function calls aren't gated by proxy matchers).
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { supabase, response } = createProxySupabase(request);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAdminRoute = path === "/admin" || path.startsWith("/admin/");
  const isLoginRoute = path === "/auth/login";

  if (isAdminRoute && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (isLoginRoute && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Skip Next internals + favicon; proxy /admin, /auth, and the rest.
  matcher: ["/((?!_next/static|_next/image|_next/data|favicon.ico).*)"],
};
