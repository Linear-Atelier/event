import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getRequestUser, userHasRole } from '@/lib/auth'
import { sendBookingNotifications } from '@/lib/notifications'
import type { Event } from '@/payload-types'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getRequestUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!userHasRole(user, ['booking_officer', 'gate_staff', 'treasurer', 'super_admin'])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await context.params
    const bookingId = Number(id)
    const payload = await getPayload({ config })

    const booking = await payload.findByID({
      collection: 'bookings',
      id: bookingId,
      user,
      overrideAccess: false,
      depth: 1,
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

    const eventObj =
      typeof booking.event === 'object' && booking.event !== null
        ? (booking.event as Event)
        : await payload.findByID({
            collection: 'events',
            id: booking.event as number,
            user,
            overrideAccess: false,
            depth: 0,
          })

    const [ticketsRes, tablesRes] = await Promise.all([
      payload.find({
        collection: 'booking-tickets',
        user,
        overrideAccess: false,
        where: { booking: { equals: bookingId } },
        limit: 100,
        depth: 0,
      }),
      payload.find({
        collection: 'booking-tables',
        user,
        overrideAccess: false,
        where: { booking: { equals: bookingId } },
        limit: 50,
        depth: 0,
      }),
    ])

    const tablesSummary =
      tablesRes.docs.length > 0
        ? tablesRes.docs
            .map((bt) => `${bt.tableLabel} (${bt.capacity}p)`)
            .join(', ')
        : 'Unassigned'

    const result = await sendBookingNotifications({
      payload,
      bookingId,
      bookingCode: booking.bookingCode,
      eventName: eventObj.name,
      eventDate: eventObj.date,
      eventVenue: eventObj.venue,
      holderName: booking.holderName,
      phone: booking.phone,
      email: booking.email,
      totalPax: booking.totalPax,
      totalAmount: booking.totalAmount,
      tablesSummary,
      ticketCodes: ticketsRes.docs.map((t) => t.ticketCode),
      trigger: 'manual_resend',
    })

    return NextResponse.json({ success: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to resend pass'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
