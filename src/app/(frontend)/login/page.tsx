'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Lock, Mail, Ticket } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.errors?.[0]?.message || data?.message || 'Invalid email or password')
        setLoading(false)
        return
      }
      router.push('/')
      router.refresh()
    } catch {
      setError('Network error. Please check your connection.')
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-5 py-10">
      <div className="w-full max-w-sm">
        {/* Frosted Dark Glass Brand Pass Header */}
        <div className="glass-surface relative overflow-hidden rounded-3xl p-6 text-white shadow-xl">
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-sky-500/20 blur-2xl" />
          <div className="relative flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-sky-300 backdrop-blur-md">
              <Ticket className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-sky-300">
                AIAIA Cochin Branch
              </p>
              <h1 className="mt-0.5 text-xl font-extrabold tracking-tight text-white">
                Committee Portal
              </h1>
            </div>
          </div>
          <div className="my-4 border-t border-dashed border-white/15" />
          <p className="relative text-xs font-medium text-slate-300">
            Sign in to access events, booking desk, gate check-in, and finance reconciliation.
          </p>
        </div>

        {/* Clean White Borderless Sign-In Form */}
        <form onSubmit={handleSubmit} className="mt-7 space-y-4">
          {error && (
            <div className="rounded-2xl bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700">
              {error}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-700">
              Committee Email
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="officer@aiaiacochin.org"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 py-2.5 pl-10 pr-4 text-sm text-slate-950 placeholder-slate-400 transition focus:border-slate-900 focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-700">
              Password
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 py-2.5 pl-10 pr-4 text-sm text-slate-950 placeholder-slate-400 transition focus:border-slate-900 focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-md transition hover:bg-slate-800 active:scale-[0.99] disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign In'}
            {!loading && <ArrowRight className="h-4 w-4" />}
          </button>
        </form>

        <div className="ticket-perforation mt-8 pt-5 text-center text-[11px] font-medium text-slate-400">
          Officer-only portal ·{' '}
          <span className="font-bold text-slate-600">Linear Atelier</span> · Ticketing Partner
        </div>
      </div>
    </div>
  )
}
