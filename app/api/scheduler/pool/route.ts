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

        if (!accounts || accounts.length === 0) return NextResponse.json([])

        const { data, error } = await supabase
            .from("content_pool")
            .select("*")
            .eq("instagram_account_id", accounts[0].id)
            .eq("is_active", true)
            .order("sequence_index", { ascending: true })

        if (error) throw error
        return NextResponse.json(data)
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { video_url, caption, cover_url } = body

        if (!video_url) return NextResponse.json({ error: "Missing video_url" }, { status: 400 })

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

        const igAccountId = accounts[0].id

        // Get current max sequence for this account
        const { data: maxContent } = await supabase
            .from("content_pool")
            .select("sequence_index")
            .eq("instagram_account_id", igAccountId)
            .order("sequence_index", { ascending: false })
            .limit(1)
            .maybeSingle()

        const nextSeq = (maxContent?.sequence_index || 0) + 1

        const { data, error } = await supabase
            .from("content_pool")
            .insert({
                instagram_account_id: igAccountId,
                video_url,
                caption,
                sequence_index: nextSeq,
                cover_url: cover_url || null
            })
            .select()
            .single()

        if (error) throw error
        return NextResponse.json(data)
    } catch (err: any) {
        console.error("Pool Error:", err)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const id = request.nextUrl.searchParams.get("id")
        if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

        const supabase = await getSupabaseServerClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

        const { error } = await supabase
            .from("content_pool")
            .delete()
            .eq("id", id)
            .in("instagram_account_id", (await supabase.from("instagram_accounts").select("id").eq("user_id", user.id)).data?.map(a => a.id) || [])

        if (error) throw error
        return NextResponse.json({ success: true })
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
