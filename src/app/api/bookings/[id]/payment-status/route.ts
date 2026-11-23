import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getRequestUser } from '@/lib/auth'
import {
  cancelRazorpayPaymentLink,
  fetchRazorpayPaymentLink,
  finalizeRazorpayBookingPayment,
} from '@/lib/razorpay'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getRequestUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      depth: 0,
    })

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    // Already confirmed & paid
    if (booking.status === 'confirmed' && booking.paymentStatus === 'paid') {
      return NextResponse.json({
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        bookingCode: booking.bookingCode,
        paymentLinkUrl: booking.paymentLinkUrl || null,
        paymentExpiresAt: booking.paymentExpiresAt || null,
      })
    }

    // If still pending_payment, actively check Razorpay API (works even on localhost without webhook!)
    if (booking.status === 'pending_payment') {
      if (booking.gatewayRefId) {
        const rzp = await fetchRazorpayPaymentLink(booking.gatewayRefId).catch(() => null)
        if (rzp?.status === 'paid') {
          const { booking: confirmed } = await finalizeRazorpayBookingPayment(
            payload,
            booking.id,
            rzp.paymentId,
          )
          return NextResponse.json({
            status: confirmed.status,
            paymentStatus: confirmed.paymentStatus,
            bookingCode: confirmed.bookingCode,
            paymentLinkUrl: confirmed.paymentLinkUrl || null,
            paymentExpiresAt: confirmed.paymentExpiresAt || null,
            justConfirmed: true,
          })
        }
      }

      // Check 10-minute POS hold expiry
      if (booking.paymentExpiresAt && Date.now() >= new Date(booking.paymentExpiresAt).getTime()) {
        if (booking.gatewayRefId) {
          await cancelRazorpayPaymentLink(booking.gatewayRefId)
        }
        await payload.update({
          collection: 'bookings',
          id: booking.id,
          overrideAccess: true,
          data: {
            status: 'cancelled',
            notes: booking.notes
              ? `${booking.notes}\n[Auto-cancelled: 10-min Razorpay hold expired]`
              : '[Auto-cancelled: 10-min Razorpay hold expired]',
          },
        })
        return NextResponse.json({
          status: 'cancelled',
          paymentStatus: 'pending',
          bookingCode: booking.bookingCode,
          expired: true,
        })
      }
    }

    return NextResponse.json({
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      bookingCode: booking.bookingCode,
      paymentLinkUrl: booking.paymentLinkUrl || null,
      paymentExpiresAt: booking.paymentExpiresAt || null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to check payment status'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
