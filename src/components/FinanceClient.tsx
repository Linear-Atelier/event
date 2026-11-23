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
} from 'lucide-react'

export type SettlementStatus =
  | 'with_officer'
  | 'transferred_to_treasurer'
  | 'received_by_treasurer'

interface FinanceEvent {
  id: number
  code: string
  name: string
}

interface FinanceBooking {
  id: number
  eventId: number
  bookingCode: string
  holderName: string
  phone: string
  totalPax: number
  totalAmount: number
  paymentMode: string
  paymentStatus: string
  status: string
  officerName: string
  settlementStatus: SettlementStatus
  transferReference?: string | null
  transferredAt?: string | null
  receivedAt?: string | null
  createdAt: string
}

interface FinanceClientProps {
  events: FinanceEvent[]
  initialEventId: number | null
  canConfirmReceived: boolean
  canMarkTransferred: boolean
  bookings: FinanceBooking[]
}

export function FinanceClient({
  events,
  initialEventId,
  canConfirmReceived,
  canMarkTransferred,
  bookings: initialBookings,
}: FinanceClientProps) {
  const [selectedEventId, setSelectedEventId] = useState<string>(
    initialEventId ? String(initialEventId) : 'all',
  )
  const [bookings, setBookings] = useState<FinanceBooking[]>(initialBookings)
  const [filterStatus, setFilterStatus] = useState<'all' | SettlementStatus>('with_officer')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const activeBookings = useMemo(
    () =>
      bookings.filter(
        (b) =>
          b.status !== 'cancelled' &&
          b.status !== 'pending_payment' &&
          (selectedEventId === 'all' || String(b.eventId) === selectedEventId),
      ),
    [bookings, selectedEventId],
  )

  const filteredBookings = useMemo(() => {
    return activeBookings.filter((b) => {
      if (filterStatus === 'all') return true
      return b.settlementStatus === filterStatus
    })
  }, [activeBookings, filterStatus])

  const totals = useMemo(() => {
    let gross = 0
    let received = 0
    let transferred = 0
    let withOfficer = 0
    let withOfficerCount = 0
    let transferredCount = 0
    let receivedCount = 0

    for (const b of activeBookings) {
      gross += b.totalAmount
      if (b.settlementStatus === 'received_by_treasurer') {
        received += b.totalAmount
        receivedCount += 1
      } else if (b.settlementStatus === 'transferred_to_treasurer') {
        transferred += b.totalAmount
        transferredCount += 1
      } else {
        withOfficer += b.totalAmount
        withOfficerCount += 1
      }
    }
    return {
      count: activeBookings.length,
      gross,
      received,
      transferred,
      withOfficer,
      withOfficerCount,
      transferredCount,
      receivedCount,
    }
  }, [activeBookings])

  const officerRows = useMemo(() => {
    const map = new Map<
      string,
      {
        officerName: string
        bookingCount: number
        cashAmount: number
        upiAmount: number
        doorAmount: number
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
        cashAmount: 0,
        upiAmount: 0,
        doorAmount: 0,
        totalAmount: 0,
        receivedAmount: 0,
        transferredAmount: 0,
        withOfficerAmount: 0,
      }
      curr.bookingCount += 1
      curr.totalAmount += b.totalAmount
      if (b.paymentMode === 'CASH') curr.cashAmount += b.totalAmount
      else if (b.paymentMode === 'OFFICER_UPI') curr.upiAmount += b.totalAmount
      else if (b.paymentMode === 'PAY_AT_DOOR') curr.doorAmount += b.totalAmount

      if (b.settlementStatus === 'received_by_treasurer') {
        curr.receivedAmount += b.totalAmount
      } else if (b.settlementStatus === 'transferred_to_treasurer') {
        curr.transferredAmount += b.totalAmount
      } else {
        curr.withOfficerAmount += b.totalAmount
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
      const curr = map.get(b.paymentMode) || {
        paymentMode: b.paymentMode,
        bookingCount: 0,
        totalPax: 0,
        totalAmount: 0,
        receivedAmount: 0,
        transferredAmount: 0,
      }
      curr.bookingCount += 1
      curr.totalPax += b.totalPax
      curr.totalAmount += b.totalAmount
      if (b.settlementStatus === 'received_by_treasurer') {
        curr.receivedAmount += b.totalAmount
      } else if (b.settlementStatus === 'transferred_to_treasurer') {
        curr.transferredAmount += b.totalAmount
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

  async function runHandoverAction(
    ids: number[],
    action: 'mark_transferred' | 'confirm_received' | 'reset_with_officer',
    askForRef = false,
  ) {
    if (ids.length === 0) return

    let transferReference: string | undefined
    if (askForRef) {
      const input = window.prompt(
        'Optional UPI Ref # or Cash Handover Note (leave blank to skip):',
        '',
      )
      if (input === null) return // user cancelled prompt
      transferReference = input.trim() || undefined
    }

    setSubmitting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/finance/handover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ bookingIds: ids, action, transferReference }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.error || 'Handover update failed')
        return
      }

      const nowIso = data.timestamp || new Date().toISOString()
      setBookings((prev) =>
        prev.map((b) => {
          if (!ids.includes(b.id)) return b
          if (action === 'mark_transferred') {
            return {
              ...b,
              settlementStatus: 'transferred_to_treasurer',
              transferredAt: nowIso,
              transferReference: transferReference || b.transferReference || null,
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

      const label =
        action === 'mark_transferred'
          ? 'marked as Transferred to Treasurer (awaiting receipt)'
          : action === 'confirm_received'
            ? 'confirmed as Received by Treasurer'
            : 'reset to With Officer'
      setMessage(`${ids.length} booking(s) ${label}.`)
    } finally {
      setSubmitting(false)
    }
  }

  const exportHref =
    selectedEventId === 'all'
      ? '/api/finance/export'
      : `/api/finance/export?eventId=${selectedEventId}`

  const canInteract = canMarkTransferred || canConfirmReceived

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">
            Treasurer Finance &amp; Handover Tracking
          </h1>
          <p className="text-sm text-neutral-600">
            Track collected funds from Booking Officers to Treasurer receipt, plus AGM Excel/PDF exports.
          </p>
        </div>

        <div className="no-print flex flex-wrap items-center gap-2">
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-800"
          >
            <option value="all">All Events</option>
            {events.map((ev) => (
              <option key={ev.id} value={String(ev.id)}>
                {ev.code} — {ev.name}
              </option>
            ))}
          </select>

          <a
            href={exportHref}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            <Download className="h-4 w-4" />
            Export Excel (.xlsx)
          </a>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50"
          >
            <Printer className="h-4 w-4" />
            Print / Save PDF
          </button>
        </div>
      </div>

      {/* Dark Frosted Glass Handover Summary Banner */}
      <div className="glass-surface rounded-3xl p-5 text-white shadow-xl">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div>
            <div className="text-[11px] font-medium text-neutral-300">Gross Revenue</div>
            <div className="mt-1 text-2xl font-extrabold tracking-tight text-white">
              ₹{totals.gross.toLocaleString('en-IN')}
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-400">
              {totals.count} active bookings
            </div>
          </div>

          <div>
            <div className="text-[11px] font-medium text-amber-300">With Officers</div>
            <div className="mt-1 text-2xl font-extrabold tracking-tight text-amber-300">
              ₹{totals.withOfficer.toLocaleString('en-IN')}
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-300">
              {totals.withOfficerCount} not yet transferred
            </div>
          </div>

          <div>
            <div className="text-[11px] font-medium text-white">Sent to Treasurer</div>
            <div className="mt-1 text-2xl font-extrabold tracking-tight text-white">
              ₹{totals.transferred.toLocaleString('en-IN')}
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-300">
              {totals.transferredCount} awaiting receipt
            </div>
          </div>

          <div>
            <div className="text-[11px] font-medium text-emerald-300">
              Received by Treasurer
            </div>
            <div className="mt-1 text-2xl font-extrabold tracking-tight text-emerald-300">
              ₹{totals.received.toLocaleString('en-IN')}
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-300">
              {totals.receivedCount} settled
            </div>
          </div>
        </div>
      </div>

      {/* Officer Cash Reconciliation & Payment Modes (Borderless White Sections) */}
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="text-sm font-bold text-neutral-900">
            Officer-Wise Cash &amp; UPI Reconciliation
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-left text-xs">
              <thead className="bg-neutral-50 text-[11px] font-semibold uppercase text-neutral-500">
                <tr>
                  <th className="px-3 py-2">Officer</th>
                  <th className="px-3 py-2">Bookings</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Treasurer Handover</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {officerRows.map((o, idx) => (
                  <tr key={idx} className="align-top">
                    <td className="px-3 py-2.5 font-semibold text-neutral-900">{o.officerName}</td>
                    <td className="px-3 py-2.5">{o.bookingCount}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-bold text-neutral-900">
                        ₹{o.totalAmount.toLocaleString('en-IN')}
                      </div>
                      <div className="mt-0.5 space-y-0.5 text-[11px] text-neutral-500">
                        <div>Cash: ₹{o.cashAmount.toLocaleString('en-IN')}</div>
                        <div>UPI: ₹{o.upiAmount.toLocaleString('en-IN')}</div>
                        <div>Door: ₹{o.doorAmount.toLocaleString('en-IN')}</div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-bold text-emerald-700">
                        Received: ₹{o.receivedAmount.toLocaleString('en-IN')}
                      </div>
                      <div className="mt-0.5 space-y-0.5 text-[11px]">
                        <div className="text-neutral-900">
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
                    <td colSpan={4} className="px-3 py-6 text-center text-neutral-400">
                      No collections recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="ticket-perforation pt-6 lg:border-t-0 lg:pt-0">
          <h2 className="text-sm font-bold text-neutral-900">Payment Mode Breakdown</h2>
          <div className="mt-3 space-y-2.5">
            {modeRows.map((m) => (
              <div
                key={m.paymentMode}
                className="flex items-center justify-between rounded-2xl bg-neutral-50/80 px-4 py-3 text-xs"
              >
                <div>
                  <div className="font-bold text-neutral-900">{m.paymentMode}</div>
                  <div className="text-[11px] text-neutral-500">
                    {m.bookingCount} bookings · {m.totalPax} pax
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-neutral-900">
                    ₹{m.totalAmount.toLocaleString('en-IN')}
                  </div>
                  <div className="text-[11px] text-emerald-700">
                    ₹{m.receivedAmount.toLocaleString('en-IN')} received
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2-Step Treasurer Handover Queue */}
      <div className="ticket-perforation pt-6">
        <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-neutral-900">
              <ArrowRightLeft className="h-4 w-4 text-neutral-700" />
              Treasurer Transfer Queue
            </h2>
            <div className="inline-flex flex-wrap gap-1 rounded-2xl bg-neutral-100/90 p-1 text-xs">
              {(
                [
                  { key: 'with_officer', label: `With Officer (${totals.withOfficerCount})` },
                  {
                    key: 'transferred_to_treasurer',
                    label: `Sent (${totals.transferredCount})`,
                  },
                  { key: 'received_by_treasurer', label: `Received (${totals.receivedCount})` },
                  { key: 'all', label: 'All' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setFilterStatus(tab.key)
                    setSelectedIds([])
                  }}
                  className={`rounded-xl px-3 py-1.5 font-bold transition ${
                    filterStatus === tab.key
                      ? 'bg-white text-neutral-950 shadow-xs'
                      : 'text-neutral-500 hover:text-neutral-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {selectedIds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {canMarkTransferred && filterStatus === 'with_officer' && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => runHandoverAction(selectedIds, 'mark_transferred', true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  Mark Transferred ({selectedIds.length})
                </button>
              )}
              {canConfirmReceived && filterStatus !== 'received_by_treasurer' && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => runHandoverAction(selectedIds, 'confirm_received', false)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Confirm Received ({selectedIds.length})
                </button>
              )}
            </div>
          )}
        </div>

        {message && (
          <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900">
            {message}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-200 text-left text-xs">
            <thead className="bg-neutral-50 text-[11px] font-semibold uppercase text-neutral-500">
              <tr>
                {canInteract && <th className="no-print w-8 px-3 py-2.5" />}
                <th className="px-3 py-2.5">Code</th>
                <th className="px-3 py-2.5">Booking</th>
                <th className="px-3 py-2.5">Pax</th>
                <th className="px-3 py-2.5">Amount</th>
                <th className="px-3 py-2.5">Collected By</th>
                <th className="px-3 py-2.5">Handover Status</th>
                {canInteract && <th className="no-print px-3 py-2.5">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filteredBookings.map((b) => (
                <tr key={b.id}>
                  {canInteract && (
                    <td className="no-print px-3 py-2.5">
                      {b.settlementStatus !== 'received_by_treasurer' && (
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(b.id)}
                          onChange={() => toggleSelect(b.id)}
                        />
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2.5 font-bold text-neutral-900">{b.bookingCode}</td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-neutral-900">{b.holderName}</div>
                    <div className="text-[11px] text-neutral-500">{b.phone}</div>
                  </td>
                  <td className="px-3 py-2.5">{b.totalPax}</td>
                  <td className="px-3 py-2.5">
                    <div className="font-bold text-neutral-900">
                      ₹{b.totalAmount.toLocaleString('en-IN')}
                    </div>
                    <div className="text-[10px] text-neutral-500">{b.paymentMode}</div>
                  </td>
                  <td className="px-3 py-2.5 text-neutral-700">{b.officerName}</td>
                  <td className="px-3 py-2.5">
                    {b.settlementStatus === 'received_by_treasurer' ? (
                      <div>
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                          <CheckCircle2 className="h-3 w-3" /> Received by Treasurer
                        </span>
                        {b.transferReference && (
                          <div className="mt-0.5 text-[10px] text-neutral-500">
                            Ref: {b.transferReference}
                          </div>
                        )}
                      </div>
                    ) : b.settlementStatus === 'transferred_to_treasurer' ? (
                      <div>
                        <span className="inline-flex items-center gap-1 rounded-full bg-neutral-200/80 px-2 py-0.5 text-[10px] font-bold text-neutral-800">
                          <Send className="h-3 w-3" /> Sent to Treasurer
                        </span>
                        {b.transferReference && (
                          <div className="mt-0.5 text-[10px] text-neutral-500">
                            Ref: {b.transferReference}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                        <Clock className="h-3 w-3" /> With Officer
                      </span>
                    )}
                  </td>
                  {canInteract && (
                    <td className="no-print px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {b.settlementStatus === 'with_officer' && canMarkTransferred && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => runHandoverAction([b.id], 'mark_transferred', true)}
                            className="inline-flex items-center gap-1 rounded bg-neutral-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
                          >
                            <Send className="h-3 w-3" />
                            Mark Transferred
                          </button>
                        )}
                        {b.settlementStatus === 'transferred_to_treasurer' &&
                          canConfirmReceived && (
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => runHandoverAction([b.id], 'confirm_received', false)}
                              className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Confirm Received
                            </button>
                          )}
                        {b.settlementStatus === 'transferred_to_treasurer' &&
                          canMarkTransferred && (
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() =>
                                runHandoverAction([b.id], 'reset_with_officer', false)
                              }
                              className="inline-flex items-center gap-1 rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
                              title="Move back to With Officer"
                            >
                              <RotateCcw className="h-3 w-3" />
                            </button>
                          )}
                        {b.settlementStatus === 'received_by_treasurer' &&
                          canConfirmReceived && (
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() =>
                                runHandoverAction([b.id], 'reset_with_officer', false)
                              }
                              className="rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
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
                    className="px-3 py-8 text-center text-neutral-400"
                  >
                    No bookings in this stage.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
