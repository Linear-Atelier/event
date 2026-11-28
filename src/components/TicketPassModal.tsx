'use client'

import React, { useState } from 'react'
import { AlertTriangle, Check, Copy, Loader2, Send } from 'lucide-react'
import { ModalShell, StatusBadge } from '@/components/ui/primitives'

export interface TicketPassTicket {
  id: number | string
  ticketCode: string
  ticketTypeName?: string
  paxCount: number
  paxNames?: string[]
}

export interface TicketPassModalProps {
  eventName: string
  bookingCode: string
  holderName: string
  totalPax: number
  totalAmount: number
  tablesSummary: string
  tickets: TicketPassTicket[]
  feedback?: { type: 'ok' | 'err'; text: string } | null
  resending?: boolean
  onResend?: () => void
  onClose: () => void
}

function QrPassImage({ bookingCode }: { bookingCode: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [retryCount, setRetryCount] = useState(0)

  const src = `/api/qr/${encodeURIComponent(bookingCode)}?style=qr&v=5${retryCount > 0 ? `&r=${retryCount}` : ''
    }`

  return (
    <div className="relative flex h-60 w-60 items-center justify-center overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 p-3">
      {status === 'loading' && (
        <div
          role="status"
          aria-label="Loading QR code"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-neutral-900"
        >
          <Loader2 className="h-7 w-7 animate-spin text-emerald-400" />
          <span className="text-sm font-semibold text-neutral-300">Loading QR…</span>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-rose-950/80 p-4 text-center">
          <AlertTriangle className="h-6 w-6 text-rose-300" />
          <span className="text-sm font-bold text-rose-100">Could not load QR</span>
          <button
            type="button"
            onClick={() => {
              setStatus('loading')
              setRetryCount((c) => c + 1)
            }}
            className="min-h-11 rounded-xl border border-neutral-700 bg-neutral-900 px-4 text-sm font-bold text-white hover:bg-neutral-800"
          >
            Retry
          </button>
        </div>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={retryCount}
        src={src}
        alt={`Master QR ${bookingCode}`}
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
        className={`h-56 w-56 transition-opacity duration-200 ${status === 'loaded' ? 'opacity-100' : 'opacity-0'
          }`}
      />
    </div>
  )
}

export function TicketPassModal({
  eventName,
  bookingCode,
  holderName,
  totalPax,
  totalAmount,
  tablesSummary,
  tickets,
  feedback,
  resending = false,
  onResend,
  onClose,
}: TicketPassModalProps) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  async function handleCopyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedCode(code)
      setTimeout(() => {
        setCopiedCode((prev) => (prev === code ? null : prev))
      }, 1500)
    } catch {
      window.prompt('Copy Ticket ID:', code)
    }
  }

  return (
    <ModalShell
      tone="dark"
      title="Master QR Pass"
      badge={<StatusBadge tone="emerald">{bookingCode}</StatusBadge>}
      subtitle={`${eventName} · ${holderName} (${totalPax} ${totalPax === 1 ? 'Guest' : 'Guests'})`}
      onClose={onClose}
      maxWidthClass="max-w-md"
      footer={
        <div className="flex gap-2.5">
          {onResend && (
            <button
              type="button"
              disabled={resending}
              onClick={onResend}
              className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-4 text-base font-bold text-white transition hover:bg-neutral-800 disabled:opacity-45 sm:text-sm"
            >
              {resending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {resending ? 'Sending…' : 'Resend Pass'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl bg-white px-4 text-base font-extrabold text-neutral-950 transition hover:bg-neutral-200 sm:text-sm"
          >
            Done
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col items-center text-center">
          <QrPassImage key={bookingCode} bookingCode={bookingCode} />
          <p className="mt-2.5 text-sm font-medium text-neutral-300">
            Show this QR code at the venue entrance
          </p>
        </div>

        {/* Summary Strip */}
        <div className="grid grid-cols-2 gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-3.5">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-neutral-400">
              Tables
            </div>
            <div className="mt-0.5 text-base font-bold text-white">{tablesSummary}</div>
          </div>
          <div className="text-right">
            <div className="text-xs font-bold uppercase tracking-wide text-neutral-400">
              Total
            </div>
            <div className="mt-0.5 text-base font-extrabold text-emerald-400 tabular-nums">
              ₹{totalAmount.toLocaleString('en-IN')}
            </div>
          </div>
        </div>

        {/* Physical Ticket IDs */}
        {tickets.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wide text-neutral-400">
              Ticket IDs (for physical cards if needed)
            </div>
            {tickets.map((t) => {
              const isCopied = copiedCode === t.ticketCode
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-2.5 rounded-xl border border-neutral-800 bg-neutral-900 px-3.5 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-sm font-bold text-white">
                        {t.ticketCode}
                      </span>
                      {t.ticketTypeName && (
                        <span className="text-xs font-semibold text-neutral-400">
                          · {t.ticketTypeName}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col text-sm text-neutral-300">
                      {t.paxNames && t.paxNames.length > 0
                        ? t.paxNames.map((p, i) => <span key={i}>{p}</span>)
                        : `${t.paxCount} ${t.paxCount === 1 ? 'guest' : 'guests'}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyCode(t.ticketCode)}
                    aria-label={`Copy Ticket ID ${t.ticketCode}`}
                    className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-bold transition ${isCopied
                      ? 'bg-emerald-500 text-neutral-950'
                      : 'border border-neutral-700 bg-neutral-800 text-white hover:bg-neutral-700'
                      }`}
                  >
                    {isCopied ? (
                      <>
                        <Check className="h-4 w-4" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 text-neutral-300" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {feedback && (
          <div
            className={`rounded-xl border px-3.5 py-2.5 text-center text-sm font-semibold ${feedback.type === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200'
              : 'border-rose-500/30 bg-rose-500/15 text-rose-200'
              }`}
          >
            {feedback.text}
          </div>
        )}

        <p className="text-center text-xs font-medium text-neutral-400">
          Linear Atelier · Ticketing Partner
        </p>
      </div>
    </ModalShell>
  )
}
