import React from 'react'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getServerUser, userHasRole } from '@/lib/auth'
import { AppNavbar, PageFooter } from '@/components/AppNavbar'
import { BookingDeskClient } from '@/components/BookingDeskClient'

export const dynamic = 'force-dynamic'

export default async function BookingDeskPage(props: {
  searchParams: Promise<{ eventId?: string }>
}) {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const sp = await props.searchParams
  const payload = await getPayload({ config })

  const eventsRes = await payload.find({
    collection: 'events',
    user,
    overrideAccess: false,
    sort: '-date',
    limit: 50,
    depth: 0,
  })

  const initialEventId = sp.eventId ? Number(sp.eventId) : eventsRes.docs[0]?.id || null

  const recentBookingsRes = await payload.find({
    collection: 'bookings',
    user,
    overrideAccess: false,
    where: initialEventId ? { event: { equals: initialEventId } } : undefined,
    sort: '-createdAt',
    limit: 50,
    depth: 0,
  })

  const bookingIds = recentBookingsRes.docs.map((b) => b.id)

  const [ticketsRes, tablesRes, slotsRes] =
    bookingIds.length > 0
      ? await Promise.all([
          payload.find({
            collection: 'booking-tickets',
            user,
            overrideAccess: false,
            where: { booking: { in: bookingIds } },
            sort: 'ticketCode',
            limit: 500,
            depth: 0,
          }),
          payload.find({
            collection: 'booking-tables',
            user,
            overrideAccess: false,
            where: { booking: { in: bookingIds } },
            sort: 'tableLabel',
            limit: 500,
            depth: 0,
          }),
          payload.find({
            collection: 'ticket-checkin-slots',
            user,
            overrideAccess: false,
            where: { booking: { in: bookingIds } },
            sort: 'slotIndex',
            limit: 2000,
            depth: 0,
          }),
        ])
      : [{ docs: [] }, { docs: [] }, { docs: [] }]

  const paxNamesByTicket = new Map<number, string[]>()
  for (const s of slotsRes.docs) {
    const tId = typeof s.bookingTicket === 'object' ? s.bookingTicket.id : s.bookingTicket
    const arr = paxNamesByTicket.get(tId) || []
    arr.push(s.attendeeName || s.label)
    paxNamesByTicket.set(tId, arr)
  }

  const ticketsByBooking = new Map<number, typeof ticketsRes.docs>()
  for (const t of ticketsRes.docs) {
    const bId = typeof t.booking === 'object' ? t.booking.id : t.booking
    const arr = ticketsByBooking.get(bId) || []
    arr.push(t)
    ticketsByBooking.set(bId, arr)
  }

  const tablesByBooking = new Map<number, string[]>()
  const tableLabelsByBooking = new Map<number, string[]>()
  for (const bt of tablesRes.docs) {
    const bId = typeof bt.booking === 'object' ? bt.booking.id : bt.booking
    const arr = tablesByBooking.get(bId) || []
    arr.push(`${bt.tableLabel} (${bt.capacity}p)`)
    tablesByBooking.set(bId, arr)

    const lbls = tableLabelsByBooking.get(bId) || []
    lbls.push(bt.tableLabel)
    tableLabelsByBooking.set(bId, lbls)
  }

  const canCreate = userHasRole(user, ['booking_officer', 'super_admin'])

  return (
    <div className="flex min-h-screen flex-col">
      <AppNavbar user={user} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <BookingDeskClient
          events={eventsRes.docs.map((e) => ({
            id: e.id,
            code: e.code,
            name: e.name,
            date: e.date,
            venue: e.venue,
          }))}
          initialEventId={initialEventId}
          canCreate={canCreate}
          recentBookings={recentBookingsRes.docs.map((b) => ({
            id: b.id,
            bookingCode: b.bookingCode,
            holderName: b.holderName,
            phone: b.phone,
            email: b.email,
            totalPax: b.totalPax,
            totalAmount: b.totalAmount,
            status: b.status,
            paymentMode: b.paymentMode,
            tablesSummary: (tablesByBooking.get(b.id) || []).join(', ') || 'Unassigned',
            assignedTableLabels: tableLabelsByBooking.get(b.id) || [],
            tickets: (ticketsByBooking.get(b.id) || []).map((t) => {
              const fromSlots = paxNamesByTicket.get(t.id) || []
              const fromTicket = t.attendeeNames
                ? t.attendeeNames
                    .split(',')
                    .map((n) => n.trim())
                    .filter(Boolean)
                : []
              return {
                id: t.id,
                ticketCode: t.ticketCode,
                ticketTypeName: t.ticketTypeName || 'Ticket',
                paxCount: t.paxCount,
                physicalIssued: Boolean(t.physicalIssued),
                paxNames: fromSlots.length > 0 ? fromSlots : fromTicket,
              }
            }),
          }))}
        />
      </main>
      <PageFooter />
    </div>
  )
}
