'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CreditCard,
  LayoutGrid,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Ticket,
  Users,
  X,
} from 'lucide-react'

export interface DashboardBookingRow {
  id: number
  bookingCode: string
  holderName: string
  phone: string
  email?: string | null
  totalPax: number
  totalAmount: number
  status: string
  paymentMode: string
  paymentStatus: string
  collectedByName: string
  treasurerVerified: boolean
  ticketCodes: string[]
  physicalIssuedCount: number
  totalTicketCount: number
  tablesSummary: string
  allocatedSeats: number
  checkedInPax: number
  createdAt: string
}

export interface DashboardTableCard {
  id: number
  tableLabel: string
  tableTypeName?: string
  maxCapacity: number
  isShared: boolean
  occupiedSeats: number
  allocations: Array<{
    bookingCode: string
    holderName: string
    allocatedSeats: number
  }>
}

export interface DashboardCheckinRow {
  id: number
  bookingCode: string
  holderName: string
  label: string
  checkedInAt: string
  checkedInByName: string
  deviceId: string
  method: string
}

export interface DashboardOfficerSummary {
  officerName: string
  bookingCount: number
  totalPax: number
  cashAmount: number
  upiAmount: number
  doorAmount: number
  totalAmount: number
  verifiedAmount: number
  unverifiedCount: number
}

export interface DashboardModeSummary {
  paymentMode: string
  bookingCount: number
  totalPax: number
  totalAmount: number
  verifiedAmount: number
}

interface EventDashboardClientProps {
  event: {
    id: number
    code: string
    name: string
    date: string
    venue: string
    publicKey?: string | null
  }
  bookings: DashboardBookingRow[]
  tables: DashboardTableCard[]
  recentCheckins: DashboardCheckinRow[]
  officerSummary: DashboardOfficerSummary[]
  modeSummary: DashboardModeSummary[]
  totalSlots: number
  checkedInSlots: number
}

type TabKey = 'overview' | 'bookings' | 'seating' | 'treasurer' | 'attendance'

