import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Magic-link landing page. Supabase redirects the user here after they tap
 * the link in their email; we exchange the `code` for a session cookie and
 * forward to `next` (defaults to /admin).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/admin";
  const next = nextParam.startsWith("/") ? nextParam : "/admin";

  if (!code) {
    const fail = new URL("/auth/login", url);
    fail.searchParams.set("error", "Missing sign-in code. Try again.");
    return NextResponse.redirect(fail);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const fail = new URL("/auth/login", url);
    fail.searchParams.set("error", error.message);
    return NextResponse.redirect(fail);
  }

  return NextResponse.redirect(new URL(next, url));
}
