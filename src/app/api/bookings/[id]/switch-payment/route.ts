import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getRequestUser, userHasRole } from '@/lib/auth'
import { switchPendingBookingToManual } from '@/lib/razorpay'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getRequestUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!userHasRole(user, ['booking_officer', 'super_admin'])) {
      return NextResponse.json({ error: 'Forbidden: Booking Officer role required' }, { status: 403 })
    }

    const { id } = await context.params
    const bookingId = Number(id)
    const body = await request.json()
    const newPaymentMode =
      body.paymentMode === 'OFFICER_UPI' ? 'OFFICER_UPI' : 'CASH'

    const payload = await getPayload({ config })
    const result = await switchPendingBookingToManual({
      payload,
      user,
      bookingId,
      newPaymentMode,
    })

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to switch payment mode'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