export function EventDashboardClient({
  event,
  bookings,
  tables,
  recentCheckins,
  officerSummary,
  modeSummary,
  totalSlots,
  checkedInSlots,
}: EventDashboardClientProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [qrModalBooking, setQrModalBooking] = useState<DashboardBookingRow | null>(null)
  const [resendingId, setResendingId] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const activeBookings = useMemo(
    () => bookings.filter((b) => b.status !== 'cancelled'),
    [bookings],
  )

  const totalPax = useMemo(
    () => activeBookings.reduce((s, b) => s + b.totalPax, 0),
    [activeBookings],
  )
  const totalRevenue = useMemo(
    () => activeBookings.reduce((s, b) => s + b.totalAmount, 0),
    [activeBookings],
  )
  const verifiedRevenue = useMemo(
    () =>
      activeBookings
        .filter((b) => b.treasurerVerified)
        .reduce((s, b) => s + b.totalAmount, 0),
    [activeBookings],
  )

  const totalTableCapacity = useMemo(
    () => tables.reduce((s, t) => s + t.maxCapacity, 0),
    [tables],
  )
  const totalSeatsAllocated = useMemo(
    () => tables.reduce((s, t) => s + t.occupiedSeats, 0),
    [tables],
  )

  const underAllocatedBookings = useMemo(
    () =>
      activeBookings.filter(
        (b) => b.allocatedSeats > 0 && b.allocatedSeats < b.totalPax,
      ),
    [activeBookings],
  )

  const filteredBookings = useMemo(() => {
    const q = search.trim().toLowerCase()
    return bookings.filter((b) => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false
      if (!q) return true
      return (
        b.bookingCode.toLowerCase().includes(q) ||
        b.holderName.toLowerCase().includes(q) ||
        b.phone.toLowerCase().includes(q) ||
        b.ticketCodes.some((tc) => tc.toLowerCase().includes(q))
      )
    })
  }, [bookings, search, statusFilter])

  const attendancePct = totalSlots > 0 ? Math.round((checkedInSlots / totalSlots) * 100) : 0

  async function handleResend(bookingId: number) {
    setResendingId(bookingId)
    setToast(null)
    try {
      const res = await fetch(`/api/bookings/${bookingId}/resend`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (res.ok) {
        setToast(
          `Pass resent — WhatsApp: ${data.result?.whatsapp || 'logged'}, Email: ${data.result?.email || 'logged'}`,
        )
      } else {
        setToast(data.error || 'Resend failed')
      }
    } catch {
      setToast('Network error while resending')
    } finally {
      setResendingId(null)
    }
  }

  const tabs: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'overview', label: 'Overview', icon: LayoutGrid },
    { key: 'bookings', label: `Bookings (${bookings.length})`, icon: Ticket },
    { key: 'seating', label: `Seating (${tables.length})`, icon: Users },
    { key: 'treasurer', label: 'Treasurer Summary', icon: CreditCard },
    { key: 'attendance', label: `Live Attendance (${attendancePct}%)`, icon: CheckCircle2 },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800">
              {event.code}
            </span>
            <span className="text-xs text-slate-500">
              {new Date(event.date).toLocaleString('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </span>
          </div>
          <h1 className="mt-1.5 text-2xl font-bold text-slate-900">{event.name}</h1>
          <p className="text-sm text-slate-600">{event.venue}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/desk?eventId=${event.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-700"
          >
            <Ticket className="h-4 w-4" />
            New Booking
          </Link>
          <Link
            href={`/finance?eventId=${event.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <CreditCard className="h-4 w-4" />
            Finance Queue
          </Link>
          <Link
            href={`/scan?eventId=${event.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            <QrCode className="h-4 w-4" />
            Gate Scanner
          </Link>
        </div>
      </div>

      {toast && (
        <div className="flex items-center justify-between rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs font-medium text-sky-900">
          <span>{toast}</span>
          <button type="button" onClick={() => setToast(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-semibold transition ${
                active
                  ? 'border-sky-600 text-sky-700'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-medium text-slate-500">Confirmed Bookings</div>
              <div className="mt-1 text-2xl font-bold text-slate-900">
                {activeBookings.length}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {totalPax} total guests (pax)
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-medium text-slate-500">Live Gate Attendance</div>
              <div className="mt-1 text-2xl font-bold text-sky-700">
                {checkedInSlots} / {totalSlots}
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-sky-500 transition-all"
                  style={{ width: `${attendancePct}%` }}
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-medium text-slate-500">Gross Revenue</div>
              <div className="mt-1 text-2xl font-bold text-emerald-700">
                ₹{totalRevenue.toLocaleString('en-IN')}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                ₹{verifiedRevenue.toLocaleString('en-IN')} treasurer verified
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-medium text-slate-500">Table Utilization</div>
              <div className="mt-1 text-2xl font-bold text-slate-900">
                {totalSeatsAllocated} / {totalTableCapacity}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                across {tables.length} tables
              </div>
            </div>
          </div>

          {underAllocatedBookings.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                {underAllocatedBookings.length} booking(s) have under-allocated table seats
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {underAllocatedBookings.map((b) => (
                  <span
                    key={b.id}
                    className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-amber-900 shadow-sm"
                  >
                    {b.bookingCode} ({b.holderName}): {b.allocatedSeats}/{b.totalPax} seats
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* BOOKINGS TAB */}
      {activeTab === 'bookings' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search B042, B042-T01, holder name, or phone..."
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-sky-500 focus:outline-none"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700"
            >
              <option value="all">All Statuses</option>
              <option value="confirmed">Confirmed</option>
              <option value="transferred">Transferred</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Booking</th>
                  <th className="px-4 py-3">Holder</th>
                  <th className="px-4 py-3">Pax / Check-In</th>
                  <th className="px-4 py-3">Tables</th>
                  <th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3">Physical</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBookings.map((b) => (
                  <tr key={b.id} className={b.status === 'cancelled' ? 'bg-rose-50/40 opacity-75' : ''}>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{b.bookingCode}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {b.ticketCodes.join(', ')}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{b.holderName}</div>
                      <div className="text-[11px] text-slate-500">{b.phone}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">
                        {b.checkedInPax} / {b.totalPax} in
                      </div>
                      <span
                        className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          b.status === 'confirmed'
                            ? 'bg-emerald-100 text-emerald-800'
                            : b.status === 'transferred'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {b.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-800">{b.tablesSummary}</div>
                      {b.allocatedSeats > 0 && b.allocatedSeats < b.totalPax && (
                        <span className="text-[10px] font-semibold text-amber-700">
                          Under-allocated ({b.allocatedSeats}/{b.totalPax})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">
                        ₹{b.totalAmount.toLocaleString('en-IN')}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {b.paymentMode} · {b.collectedByName}
                      </div>
                      {b.treasurerVerified ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" /> Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-700">
                          <Clock className="h-3 w-3" /> Pending Verify
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] text-slate-600">
                        {b.physicalIssuedCount}/{b.totalTicketCount} issued
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setQrModalBooking(b)}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          QR
                        </button>
                        <button
                          type="button"
                          disabled={resendingId === b.id}
                          onClick={() => handleResend(b.id)}
                          className="inline-flex items-center gap-1 rounded bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-50"
                        >
                          <Send className="h-3 w-3" />
                          {resendingId === b.id ? '...' : 'Resend'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredBookings.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      No matching bookings found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SEATING TAB */}
      {activeTab === 'seating' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tables.map((t) => {
            const pct = Math.min(100, Math.round((t.occupiedSeats / t.maxCapacity) * 100))
            const isFull = t.occupiedSeats >= t.maxCapacity
            return (
              <div
                key={t.id}
                className={`rounded-xl border bg-white p-4 shadow-sm ${
                  isFull ? 'border-emerald-300' : 'border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-slate-900">{t.tableLabel}</span>
                    {t.tableTypeName && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                        {t.tableTypeName}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-semibold text-slate-600">
                    {isFull ? 'Reserved' : 'Available'} · {t.maxCapacity} seats
                  </span>
                </div>

                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${
                      isFull ? 'bg-emerald-500' : 'bg-sky-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="mt-3 space-y-1.5">
                  {t.allocations.length === 0 ? (
                    <div className="text-xs italic text-slate-400">Available — no seats assigned</div>
                  ) : (
                    t.allocations.map((a, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded bg-slate-50 px-2.5 py-1.5 text-xs"
                      >
                        <span className="font-medium text-slate-800">
                          {a.bookingCode} · {a.holderName}
                        </span>
                        <span className="font-semibold text-slate-600">{a.allocatedSeats}p</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* TREASURER SUMMARY TAB */}
      {activeTab === 'treasurer' && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900">By Payment Mode</h3>
              <table className="mt-3 w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2">Mode</th>
                    <th className="py-2">Bookings</th>
                    <th className="py-2">Total</th>
                    <th className="py-2">Verified</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {modeSummary.map((m) => (
                    <tr key={m.paymentMode}>
                      <td className="py-2 font-semibold">{m.paymentMode}</td>
                      <td className="py-2">{m.bookingCount}</td>
                      <td className="py-2 font-medium">
                        ₹{Number(m.totalAmount).toLocaleString('en-IN')}
                      </td>
                      <td className="py-2 text-emerald-700">
                        ₹{Number(m.verifiedAmount).toLocaleString('en-IN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900">Officer Cash Reconciliation</h3>
              <table className="mt-3 w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2">Officer</th>
                    <th className="py-2">Cash</th>
                    <th className="py-2">UPI</th>
                    <th className="py-2">Total</th>
                    <th className="py-2">Unverified</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {officerSummary.map((o, idx) => (
                    <tr key={idx}>
                      <td className="py-2 font-semibold">{o.officerName}</td>
                      <td className="py-2">₹{Number(o.cashAmount).toLocaleString('en-IN')}</td>
                      <td className="py-2">₹{Number(o.upiAmount).toLocaleString('en-IN')}</td>
                      <td className="py-2 font-bold">
                        ₹{Number(o.totalAmount).toLocaleString('en-IN')}
                      </td>
                      <td className="py-2 text-amber-700">{o.unverifiedCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* LIVE ATTENDANCE TAB */}
      {activeTab === 'attendance' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <div className="text-sm font-bold text-slate-900">
                {checkedInSlots} of {totalSlots} guests checked in ({attendancePct}%)
              </div>
              <div className="text-xs text-slate-500">
                {totalSlots - checkedInSlots} pending arrival
              </div>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Booking</th>
                  <th className="px-4 py-3">Slot Label</th>
                  <th className="px-4 py-3">Gate Staff / Device</th>
                  <th className="px-4 py-3">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentCheckins.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2.5 text-slate-600">
                      {new Date(c.checkedInAt).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-slate-900">
                      {c.bookingCode} · {c.holderName}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{c.label}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {c.checkedInByName} ({c.deviceId})
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                        {c.method}
                      </span>
                    </td>
                  </tr>
                ))}
                {recentCheckins.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      No check-ins recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* QR PREVIEW MODAL */}
      {qrModalBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-sky-700">
                Master QR Pass
              </span>
              <button
                type="button"
                onClick={() => setQrModalBooking(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <h3 className="mt-2 text-lg font-bold text-slate-900">
              {qrModalBooking.bookingCode} · {qrModalBooking.holderName}
            </h3>
            <p className="text-xs text-slate-500">
              {qrModalBooking.totalPax} Pax · {qrModalBooking.tablesSummary}
            </p>

            <div className="my-4 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/qr/${encodeURIComponent(qrModalBooking.bookingCode)}`}
                alt={`QR ${qrModalBooking.bookingCode}`}
                className="h-56 w-56 rounded-xl border border-slate-200 p-2"
              />
            </div>

            <div className="text-[11px] text-slate-500">
              Tickets: {qrModalBooking.ticketCodes.join(', ')}
            </div>
            <div className="mt-1 text-[10px] text-slate-400">
              Linear Atelier · Ticketing Partner
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
