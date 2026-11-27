import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getRequestUser, userHasRole } from '@/lib/auth'
import { expandEventTables } from '@/lib/event-tables'
import { sendBookingNotifications } from '@/lib/notifications'
import {
  cancelRazorpayPaymentLink,
  createRazorpayPaymentLink,
  type PendingUpgradeTablesPayload,
} from '@/lib/razorpay'

type UpgradePaymentMode = 'RAZORPAY' | 'CASH' | 'OFFICER_UPI' | 'PAY_AT_DOOR' | 'COMPLIMENTARY'

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
    const channels: 'both' | 'email' | 'whatsapp' =
      body.channels === 'email' || body.channels === 'whatsapp' ? body.channels : 'both'
    const paymentMode: UpgradePaymentMode =
      body.paymentMode === 'RAZORPAY' ||
      body.paymentMode === 'CASH' ||
      body.paymentMode === 'OFFICER_UPI' ||
      body.paymentMode === 'PAY_AT_DOOR' ||
      body.paymentMode === 'COMPLIMENTARY'
        ? body.paymentMode
        : 'CASH'

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
    if (booking.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Cannot assign tables to a cancelled booking.' },
        { status: 400 },
      )
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

    // Load existing table allocations to compute price delta
    const existing = await payload.find({
      collection: 'booking-tables',
      user,
      overrideAccess: false,
      where: { booking: { equals: bookingId } },
      limit: 100,
      depth: 0,
    })

    const existingTableFee = existing.docs.reduce(
      (sum, row) => sum + Math.max(0, Number(row.price) || 0),
      0,
    )
    const newTableFee = requestedLabels.reduce(
      (sum, lbl) => sum + Math.max(0, Number(virtualByLabel.get(lbl)?.price) || 0),
      0,
    )
    const additionalDue = Math.max(0, newTableFee - existingTableFee)

    // Cancel any previously pending Razorpay table-upgrade link
    const prevPendingUpgrade = booking.pendingUpgradeTables as
      | PendingUpgradeTablesPayload
      | null
      | undefined
    if (prevPendingUpgrade?.gatewayRefId) {
      await cancelRazorpayPaymentLink(prevPendingUpgrade.gatewayRefId)
    }

    // If additional fee is due via Razorpay, create a Payment Link and hold the upgrade until paid
    if (additionalDue > 0 && paymentMode === 'RAZORPAY') {
      const plink = await createRazorpayPaymentLink({
        bookingId,
        bookingCode: booking.bookingCode,
        eventName: eventObj.name,
        holderName: booking.holderName,
        phone: booking.phone,
        email: booking.email,
        amountInr: additionalDue,
        totalPax: booking.totalPax,
        referenceId: `${booking.bookingCode}-T${Date.now().toString().slice(-4)}`,
        description: `Table Upgrade (${requestedLabels.join(', ')}) · ${booking.bookingCode}`,
        purpose: 'table_upgrade',
      })

      const pendingPayload: PendingUpgradeTablesPayload = {
        labels: requestedLabels,
        additionalAmount: additionalDue,
        gatewayRefId: plink.id,
        paymentLinkUrl: plink.shortUrl,
        resendNotification,
        channels,
        requestedByUserId: user.id,
      }

      await payload.update({
        collection: 'bookings',
        id: bookingId,
        user,
        overrideAccess: false,
        data: {
          pendingUpgradeTables: pendingPayload as unknown as Record<string, unknown>,
        },
      })

      return NextResponse.json({
        success: true,
        status: 'awaiting_payment',
        paymentLinkUrl: plink.shortUrl,
        gatewayRefId: plink.id,
        additionalDue,
        existingTableFee,
        newTableFee,
      })
    }

    // Otherwise apply tables immediately
    for (const row of existing.docs) {
      await payload.delete({
        collection: 'booking-tables',
        id: row.id,
        user,
        overrideAccess: false,
      })
    }

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
          price: paymentMode === 'COMPLIMENTARY' ? 0 : vt.price,
          assignedByOfficer: user.id,
          assignedAt: nowIso,
        },
      })
      tableLabels.push(`${vt.tableLabel} (${vt.capacity}p)`)
    }

    const tablesSummary = tableLabels.length > 0 ? tableLabels.join(', ') : 'Unassigned'

    // Update booking totals / payment tracking if there was an additional table fee or stale pending upgrade
    let updatedTotalAmount = booking.totalAmount
    const prevPaidAmount =
      typeof booking.paidAmount === 'number'
        ? booking.paidAmount
        : booking.paymentStatus === 'paid'
          ? booking.totalAmount
          : 0
    let updatedPaidAmount = prevPaidAmount

    if (additionalDue > 0 || prevPendingUpgrade) {
      const chargeAmount = paymentMode === 'COMPLIMENTARY' ? 0 : additionalDue
      updatedTotalAmount = booking.totalAmount + chargeAmount
      if (chargeAmount > 0 && paymentMode !== 'PAY_AT_DOOR') {
        updatedPaidAmount = prevPaidAmount + chargeAmount
      }

      const upgradeNote =
        additionalDue > 0
          ? `[Table fee ${paymentMode === 'COMPLIMENTARY' ? 'waived' : `+₹${additionalDue.toLocaleString('en-IN')} via ${paymentMode}`} by ${user.name || user.email}]`
          : ''

      await payload.update({
        collection: 'bookings',
        id: bookingId,
        user,
        overrideAccess: false,
        data: {
          totalAmount: updatedTotalAmount,
          paidAmount: updatedPaidAmount,
          pendingUpgradeTables: null,
          ...(additionalDue > 0 && paymentMode === 'PAY_AT_DOOR'
            ? { paymentStatus: 'pending', paymentMode: 'PAY_AT_DOOR' }
            : {}),
          ...(upgradeNote
            ? { notes: booking.notes ? `${booking.notes}\n${upgradeNote}` : upgradeNote }
            : {}),
        },
      })
    }

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
        totalAmount: updatedTotalAmount,
        tablesSummary,
        ticketCodes: ticketsRes.docs.map((t) => t.ticketCode),
        trigger: 'table_updated',
        channels,
      })
    }

    return NextResponse.json({
      success: true,
      status: 'applied',
      tablesSummary,
      assignedTableLabels: requestedLabels,
      additionalDue,
      totalAmount: updatedTotalAmount,
      paidAmount: updatedPaidAmount,
      notificationResult,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update tables'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
