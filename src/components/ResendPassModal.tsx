'use client'

import React, { useState } from 'react'
import { Mail, MessageCircle, Send } from 'lucide-react'
import { Button, ModalShell, StatusBadge } from '@/components/ui/primitives'

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
    <ModalShell
      title="Resend Ticket Pass"
      badge={<StatusBadge tone="dark">{bookingCode}</StatusBadge>}
      subtitle={holderName}
      onClose={onClose}
      disableClose={submitting}
      maxWidthClass="max-w-md"
      footer={
        <div className="flex gap-2.5">
          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={onClose}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={submitting}
            disabled={!hasEmail && !hasPhone}
            onClick={() => onConfirm(channel)}
            className="flex-[1.4]"
          >
            {!submitting && <Send className="h-4 w-4" />}
            {submitting ? 'Sending…' : 'Resend Now'}
          </Button>
        </div>
      }
    >
      <div className="space-y-2.5">
        <div className="text-sm font-bold text-neutral-700">
          Choose how to send the pass
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
              className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
                selected
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-300 bg-white text-neutral-950 hover:bg-neutral-50'
              }`}
            >
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  selected
                    ? 'bg-white/15 text-white'
                    : 'border border-neutral-200 bg-neutral-50 text-neutral-700'
                }`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-base font-bold">{opt.label}</div>
                <div
                  className={`truncate text-sm ${
                    selected ? 'text-neutral-300' : 'text-neutral-600'
                  }`}
                >
                  {opt.sub}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </ModalShell>
  )
}
