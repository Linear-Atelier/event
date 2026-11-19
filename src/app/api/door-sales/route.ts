import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getRequestUser, userHasRole } from '@/lib/auth'
import { createFullBooking } from '@/lib/booking-service'

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!userHasRole(user, ['gate_staff', 'booking_officer', 'super_admin'])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const payload = await getPayload({ config })

    const result = await createFullBooking({
      payload,
      user,
      eventId: Number(body.eventId),
      holderName: String(body.holderName || 'Walk-In Guest'),
      phone: String(body.phone || ''),
      email: body.email ? String(body.email) : null,
      paymentMode: body.paymentMode || 'CASH',
      paymentStatus: body.paymentMode === 'PAY_AT_DOOR' ? 'pending' : 'paid',
      notes: body.notes ? `Door Sale: ${body.notes}` : 'Door Sale / Walk-In',
      tickets: Array.isArray(body.tickets) ? body.tickets : [],
      tables: [],
      autoCheckInAll: body.autoCheckInAll !== false,
      deviceId: body.deviceId || 'GATE-DOOR',
      checkInMethod: 'door_sale',
    })

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Door sale failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
