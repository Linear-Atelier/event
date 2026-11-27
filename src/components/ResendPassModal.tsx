'use client'

import React, { useState } from 'react'
import { Loader2, Mail, MessageCircle, Send, X } from 'lucide-react'

export type ResendChannel = 'both' | 'email' | 'whatsapp'

interface ResendPassModalProps {
  bookingCode: string
  holderName: string
  phone?: string | null
  email?: string | null
  submitting?: boolean
  onClose: () => void
  onConfirm: (channel: ResendChannel) => Promise<void> | void
}

export function ResendPassModal({
  bookingCode,
  holderName,
  phone,
  email,
  submitting = false,
  onClose,
  onConfirm,
}: ResendPassModalProps) {
  const hasPhone = Boolean(phone?.trim())
  const hasEmail = Boolean(email?.trim())
  const defaultChannel: ResendChannel =
    hasPhone && hasEmail ? 'both' : hasEmail ? 'email' : 'whatsapp'
  const [channel, setChannel] = useState<ResendChannel>(defaultChannel)

  const options: Array<{
    key: ResendChannel
    label: string
    sub: string
    disabled: boolean
    icon: React.ComponentType<{ className?: string }>
  }> = [
    {
      key: 'email',
      label: 'Email',
      sub: hasEmail ? email!.trim() : 'No email on booking',
      disabled: !hasEmail,
      icon: Mail,
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp',
      sub: hasPhone ? phone!.trim() : 'No phone on booking',
      disabled: !hasPhone,
      icon: MessageCircle,
    },
    {
      key: 'both',
      label: 'Both (Email & WhatsApp)',
      sub:
        hasEmail && hasPhone
          ? `${email!.trim()} · ${phone!.trim()}`
          : 'Requires both email and phone',
      disabled: !hasEmail || !hasPhone,
      icon: Send,
    },
  ]

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-neutral-950/70 p-3 backdrop-blur-xs sm:items-center sm:p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-zinc-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-extrabold tracking-tight text-zinc-950">
              Resend Ticket Pass
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              <span className="font-semibold text-zinc-800">{bookingCode}</span> · {holderName}
            </p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="Close resend dialog"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Choose delivery channel
          </div>
          {options.map((opt) => {
            const Icon = opt.icon
            const selected = channel === opt.key
            return (
              <button
                key={opt.key}
                type="button"
                disabled={opt.disabled || submitting}
                onClick={() => setChannel(opt.key)}
                className={`flex w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
                  selected
                    ? 'border-zinc-950 bg-zinc-950 text-white shadow-xs'
                    : 'border-zinc-200 bg-zinc-50/70 text-zinc-900 hover:border-zinc-300 hover:bg-zinc-100/70'
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                    selected ? 'bg-white/15 text-white' : 'bg-white text-zinc-600 ring-1 ring-zinc-200'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold">{opt.label}</div>
                  <div
                    className={`truncate text-[11px] ${
                      selected ? 'text-zinc-300' : 'text-zinc-500'
                    }`}
                  >
                    {opt.sub}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="flex-1 rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-xs font-bold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || (!hasEmail && !hasPhone)}
            onClick={() => onConfirm(channel)}
            className="inline-flex flex-[1.4] items-center justify-center gap-1.5 rounded-2xl bg-zinc-950 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-zinc-800 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                Resend Now
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
