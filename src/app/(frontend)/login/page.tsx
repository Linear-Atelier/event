'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, KeyRound, Lock, Mail, RotateCw } from 'lucide-react'
import Image from 'next/image'
import {
  Button,
  Card,
  FieldLabel,
  SegmentedTabs,
  TextInput,
} from '@/components/ui/primitives'

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
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-8">
      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Image src="/AIAIA Logo.png" alt="AIAIA Cochin logo" width={64} height={64} />
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-neutral-600">
              AIAIA Cochin Branch
            </p>
            <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-neutral-950">
              Committee Sign In
            </h1>
          </div>
        </div>

        <SegmentedTabs
          value={mode}
          onChange={switchMode}
          items={[
            { key: 'otp', label: 'Email Code (OTP)' },
            { key: 'password', label: 'Password' },
          ]}
        />

        {/* Password Login Form */}
        {mode === 'password' && (
          <form onSubmit={handlePasswordSubmit} className="mt-5 space-y-4">
            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
                {error}
              </div>
            )}

            <div>
              <FieldLabel htmlFor="login-email-pw">Committee Email</FieldLabel>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-neutral-500" />
                <TextInput
                  id="login-email-pw"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="officer@aiaiacochin.org"
                  className="pl-11"
                />
              </div>
            </div>

            <div>
              <FieldLabel htmlFor="login-password">Password</FieldLabel>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-neutral-500" />
                <TextInput
                  id="login-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="pl-11"
                />
              </div>
            </div>

            <Button type="submit" loading={loading} fullWidth size="lg">
              {loading ? 'Signing in…' : 'Sign In'}
              {!loading && <ArrowRight className="h-5 w-5" />}
            </Button>
          </form>
        )}

        {/* Email OTP Step 1 */}
        {mode === 'otp' && !otpSent && (
          <form onSubmit={handleSendOtpSubmit} className="mt-5 space-y-4">
            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
                {error}
              </div>
            )}

            <div>
              <FieldLabel htmlFor="login-email-otp">Committee Email</FieldLabel>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-neutral-500" />
                <TextInput
                  id="login-email-otp"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="officer@aiaiacochin.org"
                  className="pl-11"
                />
              </div>
            </div>

            <Button type="submit" loading={loading} fullWidth size="lg">
              {loading ? 'Sending code…' : 'Send 6-Digit Code'}
              {!loading && <ArrowRight className="h-5 w-5" />}
            </Button>
          </form>
        )}

        {/* Email OTP Step 2 */}
        {mode === 'otp' && otpSent && (
          <form onSubmit={handleVerifyOtpSubmit} className="mt-5 space-y-4">
            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
                {error}
              </div>
            )}

            {info && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm font-medium text-neutral-900">
                <span>{info}</span>
                <button
                  type="button"
                  onClick={() => {
                    setOtpSent(false)
                    setOtpCode('')
                    setError(null)
                    setInfo(null)
                  }}
                  className="min-h-10 shrink-0 rounded-lg px-2 text-sm font-bold text-neutral-900 underline underline-offset-2 hover:bg-neutral-200/70"
                >
                  Change
                </button>
              </div>
            )}

            <div>
              <FieldLabel htmlFor="login-otp-code">6-Digit Verification Code</FieldLabel>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3.5 top-4 h-5 w-5 text-neutral-500" />
                <TextInput
                  id="login-otp-code"
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
                  className="min-h-14 pl-11 text-center text-2xl font-extrabold tracking-[0.35em]"
                />
              </div>
            </div>

            <Button
              type="submit"
              loading={loading}
              disabled={otpCode.length !== 6}
              fullWidth
              size="lg"
            >
              {loading ? 'Verifying…' : 'Verify & Sign In'}
              {!loading && <ArrowRight className="h-5 w-5" />}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              fullWidth
              disabled={loading || resendCooldown > 0}
              onClick={requestOtpCode}
            >
              <RotateCw className="h-4 w-4" />
              {resendCooldown > 0
                ? `Resend code in ${resendCooldown}s`
                : 'Resend 6-digit code'}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-sm font-semibold text-neutral-600">
          Linear Atelier · Ticketing Partner
        </p>
      </div>
    </div>
  )
}
