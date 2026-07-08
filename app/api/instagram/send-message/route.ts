import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

/**
 * POST /api/instagram/send-message
 * Send a DM reply to an Instagram user, authenticated via Supabase session.
 */
export async function POST(request: NextRequest) {
  try {
    const { recipient_id, message } = await request.json()

    if (!recipient_id || !message) {
      return NextResponse.json({ error: "Missing required fields: recipient_id, message" }, { status: 400 })
    }

    const supabase = await getSupabaseServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: accounts } = await supabase
      .from("instagram_accounts")
      .select("id, access_token, ig_username, business_account_id")
      .eq("user_id", user.id)

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ error: "Instagram not connected" }, { status: 404 })
    }

    const igAccount = accounts[0]
    const sendUrl = `https://graph.instagram.com/v24.0/me/messages?access_token=${encodeURIComponent(igAccount.access_token)}`

    const response = await fetch(sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipient_id.toString() },
        message: { text: message },
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error("[v0] Failed to send message:", data)
      return NextResponse.json({ error: data.error?.message || "Failed to send message" }, { status: 400 })
    }

    // Log the sent message in the database
    const { data: conversation } = await supabase
      .from("conversations")
      .select("id")
      .eq("instagram_account_id", igAccount.id)
      .eq("recipient_id", recipient_id)
      .single()

    if (conversation) {
      await supabase.from("messages").insert({
        id: data.message_id,
        conversation_id: conversation.id,
        instagram_account_id: igAccount.id,
        sender_id: String(igAccount.business_account_id || igAccount.id),
        sender_username: igAccount.ig_username,
        content: message,
        is_from_instagram: false,
      })
    }

    return NextResponse.json({ success: true, message_id: data.message_id })
  } catch (error) {
    console.error("[v0] Send message error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
