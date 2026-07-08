import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export async function GET(request: NextRequest) {
    try {
        const conversationId = request.nextUrl.searchParams.get("conversationId")
        if (!conversationId) return NextResponse.json({ error: "Missing conversationId" }, { status: 400 })

        const supabase = await getSupabaseServerClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

        // Verify the conversation belongs to this user via their instagram_accounts
        const { data: accounts } = await supabase
            .from("instagram_accounts")
            .select("id")
            .eq("user_id", user.id)

        const accountIds = (accounts || []).map(a => a.id)
        if (accountIds.length === 0) return NextResponse.json({ error: "No accounts" }, { status: 403 })

        // Verify ownership before fetching messages
        const { data: conv } = await supabase
            .from("conversations")
            .select("id")
            .eq("id", conversationId)
            .in("instagram_account_id", accountIds)
            .single()

        if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })

        const { data: messages, error } = await supabase
            .from("messages")
            .select("*")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true })

        if (error) throw error

        return NextResponse.json(messages)
    } catch (error) {
        console.error("[Inbox] Messages GET error:", error)
        return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 })
    }
}
