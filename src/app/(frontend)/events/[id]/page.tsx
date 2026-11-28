import React from 'react'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'
import { sql } from '@payloadcms/db-postgres/drizzle'
import config from '@payload-config'
import { getServerUser, userHasRole } from '@/lib/auth'
import { isScanAllowedForEventDate } from '@/lib/event-date'
import { expandEventTables } from '@/lib/event-tables'
import {
  EventDashboardClient,
  type DashboardBookingRow,
  type DashboardCheckinRow,
  type DashboardModeSummary,
  type DashboardOfficerSummary,
  type DashboardTableCard,
} from '@/components/EventDashboardClient'
import type { Booking, User } from '@/payload-types'

export const dynamic = 'force-dynamic'

export default async function EventDetailPage(props: {
  params: Promise<{ id: string }>
}) {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const { id } = await props.params
  const eventId = Number(id)
  if (!eventId || Number.isNaN(eventId)) notFound()

  const payload = await getPayload({ config })

  let event
  try {
    event = await payload.findByID({
      collection: 'events',
      id: eventId,
      user,
      overrideAccess: false,
      depth: 1,
    })
  } catch {
    notFound()
  }

  if (!event) notFound()

  const bookingsRes = await payload.find({
    collection: 'bookings',
    user,
    overrideAccess: false,
    where: { event: { equals: eventId } },
    sort: '-createdAt',
    limit: 2000,
    depth: 1,
  })

  const bookingIds = bookingsRes.docs.map((b) => b.id)

  const [ticketsRes, bookingTablesRes, slotsRes, byModeSql, byOfficerSql] =
    await Promise.all([
      bookingIds.length > 0
        ? payload.find({
          collection: 'booking-tickets',
          user,
          overrideAccess: false,
          where: { booking: { in: bookingIds } },
          limit: 5000,
          depth: 0,
        })
        : Promise.resolve({ docs: [] }),
      bookingIds.length > 0
        ? payload.find({
          collection: 'booking-tables',
          user,
          overrideAccess: false,
          where: { booking: { in: bookingIds } },
          sort: 'tableLabel',
          limit: 5000,
          depth: 0,
        })
        : Promise.resolve({ docs: [] }),
      bookingIds.length > 0
        ? payload.find({
          collection: 'ticket-checkin-slots',
          user,
          overrideAccess: false,
          where: { booking: { in: bookingIds } },
          limit: 10000,
          depth: 1,
        })
        : Promise.resolve({ docs: [] }),
      payload.db.drizzle.execute(sql`
        SELECT
          b.payment_mode AS "paymentMode",
          COUNT(CASE WHEN b.status != 'cancelled' THEN 1 END)::int AS "bookingCount",
          COALESCE(SUM(CASE WHEN b.status != 'cancelled' THEN b.total_pax ELSE 0 END), 0)::int AS "totalPax",
          COALESCE(SUM(
            CASE
              WHEN b.status != 'cancelled' THEN b.total_amount
              ELSE GREATEST(0, COALESCE(b.paid_amount, 0) - COALESCE(b.refund_amount, 0))
            END
          ), 0)::numeric AS "totalAmount",
          COALESCE(SUM(
            CASE
              WHEN b.treasurer_verified = true AND b.status != 'cancelled' THEN b.total_amount
              WHEN b.treasurer_verified = true AND b.status = 'cancelled' THEN GREATEST(0, COALESCE(b.paid_amount, 0) - COALESCE(b.refund_amount, 0))
              ELSE 0
            END
          ), 0)::numeric AS "verifiedAmount"
        FROM bookings b
        WHERE b.event_id = ${eventId}
          AND b.status NOT IN ('pending_payment', 'pay_at_door')
          AND b.payment_status != 'pending'
          AND b.payment_mode IS NOT NULL
          AND (b.status != 'cancelled' OR GREATEST(0, COALESCE(b.paid_amount, 0) - COALESCE(b.refund_amount, 0)) > 0)
        GROUP BY b.payment_mode
        ORDER BY b.payment_mode
      `),
      payload.db.drizzle.execute(sql`
        SELECT
          COALESCE(u.name, 'Unassigned') AS "officerName",
          COUNT(CASE WHEN b.status != 'cancelled' THEN 1 END)::int AS "bookingCount",
          COALESCE(SUM(CASE WHEN b.status != 'cancelled' THEN b.total_pax ELSE 0 END), 0)::int AS "totalPax",
          COALESCE(SUM(CASE WHEN b.payment_mode = 'CASH' THEN CASE WHEN b.status != 'cancelled' THEN b.total_amount ELSE GREATEST(0, COALESCE(b.paid_amount, 0) - COALESCE(b.refund_amount, 0)) END ELSE 0 END), 0)::numeric AS "cashAmount",
          COALESCE(SUM(CASE WHEN b.payment_mode = 'OFFICER_UPI' THEN CASE WHEN b.status != 'cancelled' THEN b.total_amount ELSE GREATEST(0, COALESCE(b.paid_amount, 0) - COALESCE(b.refund_amount, 0)) END ELSE 0 END), 0)::numeric AS "upiAmount",
          COALESCE(SUM(CASE WHEN b.status != 'cancelled' THEN b.total_amount ELSE GREATEST(0, COALESCE(b.paid_amount, 0) - COALESCE(b.refund_amount, 0)) END), 0)::numeric AS "totalAmount",
          COALESCE(SUM(CASE WHEN b.treasurer_verified = true THEN CASE WHEN b.status != 'cancelled' THEN b.total_amount ELSE GREATEST(0, COALESCE(b.paid_amount, 0) - COALESCE(b.refund_amount, 0)) END ELSE 0 END), 0)::numeric AS "verifiedAmount",
          COUNT(CASE WHEN b.status != 'cancelled' AND b.treasurer_verified IS NOT TRUE THEN 1 END)::int AS "unverifiedCount"
        FROM bookings b
        LEFT JOIN users u ON u.id = b.collected_by_officer_id
        WHERE b.event_id = ${eventId}
          AND b.status NOT IN ('pending_payment', 'pay_at_door')
          AND b.payment_status != 'pending'
          AND (b.status != 'cancelled' OR GREATEST(0, COALESCE(b.paid_amount, 0) - COALESCE(b.refund_amount, 0)) > 0)
        GROUP BY u.id, u.name
        ORDER BY "totalAmount" DESC
      `),
    ])

  // Index tickets, tables, and slots by bookingId
  const ticketsByBooking = new Map<number, typeof ticketsRes.docs>()
  for (const t of ticketsRes.docs) {
    const bId = typeof t.booking === 'object' ? t.booking.id : t.booking
    const arr = ticketsByBooking.get(bId) || []
    arr.push(t)
    ticketsByBooking.set(bId, arr)
  }

  const tablesByBooking = new Map<number, Array<{ label: string; price: number }>>()
  const allocationsByTableLabel = new Map<
    string,
    Array<{ bookingCode: string; holderName: string }>
  >()

  const bookingMap = new Map<number, Booking>()
  for (const b of bookingsRes.docs) {
    bookingMap.set(b.id, b)
  }

  for (const bt of bookingTablesRes.docs) {
    const bId = typeof bt.booking === 'object' ? bt.booking.id : bt.booking
    const bObj = bookingMap.get(bId)
    if (!bObj || bObj.status === 'cancelled') continue

    const label = bt.tableLabel
    const price = Number(bt.price) || 0

    const bList = tablesByBooking.get(bId) || []
    bList.push({ label, price })
    tablesByBooking.set(bId, bList)

    const tList = allocationsByTableLabel.get(label) || []
    tList.push({
      bookingCode: bObj.bookingCode,
      holderName: bObj.holderName,
    })
    allocationsByTableLabel.set(label, tList)
  }

  const checkedInByBooking = new Map<number, number>()
  const slotsByBooking = new Map<
    number,
    Array<{
      id: number
      attendeeName: string
      label: string
      ticketCode?: string
      checkedInAt?: string | null
    }>
  >()
  const ticketCodeById = new Map<number, string>(ticketsRes.docs.map((t) => [t.id, t.ticketCode]))
  const recentCheckins: DashboardCheckinRow[] = []
  let activeTotalSlots = 0
  let activeCheckedInSlots = 0

  for (const s of slotsRes.docs) {
    const bId = typeof s.booking === 'object' ? s.booking.id : s.booking
    const bObj = bookingMap.get(bId)
    const tId = typeof s.bookingTicket === 'object' ? s.bookingTicket.id : Number(s.bookingTicket)
    const slotList = slotsByBooking.get(bId) || []
    slotList.push({
      id: s.id,
      attendeeName: (s.attendeeName || s.label.split(' — ')[0] || '').trim(),
      label: s.label,
      ticketCode: ticketCodeById.get(tId),
      checkedInAt: s.checkedInAt || null,
    })
    slotsByBooking.set(bId, slotList)

    if (!bObj || bObj.status === 'cancelled') continue
    activeTotalSlots += 1

    if (s.checkedInAt) {
      activeCheckedInSlots += 1
      checkedInByBooking.set(bId, (checkedInByBooking.get(bId) || 0) + 1)
      const byUser = s.checkedInByUser as User | null
      recentCheckins.push({
        id: s.id,
        bookingCode: bObj.bookingCode,
        holderName: bObj.holderName,
        label: s.label,
        checkedInAt: s.checkedInAt,
        checkedInByName: byUser?.name || 'Gate Staff',
        deviceId: s.deviceId || 'GATE',
        method: s.method || 'qr_scan',
      })
    }
  }

  recentCheckins.sort(
    (a, b) => new Date(b.checkedInAt).getTime() - new Date(a.checkedInAt).getTime(),
  )

  const bookingRows: DashboardBookingRow[] = bookingsRes.docs.map((b) => {
    const bTickets = ticketsByBooking.get(b.id) || []
    const bTables = tablesByBooking.get(b.id) || []
    const officer = b.collectedByOfficer as User | null
    return {
      id: b.id,
      bookingCode: b.bookingCode,
      holderName: b.holderName,
      phone: b.phone,
      email: b.email,
      totalPax: b.totalPax,
      totalAmount: b.totalAmount,
      paidAmount:
        typeof b.paidAmount === 'number'
          ? b.paidAmount
          : b.paymentStatus === 'paid'
            ? b.totalAmount
            : 0,
      refundAmount: Number(b.refundAmount) || 0,
      refundMethod: b.refundMethod || 'NONE',
      refundReference: b.refundReference || null,
      notes: b.notes || null,
      gatewayRefId: b.gatewayRefId || null,
      status: b.status,
      paymentMode: b.paymentMode || null,
      paymentStatus: b.paymentStatus,
      collectedByName: officer?.name || 'Officer',
      treasurerVerified: Boolean(b.treasurerVerified),
      ticketCodes: bTickets.map((t) => t.ticketCode),
      tickets: bTickets.map((t) => ({
        id: t.id,
        ticketCode: t.ticketCode,
        ticketTypeName: t.ticketTypeName || 'Ticket',
        paxCount: t.paxCount,
        paxNames: t.attendeeNames
          ? t.attendeeNames
            .split(',')
            .map((n) => n.trim())
            .filter(Boolean)
          : [],
      })),
      slots: slotsByBooking.get(b.id) || [],
      totalTicketCount: bTickets.length,
      tablesSummary:
        bTables.length > 0 ? bTables.map((t) => t.label).join(', ') : 'Unassigned',
      assignedTableLabels: bTables.map((t) => t.label),
      assignedTableFee: bTables.reduce((s, t) => s + t.price, 0),
      checkedInPax: checkedInByBooking.get(b.id) || 0,
      createdAt: b.createdAt,
    }
  })

  const virtualTables = expandEventTables(event.tables)
  const tableCards: DashboardTableCard[] = virtualTables.map((t, idx) => {
    const allocs = allocationsByTableLabel.get(t.tableLabel) || []
    return {
      id: idx + 1,
      tableLabel: t.tableLabel,
      tableTypeName: t.tableTypeName,
      price: t.price,
      isReserved: allocs.length > 0,
      allocations: allocs,
    }
  })

  const canManage = userHasRole(user, ['booking_officer', 'super_admin'])

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6 lg:max-w-5xl pb-24">
      <EventDashboardClient
        event={{
          id: event.id,
          code: event.code,
          name: event.name,
          date: event.date,
          venue: event.venue,
          color: event.color || 'sky',
          publicKey: event.publicKey,
          isScanOpen: isScanAllowedForEventDate(event.date),
        }}
        bookings={bookingRows}
        tables={tableCards}
        recentCheckins={recentCheckins.slice(0, 100)}
        officerSummary={byOfficerSql.rows as unknown as DashboardOfficerSummary[]}
        modeSummary={byModeSql.rows as unknown as DashboardModeSummary[]}
        totalSlots={activeTotalSlots}
        checkedInSlots={activeCheckedInSlots}
        canManage={canManage}
      />
    </main>
  )
}
