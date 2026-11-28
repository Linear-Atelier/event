'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Armchair,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  Lock,
  MapPin,
  QrCode,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Ticket,
  Users,
  X,
} from 'lucide-react'

import { getEventColorTheme } from '@/lib/event-colors'
import { formatEventDayLabel } from '@/lib/event-date'
import { ResendPassModal, type ResendChannel } from '@/components/ResendPassModal'
import { ManageBookingModal } from '@/components/ManageBookingModal'
import { TicketPassModal } from '@/components/TicketPassModal'
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  SegmentedTabs,
  StatGrid,
  StatusBadge,
  TextInput,
  buttonClasses,
  type BadgeTone,
} from '@/components/ui/primitives'

export interface DashboardBookingRow {
  id: number
  bookingCode: string
  holderName: string
  phone: string
  email?: string | null
  totalPax: number
  totalAmount: number
  paidAmount?: number
  refundAmount?: number
  refundMethod?: string | null
  refundReference?: string | null
  notes?: string | null
  gatewayRefId?: string | null
  status: string
  paymentMode: string | null
  paymentStatus: string
  collectedByName: string
  treasurerVerified: boolean
  ticketCodes: string[]
  tickets?: Array<{
    id: number
    ticketCode: string
    ticketTypeName?: string
    paxCount: number
    paxNames?: string[]
  }>
  slots?: Array<{
    id: number
    attendeeName: string
    label: string
    ticketCode?: string
    checkedInAt?: string | null
  }>
  totalTicketCount: number
  tablesSummary: string
  assignedTableLabels?: string[]
  assignedTableFee?: number
  checkedInPax: number
  createdAt: string
}

