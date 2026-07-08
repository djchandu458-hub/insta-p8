import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdminClient } from "@/lib/supabase-server"
import { createReelsContainer, getContainerStatus, publishContainer } from "@/lib/instagram-publishing"

// Helper to wait
const delay = (ms: number) => new Promise(res => setTimeout(res, ms))

export async function GET(request: NextRequest) {
    // Security check: verify the Cron-Secret header
    const authHeader = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = await getSupabaseAdminClient()
    const results = []

    try {
        // 1. Get Due Schedules
        const force = request.nextUrl.searchParams.get("force") === "true"

        let query = supabase
            .from("scheduler_config")
            .select("*")
            .eq("is_running", true)

        if (!force) {
            query = query.lte("next_run_at", new Date().toISOString())
        }

        const { data: configs } = await query

        if (!configs || configs.length === 0) {
            return NextResponse.json({ message: "No schedules due", ran: 0 })
        }

        for (const config of configs) {
            const log = { instagram_account_id: config.instagram_account_id, status: 'skipped' as string, reason: '' }

            try {
                // 2. Validate Time Window
                const now = new Date()
                const currentHour = now.getHours()
                const currentMinute = now.getMinutes()
                const currentTimeVal = currentHour * 60 + currentMinute

                // Parse Window
                const [startH, startM] = (config.start_time || "09:00").split(':').map(Number)
                const [endH, endM] = (config.end_time || "21:00").split(':').map(Number)
                const startTimeVal = startH * 60 + startM
                const endTimeVal = endH * 60 + endM

                const isInside = currentTimeVal >= startTimeVal && currentTimeVal <= endTimeVal

                if (!isInside) {
                    log.reason = `Outside window (${config.start_time}-${config.end_time})`
                    // Calculate next valid time
                    let nextValid = new Date()
                    if (currentTimeVal > endTimeVal) {
                        // Too late, move to tomorrow start
                        nextValid.setDate(nextValid.getDate() + 1)
                        nextValid.setHours(startH, startM, 0, 0)
                    } else {
                        // Too early, create date for today start
                        nextValid.setHours(startH, startM, 0, 0)
                    }

                    await supabase
                        .from("scheduler_config")
                        .update({ next_run_at: nextValid.toISOString() })
                        .eq("instagram_account_id", config.instagram_account_id)

                    results.push(log)
                    continue
                }

                // 3. Get Instagram Account Token
                const { data: igAccount } = await supabase
                    .from("instagram_accounts")
                    .select("access_token")
                    .eq("id", config.instagram_account_id)
                    .single()

                if (!igAccount?.access_token) {
                    log.status = 'error'; log.reason = 'No token';
                    results.push(log); continue;
                }

                // 4. Select Content (Rotator Logic)
                let { data: clip } = await supabase
                    .from("content_pool")
                    .select("*")
                    .eq("instagram_account_id", config.instagram_account_id)
                    .eq("is_active", true)
                    .gte("sequence_index", config.current_sequence_index)
                    .order("sequence_index", { ascending: true })
                    .limit(1)
                    .maybeSingle()

                // If no clip found (end of list), Loop back to 1
                if (!clip) {
                    const { data: firstClip } = await supabase
                        .from("content_pool")
                        .select("*")
                        .eq("instagram_account_id", config.instagram_account_id)
                        .eq("is_active", true)
                        .order("sequence_index", { ascending: true })
                        .limit(1)
                        .maybeSingle()

                    clip = firstClip
                }

                if (!clip) {
                    log.status = 'error'; log.reason = 'Pool empty';
                    const nextTime = new Date(Date.now() + (config.interval_minutes * 60000))
                    await supabase.from("scheduler_config")
                        .update({ next_run_at: nextTime.toISOString() })
                        .eq("instagram_account_id", config.instagram_account_id)
                    results.push(log); continue;
                }

                // 5. Publish to Instagram
                console.log(`[Scheduler] Posting Clip #${clip.sequence_index} for Account ${config.instagram_account_id}`)

                // A. Create Container
                const containerId = await createReelsContainer(igAccount.access_token, clip.video_url, clip.caption)

                // B. Wait for Processing (Simple Polling)
                let status = 'IN_PROGRESS'
                let attempts = 0
                while (status === 'IN_PROGRESS' && attempts < 24) {
                    await delay(5000)
                    status = await getContainerStatus(igAccount.access_token, containerId)
                    attempts++
                }

                if (status !== 'FINISHED') {
                    throw new Error(`Media processing failed or timed out after 2 minutes. Final Status: ${status}`)
                }

                // C. Publish
                const mediaId = await publishContainer(igAccount.access_token, containerId)

                // 6. Log Success
                log.status = 'success'
                await supabase.from("reels_posts").insert({
                    instagram_account_id: config.instagram_account_id,
                    content_pool_id: clip.id,
                    video_url: clip.video_url,
                    caption: clip.caption,
                    ig_container_id: containerId,
                    ig_media_id: mediaId,
                    status: 'PUBLISHED',
                    published_at: new Date().toISOString()
                })

                // 7. Update Scheduler State
                const nextIndex = clip.sequence_index + 1
                const nextRunTime = new Date(Date.now() + (config.interval_minutes * 60000))

                await supabase.from("scheduler_config").update({
                    current_sequence_index: nextIndex,
                    next_run_at: nextRunTime.toISOString(),
                    last_run_at: new Date().toISOString()
                }).eq("instagram_account_id", config.instagram_account_id)

                results.push(log)

            } catch (err: any) {
                console.error(`[Scheduler] Error for account ${config.instagram_account_id}:`, err)
                const retryTime = new Date(Date.now() + 15 * 60000)
                await supabase.from("scheduler_config")
                    .update({ next_run_at: retryTime.toISOString() })
                    .eq("instagram_account_id", config.instagram_account_id)

                await supabase.from("reels_posts").insert({
                    instagram_account_id: config.instagram_account_id,
                    status: 'FAILED',
                    error_message: err.message
                })
                results.push({ instagram_account_id: config.instagram_account_id, status: 'error', reason: err.message })
            }
        }

        return NextResponse.json({ processed: results.length, details: results })

    } catch (error: any) {
        console.error("[Scheduler] Critical Error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
