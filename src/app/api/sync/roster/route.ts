import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getRequestUser } from '@/lib/auth'
import type { User } from '@/payload-types'

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const eventId = Number(searchParams.get('eventId'))
    if (!eventId) {
      return NextResponse.json({ error: 'eventId query param is required' }, { status: 400 })
    }

    const payload = await getPayload({ config })

    const event = await payload.findByID({
      collection: 'events',
      id: eventId,
      user,
      overrideAccess: false,
      depth: 0,
    })

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const bookingsRes = await payload.find({
      collection: 'bookings',
      user,
      overrideAccess: false,
      where: { event: { equals: eventId } },
      limit: 2000,
      depth: 0,
    })

    const bookingIds = bookingsRes.docs.map((b) => b.id)

    const [ticketsRes, tablesRes, slotsRes] =
      bookingIds.length > 0
        ? await Promise.all([
            payload.find({
              collection: 'booking-tickets',
              user,
              overrideAccess: false,
              where: { booking: { in: bookingIds } },
              limit: 5000,
              depth: 0,
            }),
            payload.find({
              collection: 'booking-tables',
              user,
              overrideAccess: false,
              where: { booking: { in: bookingIds } },
              limit: 5000,
              depth: 0,
            }),
            payload.find({
              collection: 'ticket-checkin-slots',
              user,
              overrideAccess: false,
              where: { booking: { in: bookingIds } },
              limit: 10000,
              depth: 1,
            }),
          ])
        : [{ docs: [] }, { docs: [] }, { docs: [] }]

    // Build table summaries per booking
    const tablesByBooking = new Map<number, string[]>()
    for (const bt of tablesRes.docs) {
      const bId = typeof bt.booking === 'object' ? bt.booking.id : bt.booking
      const label = `${bt.tableLabel} (${bt.capacity}p)`
      const list = tablesByBooking.get(bId) || []
      if (!list.includes(label)) {
        list.push(label)
      }
      tablesByBooking.set(bId, list)
    }

    return NextResponse.json({
      event: {
        id: event.id,
        code: event.code,
        name: event.name,
        date: event.date,
        venue: event.venue,
        publicKey: event.publicKey || '',
        downloadedAt: new Date().toISOString(),
      },
      bookings: bookingsRes.docs.map((b) => ({
        id: b.id,
        eventId: event.id,
        bookingCode: b.bookingCode,
        holderName: b.holderName,
        phone: b.phone,
        email: b.email || null,
        totalPax: b.totalPax,
        totalAmount: b.totalAmount,
        status: b.status,
        paymentMode: b.paymentMode,
        paymentStatus: b.paymentStatus,
        tablesSummary: (tablesByBooking.get(b.id) || []).join(', ') || 'Unassigned',
        qrSignature: b.qrSignature || '',
      })),
      tickets: ticketsRes.docs.map((t) => ({
        id: t.id,
        bookingId: typeof t.booking === 'object' ? t.booking.id : t.booking,
        ticketCode: t.ticketCode,
        phaseName: t.phaseName || '',
        typeName: t.ticketTypeName || 'Ticket',
        paxCount: t.paxCount,
        physicalIssued: Boolean(t.physicalIssued),
      })),
      slots: slotsRes.docs.map((s) => {
        const byUser = s.checkedInByUser as User | null
        return {
          id: s.id,
          bookingId: typeof s.booking === 'object' ? s.booking.id : s.booking,
          bookingTicketId:
            typeof s.bookingTicket === 'object' ? s.bookingTicket.id : s.bookingTicket,
          slotIndex: s.slotIndex,
          label: s.label,
          attendeeName: s.attendeeName || null,
          checkedInAt: s.checkedInAt || null,
          checkedInByUserName: byUser?.name || null,
          deviceId: s.deviceId || null,
          method: s.method || null,
        }
      }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to download roster'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
