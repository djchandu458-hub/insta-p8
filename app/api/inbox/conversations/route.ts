import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export async function GET(_request: NextRequest) {
    try {
        const supabase = await getSupabaseServerClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

        // Get all instagram accounts for this user
        const { data: accounts } = await supabase
            .from("instagram_accounts")
            .select("id")
            .eq("user_id", user.id)

        const accountIds = (accounts || []).map(a => a.id)
        if (accountIds.length === 0) {
            return NextResponse.json([])
        }

        const { data: conversations, error } = await supabase
            .from("conversations")
            .select("*")
            .in("instagram_account_id", accountIds)
            .order("last_message_at", { ascending: false })

        if (error) throw error

        return NextResponse.json(conversations)
    } catch (error) {
        console.error("[Inbox] Conversations GET error:", error)
        return NextResponse.json({ error: "Failed to fetch conversations" }, { status: 500 })
    }
}
