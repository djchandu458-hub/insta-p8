import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { recipientId, message, attachment } = body

        if (!recipientId || (!message && !attachment)) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
        }

        const supabase = await getSupabaseServerClient()

        // 1. Get the authenticated user
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

        // 2. Get the user's Instagram account (use primary/first for now)
        const { data: igAccounts } = await supabase
            .from("instagram_accounts")
            .select("id, access_token, ig_username, business_account_id")
            .eq("user_id", user.id)

        if (!igAccounts || igAccounts.length === 0) {
            return NextResponse.json({ error: "No Instagram account linked" }, { status: 400 })
        }

        const igAccount = igAccounts[0]

        // 3. Prepare Payload for Instagram API
        const apiBody: Record<string, unknown> = { recipient: { id: recipientId } }

        if (message) {
            apiBody.message = { text: message }
        } else if (attachment) {
            apiBody.message = { attachment }
        }

        // 4. Send to Instagram
        const res = await fetch(
            `https://graph.instagram.com/v24.0/me/messages?access_token=${igAccount.access_token}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(apiBody)
            }
        )

        const data = await res.json()

        if (data.error) {
            console.error("[Inbox Send] Instagram API Error:", data.error)
            return NextResponse.json({ error: data.error.message }, { status: 500 })
        }

        // 5. Log to Database (Outbound Message)
        let { data: conv } = await supabase
            .from("conversations")
            .select("id")
            .eq("instagram_account_id", igAccount.id)
            .eq("recipient_id", recipientId)
            .single()

        if (conv) {
            await supabase.from("messages").insert({
                id: `mid_out_${Date.now()}_${Math.random()}`,
                conversation_id: conv.id,
                instagram_account_id: igAccount.id,
                sender_id: String(igAccount.business_account_id || igAccount.id),
                sender_username: igAccount.ig_username,
                content: message || "[Attachment]",
                is_from_instagram: false
            })

            await supabase
                .from("conversations")
                .update({ last_message_at: new Date().toISOString() })
                .eq("id", conv.id)
        }

        return NextResponse.json({ success: true, data })

    } catch (error) {
        console.error("[Inbox Send] Internal Error:", error)
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
    }
}
