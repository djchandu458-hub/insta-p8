import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export async function GET(_request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Get the user's primary Instagram account
    const { data: accounts } = await supabase
      .from("instagram_accounts")
      .select("id, access_token")
      .eq("user_id", user.id)

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ error: "Instagram not connected" }, { status: 401 })
    }

    const { access_token } = accounts[0]

    // Fetch Media from Instagram Graph API
    const url = `https://graph.instagram.com/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=24&access_token=${access_token}`

    const res = await fetch(url, { cache: 'no-store' })
    const data = await res.json()

    if (data.error) {
      console.error("[v0] Instagram Media Error:", data.error)
      if (data.error.code === 190) {
         return NextResponse.json({ error: "Session Expired. Please re-connect Instagram." }, { status: 401 })
      }
      return NextResponse.json({ error: data.error.message }, { status: 500 })
    }

    return NextResponse.json({ data: data.data || [] })
  } catch (error) {
    console.error("[v0] Server Error:", error)
    return NextResponse.json({ error: "Server Error" }, { status: 500 })
  }
}
