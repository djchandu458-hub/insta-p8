import { createBrowserClient } from "@supabase/ssr"

/**
 * Create a Supabase browser client for client-side operations.
 * Used by auth pages (login, signup) and any component that
 * needs to interact with Supabase Auth from the browser.
 */
export function getSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
