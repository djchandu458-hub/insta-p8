import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

/**
 * Middleware protects:
 *   - /dashboard/*  — requires a valid Supabase session
 *   - /api/*         — requires a valid Supabase session
 *
 * Public routes (no session required):
 *   - /api/instagram/webhook   — Meta sends webhook events here, no session
 *   - /api/instagram/callback  — OAuth redirect, no session
 *   - /auth/*                  — login/signup/auth callback
 *   - /, /privacy              — public pages
 */
const PUBLIC_ROUTES = [
  "/",
  "/privacy",
  "/auth/login",
  "/auth/signup",
  "/auth/callback",
  "/auth/forgot-password",
  "/auth/reset-password",
  // Instagram OAuth & webhook — their own auth models
  "/api/instagram/webhook",
  "/api/instagram/callback",
  "/api/instagram/test-login",
  // Internal hooks — authenticated via API_SECRET_KEY header, not Supabase session
  "/api/hooks/direct-post",
  "/api/hooks/publish-reel",
  "/api/hooks/upload-washed-reel",
  // Scheduler CRON endpoint — authenticated via CRON_SECRET Bearer token, not Supabase session
  "/api/scheduler",
]

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  )
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public routes through without a session
  if (isPublicRoute(pathname)) {
    return NextResponse.next()
  }

  // Create a response object so setAll can write cookies to it.
  // The response object must be created BEFORE the Supabase client
  // so the setAll callback has a reference to it.
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: async () => request.cookies.getAll(),
        setAll: async (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // Use getUser() instead of getSession() — getUser() re-validates the
  // access token with the Supabase Auth server, making it a proper
  // authorization check rather than a trust-local-cookie check.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    // If it's an API route, return 401
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    // Otherwise redirect to login
    const loginUrl = new URL("/auth/login", request.url)
    loginUrl.searchParams.set("redirect", pathname)
    return NextResponse.redirect(loginUrl)
  }

  // User is authenticated — pass through
  return response
}

export const config = {
  matcher: [
    // Match all dashboard and API routes
    "/dashboard/:path*",
    "/api/:path*",
  ],
}
