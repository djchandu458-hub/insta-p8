import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

/**
 * POST /api/instagram/test-login
 * Creates a mock user and Instagram account for local development.
 * Only available in development mode.
 *
 * Since this is on PUBLIC_ROUTES (no Supabase session required), it
 * creates/gets a deterministic dev user, signs them in via email/password,
 * and sets the Supabase session cookies on the response.
 */
export async function POST(request: NextRequest) {
  try {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Not available in production" }, { status: 403 })
    }

    const TEST_USER_ID = "9999999999"
    const TEST_USERNAME = "test_creator"
    const testEmail = `test_${TEST_USER_ID}@dev.insta-p8.app`
    const testPassword = "test_password_123"

    // ---------------------------------------------------------------
    // Step 1: Ensure the auth user and instagram_account exist
    // ---------------------------------------------------------------
    // Use the admin client to create/get the user (no session cookies needed here)
    const supabaseAdmin = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          getAll: async () => [],
          setAll: async () => {},
        },
      }
    )

    let authUserId: string

    // Try creating the user. If they already exist, catch the error and
    // list users by email to find the existing ID.
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { dev_test_account: true },
    })

    if (createError) {
      // "already registered" or similar — find the existing user
      const { data: listedUsers } = await supabaseAdmin.auth.admin.listUsers()
      const existing = listedUsers?.users?.find((u) => u.email === testEmail)
      if (!existing?.id) {
        return NextResponse.json(
          { error: "Could not find or create test user" },
          { status: 500 }
        )
      }
      authUserId = existing.id
    } else if (!newUser?.user?.id) {
      return NextResponse.json({ error: "Failed to create test user" }, { status: 500 })
    } else {
      authUserId = newUser.user.id
    }

    // Upsert the instagram_accounts entry (admin client, no cookies needed)
    const { error: upsertError } = await supabaseAdmin
      .from("instagram_accounts")
      .upsert(
        {
          id: TEST_USER_ID,
          user_id: authUserId,
          ig_username: TEST_USERNAME,
          access_token: "TEST_TOKEN_NOT_REAL",
          token_expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
          business_account_id: Number(TEST_USER_ID),
          page_id: TEST_USER_ID,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      )

    if (upsertError) {
      console.error("[test-login] Supabase upsert error:", upsertError)
      return NextResponse.json({ error: upsertError.message }, { status: 500 })
    }

    // ---------------------------------------------------------------
    // Step 2: Sign in to get session cookies on the response
    // ---------------------------------------------------------------
    // Build the response first so the setAll callback can write onto it,
    // same pattern as middleware.ts.
    const response = NextResponse.json({
      success: true,
      username: TEST_USERNAME,
      userId: TEST_USER_ID,
    })

    // Create an anon-key client hooking into the response cookies
    const supabaseAnon = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: async () => request.cookies.getAll(),
          setAll: async (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) => {
              // Write onto the response so the browser actually receives them
              response.cookies.set(name, value, options)
            })
          },
        },
      }
    )

    // Sign in with password — this populates the session, and the cookie
    // setAll callback above writes those session cookies onto the response.
    const { error: signInError } = await supabaseAnon.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    })

    if (signInError) {
      console.error("[test-login] Sign in error:", signInError)
      return NextResponse.json({ error: "Failed to sign in" }, { status: 500 })
    }

    return response
  } catch (error: any) {
    console.error("[test-login] Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
