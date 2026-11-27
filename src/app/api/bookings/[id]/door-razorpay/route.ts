import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getRequestUser, userHasRole } from '@/lib/auth'
import { createRazorpayPaymentLink } from '@/lib/razorpay'
import type { Event } from '@/payload-types'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getRequestUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!userHasRole(user, ['gate_staff', 'booking_officer', 'super_admin'])) {
      return NextResponse.json({ error: 'Forbidden: Gate Staff role required' }, { status: 403 })
    }

    const { id } = await context.params
    const bookingId = Number(id)
    if (!bookingId) {
      return NextResponse.json({ error: 'Invalid booking id' }, { status: 400 })
    }

    const payload = await getPayload({ config })
    const booking = await payload.findByID({
      collection: 'bookings',
      id: bookingId,
      user,
      overrideAccess: false,
      depth: 1,
    })

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }
    if (booking.status === 'cancelled') {
      return NextResponse.json({ error: 'Booking is cancelled' }, { status: 400 })
    }
    if (booking.paymentStatus === 'paid') {
      return NextResponse.json({ alreadyPaid: true, paymentStatus: 'paid' })
    }

    // Reuse existing Razorpay link if already generated for this door booking
    if (booking.gatewayRefId && booking.paymentLinkUrl) {
      return NextResponse.json({
        paymentLinkUrl: booking.paymentLinkUrl,
        gatewayRefId: booking.gatewayRefId,
      })
    }

    const eventDoc =
      typeof booking.event === 'object' && booking.event !== null
        ? (booking.event as Event)
        : ((await payload.findByID({
            collection: 'events',
            id: booking.event as number,
            overrideAccess: true,
            depth: 0,
          })) as Event)

    const plink = await createRazorpayPaymentLink({
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      eventName: eventDoc?.name || 'Event',
      holderName: booking.holderName,
      phone: booking.phone,
      email: booking.email,
      amountInr: booking.totalAmount,
      totalPax: booking.totalPax,
    })

    await payload.update({
      collection: 'bookings',
      id: booking.id,
      overrideAccess: true,
      data: {
        gatewayProvider: 'razorpay',
        gatewayRefId: plink.id,
        paymentLinkUrl: plink.shortUrl,
      },
    })

    return NextResponse.json({
      paymentLinkUrl: plink.shortUrl,
      gatewayRefId: plink.id,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create Razorpay link'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
