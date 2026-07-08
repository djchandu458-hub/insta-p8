import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

/**
 * GET /api/instagram/callback — Handles the OAuth redirect from Instagram.
 * Extracts the code and passes it through to the client-side hook.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get("code")
  const error = searchParams.get("error")

  if (error) {
    const redirectUrl = new URL("/", request.url)
    redirectUrl.searchParams.set("error", error)
    return NextResponse.redirect(redirectUrl)
  }

  if (code) {
    const redirectUrl = new URL("/dashboard", request.url)
    redirectUrl.searchParams.set("code", code)
    return NextResponse.redirect(redirectUrl)
  }

  return NextResponse.json({ error: "Invalid callback" }, { status: 400 })
}

/**
 * POST /api/instagram/callback — Exchanges the OAuth code for tokens,
 * then links the Instagram account to the currently authenticated Supabase user.
 *
 * Authentication is read from the Supabase session cookie (set by @supabase/ssr).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { code } = body
    if (!code) return NextResponse.json({ error: "No code" }, { status: 400 })

    // 1. Get the authenticated Supabase user from the session cookie
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: async () => request.cookies.getAll(),
          setAll: async () => {
            // Cookie writing happens via the middleware; we don't write here
          },
        },
      }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: "Not authenticated — sign in to Supabase before connecting Instagram" },
        { status: 401 }
      )
    }

    // 2. Env Vars
    const clientId = process.env.INSTAGRAM_APP_ID
    const clientSecret = process.env.INSTAGRAM_APP_SECRET
    const redirectUri = process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error("Missing Env Vars: Check INSTAGRAM_APP_ID")
    }

    // 3. Exchange Code for Short Token
    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    })

    const tokenRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    })

    const tokenData = await tokenRes.json()
    if (!tokenRes.ok) {
      if (tokenData.error_message?.includes("authorization code has been used")) {
        return NextResponse.json({ error: "Code already used" }, { status: 400 })
      }
      console.error("[v0] 🔴 Token Error:", JSON.stringify(tokenData, null, 2))
      return NextResponse.json({ error: tokenData.error_description || "Token failed" }, { status: 400 })
    }

    const shortToken = tokenData.access_token
    const igUserId = tokenData.user_id.toString()

    // 4. Exchange for Long Token (60 Days)
    const longLivedUrl = `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${clientSecret}&access_token=${shortToken}`
    const longRes = await fetch(longLivedUrl)
    const longData = await longRes.json()
    const accessToken = longData.access_token || shortToken
    const expiresIn = longData.expires_in || 5184000

    // 5. Get Username + IG Professional Account ID (webhook-matching ID)
    let username = `user_${igUserId}`
    let businessAccountId = igUserId // fallback

    try {
      const meRes = await fetch(
        `https://graph.instagram.com/v24.0/me?fields=user_id,username&access_token=${accessToken}`
      )
      const meData = await meRes.json()

      if (meData.username) username = meData.username
      if (meData.user_id) {
        businessAccountId = meData.user_id.toString()
      }
    } catch (e) {
      console.error("[v0] /me request failed:", e)
    }

    // 6. Upsert into instagram_accounts (linked to the authenticated Supabase user)
    const { error: upsertError } = await supabase
      .from("instagram_accounts")
      .upsert(
        {
          id: igUserId,
          user_id: user.id,
          ig_username: username,
          access_token: accessToken,
          token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
          business_account_id: businessAccountId,
          page_id: businessAccountId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      )

    if (upsertError) throw upsertError

    console.log(`[v0] ✅ Instagram account ${igUserId} (${username}) linked to auth user ${user.id}`)

    return NextResponse.json({ success: true, username, userId: igUserId })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