export interface DashboardTableCard {
  id: number
  tableLabel: string
  tableTypeName?: string
  price?: number
  isReserved: boolean
  allocations: Array<{
    bookingCode: string
    holderName: string
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
    color?: string | null
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
  canManage?: boolean
}

type TabKey = 'bookings' | 'seating' | 'accounts' | 'attendance'

function statusBadgeTone(status: string): BadgeTone {
  if (status === 'confirmed') return 'emerald'
  if (status === 'pay_at_door' || status === 'pending_payment') return 'amber'
  return 'rose'
}

function formatStatusLabel(status: string): string {
  if (status === 'pay_at_door') return 'PAY AT DOOR'
  if (status === 'pending_payment') return 'PENDING'
  return status.toUpperCase()
}

export function EventDashboardClient({
  event,
  bookings,
  tables,
  recentCheckins,
  officerSummary,
  modeSummary,
  totalSlots,
  checkedInSlots,
  canManage = false,
}: EventDashboardClientProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabKey>('bookings')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [qrModalBooking, setQrModalBooking] = useState<DashboardBookingRow | null>(null)
  const [resendModalBooking, setResendModalBooking] = useState<DashboardBookingRow | null>(null)
  const [manageModalBooking, setManageModalBooking] = useState<DashboardBookingRow | null>(null)
  const [resendingId, setResendingId] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const activeBookings = useMemo(
    () => bookings.filter((b) => b.status !== 'cancelled' && b.status !== 'pending_payment'),
    [bookings],
  )

  const doorPendingBookings = useMemo(
    () => bookings.filter((b) => b.status === 'pay_at_door'),
    [bookings],
  )

  const doorPendingRevenue = useMemo(
    () => doorPendingBookings.reduce((s, b) => s + b.totalAmount, 0),
    [doorPendingBookings],
  )

  const totalPax = useMemo(
    () => activeBookings.reduce((s, b) => s + b.totalPax, 0),
    [activeBookings],
  )

  const totalRevenue = useMemo(() => {
    const collectedActiveSum = activeBookings
      .filter((b) => b.status !== 'pay_at_door' && b.paymentStatus !== 'pending')
      .reduce((s, b) => s + b.totalAmount, 0)
    const retainedCancelledSum = bookings
      .filter((b) => b.status === 'cancelled')
      .reduce(
        (s, b) => s + Math.max(0, (b.paidAmount || 0) - (b.refundAmount || 0)),
        0,
      )
    return collectedActiveSum + retainedCancelledSum
  }, [activeBookings, bookings])

  const totalRefunded = useMemo(
    () => bookings.reduce((s, b) => s + (b.refundAmount || 0), 0),
    [bookings],
  )

  const verifiedRevenue = useMemo(
    () =>
      bookings
        .filter((b) => b.treasurerVerified)
        .reduce(
          (s, b) =>
            s +
            (b.status === 'cancelled'
              ? Math.max(0, (b.paidAmount || 0) - (b.refundAmount || 0))
              : b.totalAmount),
          0,
        ),
    [bookings],
  )

  const allocatedTablesCount = useMemo(
    () => tables.filter((t) => t.isReserved).length,
    [tables],
  )

  const filteredBookings = useMemo(() => {
    const q = search.trim().toLowerCase()
    return bookings.filter((b) => {
      if (statusFilter === 'all') {
        if (b.status === 'cancelled') return false
      } else if (b.status !== statusFilter) {
        return false
      }
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

  async function handleResend(bookingId: number, channels: ResendChannel) {
    setResendingId(bookingId)
    setToast(null)
    try {
      const res = await fetch(`/api/bookings/${bookingId}/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ channels }),
      })
      const data = await res.json()
      if (res.ok) {
        const parts: string[] = []
        if (channels === 'both' || channels === 'whatsapp') {
          parts.push(`WhatsApp: ${data.result?.whatsapp || 'logged'}`)
        }
        if (channels === 'both' || channels === 'email') {
          parts.push(`Email: ${data.result?.email || 'logged'}`)
        }
        setToast(`Pass resent — ${parts.join(', ')}`)
        setResendModalBooking(null)
      } else {
        setToast(data.error || 'Resend failed')
      }
    } catch {
      setToast('Network error while resending')
    } finally {
      setResendingId(null)
    }
  }

  const eventTheme = getEventColorTheme(event.color)
  const formattedDate = new Date(event.date).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="space-y-5">
      <PageHeader
        backHref="/events"
        backLabel="All Events"
        title={event.name}
        badge={
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${eventTheme.badgeBg} ${eventTheme.badgeText}`}
          >
            {event.code}
          </span>
        }
        subtitle={
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-medium text-neutral-700">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-neutral-500" />
              {formattedDate}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-neutral-500" />
              {event.venue}
            </span>
          </div>
        }
        actions={
          <>
            <Link
              href={`/desk?eventId=${event.id}`}
              className={buttonClasses({ variant: 'secondary', size: 'md' })}
            >
              <Ticket className="h-4 w-4" />
              Book Tickets
            </Link>
            {event.isScanOpen === false ? (
              <Button
                type="button"
                variant="secondary"
                disabled
                title={`Gate scan opens on ${formatEventDayLabel(event.date)}`}
              >
                <Lock className="h-4 w-4" />
                Opens {formatEventDayLabel(event.date)}
              </Button>
            ) : (
              <Link
                href={`/scan?eventId=${event.id}`}
                className={buttonClasses({ variant: 'primary', size: 'md' })}
              >
                <QrCode className="h-4 w-4" />
                Gate Scan
              </Link>
            )}
          </>
        }
      />

      {/* Summary Metrics */}
      <StatGrid
        items={[
          {
            label: 'Bookings',
            value: activeBookings.length,
            sub: `${totalPax} guests`,
          },
          {
            label: 'Attendance',
            value: `${checkedInSlots} / ${totalSlots}`,
            sub: `${attendancePct}% arrived`,
            progressPct: attendancePct,
          },
          {
            label: 'Net Revenue',
            value: `₹${totalRevenue.toLocaleString('en-IN')}`,
            sub: `₹${verifiedRevenue.toLocaleString('en-IN')} verified${doorPendingRevenue > 0
              ? ` · +₹${doorPendingRevenue.toLocaleString('en-IN')} at door`
              : ''
              }${totalRefunded > 0 ? ` · ₹${totalRefunded.toLocaleString('en-IN')} ref` : ''}`,
            tone: 'emerald',
          },
          {
            label: 'Tables',
            value: `${allocatedTablesCount} / ${tables.length}`,
            sub: 'assigned',
          },
        ]}
      />

      {toast && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm font-semibold text-neutral-950">
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* 2x2 Grid on Mobile / Inline Row on Desktop */}
      <SegmentedTabs
        value={activeTab}
        onChange={setActiveTab}
        compact
        items={[
          { key: 'bookings', label: `Bookings (${bookings.length})`, icon: Ticket },
          { key: 'seating', label: `Seating (${tables.length})`, icon: Armchair },
          { key: 'accounts', label: 'Accounts', icon: CreditCard },
          { key: 'attendance', label: `Attendance (${attendancePct}%)`, icon: CheckCircle2 },
        ]}
      />

      {/* BOOKINGS TAB */}
      {activeTab === 'bookings' && (
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="relative max-w-lg">
              <Search className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-neutral-500" />
              <TextInput
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search code, guest name, or phone…"
                className="pl-11"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  {
                    key: 'all',
                    label: `All (${bookings.filter((b) => b.status !== 'cancelled').length})`,
                  },
                  {
                    key: 'confirmed',
                    label: `Confirmed (${bookings.filter((b) => b.status === 'confirmed').length})`,
                  },
                  {
                    key: 'pay_at_door',
                    label: `Pay at Door (${doorPendingBookings.length})`,
                  },
                  {
                    key: 'pending_payment',
                    label: `Pending (${bookings.filter((b) => b.status === 'pending_payment').length})`,
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
                  className={`min-h-10 rounded-full border px-4 text-sm font-bold transition ${statusFilter === pill.key
                    ? 'border-emerald-500 bg-emerald-600 text-white'
                    : 'border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100'
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
              <EmptyState
                icon={Ticket}
                title="No matching bookings"
                description="Try clearing your search or switching the status filter above."
              />
            ) : (
              filteredBookings.map((b) => {
                const allCheckedIn = b.totalPax > 0 && b.checkedInPax >= b.totalPax
                return (
                  <div
                    key={b.id}
                    className={`overflow-hidden rounded-2xl border border-neutral-200 bg-white ${b.status === 'cancelled' ? 'opacity-70' : ''
                      }`}
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-extrabold text-neutral-950">
                              {b.holderName}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-neutral-700 tabular-nums">
                            <span className="font-bold text-neutral-900">Booking Code: {b.bookingCode}</span>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1 shrink-0 text-right tabular-nums">
                          <StatusBadge tone={statusBadgeTone(b.status)}>
                            {formatStatusLabel(b.status)}
                          </StatusBadge>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm tabular-nums">
                        {b.tablesSummary !== 'Unassigned' && <span className="rounded-lg bg-neutral-100 px-2.5 py-1 font-bold text-neutral-800">
                          Table: {b.tablesSummary}
                        </span>}
                      </div>

                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-600">
                        <span className="truncate font-mono text-xs font-semibold text-neutral-700">
                          Ticket IDs:
                          <div className='flex flex-col'>
                            {b.ticketCodes.map((code) => (
                              <span key={code} className="font-bold">{code}</span>
                            ))}
                          </div>
                        </span>
                        {/* <span className="shrink-0 font-medium">By {b.collectedByName}</span> */}
                      </div>
                    </div>

                    {/* Touch-Friendly 44px Action Footer */}
                    <div className="grid grid-cols-2 gap-2 border-t border-neutral-200 bg-neutral-50 p-2.5">

                      <button
                        type="button"
                        onClick={() => setQrModalBooking(b)}
                        className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2.5 text-sm font-bold transition ${canManage
                          ? 'border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100'
                          : 'col-span-2 bg-neutral-900 text-white hover:bg-neutral-800'
                          }`}
                      >
                        <QrCode className="h-4 w-4 shrink-0" />
                        <span>QR</span>
                      </button>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => setManageModalBooking(b)}
                          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-neutral-900 px-2.5 text-sm font-bold text-white transition hover:bg-neutral-800"
                        >
                          <SlidersHorizontal className="h-4 w-4 shrink-0" />
                          <span>Manage</span>
                        </button>
                      )}
                      {/* <button
                        type="button"
                        disabled={resendingId === b.id}
                        onClick={() => setResendModalBooking(b)}
                        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-neutral-300 bg-white px-2.5 text-sm font-bold text-neutral-900 transition hover:bg-neutral-100 disabled:opacity-50"
                      >
                        {resendingId === b.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4 shrink-0 text-neutral-600" />
                        )}
                        <span>{resendingId === b.id ? 'Sending…' : 'Resend'}</span>
                      </button> */}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Desktop Bookings Table */}
          <Card className="hidden overflow-x-auto !p-0 md:block">
            <table className="min-w-full divide-y divide-neutral-200 text-left text-sm">
              <thead className="bg-neutral-50 text-xs font-bold uppercase tracking-wide text-neutral-600">
                <tr>
                  <th className="px-4 py-3.5">Booking</th>
                  <th className="px-4 py-3.5">Holder</th>
                  <th className="px-4 py-3.5">Guests / Status</th>
                  <th className="px-4 py-3.5">Tables</th>
                  <th className="px-4 py-3.5">Payment</th>
                  <th className="px-4 py-3.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {filteredBookings.map((b) => (
                  <tr
                    key={b.id}
                    className={b.status === 'cancelled' ? 'bg-rose-50/40 opacity-75' : ''}
                  >
                    <td className="px-4 py-3.5">
                      <div className="font-bold text-neutral-950">{b.bookingCode}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="font-bold text-neutral-950">{b.holderName}</div>
                      <div className="text-sm text-neutral-600 tabular-nums">{b.phone}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="font-bold text-neutral-950 tabular-nums">
                        {b.checkedInPax} / {b.totalPax} in
                      </div>
                      <div className="mt-1">
                        <StatusBadge tone={statusBadgeTone(b.status)}>
                          {formatStatusLabel(b.status)}
                        </StatusBadge>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-medium text-neutral-800">{b.tablesSummary}</td>
                    <td className="px-4 py-3.5">
                      <div className="font-extrabold text-neutral-950 tabular-nums">
                        ₹{b.totalAmount.toLocaleString('en-IN')}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => setManageModalBooking(b)}
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-neutral-900 px-3 text-xs font-bold text-white transition hover:bg-neutral-800"
                          >
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                            Manage
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setQrModalBooking(b)}
                          className="inline-flex min-h-10 items-center rounded-xl border border-neutral-300 bg-white px-3 text-xs font-bold text-neutral-900 transition hover:bg-neutral-100"
                        >
                          QR
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredBookings.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-neutral-600">
                      No matching bookings found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* SEATING TAB */}
      {activeTab === 'seating' &&
        (tables.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No tables configured for this event"
            description="Add table groups in Payload Admin (/admin) to start assigning tables."
          />
        ) : (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {tables.map((t) => (
              <div
                key={t.id}
                className={`rounded-2xl border p-4 ${t.isReserved
                  ? 'border-emerald-300 bg-emerald-50/50'
                  : 'border-neutral-200 bg-white'
                  }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-extrabold text-neutral-950">
                      {t.tableLabel}
                    </span>
                    {t.tableTypeName && (
                      <StatusBadge tone="neutral">{t.tableTypeName}</StatusBadge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {(t.price || 0) > 0 && (
                      <span className="text-sm font-extrabold text-neutral-950 tabular-nums">
                        ₹{Number(t.price).toLocaleString('en-IN')}
                      </span>
                    )}
                    <StatusBadge tone={t.isReserved ? 'emerald' : 'neutral'}>
                      {t.isReserved ? 'Reserved' : 'Available'}
                    </StatusBadge>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {t.allocations.length === 0 && (
                    <div className="text-sm font-medium text-neutral-500">
                      Open for assignment
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}

      {/* TREASURER SUMMARY TAB */}
      {activeTab === 'accounts' && (
        <div className="space-y-4">
          {doorPendingBookings.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
              <span>
                {doorPendingBookings.length} Pay-at-Door{' '}
                {doorPendingBookings.length === 1 ? 'booking' : 'bookings'} awaiting collection at
                gate
              </span>
              <span className="text-base font-extrabold tabular-nums">
                ₹{doorPendingRevenue.toLocaleString('en-IN')} due at door
              </span>
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Payment Modes */}
            <Card>
              <h3 className="text-base font-extrabold text-neutral-950">By Payment Mode</h3>

              {/* Mobile Cards */}
              <div className="mt-3 space-y-2.5 md:hidden">
                {modeSummary.length === 0 ? (
                  <p className="py-4 text-sm text-neutral-600">No payments recorded yet.</p>
                ) : (
                  modeSummary.map((m) => (
                    <div
                      key={m.paymentMode}
                      className="flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 p-3.5"
                    >
                      <div>
                        <div className="text-base font-bold text-neutral-950">{m.paymentMode}</div>
                        <div className="text-sm text-neutral-600">
                          {m.bookingCount} {m.bookingCount === 1 ? 'booking' : 'bookings'}
                        </div>
                      </div>
                      <div className="text-right tabular-nums">
                        <div className="text-base font-extrabold text-neutral-950">
                          ₹{Number(m.totalAmount).toLocaleString('en-IN')}
                        </div>
                        <div className="text-sm font-bold text-emerald-700">
                          ₹{Number(m.verifiedAmount).toLocaleString('en-IN')} received
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Desktop Table */}
              <div className="mt-3 hidden overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-neutral-200 text-xs font-bold uppercase text-neutral-600">
                    <tr>
                      <th className="py-2.5">Mode</th>
                      <th className="py-2.5">Bookings</th>
                      <th className="py-2.5">Total</th>
                      <th className="py-2.5">Received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {modeSummary.map((m) => (
                      <tr key={m.paymentMode}>
                        <td className="py-3 font-bold text-neutral-950">{m.paymentMode}</td>
                        <td className="py-3 tabular-nums">{m.bookingCount}</td>
                        <td className="py-3 font-bold tabular-nums">
                          ₹{Number(m.totalAmount).toLocaleString('en-IN')}
                        </td>
                        <td className="py-3 font-bold text-emerald-700 tabular-nums">
                          ₹{Number(m.verifiedAmount).toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Officer Cash Reconciliation */}
            <Card>
              <h3 className="text-base font-extrabold text-neutral-950">
                Officer Cash Reconciliation
              </h3>

              {/* Mobile Cards */}
              <div className="mt-3 space-y-2.5 md:hidden">
                {officerSummary.length === 0 ? (
                  <p className="py-4 text-sm text-neutral-600">No officer collections yet.</p>
                ) : (
                  officerSummary.map((o, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-neutral-200 bg-neutral-50 p-3.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-base font-bold text-neutral-950">
                          {o.officerName}
                        </span>
                        <span className="text-base font-extrabold text-neutral-950 tabular-nums">
                          ₹{Number(o.totalAmount).toLocaleString('en-IN')}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-700 tabular-nums">
                        <span>Cash: ₹{Number(o.cashAmount).toLocaleString('en-IN')}</span>
                        <span>UPI: ₹{Number(o.upiAmount).toLocaleString('en-IN')}</span>
                        <span className="font-bold text-amber-700">
                          {o.unverifiedCount} pending
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Desktop Table */}
              <div className="mt-3 hidden overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-neutral-200 text-xs font-bold uppercase text-neutral-600">
                    <tr>
                      <th className="py-2.5">Officer</th>
                      <th className="py-2.5">Cash</th>
                      <th className="py-2.5">UPI</th>
                      <th className="py-2.5">Total</th>
                      <th className="py-2.5">Pending</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {officerSummary.map((o, idx) => (
                      <tr key={idx}>
                        <td className="py-3 font-bold text-neutral-950">{o.officerName}</td>
                        <td className="py-3 tabular-nums">
                          ₹{Number(o.cashAmount).toLocaleString('en-IN')}
                        </td>
                        <td className="py-3 tabular-nums">
                          ₹{Number(o.upiAmount).toLocaleString('en-IN')}
                        </td>
                        <td className="py-3 font-extrabold tabular-nums">
                          ₹{Number(o.totalAmount).toLocaleString('en-IN')}
                        </td>
                        <td className="py-3 font-bold text-amber-700 tabular-nums">
                          {o.unverifiedCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* LIVE ATTENDANCE TAB */}
      {activeTab === 'attendance' && (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-lg font-extrabold text-neutral-950 tabular-nums">
                  {checkedInSlots} of {totalSlots} guests checked in ({attendancePct}%)
                </div>
                <div className="mt-0.5 text-sm font-medium text-neutral-600 tabular-nums">
                  {Math.max(0, totalSlots - checkedInSlots)} pending arrival
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => router.refresh()}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            </div>
            <div className="mt-3.5 h-2.5 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full rounded-full bg-emerald-600 transition-all"
                style={{ width: `${Math.min(100, attendancePct)}%` }}
              />
            </div>
          </Card>

          {/* Mobile Grouped Attendance List */}
          <div className="md:hidden">
            {recentCheckins.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="No check-ins yet"
                description="Arrivals scanned at the gate will appear here live."
              />
            ) : (
              <div className="divide-y divide-neutral-200 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
                {recentCheckins.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-start justify-between gap-3 px-4 py-3.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-bold text-neutral-950">
                        {c.label}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-neutral-700">
                        <span className="font-bold text-neutral-900">{c.bookingCode}</span>
                        <span>·</span>
                        <span className="truncate">{c.holderName}</span>
                      </div>
                      <div className="mt-1 text-xs font-medium text-neutral-600">
                        By {c.checkedInByName} · {c.deviceId}
                      </div>
                    </div>

                    <div className="shrink-0 text-right tabular-nums">
                      <div className="text-sm font-bold text-neutral-950">
                        {new Date(c.checkedInAt).toLocaleTimeString('en-IN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                      <StatusBadge tone="neutral" className="mt-1">
                        {c.method === 'manual_code' ? 'Manual' : 'QR Scan'}
                      </StatusBadge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Desktop Attendance Table */}
          <Card className="hidden overflow-x-auto !p-0 md:block">
            <table className="min-w-full divide-y divide-neutral-200 text-left text-sm">
              <thead className="bg-neutral-50 text-xs font-bold uppercase text-neutral-600">
                <tr>
                  <th className="px-4 py-3.5">Time</th>
                  <th className="px-4 py-3.5">Booking</th>
                  <th className="px-4 py-3.5">Guest Slot</th>
                  <th className="px-4 py-3.5">Gate Staff / Device</th>
                  <th className="px-4 py-3.5">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {recentCheckins.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 font-medium text-neutral-700 tabular-nums">
                      {new Date(c.checkedInAt).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 font-bold text-neutral-950">
                      {c.bookingCode} · {c.holderName}
                    </td>
                    <td className="px-4 py-3 text-neutral-800">{c.label}</td>
                    <td className="px-4 py-3 text-neutral-700">
                      {c.checkedInByName} ({c.deviceId})
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone="neutral">
                        {c.method === 'manual_code' ? 'Manual' : 'QR Scan'}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
                {recentCheckins.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-neutral-600">
                      No check-ins recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* SHARED MASTER QR PASS MODAL */}
      {qrModalBooking && (
        <TicketPassModal
          eventName={event.name}
          bookingCode={qrModalBooking.bookingCode}
          holderName={qrModalBooking.holderName}
          totalPax={qrModalBooking.totalPax}
          totalAmount={qrModalBooking.totalAmount}
          tablesSummary={qrModalBooking.tablesSummary}
          tickets={
            qrModalBooking.tickets && qrModalBooking.tickets.length > 0
              ? qrModalBooking.tickets
              : qrModalBooking.ticketCodes.map((code, idx) => ({
                id: idx,
                ticketCode: code,
                paxCount: qrModalBooking.totalPax,
                paxNames: [],
              }))
          }
          onResend={() => {
            const target = qrModalBooking
            setQrModalBooking(null)
            setResendModalBooking(target)
          }}
          onClose={() => setQrModalBooking(null)}
        />
      )}

      {/* RESEND CONFIRMATION MODAL */}
      {resendModalBooking && (
        <ResendPassModal
          bookingCode={resendModalBooking.bookingCode}
          holderName={resendModalBooking.holderName}
          phone={resendModalBooking.phone}
          email={resendModalBooking.email}
          submitting={resendingId === resendModalBooking.id}
          onClose={() => setResendModalBooking(null)}
          onConfirm={(ch) => handleResend(resendModalBooking.id, ch)}
        />
      )}

      {/* MANAGE BOOKING MODAL */}
      {manageModalBooking && (
        <ManageBookingModal
          event={{ id: event.id, name: event.name }}
          booking={manageModalBooking}
          tables={tables}
          onClose={() => setManageModalBooking(null)}
          onUpdated={(msg) => {
            setManageModalBooking(null)
            setToast(msg)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
