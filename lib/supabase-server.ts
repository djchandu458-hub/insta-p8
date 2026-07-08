import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

/**
 * Create a Supabase server client using the ANON key.
 * Respects Row Level Security (RLS).
 * Use this in user-facing API routes to scope queries to the authenticated user.
 * Session cookies are read/written automatically via the cookie store.
 */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: async () => cookieStore.getAll(),
        setAll: async (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch (error) {
            // Can be ignored in static generation / during build
            console.error("[supabase-server] Error setting cookies:", error)
          }
        },
      },
    }
  )
}

/**
 * Create a Supabase server client using the SERVICE_ROLE key.
 * BYPASSES Row Level Security — full admin access.
 * Use ONLY in trusted server-side code: webhook handlers, scheduler CRON jobs,
 * and any other internal-only routes that have their own verification.
 * Do NOT use this in user-facing API routes.
 */
export async function getSupabaseAdminClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll: async () => [],
        setAll: async () => {},
      },
    }
  )
}
