"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Zap, Loader2, ArrowLeft } from "lucide-react"
import { getSupabaseBrowserClient } from "@/lib/supabase-browser"


export default function SignupPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  const supabase = getSupabaseBrowserClient()

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (password.length < 6) {
      setError("Password must be at least 6 characters")
      setLoading(false)
      return
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-[#ededed] flex flex-col">
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;700&display=swap');
          .font-serif-display { font-family: 'Instrument Serif', Georgia, serif; }
          .font-mono-ui { font-family: 'JetBrains Mono', ui-monospace, monospace; }
        `}</style>
        <nav className="flex items-center justify-between px-5 md:px-10 h-16 border-b border-white/[0.08]">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-[#ffe14d] text-black flex items-center justify-center rounded-[6px]">
              <Zap className="w-3.5 h-3.5" strokeWidth={2.5} />
            </div>
            <span className="font-mono-ui text-sm font-bold tracking-tight">insta-p8</span>
          </Link>
        </nav>
        <main className="flex-1 flex items-center justify-center px-5">
          <div className="w-full max-w-sm text-center border border-white/[0.08] rounded-2xl p-8 bg-[#0b0b0a]">
            <p className="text-white font-serif-display text-2xl mb-3">Check your email</p>
            <p className="text-sm text-neutral-500 mb-6">
              We sent a confirmation link to <span className="text-neutral-300">{email}</span>.
            </p>
            <Link
              href="/auth/login"
              className="inline-block font-mono-ui text-sm font-bold bg-[#ffe14d] text-black rounded-full px-6 py-3 hover:bg-[#ffe14d]/90 transition-colors"
            >
              Sign in
            </Link>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#ededed] flex flex-col">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;700&display=swap');
        .font-serif-display { font-family: 'Instrument Serif', Georgia, serif; }
        .font-mono-ui { font-family: 'JetBrains Mono', ui-monospace, monospace; }
      `}</style>

      <nav className="flex items-center justify-between px-5 md:px-10 h-16 border-b border-white/[0.08]">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-[#ffe14d] text-black flex items-center justify-center rounded-[6px]">
            <Zap className="w-3.5 h-3.5" strokeWidth={2.5} />
          </div>
          <span className="font-mono-ui text-sm font-bold tracking-tight">insta-p8</span>
        </Link>
        <Link
          href="/"
          className="flex items-center gap-1.5 font-mono-ui text-xs text-neutral-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-3 h-3" /> back home
        </Link>
      </nav>

      <main className="flex-1 flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="font-serif-display text-4xl text-white mb-2">Get started.</h1>
            <p className="text-neutral-500 text-sm">Create your account</p>
          </div>

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label htmlFor="email" className="block font-mono-ui text-[11px] uppercase tracking-[0.15em] text-neutral-500 mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-transparent border border-white/[0.12] rounded-xl px-4 py-3 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#ffe14d]/50 transition-colors"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block font-mono-ui text-[11px] uppercase tracking-[0.15em] text-neutral-500 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="at least 6 characters"
                className="w-full bg-transparent border border-white/[0.12] rounded-xl px-4 py-3 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#ffe14d]/50 transition-colors"
                required
                minLength={6}
              />
            </div>

            {error && (
              <p className="text-red-400 text-xs">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full font-mono-ui text-sm font-bold bg-[#ffe14d] text-black rounded-full px-6 py-3 hover:bg-[#ffe14d]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Create account
            </button>

            <p className="text-center text-neutral-600 text-xs pt-4">
              Already have an account?{" "}
              <Link href="/auth/login" className="text-[#ffe14d] hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </div>
      </main>
    </div>
  )
}
