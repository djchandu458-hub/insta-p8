import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdminClient } from "@/lib/supabase-server"
import { createReelsContainer } from "@/lib/instagram-publishing"

// Vercel: Allow up to 60s execution
export const maxDuration = 60

/**
 * Direct Post — Publishes a reel to Instagram immediately.
 * POST /api/hooks/direct-post
 * Headers: { x-api-secret: YOUR_SECRET }
 * Body: { videoUrl, caption, userId }
 *
 * This is an internal hook protected by API_SECRET_KEY.
 * It uses the admin client (service role) since it's
 * called from server-side jobs, not from the browser.
 */
export async function POST(request: NextRequest) {
    try {
        // 1. Auth
        const apiSecret = request.headers.get("x-api-secret")
        if (apiSecret !== process.env.API_SECRET_KEY) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        // 2. Parse Body
        const { videoUrl, caption, instagramAccountId } = await request.json()
        if (!videoUrl || !instagramAccountId) {
            return NextResponse.json({ error: "Missing videoUrl or instagramAccountId" }, { status: 400 })
        }

        const supabase = await getSupabaseAdminClient()

        // 3. Get Instagram Account's Access Token
        const { data: igAccount, error: userError } = await supabase
            .from("instagram_accounts")
            .select("access_token")
            .eq("id", instagramAccountId)
            .single()

        if (userError || !igAccount?.access_token) {
            return NextResponse.json({ error: "Instagram account not found or no access token" }, { status: 404 })
        }

        // 4. Create Instagram Reels Container
        console.log(`[DirectPost] Creating container for account ${instagramAccountId}`)
        const containerId = await createReelsContainer(igAccount.access_token, videoUrl, caption || "")

        // 5. Return immediately (Client handles polling)
        return NextResponse.json({
            success: true,
            status: "IN_PROGRESS",
            message: "Container created. Poll status endpoint to publish.",
            containerId,
            instagramAccountId
        }, { status: 202 })

    } catch (error: any) {
        console.error("[DirectPost] Error:", error)
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 })
    }
}
