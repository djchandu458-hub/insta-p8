/**
 * Migration script: public.users → instagram_accounts + auth.users
 *
 * For each row in the old public.users table:
 *   1. Create an auth.users entry via supabase.auth.admin.createUser()
 *      (using a placeholder email so Supabase internal triggers work)
 *   2. Insert a row into instagram_accounts linked to the new auth.users id
 *
 * Run with (loads .env.local automatically):
 *   npx tsx --env-file=.env.local scripts/migrate-users-to-instagram-accounts.ts
 *
 * Prerequisites:
 *   - .env.local must have NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   - Part 1 of the migration SQL must have been run (instagram_accounts table exists)
 */

import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

interface OldUser {
  id: number | string
  username: string
  access_token: string
  token_expires_at: string | null
  business_account_id: number | string | null
  page_id: string | null
  groq_auto_reply_enabled: boolean
  ai_context: string | null
  created_at: string
  updated_at: string
}

async function migrate() {
  console.log("📋 Reading old users...")

  const { data: oldUsers, error: fetchError } = await supabase
    .from("users")
    .select("*")

  if (fetchError) {
    console.error("Failed to fetch old users:", fetchError)
    process.exit(1)
  }

  if (!oldUsers || oldUsers.length === 0) {
    console.log("No users to migrate.")
    return
  }

  console.log(`Found ${oldUsers.length} user(s) to migrate.\n`)

  let migrated = 0
  let skipped = 0

  for (const oldUser of oldUsers as OldUser[]) {
    const igId = String(oldUser.id)
    const username = oldUser.username || `ig_${igId}`
    const placeholderEmail = `ig_${igId}@migrated.insta-p8.app`

    // Check if this instagram_account already exists (idempotent)
    const { data: existing } = await supabase
      .from("instagram_accounts")
      .select("id")
      .eq("id", igId)
      .single()

    if (existing) {
      console.log(`  ⏭️  Instagram account ${igId} (${username}) already migrated — skipping`)
      skipped++
      continue
    }

    // Step 1: Create auth.users entry via Admin API
    // This is the correct approach — raw INSERT into auth.users violates
    // internal constraints and triggers
    console.log(`  👤 Creating auth user for ${username}...`)
    const { data: newUser, error: createUserError } = await supabase.auth.admin.createUser({
      email: placeholderEmail,
      password: undefined, // No password — user will set one via "forgot password"
      email_confirm: true,
      user_metadata: {
        migrated_from_instagram: true,
        instagram_username: username,
        instagram_user_id: igId,
      },
    })

    if (createUserError) {
      console.error(`  ❌ Failed to create auth user for ${username}:`, createUserError.message)
      skipped++
      continue
    }

    if (!newUser?.user?.id) {
      console.error(`  ❌ No user ID returned for ${username}`)
      skipped++
      continue
    }

    const authUserId = newUser.user.id
    console.log(`  ✅ Created auth user: ${authUserId}`)

    // Step 2: Insert into instagram_accounts
    const { error: insertError } = await supabase.from("instagram_accounts").insert({
      id: igId,
      user_id: authUserId,
      ig_username: username,
      access_token: oldUser.access_token,
      token_expires_at: oldUser.token_expires_at,
      business_account_id: oldUser.business_account_id ? Number(oldUser.business_account_id) : null,
      page_id: oldUser.page_id,
      groq_auto_reply_enabled: oldUser.groq_auto_reply_enabled ?? false,
      ai_context: oldUser.ai_context,
    })

    if (insertError) {
      console.error(`  ❌ Failed to insert instagram_account for ${username}:`, insertError.message)
      // Roll back the auth user
      await supabase.auth.admin.deleteUser(authUserId)
      skipped++
      continue
    }

    console.log(`  ✅ Migrated ${username} (ig_id=${igId}) → auth_user=${authUserId}`)
    migrated++
  }

  console.log(`\n📊 Done: ${migrated} migrated, ${skipped} skipped`)
}

migrate().catch((err) => {
  console.error("Migration failed:", err)
  process.exit(1)
})
