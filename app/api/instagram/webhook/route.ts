import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseAdminClient } from "@/lib/supabase-server"
import {
  sendTextDM,
  sendCardDM,
  sendMediaDM,
  sendSenderAction,
  replyToComment,
  fetchProfile,
  verifyIdOwnership,
  sleep,
} from "@/lib/instagram-api"
import crypto from "node:crypto"

const WEBHOOK_VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "your_verify_token"
const INSTAGRAM_APP_SECRET = process.env.INSTAGRAM_APP_SECRET || ""

const DEFAULT_PUBLIC_REPLIES = ["Check your DMs! 📥", "Sent! 🔥", "Check inbox! ✨"]

// ---------- Types ----------
interface InstagramEntry {
  id: string
  time?: number
  changes?: InstagramChange[]
  messaging?: InstagramMessagingEvent[]
}

interface InstagramChange {
  field?: string
  value?: {
    id?: string
    text?: string
    from?: { id?: string; username?: string }
    media?: { id?: string; owner?: { id?: string } }
    parent_id?: string
  }
}

interface InstagramMessagingEvent {
  sender?: { id: string }
  recipient?: { id: string }
  timestamp?: number
  message?: {
    mid?: string
    text?: string
    is_echo?: boolean
    quick_reply?: { payload: string }
    attachments?: Array<{ type: string; payload?: { url?: string } }>
    reply_to?: { story?: { id?: string } }
  }
  postback?: { payload: string; title?: string }
  reaction?: { mid?: string; emoji?: string }
  read?: Record<string, unknown>
  delivery?: Record<string, unknown>
}

interface AutomationRecord {
  id: string
  instagram_account_id: string | number
  name: string
  trigger_type: string
  trigger_value: string
  response_type: string
  response_content: unknown
  media_selection: unknown
  selected_reel_id: string | null
  specific_media_id: string | null
  trigger_source: string
  follow_up_steps: unknown
  is_active: boolean
  created_at: string
  updated_at: string
}

interface InstagramAccount {
  id: string | number
  user_id: string
  ig_username: string
  access_token: string
  token_expires_at: string | null
  business_account_id: number | null
  page_id: string | null
  groq_auto_reply_enabled: boolean
  ai_context: string | null
}

// ---------- Webhook verification ----------
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: "Invalid token" }, { status: 403 })
}

// ============================================================
// Content parsing — response_content may be object or JSON string
// ============================================================
function parseContent(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw)
    } catch {
      return { message: raw }
    }
  }
  return raw as Record<string, unknown>
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function keywordMatches(triggerValue: string, text: string): boolean {
  return triggerValue
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .some((k) => {
      try {
        return new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)
      } catch {
        return text.includes(k.toLowerCase())
      }
    })
}

// ============================================================
// Unified response sender
// ============================================================
async function sendAutomationResponse(
  token: string,
  recipient: { id?: string; comment_id?: string },
  content: Record<string, unknown>,
  opts: { skipTyping?: boolean } = {},
) {
  const delaySeconds = Number(content.delay_seconds) || 0
  const useTyping = content.typing_indicator === true && recipient.id && !opts.skipTyping

  if (useTyping) await sendSenderAction(token, recipient.id!, "typing_on")
  if (delaySeconds > 0) await sleep(delaySeconds * 1000)

  const quickReplies = Array.isArray(content.quick_replies)
    ? (content.quick_replies as Array<{ title: string; payload?: string }>)
        .filter((q) => q?.title)
        .map((q) => ({ title: q.title, payload: q.payload || `QR_${q.title.toUpperCase().replace(/\s+/g, "_")}` }))
    : undefined

  let result
  const media = content.media as { url?: string; type?: string } | undefined
  if (media?.url) {
    result = await sendMediaDM(token, recipient, (media.type as "image" | "video" | "audio") || "image", media.url)
    if (result.ok && content.message) {
      result = await sendTextDM(token, recipient, content.message as string, quickReplies)
    }
  } else if (content.card) {
    const card = content.card as { title?: string; subtitle?: string; image_url?: string; buttons?: Array<{ type?: string; title?: string; url?: string; payload?: string }> }
    result = await sendCardDM(token, recipient, {
      title: card.title || "",
      subtitle: card.subtitle,
      image_url: card.image_url,
      buttons: (card.buttons || []).map((b) => ({
        type: (b.type as "web_url" | "postback") || "postback",
        title: b.title || "",
        url: b.url,
        payload: b.payload,
      })),
    })
  } else if (content.message) {
    result = await sendTextDM(token, recipient, content.message as string, quickReplies)
  } else {
    result = { ok: false, error: "empty content" }
  }

  if (useTyping) await sendSenderAction(token, recipient.id!, "typing_off")
  return result
}

