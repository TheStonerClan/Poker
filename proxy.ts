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
  const url = request.nextUrl;
  const path = url.pathname;

  // Recover from a misconfigured Supabase Site URL: if a magic link arrives
  // with `?code=` on any path other than /auth/callback, forward it to the
  // callback so the session exchange still happens. Supabase only honors
  // `emailRedirectTo` when the URL is in the project's redirect allow-list;
  // otherwise it falls back to the Site URL. If that Site URL is bare
  // (e.g. https://app.example.com/), the user lands at "/?code=..." and
  // our root redirect to /tv eats the query — auth never completes.
  const code = url.searchParams.get("code");
  if (code && path !== "/auth/callback") {
    const target = new URL("/auth/callback", url);
    target.searchParams.set("code", code);
    const next = url.searchParams.get("next");
    if (next?.startsWith("/")) target.searchParams.set("next", next);
    return NextResponse.redirect(target);
  }

  const { supabase, response } = createProxySupabase(request);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAdminRoute = path === "/admin" || path.startsWith("/admin/");
  const isLoginRoute = path === "/auth/login";

  if (isAdminRoute && !user) {
    const loginUrl = url.clone();
    loginUrl.pathname = "/auth/login";
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoginRoute && user) {
    const adminUrl = url.clone();
    adminUrl.pathname = "/admin";
    adminUrl.search = "";
    return NextResponse.redirect(adminUrl);
  }

  return response;
}

export const config = {
  // Skip Next internals + favicon; proxy /admin, /auth, and the rest.
  matcher: ["/((?!_next/static|_next/image|_next/data|favicon.ico).*)"],
};
