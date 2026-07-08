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

        if (!accounts || accounts.length === 0) return NextResponse.json(null)

        const { data, error } = await supabase
            .from("scheduler_config")
            .select("*")
            .eq("instagram_account_id", accounts[0].id)
            .maybeSingle()

        if (error) throw error
        return NextResponse.json(data)
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { is_running, interval_minutes, start_time, end_time } = body

        const supabase = await getSupabaseServerClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

        const { data: accounts } = await supabase
            .from("instagram_accounts")
            .select("id")
            .eq("user_id", user.id)

        if (!accounts || accounts.length === 0) {
            return NextResponse.json({ error: "No Instagram account linked" }, { status: 400 })
        }

        const updates: Record<string, unknown> = {
            is_running,
            interval_minutes,
            start_time,
            end_time,
            updated_at: new Date().toISOString()
        }

        const { data, error } = await supabase
            .from("scheduler_config")
            .upsert({ instagram_account_id: accounts[0].id, ...updates })
            .select()
            .single()

        if (error) throw error
        return NextResponse.json(data)
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
