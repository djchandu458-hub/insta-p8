"use client"

import { useState, useEffect, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { getSupabaseBrowserClient } from "@/lib/supabase-browser"

/**
 * Central session hook — replaces the old localStorage-based session.
 *
 * Two session layers now work together:
 *   1. Supabase Auth (email/password or magic link) — managed via @supabase/ssr cookies,
 *      verified server-side by middleware.ts using getUser().
 *   2. Instagram account connection — the user's Instagram account(s) are linked to their
 *      Supabase Auth user via the instagram_accounts table.
 *
 * This hook reads the Supabase session on mount and also fetches the user's
 * linked Instagram account(s) so the UI can display which account is active.
 */
export function useInstagramSession() {
  const [username, setUsername] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [igAccountId, setIgAccountId] = useState<string | null>(null)

  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    const code = searchParams.get("code")

    const initSession = async () => {
      const supabase = getSupabaseBrowserClient()

      // 1. Get the Supabase Auth session
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.user) {
        // No Supabase session — user needs to log in via /auth/login
        setIsLoading(false)
        return
      }

      // 2. If there's an Instagram OAuth code, exchange it
      if (code) {
        try {
          const res = await fetch("/api/instagram/callback", {
            method: "POST",
            body: JSON.stringify({ code }),
          })
          const data = await res.json()

          if (data.success) {
            setUserId(data.userId)
            setUsername(data.username)
            setIgAccountId(data.userId)
            // Remove code from URL
            router.replace("/dashboard")
            setIsLoading(false)
            return
          }
        } catch (err) {
          console.error("Instagram login failed:", err)
        }
      }

      // 3. No code — fetch the user's linked Instagram account(s)
      //    to restore the session context.
      const { data: accounts } = await supabase
        .from("instagram_accounts")
        .select("id, ig_username")
        .eq("user_id", session.user.id)

      if (accounts && accounts.length > 0) {
        const primary = accounts[0]
        setIgAccountId(String(primary.id))
        setUserId(String(primary.id))
        setUsername(primary.ig_username)
      } else {
        // Signed in to Supabase but no Instagram connected yet
        setUserId(null)
        setUsername(null)
      }

      setIsLoading(false)
    }

    initSession()
  }, [searchParams, router])

  const logout = useCallback(async () => {
    const supabase = getSupabaseBrowserClient()
    await supabase.auth.signOut()
    setUsername(null)
    setUserId(null)
    setIgAccountId(null)
    router.push("/")
  }, [router])

  return { userId, username, igAccountId, isLoading, logout }
}
