'use client'

import React, { useMemo, useState } from 'react'
import {
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  Download,
  Printer,
  RotateCcw,
  Send,
  X,
} from 'lucide-react'
import { compareFinancialYearCodesDesc } from '@/lib/financial-year'
import {
  Button,
  Card,
  EmptyState,
  FieldLabel,
  ModalShell,
  PageHeader,
  SegmentedTabs,
  SelectInput,
  StatGrid,
  StatusBadge,
  TextInput,
  buttonClasses,
} from '@/components/ui/primitives'

export type SettlementStatus =
  | 'with_officer'
  | 'transferred_to_treasurer'
  | 'received_by_treasurer'

interface FinanceEvent {
  id: number
  code: string
  name: string
  date: string
  fyCode: string
}

interface FinanceBooking {
  id: number
  eventId: number
  bookingCode: string
  holderName: string
  phone: string
  totalPax: number
  totalAmount: number
  paidAmount?: number
  refundAmount?: number
  refundMethod?: string | null
  paymentMode: string | null
  paymentStatus: string
  status: string
  officerName: string
  settlementStatus: SettlementStatus
  transferReference?: string | null
  transferredAt?: string | null
  receivedAt?: string | null
  createdAt: string
}

function getNetBookingAmount(b: FinanceBooking): number {
  if (b.status === 'cancelled') {
    const paid = typeof b.paidAmount === 'number' ? b.paidAmount : 0
    const refunded = Number(b.refundAmount) || 0
    return Math.max(0, paid - refunded)
  }
  return b.totalAmount
}

interface FinanceClientProps {
  events: FinanceEvent[]
  currentFyCode: string
  initialFyCode?: string | null
  initialEventId: number | null
  canConfirmReceived: boolean
  canMarkTransferred: boolean
  bookings: FinanceBooking[]
}

