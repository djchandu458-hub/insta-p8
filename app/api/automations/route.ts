import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

/**
 * Helper: returns the authenticated user's Supabase user ID and
 * linked Instagram account IDs. Returns null if unauthenticated.
 */
async function getAuthContext() {
    const supabase = await getSupabaseServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { supabase, userId: null, accountIds: null as number[] | null, error: "Unauthorized" }

    const { data: accounts } = await supabase
        .from("instagram_accounts")
        .select("id")
        .eq("user_id", user.id)

    return {
        supabase,
        userId: user.id,
        accountIds: (accounts || []).map(a => a.id),
        error: null as string | null,
    }
}

export async function GET(_request: NextRequest) {
    try {
        const ctx = await getAuthContext()
        if (!ctx.userId) return NextResponse.json({ error: ctx.error }, { status: 401 })

        const { data, error } = await ctx.supabase
            .from("automations")
            .select("*")
            .in("instagram_account_id", ctx.accountIds!)
            .order("created_at", { ascending: false })

        if (error) throw error
        return NextResponse.json(data)
    } catch (error) {
        console.error("[v0] Automations GET error:", error)
        return NextResponse.json({ error: "Failed to fetch" }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const { name, trigger_source, trigger_type, trigger_value, content, specific_media_id } = await request.json()

        if (!name || !trigger_value || !content || !trigger_source) {
            return NextResponse.json({ error: "Missing fields" }, { status: 400 })
        }

        if (!['comment', 'dm', 'story'].includes(trigger_source)) {
            return NextResponse.json({ error: "Invalid trigger source" }, { status: 400 })
        }

        const ctx = await getAuthContext()
        if (!ctx.userId) return NextResponse.json({ error: ctx.error }, { status: 401 })
        if (!ctx.accountIds!.length) return NextResponse.json({ error: "No Instagram account linked" }, { status: 400 })

        const finalTriggerValue =
            trigger_type === "postback"
                ? `PAYLOAD_${Date.now()}_${Math.random().toString(36).substring(7)}`
                : trigger_value.toLowerCase()

        const { data, error } = await ctx.supabase
            .from("automations")
            .insert({
                instagram_account_id: ctx.accountIds![0],
                name,
                trigger_source,
                trigger_type: trigger_type || "keyword",
                trigger_value: finalTriggerValue,
                response_type: "pro",
                response_content: content,
                is_active: true,
                specific_media_id: specific_media_id || null,
            })
            .select()
            .single()

        if (error) throw error
        return NextResponse.json(data)
    } catch (error) {
        console.error("[v0] Automations POST error:", error)
        return NextResponse.json({ error: "Failed to create" }, { status: 500 })
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const id = request.nextUrl.searchParams.get("id")
        if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

        const ctx = await getAuthContext()
        if (!ctx.userId) return NextResponse.json({ error: ctx.error }, { status: 401 })

        const { error } = await ctx.supabase
            .from("automations")
            .delete()
            .eq("id", id)
            .in("instagram_account_id", ctx.accountIds!)

        if (error) throw error
        return NextResponse.json({ success: true })
    } catch (error) {
        console.error("[v0] Automations DELETE error:", error)
        return NextResponse.json({ error: "Failed to delete" }, { status: 500 })
    }
}

export async function PUT(request: NextRequest) {
    try {
        const { id, name, trigger_source, trigger_type, trigger_value, content, specific_media_id } = await request.json()

        if (!id || !name || !trigger_value || !content) {
            return NextResponse.json({ error: "Missing fields" }, { status: 400 })
        }

        if (trigger_source && !['comment', 'dm', 'story'].includes(trigger_source)) {
            return NextResponse.json({ error: "Invalid trigger source" }, { status: 400 })
        }

        const ctx = await getAuthContext()
        if (!ctx.userId) return NextResponse.json({ error: ctx.error }, { status: 401 })

        const updateData: Record<string, unknown> = {
            name,
            trigger_type: trigger_type || "keyword",
            trigger_value: trigger_value.toLowerCase(),
            response_content: content,
            specific_media_id: specific_media_id || null,
        }

        if (trigger_source) updateData.trigger_source = trigger_source

        const { data, error } = await ctx.supabase
            .from("automations")
            .update(updateData)
            .eq("id", id)
            .in("instagram_account_id", ctx.accountIds!)
            .select()
            .single()

        if (error) throw error
        return NextResponse.json(data)
    } catch (error) {
        console.error("[v0] Automations PUT error:", error)
        return NextResponse.json({ error: "Failed to update" }, { status: 500 })
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const { id, is_active, action } = await request.json()
        if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

        const ctx = await getAuthContext()
        if (!ctx.userId) return NextResponse.json({ error: ctx.error }, { status: 401 })

        if (action === "duplicate") {
            const { data: original, error: fetchError } = await ctx.supabase
                .from("automations")
                .select("*")
                .eq("id", id)
                .in("instagram_account_id", ctx.accountIds!)
                .single()
            if (fetchError || !original) return NextResponse.json({ error: "Not found" }, { status: 404 })

            const { id: _id, created_at, updated_at, ...rest } = original
            const { data, error } = await ctx.supabase
                .from("automations")
                .insert({ ...rest, name: `${original.name} (copy)`, is_active: false })
                .select()
                .single()
            if (error) throw error
            return NextResponse.json(data)
        }

        if (typeof is_active !== "boolean") {
            return NextResponse.json({ error: "Missing is_active" }, { status: 400 })
        }

        const { data, error } = await ctx.supabase
            .from("automations")
            .update({ is_active })
            .eq("id", id)
            .in("instagram_account_id", ctx.accountIds!)
            .select()
            .single()

        if (error) throw error
        return NextResponse.json(data)
    } catch (error) {
        console.error("[v0] Automations PATCH error:", error)
        return NextResponse.json({ error: "Failed to update" }, { status: 500 })
    }
}
