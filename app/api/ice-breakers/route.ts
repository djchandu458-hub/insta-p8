import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export async function GET(_request: NextRequest) {
    try {
        const supabase = await getSupabaseServerClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

        const { data: accounts } = await supabase
            .from("instagram_accounts")
            .select("id")
            .eq("user_id", user.id)

        const accountIds = (accounts || []).map(a => a.id)
        if (accountIds.length === 0) return NextResponse.json([])

        const { data, error } = await supabase
            .from("ice_breakers")
            .select("*")
            .in("instagram_account_id", accountIds)
            .order("created_at", { ascending: true })

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error("Ice Breaker GET Error:", error)
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { iceBreakers } = body // Array of ice breakers

        if (!Array.isArray(iceBreakers)) {
            return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
        }

        const supabase = await getSupabaseServerClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

        const { data: accounts } = await supabase
            .from("instagram_accounts")
            .select("id, access_token, page_id, ig_username")
            .eq("user_id", user.id)

        if (!accounts || accounts.length === 0) {
            return NextResponse.json({ error: "No Instagram account linked" }, { status: 400 })
        }

        const igAccount = accounts[0]

        // Delete all existing ice breakers for this account and re-insert
        const { error: deleteError } = await supabase
            .from("ice_breakers")
            .delete()
            .eq("instagram_account_id", igAccount.id)

        if (deleteError) throw deleteError

        const { data: inserted, error: insertError } = await supabase
            .from("ice_breakers")
            .insert(iceBreakers.map((ib: { question: string; response: string }) => ({
                instagram_account_id: igAccount.id,
                question: ib.question,
                response: ib.response,
                is_active: true
            })))
            .select()

        if (insertError) throw insertError

        // Sync to Instagram
        if (igAccount.access_token && igAccount.page_id) {
            const ice_breakers = (inserted || []).map((ib: { id: string; question: string }) => ({
                question: ib.question,
                payload: `ICE_BREAKER_${ib.id}`
            }))

            await fetch(
                `https://graph.instagram.com/v21.0/me/messenger_profile?access_token=${igAccount.access_token}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        ice_breakers: ice_breakers,
                        platform: "instagram"
                    })
                }
            )
        }

        return NextResponse.json({ success: true, data: inserted })

    } catch (error) {
        console.error("Ice Breaker POST Error:", error)
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
    }
}
