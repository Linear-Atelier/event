'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CreditCard,
  LayoutGrid,
  Loader2,
  Lock,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Ticket,
  Users,
  X,
} from 'lucide-react'

import { formatEventDayLabel } from '@/lib/event-date'

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
    isScanOpen?: boolean
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
      {/* Clean White Borderless Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-dashed border-neutral-200 pb-5 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-bold text-neutral-800">
              {event.code}
            </span>
            <span className="text-xs text-neutral-500">
              {new Date(event.date).toLocaleString('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-neutral-950">
            {event.name}
          </h1>
          <p className="text-sm text-neutral-500">{event.venue}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/desk?eventId=${event.id}`}
            className="inline-flex items-center gap-1.5 rounded-2xl bg-neutral-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-neutral-800"
          >
            <Ticket className="h-4 w-4" />
            New Booking
          </Link>
          <Link
            href={`/finance?eventId=${event.id}`}
            className="inline-flex items-center gap-1.5 rounded-2xl bg-neutral-100 px-4 py-2 text-xs font-bold text-neutral-700 transition hover:bg-neutral-200"
          >
            <CreditCard className="h-4 w-4" />
            Finance
          </Link>
          {event.isScanOpen === false ? (
            <button
              type="button"
              disabled
              title={`Gate scan opens on ${formatEventDayLabel(event.date)}`}
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-2xl bg-neutral-100 px-4 py-2 text-xs font-bold text-neutral-400"
            >
              <Lock className="h-4 w-4" />
              Gate Scan
            </button>
          ) : (
            <Link
              href={`/scan?eventId=${event.id}`}
              className="inline-flex items-center gap-1.5 rounded-2xl bg-neutral-950 px-4 py-2 text-xs font-bold text-white transition hover:bg-neutral-800"
            >
              <QrCode className="h-4 w-4" />
              Gate Scan
            </Link>
          )}
        </div>
      </div>

      {toast && (
        <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-100 px-4 py-2.5 text-xs font-medium text-neutral-900">
          <span>{toast}</span>
          <button type="button" onClick={() => setToast(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Soft Pill Tabs (White App Style) */}
      <div className="flex gap-1 overflow-x-auto rounded-2xl bg-neutral-100/90 p-1">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                active
                  ? 'bg-white text-neutral-950 shadow-xs'
                  : 'text-neutral-500 hover:text-neutral-900'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="glass-surface grid gap-5 rounded-3xl p-5 text-white shadow-xl sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Confirmed Bookings
              </div>
              <div className="mt-1 text-2xl font-extrabold text-white">
                {activeBookings.length}
              </div>
              <div className="mt-1 text-xs text-neutral-400">
                {totalPax} total guests (pax)
              </div>
            </div>

            <div className="sm:border-l sm:border-white/10 sm:pl-5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-white">
                Live Gate Attendance
              </div>
              <div className="mt-1 text-2xl font-extrabold text-white">
                {checkedInSlots} / {totalSlots}
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-white transition-all"
                  style={{ width: `${attendancePct}%` }}
                />
              </div>
            </div>

            <div className="lg:border-l lg:border-white/10 lg:pl-5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                Gross Revenue
              </div>
              <div className="mt-1 text-2xl font-extrabold text-emerald-300">
                ₹{totalRevenue.toLocaleString('en-IN')}
              </div>
              <div className="mt-1 text-xs text-neutral-400">
                ₹{verifiedRevenue.toLocaleString('en-IN')} received by treasurer
              </div>
            </div>

            <div className="sm:border-l sm:border-white/10 sm:pl-5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Table Utilization
              </div>
              <div className="mt-1 text-2xl font-extrabold text-white">
                {totalSeatsAllocated} / {totalTableCapacity}
              </div>
              <div className="mt-1 text-xs text-neutral-400">
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
        <div className="space-y-4 pb-16">
          <div className="space-y-2.5">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-zinc-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search code, ticket, holder name, or phone..."
                className="w-full rounded-2xl border border-zinc-200 bg-zinc-50/70 py-2.5 pl-10 pr-4 text-sm text-zinc-900 placeholder-zinc-400 transition focus:border-zinc-900 focus:bg-white focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { key: 'all', label: `All (${bookings.length})` },
                  {
                    key: 'confirmed',
                    label: `Confirmed (${bookings.filter((b) => b.status === 'confirmed').length})`,
                  },
                  {
                    key: 'pending_payment',
                    label: `Pending (${bookings.filter((b) => b.status === 'pending_payment').length})`,
                  },
                  {
                    key: 'transferred',
                    label: `Transferred (${bookings.filter((b) => b.status === 'transferred').length})`,
                  },
                  {
                    key: 'cancelled',
                    label: `Cancelled (${bookings.filter((b) => b.status === 'cancelled').length})`,
                  },
                ] as const
              ).map((pill) => (
                <button
                  key={pill.key}
                  type="button"
                  onClick={() => setStatusFilter(pill.key)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    statusFilter === pill.key
                      ? 'bg-zinc-900 text-white'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/80'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>

          {/* Mobile Booking Cards */}
          <div className="space-y-3 md:hidden">
            {filteredBookings.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-12 text-center">
                <Ticket className="mx-auto h-7 w-7 text-zinc-300" />
                <p className="mt-2 text-sm font-semibold text-zinc-700">No matching bookings</p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Try clearing your search or switching the status filter above.
                </p>
              </div>
            ) : (
              filteredBookings.map((b) => {
                const isUnderAllocated = b.allocatedSeats > 0 && b.allocatedSeats < b.totalPax
                const allCheckedIn = b.totalPax > 0 && b.checkedInPax >= b.totalPax
                return (
                  <div
                    key={b.id}
                    className={`overflow-hidden rounded-2xl border border-zinc-200 bg-white ${
                      b.status === 'cancelled' ? 'opacity-65' : ''
                    }`}
                  >
                    <div className="px-4 py-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[15px] font-bold leading-snug text-zinc-900">
                              {b.holderName}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                                b.status === 'confirmed'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : b.status === 'pending_payment'
                                    ? 'bg-amber-100 text-amber-800'
                                    : b.status === 'transferred'
                                      ? 'bg-sky-100 text-sky-800'
                                      : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {b.status === 'pending_payment' ? 'PENDING' : b.status}
                            </span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-zinc-500 tabular-nums">
                            <span className="font-semibold text-zinc-800">{b.bookingCode}</span>
                            <span>·</span>
                            <span>{b.phone}</span>
                          </div>
                        </div>

                        <div className="shrink-0 text-right tabular-nums">
                          <div className="text-sm font-bold text-zinc-900">
                            ₹{b.totalAmount.toLocaleString('en-IN')}
                          </div>
                          <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] font-semibold">
                            <span className="text-zinc-500">{b.paymentMode}</span>
                            {b.treasurerVerified ? (
                              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                            ) : (
                              <Clock className="h-3 w-3 text-amber-600" />
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Compact Status Chips */}
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] tabular-nums">
                        <span
                          className={`rounded-md px-2 py-0.5 font-semibold ${
                            allCheckedIn
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-zinc-100 text-zinc-700'
                          }`}
                        >
                          Check-in: {b.checkedInPax}/{b.totalPax}
                        </span>
                        <span
                          className={`rounded-md px-2 py-0.5 font-semibold ${
                            isUnderAllocated
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-zinc-100 text-zinc-700'
                          }`}
                        >
                          Table: {b.tablesSummary}
                        </span>
                        <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600">
                          Stubs: {b.physicalIssuedCount}/{b.totalTicketCount}
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[11px] text-zinc-500">
                        <span className="truncate">{b.ticketCodes.join(', ')}</span>
                        <span className="shrink-0">By {b.collectedByName}</span>
                      </div>
                    </div>

                    {/* Touch-Friendly Mobile Action Footer */}
                    <div className="flex items-center gap-2 border-t border-zinc-100 bg-zinc-50/50 px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setQrModalBooking(b)}
                        className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl bg-zinc-900 px-3 text-xs font-semibold text-white transition hover:bg-zinc-800"
                      >
                        <QrCode className="h-3.5 w-3.5" />
                        QR Pass
                      </button>
                      <button
                        type="button"
                        disabled={resendingId === b.id}
                        onClick={() => handleResend(b.id)}
                        className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-100 disabled:opacity-50"
                      >
                        {resendingId === b.id ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Sending…
                          </>
                        ) : (
                          <>
                            <Send className="h-3.5 w-3.5 text-zinc-500" />
                            Resend
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Desktop Bookings Table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full divide-y divide-neutral-200 text-left text-xs">
              <thead className="border-b border-neutral-200 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
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
              <tbody className="divide-y divide-neutral-100">
                {filteredBookings.map((b) => (
                  <tr key={b.id} className={b.status === 'cancelled' ? 'bg-rose-50/40 opacity-75' : ''}>
                    <td className="px-4 py-3">
                      <div className="font-bold text-neutral-900">{b.bookingCode}</div>
                      <div className="mt-0.5 text-[11px] text-neutral-500">
                        {b.ticketCodes.join(', ')}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-900">{b.holderName}</div>
                      <div className="text-[11px] text-neutral-500">{b.phone}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-neutral-900">
                        {b.checkedInPax} / {b.totalPax} in
                      </div>
                      <span
                        className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          b.status === 'confirmed'
                            ? 'bg-emerald-100 text-emerald-800'
                            : b.status === 'pending_payment'
                              ? 'bg-amber-100 text-amber-800'
                              : b.status === 'transferred'
                                ? 'bg-sky-100 text-sky-800'
                                : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {b.status === 'pending_payment' ? 'PENDING' : b.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-neutral-800">{b.tablesSummary}</div>
                      {b.allocatedSeats > 0 && b.allocatedSeats < b.totalPax && (
                        <span className="text-[10px] font-semibold text-amber-700">
                          Under-allocated ({b.allocatedSeats}/{b.totalPax})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-neutral-900">
                        ₹{b.totalAmount.toLocaleString('en-IN')}
                      </div>
                      <div className="text-[11px] text-neutral-500">
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
                      <span className="text-[11px] text-neutral-600">
                        {b.physicalIssuedCount}/{b.totalTicketCount} issued
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setQrModalBooking(b)}
                          className="rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
                        >
                          QR
                        </button>
                        <button
                          type="button"
                          disabled={resendingId === b.id}
                          onClick={() => handleResend(b.id)}
                          className="inline-flex items-center gap-1 rounded bg-neutral-100 px-2 py-1 text-[11px] font-medium text-neutral-900 hover:bg-neutral-200/80 disabled:opacity-50"
                        >
                          {resendingId === b.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Send className="h-3 w-3" />
                          )}
                          {resendingId === b.id ? '...' : 'Resend'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredBookings.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
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
        tables.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-neutral-200 bg-neutral-50/70 px-6 py-14 text-center">
            <Users className="mx-auto h-8 w-8 text-neutral-300" />
            <p className="mt-2.5 text-sm font-bold text-neutral-700">
              No tables configured for this event
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Add table groups in Payload Admin (`/admin`) to start assigning seats.
            </p>
          </div>
        ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tables.map((t) => {
            const pct = Math.min(100, Math.round((t.occupiedSeats / t.maxCapacity) * 100))
            const isFull = t.occupiedSeats >= t.maxCapacity
            return (
              <div
                key={t.id}
                className={`rounded-2xl p-4 ${
                  isFull ? 'bg-emerald-50/60 ring-1 ring-emerald-200/80' : 'bg-neutral-50/80'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-neutral-900">{t.tableLabel}</span>
                    {t.tableTypeName && (
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-700">
                        {t.tableTypeName}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-semibold text-neutral-600">
                    {isFull ? 'Reserved' : 'Available'} · {t.maxCapacity} seats
                  </span>
                </div>

                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className={`h-full rounded-full ${
                      isFull ? 'bg-emerald-500' : 'bg-neutral-900'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="mt-3 space-y-1.5">
                  {t.allocations.length === 0 ? (
                    <div className="text-xs italic text-neutral-400">Available — no seats assigned</div>
                  ) : (
                    t.allocations.map((a, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded bg-neutral-50 px-2.5 py-1.5 text-xs"
                      >
                        <span className="font-medium text-neutral-800">
                          {a.bookingCode} · {a.holderName}
                        </span>
                        <span className="font-semibold text-neutral-600">{a.allocatedSeats}p</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
        )
      )}

      {/* TREASURER SUMMARY TAB */}
      {activeTab === 'treasurer' && (
        <div className="space-y-6">
          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-bold text-neutral-900">By Payment Mode</h3>
              <table className="mt-3 w-full text-left text-xs">
                <thead className="border-b border-neutral-200 text-neutral-400">
                  <tr>
                    <th className="py-2">Mode</th>
                    <th className="py-2">Bookings</th>
                    <th className="py-2">Total</th>
                    <th className="py-2">Received</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {modeSummary.map((m) => (
                    <tr key={m.paymentMode}>
                      <td className="py-2.5 font-semibold">{m.paymentMode}</td>
                      <td className="py-2.5">{m.bookingCount}</td>
                      <td className="py-2.5 font-medium">
                        ₹{Number(m.totalAmount).toLocaleString('en-IN')}
                      </td>
                      <td className="py-2.5 text-emerald-700">
                        ₹{Number(m.verifiedAmount).toLocaleString('en-IN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ticket-perforation pt-6 md:border-t-0 md:pt-0">
              <h3 className="text-sm font-bold text-neutral-900">Officer Cash Reconciliation</h3>
              <table className="mt-3 w-full text-left text-xs">
                <thead className="border-b border-neutral-200 text-neutral-400">
                  <tr>
                    <th className="py-2">Officer</th>
                    <th className="py-2">Cash</th>
                    <th className="py-2">UPI</th>
                    <th className="py-2">Total</th>
                    <th className="py-2">Pending</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {officerSummary.map((o, idx) => (
                    <tr key={idx}>
                      <td className="py-2.5 font-semibold">{o.officerName}</td>
                      <td className="py-2.5">₹{Number(o.cashAmount).toLocaleString('en-IN')}</td>
                      <td className="py-2.5">₹{Number(o.upiAmount).toLocaleString('en-IN')}</td>
                      <td className="py-2.5 font-bold">
                        ₹{Number(o.totalAmount).toLocaleString('en-IN')}
                      </td>
                      <td className="py-2.5 text-amber-700">{o.unverifiedCount}</td>
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
        <div className="space-y-4 pb-16">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-bold text-zinc-950 tabular-nums">
                  {checkedInSlots} of {totalSlots} guests checked in ({attendancePct}%)
                </div>
                <div className="mt-0.5 text-xs text-zinc-500 tabular-nums">
                  {Math.max(0, totalSlots - checkedInSlots)} pending arrival
                </div>
              </div>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-zinc-100 px-3 py-2 text-xs font-bold text-zinc-800 transition hover:bg-zinc-200"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-emerald-600 transition-all"
                style={{ width: `${Math.min(100, attendancePct)}%` }}
              />
            </div>
          </div>

          {/* Mobile Grouped Attendance List */}
          <div className="md:hidden">
            {recentCheckins.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-12 text-center">
                <CheckCircle2 className="mx-auto h-7 w-7 text-zinc-300" />
                <p className="mt-2 text-sm font-semibold text-zinc-700">No check-ins yet</p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Arrivals scanned at the gate will appear here live.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
                {recentCheckins.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-start justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-zinc-900">
                        {c.label}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-zinc-500">
                        <span className="font-semibold text-zinc-700">{c.bookingCode}</span>
                        <span>·</span>
                        <span className="truncate">{c.holderName}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-zinc-400">
                        By {c.checkedInByName} · {c.deviceId}
                      </div>
                    </div>

                    <div className="shrink-0 text-right tabular-nums">
                      <div className="text-xs font-bold text-zinc-900">
                        {new Date(c.checkedInAt).toLocaleTimeString('en-IN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                      <span className="mt-1 inline-block rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-600">
                        {c.method === 'manual_code' ? 'Manual' : 'QR Scan'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Desktop Attendance Table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full divide-y divide-neutral-200 text-left text-xs">
              <thead className="border-b border-neutral-200 text-[11px] font-semibold uppercase text-neutral-400">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Booking</th>
                  <th className="px-4 py-3">Slot Label</th>
                  <th className="px-4 py-3">Gate Staff / Device</th>
                  <th className="px-4 py-3">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {recentCheckins.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2.5 text-neutral-600 tabular-nums">
                      {new Date(c.checkedInAt).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-neutral-900">
                      {c.bookingCode} · {c.holderName}
                    </td>
                    <td className="px-4 py-2.5 text-neutral-700">{c.label}</td>
                    <td className="px-4 py-2.5 text-neutral-600">
                      {c.checkedInByName} ({c.deviceId})
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-700">
                        {c.method}
                      </span>
                    </td>
                  </tr>
                ))}
                {recentCheckins.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                      No check-ins recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* QR PREVIEW MODAL (Dark Frosted Glass Ticket Pass) */}
      {qrModalBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/75 p-4 backdrop-blur-sm">
          <div className="glass-surface w-full max-w-sm rounded-3xl p-6 text-center text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-widest text-white">
                Scan QR Code
              </span>
              <button
                type="button"
                onClick={() => setQrModalBooking(null)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 text-center">
              <h3 className="text-xl font-extrabold tracking-tight text-white">
                {event.name}
              </h3>
              <p className="mt-1 text-xs text-neutral-300/80">
                Show this QR code at the event entrance
              </p>
              <p className="mt-1 text-xs font-semibold text-neutral-200">
                Ticket: {qrModalBooking.bookingCode} · {qrModalBooking.holderName} ({qrModalBooking.totalPax} Pax)
              </p>
            </div>

            <div className="my-5 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/qr/${encodeURIComponent(qrModalBooking.bookingCode)}?style=qr&v=2`}
                alt={`QR ${qrModalBooking.bookingCode}`}
                className="h-56 w-56"
              />
            </div>

            <div className="mt-4 rounded-2xl bg-white p-3.5 text-left text-xs text-neutral-800">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-neutral-400">Seat / Table Info</div>
                  <div className="font-bold text-neutral-900">
                    {qrModalBooking.tablesSummary}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-neutral-400">Amount</div>
                  <div className="font-bold text-emerald-700">
                    ₹{qrModalBooking.totalAmount.toLocaleString('en-IN')}
                  </div>
                </div>
              </div>
              <div className="mt-2 border-t border-dashed border-neutral-200 pt-2 text-[11px] text-neutral-500">
                Tickets: {qrModalBooking.ticketCodes.join(', ')}
              </div>
            </div>

            <div className="mt-3 text-[10px] text-neutral-400">
              Linear Atelier · Ticketing Partner
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
