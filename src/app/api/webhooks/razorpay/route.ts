import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import {
  finalizeRazorpayBookingPayment,
  finalizeRazorpayTableUpgrade,
  verifyRazorpayWebhookSignature,
  type PendingUpgradeTablesPayload,
} from '@/lib/razorpay'

interface RazorpayWebhookPayload {
  event?: string
  payload?: {
    payment_link?: {
      entity?: {
        id?: string
        status?: string
        reference_id?: string
        notes?: Record<string, string>
      }
    }
    payment?: {
      entity?: {
        id?: string
        status?: string
        notes?: Record<string, string>
      }
    }
  }
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-razorpay-signature')

    if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 })
    }

    const body = JSON.parse(rawBody) as RazorpayWebhookPayload
    const eventType = body.event || ''
    const payload = await getPayload({ config })

    const plinkEntity = body.payload?.payment_link?.entity
    const paymentEntity = body.payload?.payment?.entity

    const notesBookingId =
      Number(plinkEntity?.notes?.bookingId || paymentEntity?.notes?.bookingId || 0) || null
    const plinkId = plinkEntity?.id || null
    const paymentId = paymentEntity?.id || undefined

    // Resolve bookingId via notes or gatewayRefId
    let bookingId = notesBookingId
    if (!bookingId && plinkId) {
      const found = await payload.find({
        collection: 'bookings',
        overrideAccess: true,
        where: { gatewayRefId: { equals: plinkId } },
        limit: 1,
        depth: 0,
      })
      bookingId = found.docs[0]?.id ?? null
    }

    if (!bookingId) {
      return NextResponse.json({ received: true, ignored: 'No matching booking' })
    }

    if (eventType === 'payment_link.paid' || eventType === 'payment.captured') {
      const bookingDoc = await payload.findByID({
        collection: 'bookings',
        id: bookingId,
        overrideAccess: true,
        depth: 0,
      })
      const pendingUpgrade = bookingDoc?.pendingUpgradeTables as
        | PendingUpgradeTablesPayload
        | null
        | undefined
      const isTableUpgrade =
        plinkEntity?.notes?.purpose === 'table_upgrade' ||
        paymentEntity?.notes?.purpose === 'table_upgrade' ||
        (Boolean(plinkId) && pendingUpgrade?.gatewayRefId === plinkId)

      if (isTableUpgrade) {
        await finalizeRazorpayTableUpgrade(payload, bookingId, paymentId)
        return NextResponse.json({ received: true, action: 'table_upgrade_confirmed', bookingId })
      }

      await finalizeRazorpayBookingPayment(payload, bookingId, paymentId)
      return NextResponse.json({ received: true, action: 'confirmed', bookingId })
    }

    if (eventType === 'payment_link.cancelled' || eventType === 'payment_link.expired') {
      const existing = await payload.findByID({
        collection: 'bookings',
        id: bookingId,
        overrideAccess: true,
        depth: 0,
      })
      if (existing && existing.status === 'pending_payment') {
        await payload.update({
          collection: 'bookings',
          id: bookingId,
          overrideAccess: true,
          data: {
            status: 'cancelled',
            notes: existing.notes
              ? `${existing.notes}\n[Razorpay webhook: ${eventType}]`
              : `[Razorpay webhook: ${eventType}]`,
          },
        })
      }
      return NextResponse.json({ received: true, action: 'cancelled', bookingId })
    }

    return NextResponse.json({ received: true, ignored: eventType })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook processing failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
