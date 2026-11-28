import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getRequestUser, userHasRole } from '@/lib/auth'
import { createFullBooking } from '@/lib/booking-service'

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!userHasRole(user, ['booking_officer', 'super_admin'])) {
      return NextResponse.json({ error: 'Forbidden: Booking Officer role required' }, { status: 403 })
    }

    const body = await request.json()
    const payload = await getPayload({ config })

    const isPayAtDoor = Boolean(body.payAtDoor) || body.paymentMode === 'PAY_AT_DOOR'
    const result = await createFullBooking({
      payload,
      user,
      eventId: Number(body.eventId),
      memberId: body.memberId ? Number(body.memberId) : null,
      holderName: String(body.holderName || ''),
      phone: String(body.phone || ''),
      email: body.email ? String(body.email) : null,
      payAtDoor: isPayAtDoor,
      paymentMode: isPayAtDoor ? null : body.paymentMode || 'CASH',
      paymentStatus: body.paymentStatus,
      notes: body.notes,
      tickets: Array.isArray(body.tickets) ? body.tickets : [],
      tables: Array.isArray(body.tables) ? body.tables : [],
    })

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create booking'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
