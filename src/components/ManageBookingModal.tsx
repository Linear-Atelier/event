'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRightLeft,
  Ban,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Loader2,
  Lock,
  UserPen,
  Users,
  X,
} from 'lucide-react'
import type { DashboardBookingRow, DashboardTableCard } from './EventDashboardClient'

interface ManageBookingModalProps {
  event: {
    id: number
    name: string
  }
  booking: DashboardBookingRow
  tables: DashboardTableCard[]
  onClose: () => void
  onUpdated: (message: string) => void
}

type ManageTab = 'details' | 'tables' | 'payment' | 'cancel'

export function ManageBookingModal({
  event,
  booking,
  tables,
  onClose,
  onUpdated,
}: ManageBookingModalProps) {
  const isCancelled = booking.status === 'cancelled'
  const isPendingPayment =
    !isCancelled && (booking.paymentStatus === 'pending' || booking.status === 'pending_payment')

  const [tab, setTab] = useState<ManageTab>(isCancelled ? 'details' : 'details')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // --- TAB 1: Details & Guests ---
  const [holderName, setHolderName] = useState(booking.holderName)
  const [phone, setPhone] = useState(booking.phone)
  const [email, setEmail] = useState(booking.email || '')
  const [notes, setNotes] = useState(booking.notes || '')
  const [markTransferred, setMarkTransferred] = useState(booking.status === 'transferred')
  const [detailsResend, setDetailsResend] = useState<'none' | 'both' | 'whatsapp' | 'email'>('none')
  const [slotNames, setSlotNames] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {}
    for (const s of booking.slots || []) {
      initial[s.id] = s.attendeeName
    }
    return initial
  })

  // --- TAB 2: Tables & Payment Step ---
  const [selectedTableLabels, setSelectedTableLabels] = useState<string[]>(
    booking.assignedTableLabels || [],
  )
  const [tablePaymentMode, setTablePaymentMode] = useState<
    'RAZORPAY' | 'CASH' | 'OFFICER_UPI' | 'PAY_AT_DOOR' | 'COMPLIMENTARY'
  >('RAZORPAY')
  const [tableResend, setTableResend] = useState<'none' | 'both' | 'whatsapp' | 'email'>('both')
  const [upgradePendingLink, setUpgradePendingLink] = useState<{
    url: string
    additionalDue: number
  } | null>(null)

  // --- TAB 3: Settle Pending Payment ---
  const [settleMode, setSettleMode] = useState<'RAZORPAY' | 'CASH' | 'OFFICER_UPI' | 'COMPLIMENTARY'>(
    'CASH',
  )
  const [settleResendPass, setSettleResendPass] = useState(true)
  const [settleRazorpayUrl, setSettleRazorpayUrl] = useState<string | null>(null)

  // --- TAB 4: Cancel & Refund ---
  const effectivePaidAmount =
    typeof booking.paidAmount === 'number'
      ? booking.paidAmount
      : booking.paymentStatus === 'paid'
        ? booking.totalAmount
        : 0
  const canRazorpayRefund =
    effectivePaidAmount > 0 && (booking.paymentMode === 'RAZORPAY' || Boolean(booking.gatewayRefId))

  const [refundAmount, setRefundAmount] = useState<string>(String(effectivePaidAmount))
  const [refundMethod, setRefundMethod] = useState<
    'RAZORPAY_API' | 'OFFLINE_CASH' | 'OFFLINE_UPI' | 'NONE'
  >(effectivePaidAmount <= 0 ? 'NONE' : canRazorpayRefund ? 'RAZORPAY_API' : 'OFFLINE_CASH')
  const [refundReference, setRefundReference] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [sendCancelEmail, setSendCancelEmail] = useState(Boolean(booking.email))

  // Compute table pricing delta
  const existingTableFee = booking.assignedTableFee ?? 0
  const newTableFee = useMemo(() => {
    let sum = 0
    for (const lbl of selectedTableLabels) {
      const t = tables.find((x) => x.tableLabel === lbl)
      if (t) sum += Math.max(0, Number(t.price) || 0)
    }
    return sum
  }, [selectedTableLabels, tables])
  const additionalDue = Math.max(0, newTableFee - existingTableFee)

  // Poll payment-status every 3s when waiting on a Razorpay link (table upgrade or pending settlement)
  const isPollingRazorpay = Boolean(upgradePendingLink || settleRazorpayUrl)
  useEffect(() => {
    if (!isPollingRazorpay) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(`/api/bookings/${booking.id}/payment-status`, {
          credentials: 'include',
        })
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (upgradePendingLink && data.upgradeApplied) {
          onUpdated(
            `Table upgrade paid via Razorpay! Tables updated to ${data.tablesSummary || 'new selection'}.`,
          )
        } else if (settleRazorpayUrl && data.paymentStatus === 'paid') {
          onUpdated(`Payment of ₹${booking.totalAmount.toLocaleString('en-IN')} confirmed via Razorpay!`)
        }
      } catch {
        // retry next interval
      }
    }
    const timer = setInterval(poll, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [isPollingRazorpay, upgradePendingLink, settleRazorpayUrl, booking.id, booking.totalAmount, onUpdated])

  function toggleTable(label: string) {
    setSelectedTableLabels((prev) =>
      prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label],
    )
  }

  async function handleSaveDetails(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const attendeeUpdates = (booking.slots || [])
        .filter((s) => !s.checkedInAt)
        .map((s) => ({
          slotId: s.id,
          attendeeName: (slotNames[s.id] ?? s.attendeeName).trim(),
        }))

      const res = await fetch(`/api/bookings/${booking.id}/manage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'update_details',
          holderName,
          phone,
          email,
          notes,
          markTransferred,
          attendeeUpdates,
          resendChannels: detailsResend,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to update booking details')
        return
      }
      onUpdated(
        `Updated ${booking.bookingCode}${detailsResend !== 'none' ? ' & resent pass' : ''}.`,
      )
    } catch {
      setError('Network error while saving changes.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSaveTables() {
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/bookings/${booking.id}/tables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          tables: selectedTableLabels,
          paymentMode: additionalDue > 0 ? tablePaymentMode : 'CASH',
          resendNotification: tableResend !== 'none',
          channels: tableResend === 'none' ? 'both' : tableResend,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to update tables')
        return
      }
      if (data.status === 'awaiting_payment' && data.paymentLinkUrl) {
        setUpgradePendingLink({
          url: data.paymentLinkUrl,
          additionalDue: data.additionalDue || additionalDue,
        })
        return
      }
      onUpdated(`Tables updated for ${booking.bookingCode}: ${data.tablesSummary}.`)
    } catch {
      setError('Network error while updating tables.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSettlePayment() {
    setError(null)
    setSubmitting(true)
    try {
      if (settleMode === 'RAZORPAY') {
        const res = await fetch(`/api/bookings/${booking.id}/door-razorpay`, {
          method: 'POST',
          credentials: 'include',
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || 'Failed to generate Razorpay link')
          return
        }
        if (data.alreadyPaid) {
          onUpdated(`${booking.bookingCode} is already paid!`)
          return
        }
        setSettleRazorpayUrl(data.paymentLinkUrl)
        return
      }

      const res = await fetch(`/api/bookings/${booking.id}/manage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'settle_payment',
          paymentMode: settleMode,
          resendPass: settleResendPass,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to settle payment')
        return
      }
      onUpdated(`Payment settled for ${booking.bookingCode} via ${settleMode}.`)
    } catch {
      setError('Network error while settling payment.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancelAndRefund() {
    setError(null)
    const numericRefund = Math.max(0, Math.round(Number(refundAmount) || 0))
    if (numericRefund > effectivePaidAmount) {
      setError(
        `Refund cannot exceed paid amount (₹${effectivePaidAmount.toLocaleString('en-IN')}).`,
      )
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/bookings/${booking.id}/manage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'cancel_and_refund',
          refundAmount: numericRefund,
          refundMethod: numericRefund <= 0 ? 'NONE' : refundMethod,
          refundReference,
          reason: cancelReason,
          sendEmail: sendCancelEmail,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to cancel booking')
        return
      }
      onUpdated(
        `Booking ${booking.bookingCode} cancelled${numericRefund > 0 ? ` · Refunded ₹${numericRefund.toLocaleString('en-IN')}` : ''}${data.releasedTablesCount ? ` · Released ${data.releasedTablesCount} table(s)` : ''}.`,
      )
    } catch {
      setError('Network error while cancelling booking.')
    } finally {
      setSubmitting(false)
    }
  }

  const parsedRefundNum = Math.min(
    effectivePaidAmount,
    Math.max(0, Math.round(Number(refundAmount) || 0)),
  )
  const retainedPreview = Math.max(0, effectivePaidAmount - parsedRefundNum)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/70 p-3 backdrop-blur-sm sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-neutral-900 px-2.5 py-0.5 text-[11px] font-bold text-white">
                {booking.bookingCode}
              </span>
              <span className="truncate text-sm font-extrabold text-neutral-950">
                {booking.holderName}
              </span>
              <span className="text-xs font-medium text-neutral-500">
                · {booking.totalPax} Pax · ₹{booking.totalAmount.toLocaleString('en-IN')}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-neutral-500">{event.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 transition hover:bg-neutral-200 hover:text-neutral-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Pill Tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-neutral-200 bg-neutral-50/80 px-5 py-2.5">
          <button
            type="button"
            onClick={() => {
              setTab('details')
              setError(null)
            }}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${tab === 'details'
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-600 hover:bg-neutral-200/70'
              }`}
          >
            <UserPen className="h-3.5 w-3.5" />
            Details &amp; Guests
          </button>

          {!isCancelled && (
            <button
              type="button"
              onClick={() => {
                setTab('tables')
                setError(null)
              }}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${tab === 'tables'
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:bg-neutral-200/70'
                }`}
            >
              <Users className="h-3.5 w-3.5" />
              Tables
            </button>
          )}

          {isPendingPayment && (
            <button
              type="button"
              onClick={() => {
                setTab('payment')
                setError(null)
              }}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${tab === 'payment'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                }`}
            >
              <CreditCard className="h-3.5 w-3.5" />
              Collect Due
            </button>
          )}

          {!isCancelled && (
            <button
              type="button"
              onClick={() => {
                setTab('cancel')
                setError(null)
              }}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${tab === 'cancel'
                  ? 'bg-rose-600 text-white'
                  : 'text-rose-700 hover:bg-rose-50'
                }`}
            >
              <Ban className="h-3.5 w-3.5" />
              Cancel &amp; Refund
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {isCancelled && (
            <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-xs text-rose-900">
              <div className="font-bold">This booking is cancelled.</div>
              <div className="mt-1 space-y-0.5 text-rose-800/90">
                <div>
                  Paid: <strong>₹{effectivePaidAmount.toLocaleString('en-IN')}</strong> · Refunded:{' '}
                  <strong>₹{(booking.refundAmount || 0).toLocaleString('en-IN')}</strong>
                  {booking.refundMethod && booking.refundMethod !== 'NONE'
                    ? ` (${booking.refundMethod})`
                    : ''}
                </div>
                {booking.refundReference && <div>Ref: {booking.refundReference}</div>}
                {booking.notes && (
                  <div className="mt-1 whitespace-pre-wrap text-[11px] text-rose-700">
                    {booking.notes}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 1: DETAILS & GUESTS */}
          {tab === 'details' && (
            <form onSubmit={handleSaveDetails} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-neutral-700">
                    Booking Holder Name *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={isCancelled}
                    value={holderName}
                    onChange={(e) => setHolderName(e.target.value)}
                    className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none disabled:bg-neutral-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-neutral-700">
                    WhatsApp / Phone *
                  </label>
                  <input
                    type="tel"
                    required
                    disabled={isCancelled}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none disabled:bg-neutral-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-neutral-700">Email</label>
                  <input
                    type="email"
                    disabled={isCancelled}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none disabled:bg-neutral-100"
                  />
                </div>
              </div>

              {/* Guest / Attendee Slots */}
              {booking.slots && booking.slots.length > 0 && (
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-3.5">
                  <div className="mb-2 text-xs font-bold text-neutral-900">
                    Individual Guest Names ({booking.slots.length} Pax)
                  </div>
                  <div className="space-y-2">
                    {booking.slots.map((s, idx) => {
                      const locked = Boolean(s.checkedInAt)
                      return (
                        <div key={s.id} className="flex items-center gap-2">
                          <span className="w-24 shrink-0 truncate font-mono text-[10px] font-semibold text-neutral-500">
                            {s.ticketCode || `Guest #${idx + 1}`}
                          </span>
                          <input
                            type="text"
                            disabled={isCancelled || locked}
                            value={slotNames[s.id] ?? s.attendeeName}
                            onChange={(e) =>
                              setSlotNames((prev) => ({ ...prev, [s.id]: e.target.value }))
                            }
                            className="flex-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-900 focus:border-neutral-900 focus:outline-none disabled:bg-neutral-100 disabled:text-neutral-500"
                          />
                          {locked && (
                            <span
                              title="Already checked in at gate"
                              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800"
                            >
                              <Lock className="h-3 w-3" />
                              In
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-semibold text-neutral-700">
                  Booking Notes
                </label>
                <textarea
                  rows={2}
                  disabled={isCancelled}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Special seating, dietary, or transfer notes..."
                  className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-xs text-neutral-900 focus:border-neutral-900 focus:outline-none disabled:bg-neutral-100"
                />
              </div>

              {!isCancelled && (
                <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-neutral-50/70 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-neutral-800">
                    <input
                      type="checkbox"
                      checked={markTransferred}
                      onChange={(e) => setMarkTransferred(e.target.checked)}
                      className="h-4 w-4 rounded border-neutral-300 text-neutral-900"
                    />
                    <ArrowRightLeft className="h-3.5 w-3.5 text-sky-600" />
                    Mark booking as Transferred
                  </label>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-neutral-500">Resend pass:</span>
                    <select
                      value={detailsResend}
                      onChange={(e) =>
                        setDetailsResend(e.target.value as 'none' | 'both' | 'whatsapp' | 'email')
                      }
                      className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-800"
                    >
                      <option value="none">Don&apos;t resend</option>
                      <option value="both">WhatsApp + Email</option>
                      <option value="whatsapp">WhatsApp only</option>
                      <option value="email">Email only</option>
                    </select>
                  </div>
                </div>
              )}

              {!isCancelled && (
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-xl border border-neutral-200 px-4 py-2 text-xs font-bold text-neutral-700 hover:bg-neutral-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-neutral-900 px-5 py-2 text-xs font-bold text-white transition hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Save Changes
                  </button>
                </div>
              )}
            </form>
          )}

          {/* TAB 2: TABLES & PAYMENT STEP */}
          {tab === 'tables' && !isCancelled && (
            <div className="space-y-4">
              {upgradePendingLink ? (
                <div className="rounded-2xl border border-neutral-200 bg-neutral-950 p-5 text-center text-white">
                  <div className="text-xs font-bold uppercase tracking-widest text-amber-400">
                    Awaiting Table Fee Payment
                  </div>
                  <div className="mt-1 text-xl font-extrabold tabular-nums">
                    ₹{upgradePendingLink.additionalDue.toLocaleString('en-IN')}
                  </div>
                  <p className="mt-1 text-xs text-neutral-400">
                    Scan QR or open link below. Tables will assign automatically once paid.
                  </p>
                  <div className="my-4 flex justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/qr/link?url=${encodeURIComponent(upgradePendingLink.url)}`}
                      alt="Razorpay Table Upgrade QR"
                      className="h-44 w-44 rounded-2xl bg-white p-2"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <a
                      href={upgradePendingLink.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-bold text-neutral-950 hover:bg-neutral-200"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open Razorpay Link
                    </a>
                    <button
                      type="button"
                      onClick={() => setUpgradePendingLink(null)}
                      className="rounded-xl border border-white/20 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-white/10"
                    >
                      Back / Switch Mode
                    </button>
                  </div>
                  <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-emerald-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Checking payment status every 3s…
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-neutral-600">
                      Selected Tables:{' '}
                      <strong>
                        {selectedTableLabels.length > 0 ? selectedTableLabels.join(', ') : 'None'}
                      </strong>
                    </div>
                    {newTableFee > 0 && (
                      <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-semibold text-neutral-700 tabular-nums">
                        Table total: ₹{newTableFee.toLocaleString('en-IN')}
                      </span>
                    )}
                  </div>

                  {tables.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 px-4 py-8 text-center text-xs text-neutral-500">
                      No tables configured for this event. Add tables in Payload Admin first.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {tables.map((t) => {
                        const isMine = (booking.assignedTableLabels || []).includes(t.tableLabel)
                        const reservedByOther = t.isReserved && !isMine
                        const isSelected = selectedTableLabels.includes(t.tableLabel)
                        const price = Number(t.price) || 0

                        return (
                          <button
                            key={t.tableLabel}
                            type="button"
                            disabled={reservedByOther}
                            onClick={() => toggleTable(t.tableLabel)}
                            className={`flex flex-col items-start justify-between rounded-xl border p-2.5 text-left text-xs transition ${reservedByOther
                                ? 'cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400'
                                : isSelected
                                  ? 'border-neutral-900 bg-neutral-900 text-white'
                                  : 'border-neutral-200 bg-white text-neutral-800 hover:border-neutral-500'
                              }`}
                          >
                            <div className="flex w-full items-center justify-between gap-1">
                              <span className="font-bold">{t.tableLabel}</span>
                              {price > 0 && (
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${isSelected
                                      ? 'bg-white/20 text-emerald-300'
                                      : 'bg-neutral-100 text-neutral-900'
                                    }`}
                                >
                                  ₹{price.toLocaleString('en-IN')}
                                </span>
                              )}
                            </div>
                            <div
                              className={`mt-1 truncate text-[10px] ${isSelected ? 'text-neutral-300' : 'text-neutral-500'
                                }`}
                            >
                              {t.tableTypeName || 'Table'}
                            </div>
                            <div className="mt-1 text-[10px] font-semibold">
                              {reservedByOther ? (
                                <span className="text-rose-500">
                                  Taken · {t.allocations[0]?.bookingCode}
                                </span>
                              ) : isSelected ? (
                                <span className="text-emerald-300">
                                  {isMine ? '✓ Current' : '✓ Selected'}
                                </span>
                              ) : (
                                <span className="text-emerald-700">Available</span>
                              )}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {/* Payment Step when additionalDue > 0 */}
                  {additionalDue > 0 && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-bold text-emerald-950">
                            Table Fee Payment Step
                          </div>
                          <div className="text-[11px] text-emerald-800">
                            New tables ₹{newTableFee.toLocaleString('en-IN')} − Paid tables ₹
                            {existingTableFee.toLocaleString('en-IN')}
                          </div>
                        </div>
                        <div className="text-lg font-extrabold text-emerald-700 tabular-nums">
                          +₹{additionalDue.toLocaleString('en-IN')}
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {(
                          [
                            { key: 'RAZORPAY', label: 'Razorpay QR / Link' },
                            { key: 'CASH', label: 'Cash' },
                            { key: 'OFFICER_UPI', label: 'Officer UPI' },
                            { key: 'PAY_AT_DOOR', label: 'Pay at Door' },
                            { key: 'COMPLIMENTARY', label: 'Waive Fee (₹0)' },
                          ] as const
                        ).map((m) => (
                          <button
                            key={m.key}
                            type="button"
                            onClick={() => setTablePaymentMode(m.key)}
                            className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${tablePaymentMode === m.key
                                ? 'border-neutral-900 bg-neutral-900 text-white'
                                : 'border-emerald-200 bg-white text-neutral-800 hover:border-neutral-400'
                              }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-neutral-600">
                        Notify guest:
                      </span>
                      <select
                        value={tableResend}
                        onChange={(e) =>
                          setTableResend(e.target.value as 'none' | 'both' | 'whatsapp' | 'email')
                        }
                        className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-800"
                      >
                        <option value="both">WhatsApp + Email</option>
                        <option value="whatsapp">WhatsApp only</option>
                        <option value="email">Email only</option>
                        <option value="none">Don&apos;t resend</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={onClose}
                        className="rounded-xl border border-neutral-200 px-4 py-2 text-xs font-bold text-neutral-700 hover:bg-neutral-100"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={handleSaveTables}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-neutral-900 px-5 py-2 text-xs font-bold text-white transition hover:bg-neutral-800 disabled:opacity-50"
                      >
                        {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {additionalDue > 0 && tablePaymentMode === 'RAZORPAY'
                          ? `Generate ₹${additionalDue.toLocaleString('en-IN')} Razorpay QR`
                          : additionalDue > 0 && tablePaymentMode !== 'COMPLIMENTARY'
                            ? `Collect ₹${additionalDue.toLocaleString('en-IN')} & Save Tables`
                            : 'Save Tables'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 3: SETTLE PENDING PAYMENT */}
          {tab === 'payment' && isPendingPayment && (
            <div className="space-y-4">
              {settleRazorpayUrl ? (
                <div className="rounded-2xl bg-neutral-950 p-5 text-center text-white">
                  <div className="text-xs font-bold uppercase tracking-widest text-amber-400">
                    Scan to Pay Pending Balance
                  </div>
                  <div className="mt-1 text-2xl font-extrabold tabular-nums">
                    ₹{booking.totalAmount.toLocaleString('en-IN')}
                  </div>
                  <div className="my-4 flex justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/qr/link?url=${encodeURIComponent(settleRazorpayUrl)}`}
                      alt="Razorpay Payment QR"
                      className="h-44 w-44 rounded-2xl bg-white p-2"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <a
                      href={settleRazorpayUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-bold text-neutral-950 hover:bg-neutral-200"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open Razorpay Link
                    </a>
                    <button
                      type="button"
                      onClick={() => setSettleRazorpayUrl(null)}
                      className="rounded-xl border border-white/20 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-white/10"
                    >
                      Switch to Cash / UPI
                    </button>
                  </div>
                  <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-emerald-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Checking payment status every 3s…
                  </div>
                </div>
              ) : (
                <>
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <div className="text-xs font-bold text-amber-900">Pending Balance Due</div>
                    <div className="mt-1 text-2xl font-extrabold text-amber-950 tabular-nums">
                      ₹{booking.totalAmount.toLocaleString('en-IN')}
                    </div>
                    <div className="mt-0.5 text-xs text-amber-800">
                      Current mode: <strong>{booking.paymentMode}</strong> · Status:{' '}
                      <strong>{booking.paymentStatus}</strong>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { key: 'RAZORPAY', label: 'Razorpay QR / Link' },
                        { key: 'CASH', label: 'Cash Collected' },
                        { key: 'OFFICER_UPI', label: 'Officer UPI' },
                        { key: 'COMPLIMENTARY', label: 'Complimentary (₹0)' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => setSettleMode(m.key)}
                        className={`rounded-xl border px-3 py-2.5 text-xs font-bold transition ${settleMode === m.key
                            ? 'border-neutral-900 bg-neutral-900 text-white'
                            : 'border-neutral-200 bg-white text-neutral-800 hover:border-neutral-400'
                          }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  {settleMode !== 'RAZORPAY' && (
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-neutral-700">
                      <input
                        type="checkbox"
                        checked={settleResendPass}
                        onChange={(e) => setSettleResendPass(e.target.checked)}
                        className="h-4 w-4 rounded border-neutral-300"
                      />
                      Send confirmed Master QR pass via WhatsApp &amp; Email
                    </label>
                  )}

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-xl border border-neutral-200 px-4 py-2 text-xs font-bold text-neutral-700 hover:bg-neutral-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleSettlePayment}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {settleMode === 'RAZORPAY'
                        ? 'Generate Razorpay QR'
                        : 'Confirm Payment Received'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 4: CANCEL & REFUND */}
          {tab === 'cancel' && !isCancelled && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-xs text-rose-900">
                <div className="font-bold">Cancel Booking &amp; Release Tables</div>
                <p className="mt-1 text-rose-800">
                  Cancelling preserves the audit record, immediately releases any reserved tables (
                  {booking.tablesSummary}), and blocks gate check-in for this Master QR.
                </p>
              </div>

              <div className="rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-neutral-600">Amount Paid</span>
                  <span className="text-sm font-extrabold text-neutral-950 tabular-nums">
                    ₹{effectivePaidAmount.toLocaleString('en-IN')}
                  </span>
                </div>

                {effectivePaidAmount > 0 && (
                  <>
                    <div className="mt-3">
                      <label className="mb-1 block text-xs font-bold text-neutral-800">
                        Refund Amount (₹)
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={effectivePaidAmount}
                          value={refundAmount}
                          onChange={(e) => setRefundAmount(e.target.value)}
                          className="w-36 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm font-bold text-neutral-900 tabular-nums focus:border-neutral-900 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setRefundAmount(String(effectivePaidAmount))}
                          className="rounded-lg bg-neutral-200 px-2.5 py-1.5 text-[11px] font-bold text-neutral-800 hover:bg-neutral-300"
                        >
                          Full (₹{effectivePaidAmount.toLocaleString('en-IN')})
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setRefundAmount(String(Math.round(effectivePaidAmount / 2)))
                          }
                          className="rounded-lg bg-neutral-200 px-2.5 py-1.5 text-[11px] font-bold text-neutral-800 hover:bg-neutral-300"
                        >
                          50% (₹{Math.round(effectivePaidAmount / 2).toLocaleString('en-IN')})
                        </button>
                        <button
                          type="button"
                          onClick={() => setRefundAmount('0')}
                          className="rounded-lg bg-neutral-200 px-2.5 py-1.5 text-[11px] font-bold text-neutral-800 hover:bg-neutral-300"
                        >
                          ₹0 (No Refund)
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between rounded-xl bg-white px-3 py-2 text-xs ring-1 ring-neutral-200">
                      <span className="text-neutral-600">Retained in Net Revenue</span>
                      <span className="font-extrabold text-emerald-700 tabular-nums">
                        ₹{retainedPreview.toLocaleString('en-IN')}
                      </span>
                    </div>

                    {parsedRefundNum > 0 && (
                      <div className="mt-3">
                        <label className="mb-1.5 block text-xs font-bold text-neutral-800">
                          Refund Method
                        </label>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <button
                            type="button"
                            disabled={!canRazorpayRefund}
                            onClick={() => setRefundMethod('RAZORPAY_API')}
                            className={`rounded-xl border px-3 py-2 text-left text-xs font-bold transition ${!canRazorpayRefund
                                ? 'cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400'
                                : refundMethod === 'RAZORPAY_API'
                                  ? 'border-neutral-900 bg-neutral-900 text-white'
                                  : 'border-neutral-200 bg-white text-neutral-800 hover:border-neutral-400'
                              }`}
                          >
                            <div>Razorpay API</div>
                            <div className="text-[10px] font-normal opacity-80">
                              {canRazorpayRefund ? 'Auto-refund to source' : 'Not paid via Razorpay'}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setRefundMethod('OFFLINE_CASH')}
                            className={`rounded-xl border px-3 py-2 text-left text-xs font-bold transition ${refundMethod === 'OFFLINE_CASH'
                                ? 'border-neutral-900 bg-neutral-900 text-white'
                                : 'border-neutral-200 bg-white text-neutral-800 hover:border-neutral-400'
                              }`}
                          >
                            <div>Offline — Cash</div>
                            <div className="text-[10px] font-normal opacity-80">
                              Handed back in cash
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setRefundMethod('OFFLINE_UPI')}
                            className={`rounded-xl border px-3 py-2 text-left text-xs font-bold transition ${refundMethod === 'OFFLINE_UPI'
                                ? 'border-neutral-900 bg-neutral-900 text-white'
                                : 'border-neutral-200 bg-white text-neutral-800 hover:border-neutral-400'
                              }`}
                          >
                            <div>Offline — UPI / Bank</div>
                            <div className="text-[10px] font-normal opacity-80">
                              Manual UPI / bank transfer
                            </div>
                          </button>
                        </div>

                        {refundMethod !== 'RAZORPAY_API' && (
                          <div className="mt-2.5">
                            <input
                              type="text"
                              value={refundReference}
                              onChange={(e) => setRefundReference(e.target.value)}
                              placeholder="Optional UPI Ref # or cash receipt note..."
                              className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs text-neutral-900 focus:border-neutral-900 focus:outline-none"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-neutral-700">
                  Cancellation Reason (Optional)
                </label>
                <input
                  type="text"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Guest unable to attend, duplicate booking..."
                  className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-xs text-neutral-900 focus:border-neutral-900 focus:outline-none"
                />
              </div>

              {booking.email && (
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-neutral-700">
                  <input
                    type="checkbox"
                    checked={sendCancelEmail}
                    onChange={(e) => setSendCancelEmail(e.target.checked)}
                    className="h-4 w-4 rounded border-neutral-300"
                  />
                  Send cancellation confirmation email to {booking.email}
                </label>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-neutral-200 px-4 py-2 text-xs font-bold text-neutral-700 hover:bg-neutral-100"
                >
                  Keep Booking
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleCancelAndRefund}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-5 py-2 text-xs font-bold text-white transition hover:bg-rose-700 disabled:opacity-50"
                >
                  {submitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Confirm Cancellation
                  {parsedRefundNum > 0
                    ? ` & Refund ₹${parsedRefundNum.toLocaleString('en-IN')}`
                    : ''}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
