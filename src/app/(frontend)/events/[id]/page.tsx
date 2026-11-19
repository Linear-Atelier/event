import React from 'react'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'
import { sql } from '@payloadcms/db-postgres/drizzle'
import config from '@payload-config'
import { getServerUser } from '@/lib/auth'
import { expandEventTables } from '@/lib/event-tables'
import { AppNavbar, PageFooter } from '@/components/AppNavbar'
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
          COUNT(*)::int AS "bookingCount",
          COALESCE(SUM(b.total_pax), 0)::int AS "totalPax",
          COALESCE(SUM(b.total_amount), 0)::numeric AS "totalAmount",
          COALESCE(SUM(CASE WHEN b.treasurer_verified = true THEN b.total_amount ELSE 0 END), 0)::numeric AS "verifiedAmount"
        FROM bookings b
        WHERE b.event_id = ${eventId} AND b.status != 'cancelled'
        GROUP BY b.payment_mode
        ORDER BY b.payment_mode
      `),
      payload.db.drizzle.execute(sql`
        SELECT
          COALESCE(u.name, 'Unassigned') AS "officerName",
          COUNT(*)::int AS "bookingCount",
          COALESCE(SUM(b.total_pax), 0)::int AS "totalPax",
          COALESCE(SUM(CASE WHEN b.payment_mode = 'CASH' THEN b.total_amount ELSE 0 END), 0)::numeric AS "cashAmount",
          COALESCE(SUM(CASE WHEN b.payment_mode = 'OFFICER_UPI' THEN b.total_amount ELSE 0 END), 0)::numeric AS "upiAmount",
          COALESCE(SUM(CASE WHEN b.payment_mode = 'PAY_AT_DOOR' THEN b.total_amount ELSE 0 END), 0)::numeric AS "doorAmount",
          COALESCE(SUM(b.total_amount), 0)::numeric AS "totalAmount",
          COALESCE(SUM(CASE WHEN b.treasurer_verified = true THEN b.total_amount ELSE 0 END), 0)::numeric AS "verifiedAmount",
          COUNT(CASE WHEN b.treasurer_verified IS NOT TRUE THEN 1 END)::int AS "unverifiedCount"
        FROM bookings b
        LEFT JOIN users u ON u.id = b.collected_by_officer_id
        WHERE b.event_id = ${eventId} AND b.status != 'cancelled'
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

  const tablesByBooking = new Map<number, Array<{ label: string; seats: number }>>()
  const allocationsByTableLabel = new Map<
    string,
    Array<{ bookingCode: string; holderName: string; allocatedSeats: number }>
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
    const cap = bt.capacity || 8

    const bList = tablesByBooking.get(bId) || []
    bList.push({ label, seats: cap })
    tablesByBooking.set(bId, bList)

    const tList = allocationsByTableLabel.get(label) || []
    tList.push({
      bookingCode: bObj.bookingCode,
      holderName: bObj.holderName,
      allocatedSeats: cap,
    })
    allocationsByTableLabel.set(label, tList)
  }

  const checkedInByBooking = new Map<number, number>()
  const recentCheckins: DashboardCheckinRow[] = []
  let activeTotalSlots = 0
  let activeCheckedInSlots = 0

  for (const s of slotsRes.docs) {
    const bId = typeof s.booking === 'object' ? s.booking.id : s.booking
    const bObj = bookingMap.get(bId)
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
      status: b.status,
      paymentMode: b.paymentMode,
      paymentStatus: b.paymentStatus,
      collectedByName: officer?.name || 'Officer',
      treasurerVerified: Boolean(b.treasurerVerified),
      ticketCodes: bTickets.map((t) => t.ticketCode),
      physicalIssuedCount: bTickets.filter((t) => t.physicalIssued).length,
      totalTicketCount: bTickets.length,
      tablesSummary:
        bTables.length > 0
          ? bTables.map((t) => `${t.label} (${t.seats}p)`).join(', ')
          : 'Unassigned',
      allocatedSeats: bTables.reduce((s, t) => s + t.seats, 0),
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
      maxCapacity: t.capacity,
      isShared: false,
      occupiedSeats: allocs.length > 0 ? t.capacity : 0,
      allocations: allocs,
    }
  })

  return (
    <div className="flex min-h-screen flex-col">
      <AppNavbar user={user} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <EventDashboardClient
          event={{
            id: event.id,
            code: event.code,
            name: event.name,
            date: event.date,
            venue: event.venue,
            publicKey: event.publicKey,
          }}
          bookings={bookingRows}
          tables={tableCards}
          recentCheckins={recentCheckins.slice(0, 100)}
          officerSummary={byOfficerSql.rows as unknown as DashboardOfficerSummary[]}
          modeSummary={byModeSql.rows as unknown as DashboardModeSummary[]}
          totalSlots={activeTotalSlots}
          checkedInSlots={activeCheckedInSlots}
        />
      </main>
      <PageFooter />
    </div>
  )
}
