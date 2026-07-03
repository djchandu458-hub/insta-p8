"use client"

import { useState, useCallback, useEffect } from "react"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { AutomationList } from "@/components/dashboard/AutomationList"
import { CreateRuleForm } from "@/components/dashboard/CreateRuleForm"
import { MessageCircle, Send, Sparkles, Zap, Plus, Brain, Loader2 } from "lucide-react"
import type { Automation } from "@/lib/types"

export default function AutomationsPage() {
    const { userId, isLoading: isSessionLoading } = useInstagramSession()
    const [automations, setAutomations] = useState<Automation[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [activeTab, setActiveTab] = useState<'comment' | 'dm' | 'story'>('comment')
    const [showCreateForm, setShowCreateForm] = useState(false)
    const [editRule, setEditRule] = useState<Automation | null>(null)
    const [aiEnabled, setAiEnabled] = useState(false)
    const [aiLoading, setAiLoading] = useState(true)
    const [aiToggling, setAiToggling] = useState(false)
    const [showAiContext, setShowAiContext] = useState(false)
    const [aiContext, setAiContext] = useState("")
    const [aiContextSaving, setAiContextSaving] = useState(false)
    const [aiContextSaved, setAiContextSaved] = useState(false)

    useEffect(() => {
        if (!userId) return
        fetch(`/api/groq/auto-reply?userId=${userId}`)
            .then(res => res.json())
            .then(data => {
                setAiEnabled(data.enabled ?? false)
                setAiContext(data.ai_context ?? "")
            })
            .catch(() => {})
            .finally(() => setAiLoading(false))
    }, [userId])

    const handleSaveAiContext = async () => {
        if (aiContextSaving) return
        setAiContextSaving(true)
        try {
            await fetch("/api/groq/auto-reply", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, enabled: aiEnabled, ai_context: aiContext }),
            })
            setAiContextSaved(true)
            setTimeout(() => setAiContextSaved(false), 2000)
        } catch {}
        setAiContextSaving(false)
    }

    const handleToggleAI = async () => {
        if (aiToggling) return
        setAiToggling(true)
        const newState = !aiEnabled
        try {
            const res = await fetch("/api/groq/auto-reply", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, enabled: newState }),
            })
            if (res.ok) setAiEnabled(newState)
        } catch {}
        setAiToggling(false)
    }

    const fetchAutomations = useCallback(async () => {
        if (!userId) return
        try {
            const res = await fetch(`/api/automations?userId=${userId}`)
            const data = await res.json()
            if (res.ok) setAutomations(Array.isArray(data) ? data : [])
        } catch (err) {
            console.error("Fetch error:", err)
        } finally {
            setIsLoading(false)
        }
    }, [userId])

    useEffect(() => {
        if (userId) fetchAutomations()
    }, [userId, fetchAutomations])

    const handleDeleteRule = async (id: string) => {
        await fetch(`/api/automations?id=${id}`, { method: "DELETE" })
        fetchAutomations()
    }

    const handleEditRule = (rule: Automation) => {
        setEditRule(rule)
        setShowCreateForm(true)
    }

    if (isSessionLoading) return <div className="h-screen flex items-center justify-center bg-black"><div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>
    if (!userId) return <div className="h-screen flex items-center justify-center bg-black text-neutral-500">Please log in</div>

    const filteredAutomations = automations.filter(a => a.trigger_source === activeTab)
    const counts = {
        comment: automations.filter(a => a.trigger_source === 'comment').length,
        dm: automations.filter(a => a.trigger_source === 'dm').length,
        story: automations.filter(a => a.trigger_source === 'story').length,
    }

    const tabs = [
        { key: 'comment' as const, icon: <MessageCircle className="w-4 h-4" />, label: 'Comments', count: counts.comment },
        { key: 'dm' as const, icon: <Send className="w-4 h-4" />, label: 'DMs', count: counts.dm },
        { key: 'story' as const, icon: <Sparkles className="w-4 h-4" />, label: 'Stories', count: counts.story },
    ]

    return (
        <div className="min-h-screen bg-black">
            <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 space-y-8">
                {/* Header */}
                <div className="flex items-end justify-between gap-4 flex-wrap">
                    <div>
                        <p className="font-mono-ui text-[10px] uppercase tracking-[0.3em] text-neutral-600 mb-2">Rules engine</p>
                        <h1 className="font-serif-display text-4xl md:text-5xl text-white leading-none">Automations</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* AI Auto-Reply Toggle */}
                        {aiLoading ? (
                            <Loader2 className="w-4 h-4 text-neutral-500 animate-spin" />
                        ) : (
                            <>
                                <button
                                    onClick={() => setShowAiContext(!showAiContext)}
                                    className="w-9 h-9 flex items-center justify-center rounded-full border border-white/10 text-neutral-500 hover:text-white hover:border-white/30 transition-colors"
                                    title="AI settings"
                                >
                                    <Brain className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={handleToggleAI}
                                    disabled={aiToggling}
                                    className={`flex items-center gap-2 h-9 px-4 rounded-full font-mono-ui text-[11px] font-bold uppercase tracking-widest transition-colors ${
                                        aiEnabled
                                            ? 'bg-[#ffe14d]/10 border border-[#ffe14d]/40 text-[#ffe14d]'
                                            : 'border border-white/10 text-neutral-500 hover:text-white hover:border-white/30'
                                    }`}
                                >
                                    <Sparkles className={`w-3.5 h-3.5 ${aiToggling ? 'animate-pulse' : ''}`} />
                                    {aiToggling ? '...' : aiEnabled ? 'AI ON' : 'AI OFF'}
                                </button>
                            </>
                        )}
                        <button
                            onClick={() => {
                                if (showCreateForm) setEditRule(null)
                                setShowCreateForm(!showCreateForm)
                            }}
                            className={`flex items-center gap-2 h-9 px-5 rounded-full font-mono-ui text-[11px] font-bold uppercase tracking-widest transition-all active:scale-95 ${
                                showCreateForm
                                    ? 'border border-white/20 text-white hover:border-white/40'
                                    : 'bg-[#ffe14d] text-black hover:brightness-95'
                            }`}
                        >
                            <Plus className={`w-4 h-4 transition-transform duration-200 ${showCreateForm ? 'rotate-45' : ''}`} />
                            {showCreateForm ? 'Close' : 'New Rule'}
                        </button>
                    </div>
                </div>

                {/* AI Context Panel */}
                {showAiContext && (
                    <div className="rounded-2xl border border-[#ffe14d]/20 bg-[#ffe14d]/[0.04] p-5 animate-in fade-in slide-in-from-top-2 duration-200 space-y-3">
                        <div className="flex items-center gap-2">
                            <Brain className="w-4 h-4 text-[#ffe14d]" />
                            <span className="text-sm font-semibold text-[#ffe14d]">AI Personality Context</span>
                        </div>
                        <p className="text-xs text-neutral-500">Tell AI about your account — niche, products, tone, what to say/avoid. More context = more human replies.</p>
                        <textarea
                            value={aiContext}
                            onChange={e => setAiContext(e.target.value)}
                            placeholder={`e.g. This is a fitness coaching account. I sell online training programs (₹2999/mo). My tone is motivating but chill. If someone asks about pricing, tell them to DM for a free consultation. Never promise specific results.`}
                            rows={4}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-neutral-600 resize-none focus:outline-none focus:border-[#ffe14d]/50 transition-colors"
                        />
                        <button
                            onClick={handleSaveAiContext}
                            disabled={aiContextSaving}
                            className="px-4 py-2 rounded-xl bg-[#ffe14d] hover:brightness-95 text-black text-xs font-bold transition-all disabled:opacity-50"
                        >
                            {aiContextSaving ? 'Saving...' : aiContextSaved ? 'Saved ✓' : 'Save Context'}
                        </button>
                    </div>
                )}

                {/* Tabs — editorial underline */}
                <div className="flex items-center gap-6 border-b border-white/10">
                    {tabs.map((tab) => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`relative flex items-center gap-2 pb-3 -mb-px font-mono-ui text-xs uppercase tracking-widest transition-colors border-b-2 ${
                                activeTab === tab.key
                                    ? 'text-white border-[#ffe14d]'
                                    : 'text-neutral-600 border-transparent hover:text-neutral-300'
                            }`}
                        >
                            {tab.icon}
                            <span>{tab.label}</span>
                            {tab.count > 0 && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                                    activeTab === tab.key ? 'bg-[#ffe14d] text-black' : 'bg-white/10 text-neutral-400'
                                }`}>
                                    {tab.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Create Form (Collapsible) */}
                {showCreateForm && (
                    <div className="rounded-2xl border border-white/10 bg-[#0b0b0a] p-6 md:p-8 animate-in fade-in slide-in-from-top-2 duration-300">
                        <CreateRuleForm
                            userId={userId}
                            triggerSource={editRule ? editRule.trigger_source : activeTab}
                            editRule={editRule}
                            onSuccess={() => {
                                fetchAutomations()
                                setShowCreateForm(false)
                                setEditRule(null)
                            }}
                        />
                    </div>
                )}


                {/* Automation List */}
                {isLoading ? (
                    <div className="flex items-center justify-center py-16">
                        <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    </div>
                ) : (
                    <AutomationList
                        automations={filteredAutomations}
                        onDelete={handleDeleteRule}
                        onEdit={handleEditRule}
                        onChanged={fetchAutomations}
                        userId={userId}
                    />
                )}
            </div>
        </div>
    )
}
