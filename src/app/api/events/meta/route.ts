import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getRequestUser } from '@/lib/auth'
import { expandEventTables } from '@/lib/event-tables'
import { isPhaseActiveNow } from '@/lib/phase-status'
import { expireStalePendingBookings } from '@/lib/razorpay'
import type { Booking, TableType, TicketType } from '@/payload-types'

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const eventId = Number(searchParams.get('eventId'))
    if (!eventId) {
      return NextResponse.json({ error: 'eventId is required' }, { status: 400 })
    }

    const payload = await getPayload({ config })
    await expireStalePendingBookings(payload, eventId)

    const [event, ticketTypesRes, tableTypesRes, bookingsRes] = await Promise.all([
      payload.findByID({
        collection: 'events',
        id: eventId,
        user,
        overrideAccess: false,
        depth: 1,
      }),
      payload.find({
        collection: 'ticket-types',
        user,
        overrideAccess: false,
        limit: 100,
        depth: 0,
      }),
      payload.find({
        collection: 'table-types',
        user,
        overrideAccess: false,
        limit: 100,
        depth: 0,
      }),
      payload.find({
        collection: 'bookings',
        user,
        overrideAccess: false,
        where: {
          and: [
            { event: { equals: eventId } },
            { status: { not_equals: 'cancelled' } },
          ],
        },
        limit: 2000,
        depth: 0,
      }),
    ])

    const activeBookings = bookingsRes.docs as Booking[]
    const activeBookingIds = activeBookings.map((b) => b.id)
    const bookingById = new Map<number, Booking>(activeBookings.map((b) => [b.id, b]))

    const [bookingTablesRes, existingSlotsRes] =
      activeBookingIds.length > 0
        ? await Promise.all([
            payload.find({
              collection: 'booking-tables',
              user,
              overrideAccess: false,
              where: { booking: { in: activeBookingIds } },
              limit: 5000,
              depth: 0,
            }),
            payload.find({
              collection: 'ticket-checkin-slots',
              user,
              overrideAccess: false,
              where: { booking: { in: activeBookingIds } },
              limit: 10000,
              depth: 0,
            }),
          ])
        : [{ docs: [] }, { docs: [] }]

    const bookedAttendees = existingSlotsRes.docs.map((slot) => {
      const bId = typeof slot.booking === 'object' ? slot.booking.id : slot.booking
      const bObj = bookingById.get(bId)
      const mId =
        slot.member && typeof slot.member === 'object'
          ? Number(slot.member.id)
          : slot.member
            ? Number(slot.member)
            : null
      const name = (slot.attendeeName || slot.label.split(' — ')[0] || '').trim()
      return {
        memberId: mId,
        name,
        bookingCode: bObj?.bookingCode || '',
      }
    })

    // Map each reserved tableLabel -> reserving booking info (non-sharing)
    const reservedByLabel = new Map<
      string,
      { bookingId: number; bookingCode: string; holderName: string }
    >()
    for (const bt of bookingTablesRes.docs) {
      const bId = typeof bt.booking === 'object' ? bt.booking.id : bt.booking
      const bObj = bookingById.get(bId)
      if (!bObj) continue
      reservedByLabel.set(bt.tableLabel, {
        bookingId: bObj.id,
        bookingCode: bObj.bookingCode,
        holderName: bObj.holderName,
      })
    }

    const tableTypesMap = new Map<
      number | string,
      { name: string; capacity: number; prefix?: string | null }
    >(
      (tableTypesRes.docs as TableType[]).map((tt) => [
        tt.id,
        { name: tt.name, capacity: tt.capacity, prefix: tt.prefix },
      ]),
    )

    const virtualTables = expandEventTables(event.tables, tableTypesMap)

    const now = new Date()
    const eventPhases = event.phases || []

    const flattenedPhases = eventPhases.flatMap((phase) => {
      const active = isPhaseActiveNow(
        {
          startsAt: phase.startsAt,
          endsAt: phase.endsAt,
          overrideStatus: phase.overrideStatus,
        },
        now,
      )
      return (phase.tickets || []).map((row) => {
        const tt =
          typeof row.ticketType === 'object' && row.ticketType !== null
            ? (row.ticketType as TicketType)
            : ticketTypesRes.docs.find((t) => t.id === row.ticketType)

        const rowId = String(row.id || `${phase.id || phase.phaseName}-${tt?.id || 'ticket'}`)
        return {
          id: rowId,
          phaseName: phase.phaseName,
          price: row.price,
          maxQty: row.maxQty ?? null,
          startsAt: phase.startsAt ?? null,
          endsAt: phase.endsAt ?? null,
          overrideStatus: phase.overrideStatus || 'auto',
          isActive: active,
          ticketTypeId: String(tt?.id ?? row.ticketType),
          ticketTypeName: tt?.name || 'Ticket',
          paxMultiplier: tt?.paxMultiplier || 1,
          memberOnly: Boolean(tt?.memberOnly),
        }
      })
    })

    return NextResponse.json({
      event,
      ticketTypes: ticketTypesRes.docs,
      tableTypes: tableTypesRes.docs,
      ticketPhases: flattenedPhases,
      tables: virtualTables.map((t) => {
        const reserved = reservedByLabel.get(t.tableLabel)
        return {
          tableLabel: t.tableLabel,
          tableTypeName: t.tableTypeName,
          maxCapacity: t.capacity,
          price: t.price,
          isReserved: Boolean(reserved),
          reservedByBookingId: reserved?.bookingId ?? null,
          reservedByBookingCode: reserved?.bookingCode ?? null,
          reservedByHolderName: reserved?.holderName ?? null,
        }
      }),
      activeBookingCount: activeBookings.length,
      bookedAttendees,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load event metadata'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
