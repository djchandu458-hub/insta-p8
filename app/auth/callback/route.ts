import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

/**
 * Auth callback route — handles PKCE flow redirect from Supabase Auth.
 * After a user clicks a magic link or email confirmation link,
 * Supabase redirects here with a code. We exchange it for a session
 * then redirect to the dashboard.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get("code")
  const next = searchParams.get("next") ?? "/dashboard"

  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: async () => request.cookies.getAll(),
          setAll: async (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) =>
              request.cookies.set(name, value)
            )
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const redirectUrl = new URL(next, origin)
      return NextResponse.redirect(redirectUrl)
    }
  }

  // If there's an error or no code, redirect to login
  return NextResponse.redirect(`${origin}/auth/login?error=Could not verify session`)
}
