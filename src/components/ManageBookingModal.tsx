'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Loader2,
  Lock,
  UserPen,
  Users,
} from 'lucide-react'
import type { DashboardBookingRow, DashboardTableCard } from './EventDashboardClient'
import {
  Button,
  FieldLabel,
  ModalShell,
  SegmentedTabs,
  SelectInput,
  StatusBadge,
  TextArea,
  TextInput,
  buttonClasses,
  type SegmentedTabItem,
} from '@/components/ui/primitives'

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
  const isUnpaidDoorBooking = booking.status === 'pay_at_door'
  const isPendingPayment =
    !isCancelled &&
    (isUnpaidDoorBooking ||
      booking.paymentStatus === 'pending' ||
      booking.status === 'pending_payment')

  const [tab, setTab] = useState<ManageTab>('details')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // --- TAB 1: Details & Guests ---
  const [holderName, setHolderName] = useState(booking.holderName)
  const [phone, setPhone] = useState(booking.phone)
  const [email, setEmail] = useState(booking.email || '')
  const [notes, setNotes] = useState(booking.notes || '')
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
    'RAZORPAY' | 'CASH' | 'OFFICER_UPI' | 'COMPLIMENTARY' | 'ADD_TO_DOOR'
  >(isUnpaidDoorBooking ? 'ADD_TO_DOOR' : 'RAZORPAY')
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

  const assignedLabels = useMemo(
    () => booking.assignedTableLabels || [],
    [booking.assignedTableLabels],
  )
  const existingCatalogFee = useMemo(() => {
    let sum = 0
    for (const lbl of assignedLabels) {
      const t = tables.find((x) => x.tableLabel === lbl)
      if (t) sum += Math.max(0, Number(t.price) || 0)
    }
    return sum
  }, [assignedLabels, tables])
  const existingTableFee = Math.max(booking.assignedTableFee ?? 0, existingCatalogFee)
  const newTableFee = useMemo(() => {
    let sum = 0
    for (const lbl of selectedTableLabels) {
      const t = tables.find((x) => x.tableLabel === lbl)
      if (t) sum += Math.max(0, Number(t.price) || 0)
    }
    return sum
  }, [selectedTableLabels, tables])
  const additionalDue = Math.max(0, newTableFee - existingTableFee)
  const hasTableChanges = useMemo(() => {
    if (selectedTableLabels.length !== assignedLabels.length) return true
    return selectedTableLabels.some((lbl) => !assignedLabels.includes(lbl))
  }, [selectedTableLabels, assignedLabels])

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
          onUpdated(
            `Payment of ₹${booking.totalAmount.toLocaleString('en-IN')} confirmed via Razorpay!`,
          )
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
  }, [
    isPollingRazorpay,
    upgradePendingLink,
    settleRazorpayUrl,
    booking.id,
    booking.totalAmount,
    onUpdated,
  ])

  function toggleTable(label: string) {
    if (assignedLabels.includes(label)) return
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

  const tabItems: SegmentedTabItem<ManageTab>[] = [
    { key: 'details', label: 'Details', icon: UserPen },
    ...(!isCancelled ? [{ key: 'tables' as const, label: 'Tables', icon: Users }] : []),
    ...(isPendingPayment
      ? [{ key: 'payment' as const, label: 'Collect Due', icon: CreditCard, tone: 'amber' as const }]
      : []),
    ...(!isCancelled
      ? [{ key: 'cancel' as const, label: 'Cancel', icon: Ban, tone: 'rose' as const }]
      : []),
  ]

  return (
    <ModalShell
      title={booking.holderName}
      badge={<StatusBadge tone="dark">{booking.bookingCode}</StatusBadge>}
      subtitle={`${event.name} · ${booking.totalPax} Guests · ₹${booking.totalAmount.toLocaleString('en-IN')}`}
      onClose={onClose}
      disableClose={submitting}
      maxWidthClass="max-w-2xl"
    >
      <div className="space-y-4">
        {tabItems.length > 1 && (
          <SegmentedTabs
            value={tab}
            onChange={(next) => {
              setTab(next)
              setError(null)
            }}
            items={tabItems}
          />
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {isCancelled && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <div className="font-extrabold">This booking is cancelled.</div>
            <div className="mt-1 space-y-1">
              <div>
                Paid: <strong>₹{effectivePaidAmount.toLocaleString('en-IN')}</strong> · Refunded:{' '}
                <strong>₹{(booking.refundAmount || 0).toLocaleString('en-IN')}</strong>
                {booking.refundMethod && booking.refundMethod !== 'NONE'
                  ? ` (${booking.refundMethod})`
                  : ''}
              </div>
              {booking.refundReference && <div>Ref: {booking.refundReference}</div>}
              {booking.notes && (
                <div className="whitespace-pre-wrap text-rose-800">{booking.notes}</div>
              )}
            </div>
          </div>
        )}

        {/* TAB 1: DETAILS & GUESTS */}
        {tab === 'details' && (
          <form onSubmit={handleSaveDetails} className="space-y-4">
            <div className="grid gap-3.5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <FieldLabel>Booking Holder Name *</FieldLabel>
                <TextInput
                  type="text"
                  required
                  disabled={isCancelled}
                  value={holderName}
                  onChange={(e) => setHolderName(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel>WhatsApp / Phone *</FieldLabel>
                <TextInput
                  type="tel"
                  required
                  disabled={isCancelled}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel>Email *</FieldLabel>
                <TextInput
                  type="email"
                  disabled={isCancelled}
                  value={email}
                  required
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            {booking.slots && booking.slots.length > 0 && (
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <div className="mb-3 text-sm font-extrabold text-neutral-950">
                  Individual Guest Names ({booking.slots.length} Guests)
                </div>
                <div className="space-y-3">
                  {booking.slots.map((s, idx) => {
                    const locked = Boolean(s.checkedInAt)
                    return (
                      <div key={s.id} className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-bold text-neutral-600">
                            {s.ticketCode || `Guest #${idx + 1}`}
                          </span>
                          {locked && (
                            <StatusBadge tone="emerald">
                              <Lock className="h-3 w-3" />
                              Checked In
                            </StatusBadge>
                          )}
                        </div>
                        <TextInput
                          type="text"
                          disabled={isCancelled || locked}
                          value={slotNames[s.id] ?? s.attendeeName}
                          onChange={(e) =>
                            setSlotNames((prev) => ({ ...prev, [s.id]: e.target.value }))
                          }
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div>
              <FieldLabel>Booking Notes</FieldLabel>
              <TextArea
                rows={2}
                disabled={isCancelled}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Special seating or dietary notes…"
              />
            </div>

            {!isCancelled && (
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <div>
                  <FieldLabel>Resend Pass After Saving</FieldLabel>
                  <SelectInput
                    value={detailsResend}
                    onChange={(e) =>
                      setDetailsResend(e.target.value as 'none' | 'both' | 'whatsapp' | 'email')
                    }
                  >
                    <option value="none">Don&apos;t resend</option>
                    <option value="both">WhatsApp + Email</option>
                    <option value="whatsapp">WhatsApp only</option>
                    <option value="email">Email only</option>
                  </SelectInput>
                </div>
              </div>
            )}

            {!isCancelled && (
              <div className="flex gap-2.5 pt-2">
                <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
                  Cancel
                </Button>
                <Button type="submit" loading={submitting} className="flex-[1.5]">
                  Save Changes
                </Button>
              </div>
            )}
          </form>
        )}

        {/* TAB 2: TABLES & PAYMENT STEP */}
        {tab === 'tables' && !isCancelled && (
          <div className="space-y-4">
            {upgradePendingLink ? (
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-center">
                <StatusBadge tone="amber">Awaiting Table Fee Payment</StatusBadge>
                <div className="mt-2 text-2xl font-extrabold text-neutral-950 tabular-nums">
                  ₹{upgradePendingLink.additionalDue.toLocaleString('en-IN')}
                </div>
                <p className="mt-1 text-sm text-neutral-600">
                  Scan QR or open link below. Tables assign automatically once paid.
                </p>
                <div className="my-4 flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/qr/link?url=${encodeURIComponent(upgradePendingLink.url)}`}
                    alt="Razorpay Table Upgrade QR"
                    className="h-48 w-48 rounded-2xl border border-neutral-800 bg-neutral-950 p-3"
                  />
                </div>
                <div className="flex flex-col gap-2.5 sm:flex-row sm:justify-center">
                  <a
                    href={upgradePendingLink.url}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonClasses({ variant: 'primary' })}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open Razorpay Link
                  </a>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setUpgradePendingLink(null)}
                  >
                    Back / Switch Mode
                  </Button>
                </div>
                <div className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking payment status every 3s…
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-2.5 text-sm">
                  <span className="font-semibold text-neutral-700">
                    Selected:{' '}
                    <strong className="text-neutral-950">
                      {selectedTableLabels.length > 0 ? selectedTableLabels.join(', ') : 'None'}
                    </strong>
                  </span>
                  {newTableFee > 0 && (
                    <span className="font-extrabold text-neutral-950 tabular-nums">
                      Table fee: ₹{newTableFee.toLocaleString('en-IN')}
                    </span>
                  )}
                </div>

                {tables.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-600">
                    No tables configured for this event. Add tables in Payload Admin first.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                    {[...tables]
                      .sort((a, b) => {
                        const mine = booking.assignedTableLabels || []
                        const rank = (t: DashboardTableCard) =>
                          mine.includes(t.tableLabel) ? 0 : !t.isReserved ? 1 : 2
                        return rank(a) - rank(b)
                      })
                      .map((t) => {
                        const isMine = (booking.assignedTableLabels || []).includes(t.tableLabel)
                        const reservedByOther = t.isReserved && !isMine
                        const isSelected = selectedTableLabels.includes(t.tableLabel)
                        const price = Number(t.price) || 0

                        return (
                          <button
                            key={t.tableLabel}
                            type="button"
                            disabled={reservedByOther || isMine}
                            onClick={() => toggleTable(t.tableLabel)}
                            className={`flex min-h-16 flex-col items-start justify-between rounded-xl border p-3 text-left transition ${reservedByOther
                              ? 'cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-500'
                              : isMine
                                ? 'cursor-default border-2 border-neutral-950 bg-neutral-900 text-white'
                                : isSelected
                                  ? 'border-2 border-neutral-950 bg-neutral-900 text-white'
                                  : 'border-neutral-300 bg-white text-neutral-950 hover:border-neutral-500'
                              }`}
                          >
                            <div className="flex w-full items-center justify-between gap-1">
                              <span className="text-base font-extrabold">{t.tableLabel}</span>
                              {price > 0 && (
                                <span
                                  className={`rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${isSelected
                                    ? 'bg-white/20 text-emerald-300'
                                    : 'bg-neutral-100 text-neutral-900'
                                    }`}
                                >
                                  ₹{price.toLocaleString('en-IN')}
                                </span>
                              )}
                            </div>
                            <div
                              className={`mt-1 truncate text-xs font-medium ${isSelected ? 'text-neutral-300' : 'text-neutral-600'
                                }`}
                            >
                              {t.tableTypeName || 'Table'}
                            </div>
                            <div className="mt-1 text-xs font-bold">
                              {reservedByOther ? (
                                <span className="text-rose-700">
                                  Reserved
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

                {additionalDue > 0 && (
                  <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-extrabold text-emerald-950">
                          Table Fee Payment Step
                        </div>
                        <div className="text-sm text-emerald-800">
                          New ₹{newTableFee.toLocaleString('en-IN')} − Paid ₹
                          {existingTableFee.toLocaleString('en-IN')}
                        </div>
                      </div>
                      <div className="text-xl font-extrabold text-emerald-800 tabular-nums">
                        +₹{additionalDue.toLocaleString('en-IN')}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {(isUnpaidDoorBooking
                        ? ([
                          { key: 'ADD_TO_DOOR', label: 'Add to Door Balance' },
                          { key: 'COMPLIMENTARY', label: 'Waive (₹0)' },
                        ] as const)
                        : ([
                          { key: 'RAZORPAY', label: 'Razorpay QR' },
                          { key: 'CASH', label: 'Cash' },
                          { key: 'OFFICER_UPI', label: 'Officer UPI' },
                          { key: 'COMPLIMENTARY', label: 'Waive (₹0)' },
                        ] as const)
                      ).map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => setTablePaymentMode(m.key)}
                          className={`min-h-12 rounded-xl border px-3 text-sm font-bold transition ${tablePaymentMode === m.key
                            ? 'border-neutral-900 bg-neutral-900 text-white'
                            : 'border-emerald-300 bg-white text-neutral-900 hover:bg-emerald-100/60'
                            }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-3 border-t border-neutral-200 pt-4">
                  <div>
                    <FieldLabel>Notify Guest</FieldLabel>
                    <SelectInput
                      value={tableResend}
                      onChange={(e) =>
                        setTableResend(e.target.value as 'none' | 'both' | 'whatsapp' | 'email')
                      }
                    >
                      <option value="both">WhatsApp + Email</option>
                      <option value="whatsapp">WhatsApp only</option>
                      <option value="email">Email only</option>
                      <option value="none">Don&apos;t resend</option>
                    </SelectInput>
                  </div>

                  <div className="flex gap-2.5">
                    <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      loading={submitting}
                      disabled={!hasTableChanges}
                      onClick={handleSaveTables}
                      className="flex-[1.5]"
                    >
                      {!hasTableChanges
                        ? 'No Table Changes'
                        : additionalDue > 0 && tablePaymentMode === 'RAZORPAY'
                          ? `Generate ₹${additionalDue.toLocaleString('en-IN')} QR`
                          : additionalDue > 0 && tablePaymentMode === 'ADD_TO_DOOR'
                            ? `Add ₹${additionalDue.toLocaleString('en-IN')} to Door Total`
                            : additionalDue > 0 && tablePaymentMode !== 'COMPLIMENTARY'
                              ? `Collect ₹${additionalDue.toLocaleString('en-IN')} & Save`
                              : 'Save Tables'}
                    </Button>
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
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-center">
                <StatusBadge tone="amber">Scan to Pay Pending Balance</StatusBadge>
                <div className="mt-2 text-2xl font-extrabold text-neutral-950 tabular-nums">
                  ₹{booking.totalAmount.toLocaleString('en-IN')}
                </div>
                <div className="my-4 flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/qr/link?url=${encodeURIComponent(settleRazorpayUrl)}`}
                    alt="Razorpay Payment QR"
                    className="h-48 w-48 rounded-2xl border border-neutral-800 bg-neutral-950 p-3"
                  />
                </div>
                <div className="flex flex-col gap-2.5 sm:flex-row sm:justify-center">
                  <a
                    href={settleRazorpayUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonClasses({ variant: 'primary' })}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open Razorpay Link
                  </a>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setSettleRazorpayUrl(null)}
                  >
                    Switch to Cash / UPI
                  </Button>
                </div>
                <div className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking payment status every 3s…
                </div>
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
                  <div className="text-sm font-bold text-amber-900">Pending Balance Due</div>
                  <div className="mt-1 text-2xl font-extrabold text-amber-950 tabular-nums">
                    ₹{booking.totalAmount.toLocaleString('en-IN')}
                  </div>
                  <div className="mt-1 text-sm text-amber-900">
                    Booking status:{' '}
                    <strong>{isUnpaidDoorBooking ? 'Pay at Door' : booking.status}</strong> ·
                    Payment: <strong>{booking.paymentMode || 'Not collected yet'}</strong>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {(
                    [
                      { key: 'RAZORPAY', label: 'Razorpay QR' },
                      { key: 'CASH', label: 'Cash Collected' },
                      { key: 'OFFICER_UPI', label: 'Officer UPI' },
                      { key: 'COMPLIMENTARY', label: 'Complimentary (₹0)' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setSettleMode(m.key)}
                      className={`min-h-12 rounded-xl border px-3 text-sm font-bold transition ${settleMode === m.key
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50'
                        }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {settleMode !== 'RAZORPAY' && (
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-2 text-sm font-bold text-neutral-900">
                    <input
                      type="checkbox"
                      checked={settleResendPass}
                      onChange={(e) => setSettleResendPass(e.target.checked)}
                      className="h-6 w-6 rounded accent-neutral-900"
                    />
                    <span>Send confirmed Master QR pass via WhatsApp &amp; Email</span>
                  </label>
                )}

                <div className="flex gap-2.5 pt-2">
                  <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="success"
                    loading={submitting}
                    onClick={handleSettlePayment}
                    className="flex-[1.5]"
                  >
                    {settleMode === 'RAZORPAY'
                      ? 'Generate Razorpay QR'
                      : 'Confirm Payment Received'}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* TAB 4: CANCEL & REFUND */}
        {tab === 'cancel' && !isCancelled && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
              <div className="font-extrabold">Cancel Booking &amp; Release Tables</div>
              <p className="mt-1">
                Cancelling keeps the audit record, immediately frees reserved tables (
                {booking.tablesSummary}), and blocks gate check-in for this Master QR.
              </p>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-bold text-neutral-700">Amount Paid</span>
                <span className="text-lg font-extrabold text-neutral-950 tabular-nums">
                  ₹{effectivePaidAmount.toLocaleString('en-IN')}
                </span>
              </div>

              {effectivePaidAmount > 0 && (
                <>
                  <div className="mt-3.5">
                    <FieldLabel>Refund Amount (₹)</FieldLabel>
                    <TextInput
                      type="number"
                      min={0}
                      max={effectivePaidAmount}
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                      className="font-bold tabular-nums"
                    />
                    <div className="mt-2.5 grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setRefundAmount(String(effectivePaidAmount))}
                        className="min-h-11 rounded-xl border border-neutral-300 bg-white px-2 text-sm font-bold text-neutral-900 hover:bg-neutral-100"
                      >
                        Full
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setRefundAmount(String(Math.round(effectivePaidAmount / 2)))
                        }
                        className="min-h-11 rounded-xl border border-neutral-300 bg-white px-2 text-sm font-bold text-neutral-900 hover:bg-neutral-100"
                      >
                        50%
                      </button>
                      <button
                        type="button"
                        onClick={() => setRefundAmount('0')}
                        className="min-h-11 rounded-xl border border-neutral-300 bg-white px-2 text-sm font-bold text-neutral-900 hover:bg-neutral-100"
                      >
                        ₹0
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm">
                    <span className="font-semibold text-neutral-700">Retained in Net Revenue</span>
                    <span className="font-extrabold text-emerald-700 tabular-nums">
                      ₹{retainedPreview.toLocaleString('en-IN')}
                    </span>
                  </div>

                  {parsedRefundNum > 0 && (
                    <div className="mt-3.5">
                      <FieldLabel>Refund Method</FieldLabel>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <button
                          type="button"
                          disabled={!canRazorpayRefund}
                          onClick={() => setRefundMethod('RAZORPAY_API')}
                          className={`min-h-14 rounded-xl border px-3 py-2.5 text-left transition ${!canRazorpayRefund
                            ? 'cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-500'
                            : refundMethod === 'RAZORPAY_API'
                              ? 'border-neutral-900 bg-neutral-900 text-white'
                              : 'border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50'
                            }`}
                        >
                          <div className="text-sm font-bold">Razorpay API</div>
                          <div className="text-xs opacity-80">
                            {canRazorpayRefund ? 'Auto-refund' : 'Not Razorpay'}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setRefundMethod('OFFLINE_CASH')}
                          className={`min-h-14 rounded-xl border px-3 py-2.5 text-left transition ${refundMethod === 'OFFLINE_CASH'
                            ? 'border-neutral-900 bg-neutral-900 text-white'
                            : 'border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50'
                            }`}
                        >
                          <div className="text-sm font-bold">Offline Cash</div>
                          <div className="text-xs opacity-80">Handed back in cash</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setRefundMethod('OFFLINE_UPI')}
                          className={`min-h-14 rounded-xl border px-3 py-2.5 text-left transition ${refundMethod === 'OFFLINE_UPI'
                            ? 'border-neutral-900 bg-neutral-900 text-white'
                            : 'border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50'
                            }`}
                        >
                          <div className="text-sm font-bold">Offline UPI</div>
                          <div className="text-xs opacity-80">Manual bank / UPI</div>
                        </button>
                      </div>

                      {refundMethod !== 'RAZORPAY_API' && (
                        <div className="mt-3">
                          <TextInput
                            type="text"
                            value={refundReference}
                            onChange={(e) => setRefundReference(e.target.value)}
                            placeholder="Optional UPI Ref # or cash receipt note…"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            <div>
              <FieldLabel>Cancellation Reason (Optional)</FieldLabel>
              <TextInput
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Guest unable to attend, duplicate booking…"
              />
            </div>

            {booking.email && (
              <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-2 text-sm font-bold text-neutral-900">
                <input
                  type="checkbox"
                  checked={sendCancelEmail}
                  onChange={(e) => setSendCancelEmail(e.target.checked)}
                  className="h-6 w-6 rounded accent-neutral-900"
                />
                <span>Send cancellation email to {booking.email}</span>
              </label>
            )}

            <div className="flex gap-2.5 pt-2">
              <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
                Keep Booking
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={submitting}
                onClick={handleCancelAndRefund}
                className="flex-[1.5]"
              >
                {!submitting && <CheckCircle2 className="h-4 w-4" />}
                Confirm Cancel
                {parsedRefundNum > 0
                  ? ` & Refund ₹${parsedRefundNum.toLocaleString('en-IN')}`
                  : ''}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  )
}
