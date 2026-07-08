import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

/**
 * GET /api/dashboard/stats
 * Returns dashboard statistics for the authenticated user.
 * Uses the Supabase session (anon key + RLS) — no userId param needed.
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await getSupabaseServerClient()

        // 1. Get the authenticated user
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        // 2. Get all Instagram accounts owned by this user
        const { data: accounts } = await supabase
            .from("instagram_accounts")
            .select("id")

        const accountIds = (accounts || []).map(a => a.id)

        if (accountIds.length === 0) {
            return NextResponse.json({
                metrics: { totalAutomations: 0, activeTriggers: 0, audienceReached: 0, messagesSent: 0 },
                recentActivity: []
            })
        }

        // 3. Total Automations across all accounts
        const { count: automationsCount } = await supabase
            .from("automations")
            .select("*", { count: "exact", head: true })
            .in("instagram_account_id", accountIds)

        // 4. Active Triggers
        const { count: activeTriggersCount } = await supabase
            .from("automations")
            .select("*", { count: "exact", head: true })
            .in("instagram_account_id", accountIds)
            .eq("is_active", true)

        // 5. Audience Reached (Total Conversations)
        const { count: audienceCount } = await supabase
            .from("conversations")
            .select("*", { count: "exact", head: true })
            .in("instagram_account_id", accountIds)

        // 6. Messages Sent (where is_from_instagram is false)
        const { count: messagesSentCount } = await supabase
            .from("messages")
            .select("*", { count: "exact", head: true })
            .in("instagram_account_id", accountIds)
            .eq("is_from_instagram", false)

        // 7. Recent Activity (Last 5 bot-sent messages)
        const { data: recentMessages } = await supabase
            .from("messages")
            .select("id, content, created_at, sender_username, conversation_id, recipient:conversations(recipient_username)")
            .in("instagram_account_id", accountIds)
            .eq("is_from_instagram", false)
            .order("created_at", { ascending: false })
            .limit(5)

        return NextResponse.json({
            metrics: {
                totalAutomations: automationsCount || 0,
                activeTriggers: activeTriggersCount || 0,
                audienceReached: audienceCount || 0,
                messagesSent: messagesSentCount || 0,
            },
            recentActivity: recentMessages || []
        })
    } catch (error) {
        console.error("[v0] Dashboard Stats error:", error)
        return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 })
    }
}