function responsePreviewText(content: Record<string, unknown>): string {
  if (content.message) return content.message as string
  if (content.card) return `[Card] ${(content.card as Record<string, unknown>).title || ""}`
  const media = content.media as { url?: string; type?: string } | undefined
  if (media?.url) return `[${media.type || "media"}]`
  return "[automation]"
}

// ============================================================
// POST — inbound webhook events
// ============================================================
export async function POST(request: NextRequest) {
  try {
    // ---- Step 1: Signature verification ----
    const signature = request.headers.get("x-hub-signature-256")
    if (!signature || !INSTAGRAM_APP_SECRET) {
      console.warn("[webhook] Missing or invalid signature — rejecting")
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
    }

    const rawBody = await request.clone().text()
    const expectedSig = crypto
      .createHmac("sha256", INSTAGRAM_APP_SECRET)
      .update(rawBody)
      .digest("hex")

    if (signature !== `sha256=${expectedSig}`) {
      console.warn("[webhook] Signature mismatch — rejecting")
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
    }

    const body = JSON.parse(rawBody)
    if (!body.entry) return NextResponse.json({ ok: true })

    // Admin client — service-role bypasses RLS, needed for cross-account resolution
    const supabase = await getSupabaseAdminClient()

    for (const entry of body.entry as InstagramEntry[]) {
      // Skip pure system events (echo / read / delivery)
      if (entry.messaging) {
        const isSystemEvent = entry.messaging.every(
          (event) => event.read || event.delivery || (event.message && event.message.is_echo),
        )
        if (isSystemEvent) continue
      }

      const webhookId = entry.id

      // ---------- User resolution: via instagram_accounts ----------
      let account: InstagramAccount | null = null

      // Strategy 1: Direct match by business_account_id or page_id
      const { data: directAccount } = await supabase
        .from("instagram_accounts")
        .select("*")
        .or(`business_account_id.eq.${webhookId},page_id.eq.${webhookId}`)
        .maybeSingle()

      if (directAccount) {
        account = directAccount as InstagramAccount
      }

      // Strategy 2: Candidate fallback — collect IDs from payload, query each
      if (!account) {
        const candidateIds = new Set<string>()
        if (entry.changes) {
          for (const change of entry.changes) {
            if (change.value?.media?.owner?.id) candidateIds.add(String(change.value.media.owner.id))
          }
        }
        if (entry.messaging) {
          for (const event of entry.messaging) {
            if (event.recipient?.id) candidateIds.add(String(event.recipient.id))
          }
        }
        for (const candidateId of candidateIds) {
          if (candidateId === webhookId) continue
          const { data: fallbackAccount } = await supabase
            .from("instagram_accounts")
            .select("*")
            .or(`business_account_id.eq.${candidateId},page_id.eq.${candidateId}`)
            .maybeSingle()
          if (fallbackAccount) {
            // 🔒 Stop auto-mutating page_id — just flag it for human review
            console.warn(
              `[webhook] ⚠️ Matching account found via candidate ${candidateId} for webhook ${webhookId}, ` +
              `but page_id mismatch. This may indicate a routing issue. Account: ${fallbackAccount.id}`
            )
            account = fallbackAccount as InstagramAccount
            break
          }
        }
      }

      // Strategy 3: Token verification — O(n) full scan, last resort
      if (!account) {
        const { data: allAccounts } = await supabase
          .from("instagram_accounts")
          .select("*")

        if (allAccounts) {
          for (const candidate of allAccounts as InstagramAccount[]) {
            if (!candidate.access_token) continue
            if (await verifyIdOwnership(candidate.access_token, webhookId)) {
              // 🔒 Do NOT auto-mutate page_id — flag for review instead
              console.warn(
                `[webhook] ⚠️ Token-verified match for webhook ${webhookId} to account ${candidate.id}. ` +
                `page_id NOT auto-updated — review manually.`
              )
              account = candidate
              break
            }
          }
        }
      }

      if (!account) {
        console.log(`[webhook] ❌ Could not resolve account for ID ${webhookId}`)
        continue
      }

      // Log the webhook event
      await supabase.from("webhook_events").insert({
        event_type: entry.changes ? "changes" : "messaging",
        instagram_account_id: account.id,
        data: body,
      })

      // Fetch automations for this instagram account
      const { data: automations } = await supabase
        .from("automations")
        .select("*")
        .eq("instagram_account_id", account.id)
        .eq("is_active", true)

      if (!automations?.length) continue

      // Cast to proper type
      const typedAutomations = automations as AutomationRecord[]

      // ============================================================
      //  PART A: COMMENTS
      // ============================================================
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field !== "comments" || !change.value?.text) continue

          const commentId = change.value.id
          const commentText = change.value.text.toLowerCase().trim()
          const senderId = change.value.from?.id
          const mediaId = change.value.media?.id
          const parentId = change.value.parent_id || null

          if (!senderId || !mediaId) continue
          if (senderId === String(account.business_account_id) || senderId === account.page_id) continue

          const commentAutomations = typedAutomations.filter(
            (a) => a.trigger_source === "comment"
          )

          // Priority: specific post reply-all → specific post keyword → global keyword
          let match: AutomationRecord | undefined = commentAutomations.find(
            (a) => a.specific_media_id === mediaId && a.trigger_type === "reply_all",
          )
          if (!match) {
            match = commentAutomations.find(
              (a) =>
                a.specific_media_id === mediaId &&
                a.trigger_type === "keyword" &&
                keywordMatches(a.trigger_value, commentText),
            )
          }
          if (!match) {
            match = commentAutomations.find(
              (a) =>
                !a.specific_media_id &&
                a.trigger_type === "keyword" &&
                keywordMatches(a.trigger_value, commentText),
            )
          }
          if (!match) continue

          const content = parseContent(match.response_content)

          // Skip nested replies unless user opted in
          if (parentId && content.include_replies !== true) continue

          console.log(`[webhook] ✅ Comment match: "${match.name}"`)

          const replyMode = content.reply_mode || "both"

          if (replyMode !== "dm_only") {
            const pool =
              Array.isArray(content.public_replies) &&
              (content.public_replies as string[]).filter(Boolean).length > 0
                ? (content.public_replies as string[]).filter(Boolean)
                : DEFAULT_PUBLIC_REPLIES
            await replyToComment(account.access_token, commentId!, pickRandom(pool))
          }

          if (replyMode !== "public_only") {
            await sendAutomationResponse(
              account.access_token,
              { comment_id: commentId },
              content,
              { skipTyping: true },
            )
          }
        }
      }

      // ============================================================
      //  PART A.5: STORY AUTOMATIONS
      // ============================================================
      if (entry.messaging) {
        for (const event of entry.messaging) {
          const senderId = event.sender?.id
          const recipientId = event.recipient?.id
          if (!senderId || !recipientId) continue
          if (event.read || event.delivery || event.message?.is_echo || senderId === recipientId) continue

          const storyAutomations = typedAutomations.filter((a) => a.trigger_source === "story")
          if (storyAutomations.length === 0) continue

          let match: AutomationRecord | null = null
          let storyMediaId: string | null = null

          if (event.message?.attachments?.[0]?.type === "story_mention") {
            storyMediaId = event.message.attachments[0].payload?.url || null
            match = storyAutomations.find(
              (a) => a.trigger_type === "mention" && (!a.specific_media_id || a.specific_media_id === storyMediaId),
            ) || null
          } else if (event.reaction) {
            const reactionEmoji = event.reaction.emoji
            storyMediaId = event.reaction.mid || null
            match = storyAutomations.find((a) => {
              if (a.trigger_type !== "reaction") return false
              if (a.specific_media_id && a.specific_media_id !== storyMediaId) return false
              const triggers = a.trigger_value?.split(",").map((t) => t.trim()) || []
              if (triggers.length > 0 && triggers[0] !== "ALL" && triggers[0] !== "ALL_REACTIONS" && triggers[0] !== "") {
                return triggers.includes(reactionEmoji || "")
              }
              return true
            }) || null
          } else if (event.message?.reply_to?.story) {
            const messageText = event.message.text || ""
            storyMediaId = event.message.reply_to.story.id || null
            match = storyAutomations.find((a) => {
              if (a.trigger_type !== "reply") return false
              if (a.specific_media_id && a.specific_media_id !== storyMediaId) return false
              const triggers = a.trigger_value?.split(",").map((t) => t.trim()) || []
              if (triggers.length > 0 && triggers[0] !== "ALL" && triggers[0] !== "ALL_MENTIONS" && triggers[0] !== "") {
                return keywordMatches(a.trigger_value, messageText)
              }
              return true
            }) || null
          }

          if (match) {
            console.log(`[webhook] ✨ Story match: "${match.name}"`)
            const content = parseContent(match.response_content)
            await sendAutomationResponse(account.access_token, { id: senderId }, content)
          }
        }
      }

      // ============================================================
      //  PART B: DIRECT MESSAGES
      // ============================================================
      if (entry.messaging) {
        for (const event of entry.messaging) {
          if (event.read || event.delivery || event.reaction || event.message?.is_echo) continue

          const senderId = event.sender?.id
          if (!senderId) continue
          if (senderId === String(account.business_account_id) || senderId === account.page_id) continue

          let triggerType = ""
          let triggerValue = ""

          if (event.message?.quick_reply?.payload) {
            triggerType = "postback"
            triggerValue = event.message.quick_reply.payload
          } else if (event.message?.text) {
            triggerType = "keyword"
            triggerValue = event.message.text.toLowerCase().trim()
          } else if (event.postback?.payload) {
            triggerType = "postback"
            triggerValue = event.postback.payload
          } else {
            continue
          }

          console.log(`[webhook] 📩 DM from ${senderId}: "${triggerValue}"`)

          // ---------- Persist conversation + incoming message ----------
          let conv: { id: string } | null = null
          try {
            const { data: existing } = await supabase
              .from("conversations")
              .select("id")
              .eq("instagram_account_id", account.id)
              .eq("recipient_id", senderId)
              .maybeSingle()

            if (!existing) {
              let realUsername = `cnt_${senderId.slice(0, 5)}...`
              const profile = await fetchProfile(account.access_token, senderId)
              if (profile?.username) realUsername = profile.username

              const { data: newConv } = await supabase
                .from("conversations")
                .insert({
                  instagram_account_id: account.id,
                  recipient_id: senderId,
                  recipient_username: realUsername,
                  last_message_at: new Date().toISOString(),
                })
                .select("id")
                .single()
              conv = newConv
            } else {
              conv = existing
              await supabase
                .from("conversations")
                .update({ last_message_at: new Date().toISOString() })
                .eq("id", existing.id)
            }

            if (conv) {
              await supabase.from("messages").insert({
                id: event.message?.mid || `mid_${Date.now()}_${Math.random()}`,
                conversation_id: conv.id,
                instagram_account_id: account.id,
                sender_id: senderId,
                sender_username: "User",
                content: triggerValue,
                is_from_instagram: true,
              })
            }
          } catch (err) {
            console.error("[webhook] Failed to save incoming message", err)
          }

          // ---------- Match automation ----------
          const dmAutomations = typedAutomations.filter(
            (a) => a.trigger_source === "dm" || !a.trigger_source
          )
          let match: AutomationRecord | { name: string; response_content: Record<string, unknown> } | null = null

          if (triggerType === "postback") {
            if (triggerValue.startsWith("UNLOCK_CONTENT_")) {
              const ruleId = triggerValue.replace("UNLOCK_CONTENT_", "")
              match = automations?.find((a: AutomationRecord) => a.id === ruleId) || null
            } else if (triggerValue.startsWith("ICE_BREAKER_")) {
              const iceBreakerId = triggerValue.replace("ICE_BREAKER_", "")
              const { data: ib } = await supabase
                .from("ice_breakers")
                .select("*")
                .eq("id", iceBreakerId as unknown as string)
                .eq("instagram_account_id", account.id)
                .single()
              if (ib) {
                match = { name: "Ice Breaker: " + (ib as Record<string, unknown>).question, response_content: { message: (ib as Record<string, unknown>).response } }
              }
            } else {
              const found = typedAutomations.find(
                (a) => a.trigger_type === "postback" && a.trigger_value === triggerValue
              )
              match = found || null
              if (!match) {
                const found = dmAutomations.find(
                  (a) => a.trigger_type === "keyword" && keywordMatches(a.trigger_value, triggerValue.toLowerCase()),
                )
                match = found || null
              }
            }
          } else {
            const found = dmAutomations.find(
              (a) => a.trigger_type === "keyword" && keywordMatches(a.trigger_value, triggerValue),
            )
            match = found || null
          }

          if (!match) continue

          console.log(`[webhook] ✅ DM match: "${match.name}"`)
          const content = parseContent(match.response_content)

          if (content.mark_seen !== false) {
            await sendSenderAction(account.access_token, senderId, "mark_seen")
          }

          const isUnlockEvent = triggerType === "postback" && triggerValue.startsWith("UNLOCK_CONTENT_")
          let result
          let replyTextLog = responsePreviewText(content)

          if (content.check_follow === true && !isUnlockEvent) {
            replyTextLog = "[Locked Content Gate]"
            result = await sendCardDM(account.access_token, { id: senderId }, {
              title: "🔒 Content Locked",
              subtitle: `Please follow @${account.ig_username} to see this!`,
              buttons: [
                { type: "web_url" as const, url: `https://instagram.com/${account.ig_username}`, title: "Follow Us" },
                { type: "postback" as const, title: "I Followed! ✅", payload: `UNLOCK_CONTENT_${(match as AutomationRecord).id || ""}` },
              ],
            })
          } else {
            result = await sendAutomationResponse(account.access_token, { id: senderId }, content)
          }

          if (result?.ok && conv) {
            try {
              await supabase.from("messages").insert({
                id: `mid_reply_${Date.now()}_${Math.random()}`,
                conversation_id: conv.id,
                instagram_account_id: account.id,
                sender_id: String(account.business_account_id || account.id),
                sender_username: account.ig_username,
                content: replyTextLog,
                is_from_instagram: false,
              })
            } catch (e) {
              console.error("[webhook] Failed to save outgoing message", e)
            }
          }
        }
      }
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[webhook] Error", error)
    return NextResponse.json({ ok: true })
  }
}
