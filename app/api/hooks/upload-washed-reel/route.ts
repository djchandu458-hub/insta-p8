import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdminClient } from "@/lib/supabase-server"

export async function POST(request: NextRequest) {
    try {
        // 1. Security Check
        const apiSecret = request.headers.get("x-api-secret")
        if (apiSecret !== process.env.API_SECRET_KEY) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        // 2. Parse JSON Body
        const body = await request.json()
        const { videoUrl, caption, instagramAccountId } = body

        if (!videoUrl || !instagramAccountId) {
            return NextResponse.json({ error: "Missing videoUrl or instagramAccountId" }, { status: 400 })
        }

        const supabase = await getSupabaseAdminClient()

        // 3. Verify Instagram account exists
        const { data: igAccount, error: userError } = await supabase
            .from("instagram_accounts")
            .select("id")
            .eq("id", instagramAccountId)
            .single()

        if (userError || !igAccount) {
            return NextResponse.json({ error: "Instagram account not found" }, { status: 404 })
        }

        // 4. Add to Content Pool

        // A. Get current max sequence
        const { data: maxSeqData } = await supabase
            .from("content_pool")
            .select("sequence_index")
            .eq("instagram_account_id", instagramAccountId)
            .order("sequence_index", { ascending: false })
            .limit(1)
            .maybeSingle()

        const nextSequence = (maxSeqData?.sequence_index ?? 0) + 1

        // B. Insert into Pool
        const { data: poolEntry, error: poolError } = await supabase
            .from("content_pool")
            .insert({
                instagram_account_id: instagramAccountId,
                video_url: videoUrl,
                caption: caption || "",
                sequence_index: nextSequence,
                is_active: true
            })
            .select()
            .single()

        if (poolError) {
            throw new Error(`Pool Insert Failed: ${poolError.message}`)
        }

        // C. Ensure Scheduler Config Exists
        await supabase.from("scheduler_config")
            .upsert({
                instagram_account_id: instagramAccountId,
                is_running: true,
                start_time: '09:00',
                end_time: '23:00',
                interval_minutes: 60,
                current_sequence_index: 1
            }, { onConflict: 'instagram_account_id', ignoreDuplicates: true })

        return NextResponse.json({
            success: true,
            message: "Video added to scheduler pool",
            poolId: poolEntry.id,
            sequenceIndex: nextSequence,
            videoUrl
        })

    } catch (error: any) {
        console.error("API Error:", error)
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 })
    }
}
