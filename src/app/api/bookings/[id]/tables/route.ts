import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getRequestUser, userHasRole } from '@/lib/auth'
import { expandEventTables } from '@/lib/event-tables'
import { sendBookingNotifications } from '@/lib/notifications'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getRequestUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!userHasRole(user, ['booking_officer', 'super_admin'])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await context.params
    const bookingId = Number(id)
    const body = await request.json()
    const rawTables: Array<string | { tableLabel?: string }> = Array.isArray(body.tables)
      ? body.tables
      : []
    const requestedLabels = Array.from(
      new Set(
        rawTables
          .map((t) => (typeof t === 'string' ? t.trim() : String(t?.tableLabel || '').trim()))
          .filter(Boolean),
      ),
    )
    const resendNotification = Boolean(body.resendNotification)

    const payload = await getPayload({ config })

    const booking = await payload.findByID({
      collection: 'bookings',
      id: bookingId,
      user,
      overrideAccess: false,
      depth: 0,
    })

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    const eventId = typeof booking.event === 'object' ? booking.event.id : booking.event
    const eventObj = await payload.findByID({
      collection: 'events',
      id: eventId,
      user,
      overrideAccess: false,
      depth: 1,
    })

    const virtualTables = expandEventTables(eventObj.tables)
    const virtualByLabel = new Map(virtualTables.map((t) => [t.tableLabel, t]))

    for (const lbl of requestedLabels) {
      if (!virtualByLabel.has(lbl)) {
        return NextResponse.json(
          { error: `Table "${lbl}" does not exist on this event.` },
          { status: 400 },
        )
      }
    }

    // Check non-sharing conflict against OTHER active bookings for this event
    if (requestedLabels.length > 0) {
      const otherBookingsRes = await payload.find({
        collection: 'bookings',
        user,
        overrideAccess: false,
        where: {
          and: [
            { event: { equals: eventId } },
            { status: { not_equals: 'cancelled' } },
            { id: { not_equals: bookingId } },
          ],
        },
        limit: 2000,
        depth: 0,
      })
      const otherIds = otherBookingsRes.docs.map((b) => b.id)
      if (otherIds.length > 0) {
        const conflicts = await payload.find({
          collection: 'booking-tables',
          user,
          overrideAccess: false,
          where: {
            and: [
              { booking: { in: otherIds } },
              { tableLabel: { in: requestedLabels } },
            ],
          },
          limit: 50,
          depth: 1,
        })
        if (conflicts.docs.length > 0) {
          const c = conflicts.docs[0]
          const cCode =
            typeof c.booking === 'object' && c.booking !== null
              ? c.booking.bookingCode
              : `#${c.booking}`
          return NextResponse.json(
            {
              error: `Table ${c.tableLabel} is already reserved by booking ${cCode} (tables are non-sharing).`,
            },
            { status: 400 },
          )
        }
      }
    }

    // Delete existing table allocations for this booking
    const existing = await payload.find({
      collection: 'booking-tables',
      user,
      overrideAccess: false,
      where: { booking: { equals: bookingId } },
      limit: 100,
      depth: 0,
    })

    for (const row of existing.docs) {
      await payload.delete({
        collection: 'booking-tables',
        id: row.id,
        user,
        overrideAccess: false,
      })
    }

    // Insert new non-sharing table allocations
    const nowIso = new Date().toISOString()
    const tableLabels: string[] = []
    for (const lbl of requestedLabels) {
      const vt = virtualByLabel.get(lbl)!
      await payload.create({
        collection: 'booking-tables',
        user,
        overrideAccess: false,
        data: {
          booking: bookingId,
          tableLabel: vt.tableLabel,
          tableTypeName: vt.tableTypeName,
          capacity: vt.capacity,
          assignedByOfficer: user.id,
          assignedAt: nowIso,
        },
      })
      tableLabels.push(`${vt.tableLabel} (${vt.capacity}p)`)
    }

    const tablesSummary = tableLabels.length > 0 ? tableLabels.join(', ') : 'Unassigned'

    let notificationResult = null
    if (resendNotification) {
      const ticketsRes = await payload.find({
        collection: 'booking-tickets',
        user,
        overrideAccess: false,
        where: { booking: { equals: bookingId } },
        limit: 100,
        depth: 0,
      })

      notificationResult = await sendBookingNotifications({
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
        trigger: 'table_updated',
      })
    }

    return NextResponse.json({
      success: true,
      tablesSummary,
      assignedTableLabels: requestedLabels,
      notificationResult,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update tables'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
