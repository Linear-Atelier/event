'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, KeyRound, Lock, Mail, RotateCw } from 'lucide-react'
import Image from 'next/image'

type LoginMode = 'password' | 'otp'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<LoginMode>('otp')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setTimeout(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => clearTimeout(timer)
  }, [resendCooldown])

  function switchMode(nextMode: LoginMode) {
    setMode(nextMode)
    setError(null)
    setInfo(null)
    setOtpSent(false)
    setOtpCode('')
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
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
      router.replace('/')
      router.refresh()
    } catch {
      setError('Network error. Please check your connection.')
      setLoading(false)
    }
  }

  async function requestOtpCode() {
    setError(null)
    setInfo(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Could not send verification code.')
        setLoading(false)
        return
      }
      setOtpSent(true)
      setOtpCode('')
      setResendCooldown(30)
      setInfo(`We sent a 6-digit login code to ${email.trim()}.`)
    } catch {
      setError('Network error. Please check your connection.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSendOtpSubmit(e: React.FormEvent) {
    e.preventDefault()
    await requestOtpCode()
  }

  async function handleVerifyOtpSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, code: otpCode }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Invalid or expired verification code.')
        setLoading(false)
        return
      }
      router.replace('/')
      router.refresh()
    } catch {
      setError('Network error. Please check your connection.')
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-5 py-10">
      <div className="w-full max-w-sm">
        {/* Brand Header */}
        <div className="flex flex-col items-center gap-3.5">
          <Image src="/AIAIA Logo.png" alt="logo" width={60} height={60} />
          <div className='flex flex-col items-center'>
            <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-800">
              AIAIA Cochin Branch
            </p>
            <h1 className="text-xl font-extrabold tracking-tight text-neutral-800">
              Committee Portal
            </h1>
          </div>
        </div>

        {/* Soft Pill Mode Switcher */}
        <div className="mt-6 grid grid-cols-2 gap-1 rounded-2xl bg-neutral-100/90 p-1">
          <button
            type="button"
            onClick={() => switchMode('otp')}
            className={`rounded-xl py-2 text-xs font-bold transition ${mode === 'otp'
              ? 'bg-white text-neutral-950 shadow-xs'
              : 'text-neutral-500 hover:text-neutral-800'
              }`}
          >
            Email OTP
          </button>
          <button
            type="button"
            onClick={() => switchMode('password')}
            className={`rounded-xl py-2 text-xs font-bold transition ${mode === 'password'
              ? 'bg-white text-neutral-950 shadow-xs'
              : 'text-neutral-500 hover:text-neutral-800'
              }`}
          >
            Password
          </button>
        </div>

        {/* Password Login Form */}
        {mode === 'password' && (
          <form onSubmit={handlePasswordSubmit} className="mt-6 space-y-4">
            {error && (
              <div className="rounded-2xl bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700">
                {error}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-bold text-neutral-700">
                Committee Email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-neutral-400" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="officer@aiaiacochin.org"
                  className="w-full rounded-2xl border border-neutral-200 bg-neutral-50/70 py-2.5 pl-10 pr-4 text-sm text-neutral-950 placeholder-neutral-400 transition focus:border-neutral-900 focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-neutral-700">
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-neutral-400" />
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-2xl border border-neutral-200 bg-neutral-50/70 py-2.5 pl-10 pr-4 text-sm text-neutral-950 placeholder-neutral-400 transition focus:border-neutral-900 focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-bold text-white shadow-md transition hover:bg-neutral-800 active:scale-[0.99] disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign In'}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        )}

        {/* Email OTP Login Flow */}
        {mode === 'otp' && !otpSent && (
          <form onSubmit={handleSendOtpSubmit} className="mt-6 space-y-4">
            {error && (
              <div className="rounded-2xl bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700">
                {error}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-bold text-neutral-700">
                Committee Email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-neutral-400" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="officer@aiaiacochin.org"
                  className="w-full rounded-2xl border border-neutral-200 bg-neutral-50/70 py-2.5 pl-10 pr-4 text-sm text-neutral-950 placeholder-neutral-400 transition focus:border-neutral-900 focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-bold text-white shadow-md transition hover:bg-neutral-800 active:scale-[0.99] disabled:opacity-50"
            >
              {loading ? 'Sending code…' : 'Send 6-Digit Code'}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        )}

        {mode === 'otp' && otpSent && (
          <form onSubmit={handleVerifyOtpSubmit} className="mt-6 space-y-4">
            {error && (
              <div className="rounded-2xl bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700">
                {error}
              </div>
            )}

            {info && (
              <div className="flex items-center justify-between gap-2 rounded-2xl bg-neutral-100 px-4 py-3 text-xs font-medium text-neutral-900">
                <span>{info}</span>
                <button
                  type="button"
                  onClick={() => {
                    setOtpSent(false)
                    setOtpCode('')
                    setError(null)
                    setInfo(null)
                  }}
                  className="shrink-0 font-bold text-neutral-900 underline underline-offset-2 hover:text-neutral-900"
                >
                  Change
                </button>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-bold text-neutral-700">
                6-Digit Verification Code
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3.5 top-4.5 h-4 w-4 text-neutral-400" />
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  autoComplete="one-time-code"
                  autoFocus
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="w-full rounded-2xl border border-neutral-200 bg-neutral-50/70 py-3 pl-10 pr-4 text-center text-lg font-extrabold tracking-[0.35em] text-neutral-950 placeholder-neutral-300 transition focus:border-neutral-900 focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || otpCode.length !== 6}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-bold text-white shadow-md transition hover:bg-neutral-800 active:scale-[0.99] disabled:opacity-50"
            >
              {loading ? 'Verifying…' : 'Verify & Sign In'}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>

            <button
              type="button"
              disabled={loading || resendCooldown > 0}
              onClick={requestOtpCode}
              className="inline-flex w-full items-center justify-center gap-1.5 py-1.5 text-xs font-semibold text-neutral-500 transition hover:text-neutral-900 disabled:opacity-50"
            >
              <RotateCw className="h-3.5 w-3.5" />
              {resendCooldown > 0
                ? `Resend code in ${resendCooldown}s`
                : 'Resend 6-digit code'}
            </button>
          </form>
        )}

        <div className="ticket-perforation mt-8 flex flex-col pt-5 text-center text-sm font-medium text-neutral-400">
          <span className="font-bold text-neutral-600">Linear Atelier | Ticketing Partner</span>
        </div>
      </div>
    </div>
  )
}
