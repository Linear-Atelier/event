import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getRequestUser } from '@/lib/auth'
import {
  cancelRazorpayPaymentLink,
  fetchRazorpayPaymentLink,
  finalizeRazorpayBookingPayment,
  finalizeRazorpayTableUpgrade,
  type PendingUpgradeTablesPayload,
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

    // Check if there is a pending Razorpay table-upgrade payment link
    const pendingUpgrade = booking.pendingUpgradeTables as PendingUpgradeTablesPayload | null | undefined
    if (pendingUpgrade?.gatewayRefId) {
      const rzp = await fetchRazorpayPaymentLink(pendingUpgrade.gatewayRefId).catch(() => null)
      if (rzp?.status === 'paid') {
        const { booking: upgraded, tablesSummary } = await finalizeRazorpayTableUpgrade(
          payload,
          booking.id,
          rzp.paymentId,
        )
        return NextResponse.json({
          status: upgraded.status,
          paymentStatus: upgraded.paymentStatus,
          bookingCode: upgraded.bookingCode,
          totalAmount: upgraded.totalAmount,
          paidAmount: upgraded.paidAmount ?? upgraded.totalAmount,
          upgradeApplied: true,
          tablesSummary,
        })
      }
      return NextResponse.json({
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        bookingCode: booking.bookingCode,
        upgradePending: true,
        upgradePaymentLinkUrl: pendingUpgrade.paymentLinkUrl,
        additionalDue: pendingUpgrade.additionalAmount,
      })
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

    // If still pending payment (either pending_payment hold or PAY_AT_DOOR with a generated Razorpay link),
    // actively check Razorpay API (works even on localhost without webhook!)
    if (
      booking.status === 'pending_payment' ||
      (booking.paymentStatus === 'pending' && Boolean(booking.gatewayRefId))
    ) {
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

      // Check 10-minute POS hold expiry (only applies to pending_payment holds, not confirmed PAY_AT_DOOR)
      if (
        booking.status === 'pending_payment' &&
        booking.paymentExpiresAt &&
        Date.now() >= new Date(booking.paymentExpiresAt).getTime()
      ) {
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