export function FinanceClient({
  events,
  currentFyCode,
  initialFyCode,
  initialEventId,
  canConfirmReceived,
  canMarkTransferred,
  bookings: initialBookings,
}: FinanceClientProps) {
  const defaultFilter = initialEventId
    ? String(initialEventId)
    : `fy:${initialFyCode || currentFyCode}`
  const [selectedFilter, setSelectedFilter] = useState<string>(defaultFilter)
  const [bookings, setBookings] = useState<FinanceBooking[]>(initialBookings)
  const [filterStatus, setFilterStatus] = useState<'all' | SettlementStatus>('with_officer')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Modal replacing browser window.prompt for transfer reference note
  const [transferModalIds, setTransferModalIds] = useState<number[] | null>(null)
  const [transferRefInput, setTransferRefInput] = useState('')

  const eventFyById = useMemo(
    () => new Map(events.map((e) => [e.id, e.fyCode])),
    [events],
  )

  const availableFys = useMemo(() => {
    const set = new Set<string>([currentFyCode])
    if (initialFyCode) set.add(initialFyCode)
    for (const ev of events) {
      if (ev.fyCode) set.add(ev.fyCode)
    }
    return Array.from(set).sort(compareFinancialYearCodesDesc)
  }, [events, currentFyCode, initialFyCode])

  const eventsByFy = useMemo(() => {
    const grouped = new Map<string, FinanceEvent[]>()
    for (const ev of events) {
      const list = grouped.get(ev.fyCode) || []
      list.push(ev)
      grouped.set(ev.fyCode, list)
    }
    return grouped
  }, [events])

  const selectedFyCode = selectedFilter.startsWith('fy:') ? selectedFilter.slice(3) : null

  const activeScopeLabel = useMemo(() => {
    if (selectedFyCode) return `${selectedFyCode} · All Events`
    const ev = events.find((e) => String(e.id) === selectedFilter)
    return ev ? `${ev.code} — ${ev.name}` : `${currentFyCode} · All Events`
  }, [selectedFyCode, selectedFilter, events, currentFyCode])

  const scopedBookings = useMemo(
    () =>
      bookings.filter((b) => {
        if (b.status === 'pending_payment') return false
        if (selectedFyCode) {
          return eventFyById.get(b.eventId) === selectedFyCode
        }
        return String(b.eventId) === selectedFilter
      }),
    [bookings, selectedFyCode, selectedFilter, eventFyById],
  )

  const doorDueTotals = useMemo(() => {
    const doorBookings = scopedBookings.filter((b) => b.status === 'pay_at_door')
    return {
      doorCount: doorBookings.length,
      doorDue: doorBookings.reduce((sum, b) => sum + b.totalAmount, 0),
    }
  }, [scopedBookings])

  const activeBookings = useMemo(
    () =>
      scopedBookings.filter(
        (b) =>
          b.status !== 'pay_at_door' &&
          b.paymentStatus !== 'pending' &&
          (b.status !== 'cancelled' || getNetBookingAmount(b) > 0),
      ),
    [scopedBookings],
  )

  const filteredBookings = useMemo(() => {
    return activeBookings.filter((b) => {
      if (filterStatus === 'all') return true
      return b.settlementStatus === filterStatus
    })
  }, [activeBookings, filterStatus])

  const totals = useMemo(() => {
    let gross = 0
    let refunded = 0
    let activeCount = 0
    let received = 0
    let transferred = 0
    let withOfficer = 0
    let withOfficerCount = 0
    let transferredCount = 0
    let receivedCount = 0

    for (const b of scopedBookings) {
      refunded += Number(b.refundAmount) || 0
    }

    for (const b of activeBookings) {
      const amt = getNetBookingAmount(b)
      if (b.status !== 'cancelled') activeCount += 1
      gross += amt
      if (b.settlementStatus === 'received_by_treasurer') {
        received += amt
        receivedCount += 1
      } else if (b.settlementStatus === 'transferred_to_treasurer') {
        transferred += amt
        transferredCount += 1
      } else {
        withOfficer += amt
        withOfficerCount += 1
      }
    }
    return {
      count: activeCount,
      gross,
      refunded,
      received,
      transferred,
      withOfficer,
      withOfficerCount,
      transferredCount,
      receivedCount,
    }
  }, [activeBookings, scopedBookings])

  const officerRows = useMemo(() => {
    const map = new Map<
      string,
      {
        officerName: string
        bookingCount: number
        razorpayAmount: number
        cashAmount: number
        upiAmount: number
        totalAmount: number
        receivedAmount: number
        transferredAmount: number
        withOfficerAmount: number
      }
    >()

    for (const b of activeBookings) {
      const key = b.officerName || 'Unassigned'
      const curr = map.get(key) || {
        officerName: key,
        bookingCount: 0,
        razorpayAmount: 0,
        cashAmount: 0,
        upiAmount: 0,
        totalAmount: 0,
        receivedAmount: 0,
        transferredAmount: 0,
        withOfficerAmount: 0,
      }
      const amt = getNetBookingAmount(b)
      if (b.status !== 'cancelled') curr.bookingCount += 1
      curr.totalAmount += amt
      if (b.paymentMode === 'RAZORPAY') curr.razorpayAmount += amt
      else if (b.paymentMode === 'CASH') curr.cashAmount += amt
      else if (b.paymentMode === 'OFFICER_UPI') curr.upiAmount += amt

      if (b.settlementStatus === 'received_by_treasurer') {
        curr.receivedAmount += amt
      } else if (b.settlementStatus === 'transferred_to_treasurer') {
        curr.transferredAmount += amt
      } else {
        curr.withOfficerAmount += amt
      }

      map.set(key, curr)
    }

    return Array.from(map.values()).sort((a, b) => b.totalAmount - a.totalAmount)
  }, [activeBookings])

  const modeRows = useMemo(() => {
    const map = new Map<
      string,
      {
        paymentMode: string
        bookingCount: number
        totalPax: number
        totalAmount: number
        receivedAmount: number
        transferredAmount: number
      }
    >()
    for (const b of activeBookings) {
      if (!b.paymentMode) continue
      const curr = map.get(b.paymentMode) || {
        paymentMode: b.paymentMode,
        bookingCount: 0,
        totalPax: 0,
        totalAmount: 0,
        receivedAmount: 0,
        transferredAmount: 0,
      }
      const amt = getNetBookingAmount(b)
      if (b.status !== 'cancelled') {
        curr.bookingCount += 1
        curr.totalPax += b.totalPax
      }
      curr.totalAmount += amt
      if (b.settlementStatus === 'received_by_treasurer') {
        curr.receivedAmount += amt
      } else if (b.settlementStatus === 'transferred_to_treasurer') {
        curr.transferredAmount += amt
      }
      map.set(b.paymentMode, curr)
    }
    return Array.from(map.values()).sort((a, b) => a.paymentMode.localeCompare(b.paymentMode))
  }, [activeBookings])

  function toggleSelect(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function openTransferModal(ids: number[]) {
    if (ids.length === 0) return
    setTransferRefInput('')
    setTransferModalIds(ids)
  }

  async function runHandoverAction(
    ids: number[],
    action: 'mark_transferred' | 'confirm_received' | 'reset_with_officer',
    transferReference?: string,
  ) {
    if (ids.length === 0) return

    setSubmitting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/finance/handover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          bookingIds: ids,
          action,
          transferReference: transferReference?.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.error || 'Handover update failed')
        return
      }

      const nowIso = data.timestamp || new Date().toISOString()
      const cleanRef = transferReference?.trim() || null
      setBookings((prev) =>
        prev.map((b) => {
          if (!ids.includes(b.id)) return b
          if (action === 'mark_transferred') {
            return {
              ...b,
              settlementStatus: 'transferred_to_treasurer',
              transferredAt: nowIso,
              transferReference: cleanRef || b.transferReference || null,
            }
          }
          if (action === 'confirm_received') {
            return {
              ...b,
              settlementStatus: 'received_by_treasurer',
              receivedAt: nowIso,
            }
          }
          return {
            ...b,
            settlementStatus: 'with_officer',
            transferredAt: null,
            transferReference: null,
            receivedAt: null,
          }
        }),
      )
      setSelectedIds([])
      setTransferModalIds(null)

      const label =
        action === 'mark_transferred'
          ? 'marked as Sent to Treasurer'
          : action === 'confirm_received'
            ? 'confirmed as Received by Treasurer'
            : 'moved back to With Officer'
      setMessage(`${ids.length} booking(s) ${label}.`)
    } finally {
      setSubmitting(false)
    }
  }

  const exportHref = selectedFyCode
    ? `/api/finance/export?fy=${encodeURIComponent(selectedFyCode)}`
    : `/api/finance/export?eventId=${encodeURIComponent(selectedFilter)}`

  const canInteract = canMarkTransferred || canConfirmReceived

  return (
    <div className="space-y-5">

      {/* Scope Filter */}
      <div className="no-print">
        <FieldLabel htmlFor="finance-scope">Financial Year or Event</FieldLabel>
        <SelectInput
          id="finance-scope"
          value={selectedFilter}
          onChange={(e) => {
            setSelectedFilter(e.target.value)
            setSelectedIds([])
          }}
        >
          <optgroup label="Financial Year (Apr – Mar)">
            {availableFys.map((fy) => (
              <option key={fy} value={`fy:${fy}`}>
                {fy} · All Events
              </option>
            ))}
          </optgroup>
          {availableFys.map((fy) => {
            const fyEvents = eventsByFy.get(fy) || []
            if (fyEvents.length === 0) return null
            return (
              <optgroup key={`events-${fy}`} label={`${fy} Events`}>
                {fyEvents.map((ev) => (
                  <option key={ev.id} value={String(ev.id)}>
                    {ev.code} — {ev.name}
                  </option>
                ))}
              </optgroup>
            )
          })}
        </SelectInput>
      </div>
      <div className='flex gap-4'>
        <a
          href={exportHref}
          className={buttonClasses({ variant: 'success', size: 'md' })}
        >
          <Download className="h-4 w-4" />
          Export Excel
        </a>
        <Button
          type="button"
          variant="secondary"
          onClick={() => window.print()}
        >
          <Printer className="h-4 w-4" />
          Print / PDF
        </Button>
      </div>

      {/* Summary Metrics */}
      <StatGrid
        items={[
          {
            label: 'Net Revenue',
            value: `₹${totals.gross.toLocaleString('en-IN')}`,
            sub: `${totals.count} paid${
              doorDueTotals.doorDue > 0
                ? ` · +₹${doorDueTotals.doorDue.toLocaleString('en-IN')} at door`
                : ''
            }${totals.refunded > 0 ? ` · ₹${totals.refunded.toLocaleString('en-IN')} ref` : ''}`,
          },
          {
            label: 'With Officers',
            value: `₹${totals.withOfficer.toLocaleString('en-IN')}`,
            sub: `${totals.withOfficerCount} not yet sent`,
            tone: 'amber',
          },
          {
            label: 'Sent to Treasurer',
            value: `₹${totals.transferred.toLocaleString('en-IN')}`,
            sub: `${totals.transferredCount} awaiting receipt`,
          },
          {
            label: 'Received',
            value: `₹${totals.received.toLocaleString('en-IN')}`,
            sub: `${totals.receivedCount} settled`,
            tone: 'emerald',
          },
        ]}
      />

      {/* Officer Reconciliation & Payment Modes */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="text-base font-extrabold text-neutral-950">
            Officer-Wise Cash &amp; UPI Reconciliation
          </h2>

          {/* Mobile Officer Cards */}
          <div className="mt-3.5 space-y-3 md:hidden">
            {officerRows.length === 0 ? (
              <p className="py-4 text-sm text-neutral-600">No collections recorded yet.</p>
            ) : (
              officerRows.map((o, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-neutral-200 bg-neutral-50 p-3.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-base font-extrabold text-neutral-950">
                        {o.officerName}
                      </div>
                      <div className="text-sm text-neutral-600">
                        {o.bookingCount} {o.bookingCount === 1 ? 'booking' : 'bookings'}
                      </div>
                    </div>
                    <div className="text-right text-lg font-extrabold text-neutral-950 tabular-nums">
                      ₹{o.totalAmount.toLocaleString('en-IN')}
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-neutral-200 pt-2.5 text-sm text-neutral-700 tabular-nums">
                    {o.razorpayAmount > 0 && (
                      <span>Razorpay: ₹{o.razorpayAmount.toLocaleString('en-IN')}</span>
                    )}
                    <span>Cash: ₹{o.cashAmount.toLocaleString('en-IN')}</span>
                    <span>UPI: ₹{o.upiAmount.toLocaleString('en-IN')}</span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm font-bold tabular-nums">
                    <span className="text-emerald-700">
                      Received: ₹{o.receivedAmount.toLocaleString('en-IN')}
                    </span>
                    <span className="text-neutral-800">
                      Sent: ₹{o.transferredAmount.toLocaleString('en-IN')}
                    </span>
                    <span className="text-amber-700">
                      With Officer: ₹{o.withOfficerAmount.toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Desktop Officer Table */}
          <div className="mt-3 hidden overflow-x-auto md:block">
            <table className="min-w-full divide-y divide-neutral-200 text-left text-sm">
              <thead className="bg-neutral-50 text-xs font-bold uppercase text-neutral-600">
                <tr>
                  <th className="px-3 py-3">Officer</th>
                  <th className="px-3 py-3">Bookings</th>
                  <th className="px-3 py-3">Total &amp; Split</th>
                  <th className="px-3 py-3">Treasurer Handover</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {officerRows.map((o, idx) => (
                  <tr key={idx} className="align-top">
                    <td className="px-3 py-3 font-bold text-neutral-950">{o.officerName}</td>
                    <td className="px-3 py-3 tabular-nums">{o.bookingCount}</td>
                    <td className="px-3 py-3 tabular-nums">
                      <div className="font-extrabold text-neutral-950">
                        ₹{o.totalAmount.toLocaleString('en-IN')}
                      </div>
                      <div className="mt-0.5 space-y-0.5 text-xs font-medium text-neutral-600">
                        {o.razorpayAmount > 0 && (
                          <div>Razorpay: ₹{o.razorpayAmount.toLocaleString('en-IN')}</div>
                        )}
                        <div>Cash: ₹{o.cashAmount.toLocaleString('en-IN')}</div>
                        <div>UPI: ₹{o.upiAmount.toLocaleString('en-IN')}</div>
                      </div>
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      <div className="font-bold text-emerald-700">
                        Received: ₹{o.receivedAmount.toLocaleString('en-IN')}
                      </div>
                      <div className="mt-0.5 space-y-0.5 text-xs font-semibold">
                        <div className="text-neutral-800">
                          Sent: ₹{o.transferredAmount.toLocaleString('en-IN')}
                        </div>
                        <div className="text-amber-700">
                          With Officer: ₹{o.withOfficerAmount.toLocaleString('en-IN')}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
                {officerRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-sm text-neutral-600">
                      No collections recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <h2 className="text-base font-extrabold text-neutral-950">Payment Modes</h2>
          <div className="mt-3.5 space-y-2.5">
            {modeRows.length === 0 ? (
              <p className="py-4 text-sm text-neutral-600">No payments yet.</p>
            ) : (
              modeRows.map((m) => (
                <div
                  key={m.paymentMode}
                  className="flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-3"
                >
                  <div>
                    <div className="text-sm font-extrabold text-neutral-950">
                      {m.paymentMode}
                    </div>
                    <div className="text-xs font-medium text-neutral-600">
                      {m.bookingCount} bookings · {m.totalPax} guests
                    </div>
                  </div>
                  <div className="text-right tabular-nums">
                    <div className="text-base font-extrabold text-neutral-950">
                      ₹{m.totalAmount.toLocaleString('en-IN')}
                    </div>
                    <div className="text-xs font-bold text-emerald-700">
                      ₹{m.receivedAmount.toLocaleString('en-IN')} received
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Treasurer Transfer Queue */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-extrabold text-neutral-950">
            <ArrowRightLeft className="h-5 w-5 text-neutral-700" />
            Treasurer Transfer Queue
          </h2>
        </div>

        <div className="no-print">
          <SegmentedTabs
            value={filterStatus}
            onChange={(next) => {
              setFilterStatus(next)
              setSelectedIds([])
            }}
            items={[
              { key: 'with_officer', label: `With Officer (${totals.withOfficerCount})` },
              { key: 'transferred_to_treasurer', label: `Sent (${totals.transferredCount})` },
              { key: 'received_by_treasurer', label: `Received (${totals.receivedCount})` },
              { key: 'all', label: 'All' },
            ]}
          />
        </div>

        {selectedIds.length > 0 && (
          <div className="no-print flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-neutral-300 bg-white p-3.5">
            <span className="text-sm font-bold text-neutral-900">
              {selectedIds.length} booking{selectedIds.length === 1 ? '' : 's'} selected
            </span>
            <div className="flex flex-wrap gap-2">
              {canMarkTransferred && filterStatus === 'with_officer' && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={submitting}
                  onClick={() => openTransferModal(selectedIds)}
                >
                  <Send className="h-4 w-4" />
                  Mark Sent ({selectedIds.length})
                </Button>
              )}
              {canConfirmReceived && filterStatus !== 'received_by_treasurer' && (
                <Button
                  type="button"
                  variant="success"
                  size="sm"
                  loading={submitting}
                  onClick={() => runHandoverAction(selectedIds, 'confirm_received')}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Confirm Received ({selectedIds.length})
                </Button>
              )}
            </div>
          </div>
        )}

        {message && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-950">
            <span>{message}</span>
            <button
              type="button"
              onClick={() => setMessage(null)}
              aria-label="Dismiss message"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-emerald-800 hover:bg-emerald-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Mobile Transfer Queue Cards */}
        <div className="space-y-3 md:hidden">
          {filteredBookings.length === 0 ? (
            <EmptyState
              icon={ArrowRightLeft}
              title="No bookings in this stage"
              description="Switch tabs above to view other handover stages."
            />
          ) : (
            filteredBookings.map((b) => {
              const selectable = canInteract && b.settlementStatus !== 'received_by_treasurer'
              const isChecked = selectedIds.includes(b.id)
              return (
                <div
                  key={b.id}
                  className={`overflow-hidden rounded-2xl border bg-white ${isChecked ? 'border-neutral-900 ring-1 ring-neutral-900' : 'border-neutral-200'
                    }`}
                >
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      {selectable && (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelect(b.id)}
                          aria-label={`Select booking ${b.bookingCode}`}
                          className="no-print mt-0.5 h-6 w-6 shrink-0 rounded accent-neutral-900"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-base font-extrabold text-neutral-950">
                              {b.holderName}
                            </div>
                            <div className="text-sm font-semibold text-neutral-700 tabular-nums">
                              {b.bookingCode} · {b.phone}
                            </div>
                          </div>
                          <div className="shrink-0 text-right tabular-nums">
                            <div className="text-base font-extrabold text-neutral-950">
                              ₹{b.totalAmount.toLocaleString('en-IN')}
                            </div>
                            <div className="text-xs font-bold text-neutral-600">
                              {b.paymentMode}
                            </div>
                          </div>
                        </div>

                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="font-medium text-neutral-700">
                            By {b.officerName} · {b.totalPax} guests
                          </span>
                          {b.settlementStatus === 'received_by_treasurer' ? (
                            <StatusBadge tone="emerald">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Received
                            </StatusBadge>
                          ) : b.settlementStatus === 'transferred_to_treasurer' ? (
                            <StatusBadge tone="neutral">
                              <Send className="h-3.5 w-3.5" />
                              Sent
                            </StatusBadge>
                          ) : (
                            <StatusBadge tone="amber">
                              <Clock className="h-3.5 w-3.5" />
                              With Officer
                            </StatusBadge>
                          )}
                        </div>

                        {b.transferReference && (
                          <div className="mt-2 rounded-lg bg-neutral-50 px-2.5 py-1.5 text-xs font-semibold text-neutral-700">
                            Ref: {b.transferReference}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {canInteract && (
                    <div className="no-print flex flex-wrap gap-2 border-t border-neutral-200 bg-neutral-50 p-2.5">
                      {b.settlementStatus === 'with_officer' && canMarkTransferred && (
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          disabled={submitting}
                          onClick={() => openTransferModal([b.id])}
                          className="flex-1"
                        >
                          <Send className="h-4 w-4" />
                          Mark Sent
                        </Button>
                      )}
                      {b.settlementStatus === 'transferred_to_treasurer' &&
                        canConfirmReceived && (
                          <Button
                            type="button"
                            variant="success"
                            size="sm"
                            disabled={submitting}
                            onClick={() => runHandoverAction([b.id], 'confirm_received')}
                            className="flex-1"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Confirm Received
                          </Button>
                        )}
                      {b.settlementStatus === 'transferred_to_treasurer' &&
                        canMarkTransferred && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={submitting}
                            onClick={() => runHandoverAction([b.id], 'reset_with_officer')}
                          >
                            <RotateCcw className="h-4 w-4" />
                            Undo
                          </Button>
                        )}
                      {b.settlementStatus === 'received_by_treasurer' &&
                        canConfirmReceived && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={submitting}
                            onClick={() => runHandoverAction([b.id], 'reset_with_officer')}
                            className="flex-1"
                          >
                            <RotateCcw className="h-4 w-4" />
                            Revert to Officer
                          </Button>
                        )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Desktop Transfer Queue Table */}
        <Card className="hidden overflow-x-auto p-0 md:block">
          <table className="min-w-full divide-y divide-neutral-200 text-left text-sm">
            <thead className="bg-neutral-50 text-xs font-bold uppercase text-neutral-600">
              <tr>
                {canInteract && <th className="no-print w-10 px-4 py-3.5" />}
                <th className="px-4 py-3.5">Code</th>
                <th className="px-4 py-3.5">Booking</th>
                <th className="px-4 py-3.5">Guests</th>
                <th className="px-4 py-3.5">Amount</th>
                <th className="px-4 py-3.5">Collected By</th>
                <th className="px-4 py-3.5">Status</th>
                {canInteract && <th className="no-print px-4 py-3.5">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {filteredBookings.map((b) => (
                <tr key={b.id}>
                  {canInteract && (
                    <td className="no-print px-4 py-3.5">
                      {b.settlementStatus !== 'received_by_treasurer' && (
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(b.id)}
                          onChange={() => toggleSelect(b.id)}
                          className="h-5 w-5 rounded accent-neutral-900"
                        />
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3.5 font-bold text-neutral-950">{b.bookingCode}</td>
                  <td className="px-4 py-3.5">
                    <div className="font-bold text-neutral-950">{b.holderName}</div>
                    <div className="text-xs font-medium text-neutral-600 tabular-nums">
                      {b.phone}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 tabular-nums">{b.totalPax}</td>
                  <td className="px-4 py-3.5 tabular-nums">
                    <div className="font-extrabold text-neutral-950">
                      ₹{b.totalAmount.toLocaleString('en-IN')}
                    </div>
                    <div className="text-xs font-semibold text-neutral-600">{b.paymentMode}</div>
                  </td>
                  <td className="px-4 py-3.5 font-medium text-neutral-800">{b.officerName}</td>
                  <td className="px-4 py-3.5">
                    {b.settlementStatus === 'received_by_treasurer' ? (
                      <div>
                        <StatusBadge tone="emerald">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Received
                        </StatusBadge>
                        {b.transferReference && (
                          <div className="mt-1 text-xs text-neutral-600">
                            Ref: {b.transferReference}
                          </div>
                        )}
                      </div>
                    ) : b.settlementStatus === 'transferred_to_treasurer' ? (
                      <div>
                        <StatusBadge tone="neutral">
                          <Send className="h-3.5 w-3.5" />
                          Sent
                        </StatusBadge>
                        {b.transferReference && (
                          <div className="mt-1 text-xs text-neutral-600">
                            Ref: {b.transferReference}
                          </div>
                        )}
                      </div>
                    ) : (
                      <StatusBadge tone="amber">
                        <Clock className="h-3.5 w-3.5" />
                        With Officer
                      </StatusBadge>
                    )}
                  </td>
                  {canInteract && (
                    <td className="no-print px-4 py-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {b.settlementStatus === 'with_officer' && canMarkTransferred && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => openTransferModal([b.id])}
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-neutral-900 px-3 text-xs font-bold text-white hover:bg-neutral-800 disabled:opacity-50"
                          >
                            <Send className="h-3.5 w-3.5" />
                            Mark Sent
                          </button>
                        )}
                        {b.settlementStatus === 'transferred_to_treasurer' &&
                          canConfirmReceived && (
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => runHandoverAction([b.id], 'confirm_received')}
                              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-emerald-700 px-3 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Confirm Received
                            </button>
                          )}
                        {b.settlementStatus === 'transferred_to_treasurer' &&
                          canMarkTransferred && (
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => runHandoverAction([b.id], 'reset_with_officer')}
                              className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-neutral-300 bg-white px-2.5 text-xs font-bold text-neutral-800 hover:bg-neutral-100"
                              title="Move back to With Officer"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          )}
                        {b.settlementStatus === 'received_by_treasurer' &&
                          canConfirmReceived && (
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => runHandoverAction([b.id], 'reset_with_officer')}
                              className="inline-flex min-h-10 items-center rounded-xl border border-neutral-300 bg-white px-3 text-xs font-bold text-neutral-800 hover:bg-neutral-100"
                            >
                              Revert
                            </button>
                          )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {filteredBookings.length === 0 && (
                <tr>
                  <td
                    colSpan={canInteract ? 8 : 6}
                    className="px-4 py-10 text-center text-sm text-neutral-600"
                  >
                    No bookings in this stage.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Handover Reference Modal (replaces window.prompt) */}
      {transferModalIds && (
        <ModalShell
          title="Mark as Sent to Treasurer"
          subtitle={`Marking ${transferModalIds.length} booking${transferModalIds.length === 1 ? '' : 's'} as transferred.`}
          onClose={() => setTransferModalIds(null)}
          disableClose={submitting}
          maxWidthClass="max-w-md"
          footer={
            <div className="flex gap-2.5">
              <Button
                type="button"
                variant="secondary"
                disabled={submitting}
                onClick={() => setTransferModalIds(null)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                loading={submitting}
                onClick={() =>
                  runHandoverAction(transferModalIds, 'mark_transferred', transferRefInput)
                }
                className="flex-[1.5]"
              >
                {!submitting && <Send className="h-4 w-4" />}
                Confirm Handover
              </Button>
            </div>
          }
        >
          <div>
            <FieldLabel htmlFor="transfer-ref">
              UPI Reference # or Cash Note (Optional)
            </FieldLabel>
            <TextInput
              id="transfer-ref"
              type="text"
              autoFocus
              value={transferRefInput}
              onChange={(e) => setTransferRefInput(e.target.value)}
              placeholder="e.g. UPI Ref 412345678 or Handed cash to Treasurer"
            />
          </div>
        </ModalShell>
      )}
    </div>
  )
}
