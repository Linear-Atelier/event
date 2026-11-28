import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getRequestUser, userHasRole } from '@/lib/auth'
import { cancelRazorpayPaymentLink } from '@/lib/razorpay'

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
    const status = body.status as 'confirmed' | 'pay_at_door' | 'cancelled'
    const holderName = body.holderName ? String(body.holderName).trim() : undefined
    const phone = body.phone ? String(body.phone).trim() : undefined
    const email = body.email !== undefined ? String(body.email || '').trim() : undefined
    const notes = body.notes ? String(body.notes).trim() : undefined
    const paymentStatus = body.paymentStatus as 'paid' | 'pending' | 'refunded' | undefined

    const payload = await getPayload({ config })
    if (status === 'cancelled') {
      const existing = await payload.findByID({
        collection: 'bookings',
        id: bookingId,
        user,
        overrideAccess: false,
        depth: 0,
      })
      if (existing?.gatewayRefId && existing.status === 'pending_payment') {
        await cancelRazorpayPaymentLink(existing.gatewayRefId)
      }
    }

    const updateData: Record<string, unknown> = {}
    if (status) updateData.status = status
    if (holderName) updateData.holderName = holderName
    if (phone) updateData.phone = phone
    if (email !== undefined) updateData.email = email || null
    if (notes !== undefined) updateData.notes = notes
    if (paymentStatus) updateData.paymentStatus = paymentStatus

    const updated = await payload.update({
      collection: 'bookings',
      id: bookingId,
      user,
      overrideAccess: false,
      data: updateData,
    })

    return NextResponse.json({ booking: updated })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update booking status'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
