import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getRequestUser, userHasRole } from '@/lib/auth'
import { sendBookingNotifications } from '@/lib/notifications'
import {
  cancelRazorpayPaymentLink,
  refundRazorpayPayment,
  type PendingUpgradeTablesPayload,
} from '@/lib/razorpay'

function normalizeAttendeeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getRequestUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!userHasRole(user, ['booking_officer', 'super_admin'])) {
      return NextResponse.json(
        { error: 'Forbidden: Booking Officer or Admin role required' },
        { status: 403 },
      )
    }

    const { id } = await context.params
    const bookingId = Number(id)
    if (!bookingId || Number.isNaN(bookingId)) {
      return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
    }

    const body = (await request.json()) as Record<string, unknown>
    const action = String(body.action || '')

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

    const eventId = typeof booking.event === 'object' ? booking.event.id : booking.event
    const eventObj = await payload.findByID({
      collection: 'events',
      id: eventId,
      user,
      overrideAccess: false,
      depth: 0,
    })

    // -----------------------------------------------------------------------
    // ACTION 1: UPDATE DETAILS, GUEST NAMES & OPTIONAL TRANSFER
    // -----------------------------------------------------------------------
    if (action === 'update_details') {
      if (booking.status === 'cancelled') {
        return NextResponse.json(
          { error: 'Cannot edit details on a cancelled booking.' },
          { status: 400 },
        )
      }

      const holderName = String(body.holderName ?? booking.holderName).trim()
      const phone = String(body.phone ?? booking.phone).trim()
      const email =
        body.email !== undefined ? String(body.email || '').trim() : booking.email || ''
      const notes =
        body.notes !== undefined ? String(body.notes || '').trim() : booking.notes || ''
      const markTransferred = Boolean(body.markTransferred)
      const resendChannels = String(body.resendChannels || 'none') as
        | 'none'
        | 'email'
        | 'whatsapp'
        | 'both'

      if (!holderName) {
        return NextResponse.json({ error: 'Holder name is required.' }, { status: 400 })
      }
      if (!phone) {
        return NextResponse.json({ error: 'Phone number is required.' }, { status: 400 })
      }

      // Optional attendee slot name updates
      const attendeeUpdates = Array.isArray(body.attendeeUpdates)
        ? (body.attendeeUpdates as Array<{ slotId?: number; attendeeName?: string }>)
            .filter((u) => Number(u?.slotId) > 0 && typeof u?.attendeeName === 'string')
            .map((u) => ({
              slotId: Number(u.slotId),
              attendeeName: String(u.attendeeName).trim(),
            }))
        : []

      if (attendeeUpdates.length > 0) {
        const bookingSlotsRes = await payload.find({
          collection: 'ticket-checkin-slots',
          user,
          overrideAccess: false,
          where: { booking: { equals: bookingId } },
          limit: 500,
          depth: 0,
        })
        const bookingSlotById = new Map(bookingSlotsRes.docs.map((s) => [s.id, s]))

        // Validate every updated slot belongs to this booking and is not checked in
        const changedUpdates: Array<{ slotId: number; attendeeName: string }> = []
        for (const u of attendeeUpdates) {
          const slot = bookingSlotById.get(u.slotId)
          if (!slot) {
            return NextResponse.json(
              { error: `Attendee slot #${u.slotId} does not belong to this booking.` },
              { status: 400 },
            )
          }
          if (!u.attendeeName) {
            return NextResponse.json(
              { error: 'Attendee name cannot be blank.' },
              { status: 400 },
            )
          }
          const currentName = (slot.attendeeName || slot.label.split(' — ')[0] || '').trim()
          if (currentName === u.attendeeName) continue
          if (slot.checkedInAt) {
            return NextResponse.json(
              { error: `Cannot rename "${currentName}" because they are already checked in.` },
              { status: 400 },
            )
          }
          changedUpdates.push(u)
        }

        if (changedUpdates.length > 0) {
          // Check uniqueness across all active bookings for this event
          const activeBookingsRes = await payload.find({
            collection: 'bookings',
            overrideAccess: true,
            where: {
              and: [
                { event: { equals: eventId } },
                { status: { not_equals: 'cancelled' } },
              ],
            },
            limit: 2000,
            depth: 0,
          })
          const activeIds = activeBookingsRes.docs.map((b) => b.id)
          const codeByBookingId = new Map(
            activeBookingsRes.docs.map((b) => [b.id, b.bookingCode]),
          )
          const allEventSlotsRes = await payload.find({
            collection: 'ticket-checkin-slots',
            overrideAccess: true,
            where: { booking: { in: activeIds } },
            limit: 10000,
            depth: 0,
          })

          const updatedSlotIdSet = new Set(changedUpdates.map((u) => u.slotId))
          const existingNames = new Map<string, string>()
          for (const s of allEventSlotsRes.docs) {
            if (updatedSlotIdSet.has(s.id)) continue
            const norm = normalizeAttendeeName(s.attendeeName || s.label.split(' — ')[0] || '')
            if (norm) {
              const bId = typeof s.booking === 'object' ? s.booking.id : s.booking
              existingNames.set(norm, codeByBookingId.get(bId) || 'another booking')
            }
          }

          const seenNew = new Set<string>()
          for (const u of changedUpdates) {
            const norm = normalizeAttendeeName(u.attendeeName)
            if (seenNew.has(norm)) {
              return NextResponse.json(
                { error: `"${u.attendeeName}" is listed more than once.` },
                { status: 400 },
              )
            }
            if (existingNames.has(norm)) {
              return NextResponse.json(
                {
                  error: `"${u.attendeeName}" is already booked on ${existingNames.get(norm)} for this event.`,
                },
                { status: 400 },
              )
            }
            seenNew.add(norm)
          }

          // Apply slot updates
          const touchedTicketIds = new Set<number>()
          for (const u of changedUpdates) {
            const slot = bookingSlotById.get(u.slotId)!
            const parts = slot.label.split(' — ')
            const newLabel =
              parts.length > 1 ? `${u.attendeeName} — ${parts.slice(1).join(' — ')}` : u.attendeeName

            await payload.update({
              collection: 'ticket-checkin-slots',
              id: slot.id,
              user,
              overrideAccess: false,
              data: {
                attendeeName: u.attendeeName,
                label: newLabel,
              },
            })
            const tId =
              typeof slot.bookingTicket === 'object'
                ? slot.bookingTicket.id
                : Number(slot.bookingTicket)
            if (tId) touchedTicketIds.add(tId)
          }

          // Re-sync booking-tickets.attendeeNames for affected tickets
          if (touchedTicketIds.size > 0) {
            const refreshedSlots = await payload.find({
              collection: 'ticket-checkin-slots',
              overrideAccess: true,
              where: { booking: { equals: bookingId } },
              sort: 'slotIndex',
              limit: 500,
              depth: 0,
            })
            for (const ticketId of touchedTicketIds) {
              const names = refreshedSlots.docs
                .filter((s) => {
                  const sTid =
                    typeof s.bookingTicket === 'object'
                      ? s.bookingTicket.id
                      : Number(s.bookingTicket)
                  return sTid === ticketId
                })
                .map((s) => (s.attendeeName || s.label.split(' — ')[0] || '').trim())
                .filter(Boolean)
                .join(', ')

              await payload.update({
                collection: 'booking-tickets',
                id: ticketId,
                user,
                overrideAccess: false,
                data: { attendeeNames: names },
              })
            }
          }
        }
      }

      const transferAudit =
        markTransferred && booking.status !== 'transferred'
          ? `[Transferred from ${booking.holderName} to ${holderName} by ${user.name || user.email}]`
          : ''
      const finalNotes = transferAudit
        ? notes
          ? `${notes}\n${transferAudit}`
          : transferAudit
        : notes

      const updated = await payload.update({
        collection: 'bookings',
        id: bookingId,
        user,
        overrideAccess: false,
        data: {
          holderName,
          phone,
          email: email || undefined,
          notes: finalNotes || undefined,
          ...(markTransferred ? { status: 'transferred' } : {}),
        },
      })

      let notificationResult = null
      if (resendChannels !== 'none') {
        const [ticketsRes, tablesRes] = await Promise.all([
          payload.find({
            collection: 'booking-tickets',
            user,
            overrideAccess: false,
            where: { booking: { equals: bookingId } },
            sort: 'ticketCode',
            limit: 100,
            depth: 0,
          }),
          payload.find({
            collection: 'booking-tables',
            user,
            overrideAccess: false,
            where: { booking: { equals: bookingId } },
            sort: 'tableLabel',
            limit: 100,
            depth: 0,
          }),
        ])
        const tablesSummary =
          tablesRes.docs.length > 0
            ? tablesRes.docs.map((t) => `${t.tableLabel} (${t.capacity}p)`).join(', ')
            : 'Unassigned'

        notificationResult = await sendBookingNotifications({
          payload,
          bookingId,
          bookingCode: updated.bookingCode,
          eventName: eventObj.name,
          eventDate: eventObj.date,
          eventVenue: eventObj.venue,
          holderName: updated.holderName,
          phone: updated.phone,
          email: updated.email,
          totalPax: updated.totalPax,
          totalAmount: updated.totalAmount,
          tablesSummary,
          ticketCodes: ticketsRes.docs.map((t) => t.ticketCode),
          trigger: 'manual_resend',
          channels: resendChannels,
        })
      }

      return NextResponse.json({
        success: true,
        booking: updated,
        notificationResult,
      })
    }

    // -----------------------------------------------------------------------
    // ACTION 2: SETTLE PENDING PAYMENT (CASH / OFFICER_UPI / COMPLIMENTARY)
    // -----------------------------------------------------------------------
    if (action === 'settle_payment') {
      if (booking.status === 'cancelled') {
        return NextResponse.json(
          { error: 'Cannot settle payment on a cancelled booking.' },
          { status: 400 },
        )
      }
      if (booking.paymentStatus === 'paid' && booking.status !== 'pending_payment') {
        return NextResponse.json({ error: 'Booking is already paid.' }, { status: 400 })
      }

      const mode =
        body.paymentMode === 'OFFICER_UPI' || body.paymentMode === 'COMPLIMENTARY'
          ? body.paymentMode
          : 'CASH'
      const resendPass = body.resendPass !== false

      if (booking.gatewayRefId) {
        await cancelRazorpayPaymentLink(booking.gatewayRefId)
      }

      const nowIso = new Date().toISOString()
      const updated = await payload.update({
        collection: 'bookings',
        id: bookingId,
        overrideAccess: mode === 'COMPLIMENTARY',
        ...(mode === 'COMPLIMENTARY' ? {} : { user, overrideAccess: false }),
        data:
          mode === 'COMPLIMENTARY'
            ? {
                paymentMode: 'COMPLIMENTARY',
                paymentStatus: 'paid',
                totalAmount: 0,
                paidAmount: 0,
                status: 'confirmed',
                settlementStatus: 'received_by_treasurer',
                treasurerVerified: true,
                treasurerVerifiedAt: nowIso,
                collectedByOfficer: user.id,
                paymentExpiresAt: null,
              }
            : {
                paymentMode: mode,
                paymentStatus: 'paid',
                paidAmount: booking.totalAmount,
                status: 'confirmed',
                settlementStatus: 'with_officer',
                collectedByOfficer: user.id,
                paymentExpiresAt: null,
              },
      })

      let notificationResult = null
      if (resendPass) {
        const [ticketsRes, tablesRes] = await Promise.all([
          payload.find({
            collection: 'booking-tickets',
            overrideAccess: true,
            where: { booking: { equals: bookingId } },
            sort: 'ticketCode',
            limit: 100,
            depth: 0,
          }),
          payload.find({
            collection: 'booking-tables',
            overrideAccess: true,
            where: { booking: { equals: bookingId } },
            sort: 'tableLabel',
            limit: 100,
            depth: 0,
          }),
        ])
        const tablesSummary =
          tablesRes.docs.length > 0
            ? tablesRes.docs.map((t) => `${t.tableLabel} (${t.capacity}p)`).join(', ')
            : 'Unassigned'

        try {
          notificationResult = await sendBookingNotifications({
            payload,
            bookingId,
            bookingCode: updated.bookingCode,
            eventName: eventObj.name,
            eventDate: eventObj.date,
            eventVenue: eventObj.venue,
            holderName: updated.holderName,
            phone: updated.phone,
            email: updated.email,
            totalPax: updated.totalPax,
            totalAmount: updated.totalAmount,
            tablesSummary,
            ticketCodes: ticketsRes.docs.map((t) => t.ticketCode),
            trigger: 'booking_created',
          })
        } catch {
          // Non-fatal
        }
      }

      return NextResponse.json({
        success: true,
        booking: updated,
        notificationResult,
      })
    }

    // -----------------------------------------------------------------------
    // ACTION 3: CANCEL & REFUND (CUSTOMIZABLE REFUND AMOUNT + RELEASE TABLES)
    // -----------------------------------------------------------------------
    if (action === 'cancel_and_refund') {
      if (booking.status === 'cancelled') {
        return NextResponse.json({ error: 'Booking is already cancelled.' }, { status: 400 })
      }

      const effectivePaidAmount =
        typeof booking.paidAmount === 'number'
          ? booking.paidAmount
          : booking.paymentStatus === 'paid'
            ? booking.totalAmount
            : 0

      const rawRefund = Number(body.refundAmount ?? 0)
      if (!Number.isFinite(rawRefund) || rawRefund < 0) {
        return NextResponse.json({ error: 'Refund amount must be ₹0 or greater.' }, { status: 400 })
      }
      const refundAmount = Math.round(rawRefund)
      if (refundAmount > effectivePaidAmount) {
        return NextResponse.json(
          {
            error: `Refund amount (₹${refundAmount.toLocaleString('en-IN')}) cannot exceed paid amount (₹${effectivePaidAmount.toLocaleString('en-IN')}).`,
          },
          { status: 400 },
        )
      }

      const requestedMethod = String(body.refundMethod || 'NONE') as
        | 'NONE'
        | 'RAZORPAY_API'
        | 'OFFLINE_CASH'
        | 'OFFLINE_UPI'
      const refundMethod: 'NONE' | 'RAZORPAY_API' | 'OFFLINE_CASH' | 'OFFLINE_UPI' =
        refundAmount <= 0
          ? 'NONE'
          : requestedMethod === 'RAZORPAY_API' ||
              requestedMethod === 'OFFLINE_CASH' ||
              requestedMethod === 'OFFLINE_UPI'
            ? requestedMethod
            : 'OFFLINE_CASH'

      let refundReference = String(body.refundReference || '').trim()
      const reason = String(body.reason || '').trim()
      const sendEmail = Boolean(body.sendEmail)

      // Execute automated Razorpay Refund API if requested
      if (refundAmount > 0 && refundMethod === 'RAZORPAY_API') {
        const rzpRefund = await refundRazorpayPayment({
          paymentId: booking.transferReference?.startsWith('pay_')
            ? booking.transferReference
            : undefined,
          gatewayRefId: booking.gatewayRefId || undefined,
          amountInr: refundAmount,
          bookingCode: booking.bookingCode,
          reason: reason || `Cancelled by ${user.name || user.email}`,
        })
        refundReference = rzpRefund.refundId
      }

      // Cancel any unpaid Razorpay payment link (main booking or pending table upgrade)
      if (
        (booking.status === 'pending_payment' || booking.paymentStatus === 'pending') &&
        booking.gatewayRefId
      ) {
        await cancelRazorpayPaymentLink(booking.gatewayRefId)
      }
      const pendingUpgrade = booking.pendingUpgradeTables as
        | PendingUpgradeTablesPayload
        | null
        | undefined
      if (pendingUpgrade?.gatewayRefId) {
        await cancelRazorpayPaymentLink(pendingUpgrade.gatewayRefId)
      }

      // Immediately release reserved tables
      const existingTables = await payload.find({
        collection: 'booking-tables',
        user,
        overrideAccess: false,
        where: { booking: { equals: bookingId } },
        limit: 100,
        depth: 0,
      })
      for (const row of existingTables.docs) {
        await payload.delete({
          collection: 'booking-tables',
          id: row.id,
          user,
          overrideAccess: false,
        })
      }

      const nowIso = new Date().toISOString()
      const cancelNote = `[Cancelled by ${user.name || user.email}${reason ? `: ${reason}` : ''} · Paid ₹${effectivePaidAmount.toLocaleString('en-IN')}, Refunded ₹${refundAmount.toLocaleString('en-IN')} (${refundMethod})${refundReference ? ` · Ref: ${refundReference}` : ''}]`

      const updated = await payload.update({
        collection: 'bookings',
        id: bookingId,
        user,
        overrideAccess: false,
        data: {
          status: 'cancelled',
          paymentStatus: refundAmount > 0 ? 'refunded' : booking.paymentStatus,
          paidAmount: effectivePaidAmount,
          refundAmount,
          refundMethod,
          refundReference: refundReference || undefined,
          refundedAt: refundAmount > 0 ? nowIso : undefined,
          refundedBy: refundAmount > 0 ? user.id : undefined,
          pendingUpgradeTables: null,
          notes: booking.notes ? `${booking.notes}\n${cancelNote}` : cancelNote,
        },
      })

      let notificationResult = null
      if (sendEmail && booking.email) {
        const ticketsRes = await payload.find({
          collection: 'booking-tickets',
          overrideAccess: true,
          where: { booking: { equals: bookingId } },
          sort: 'ticketCode',
          limit: 100,
          depth: 0,
        })
        try {
          notificationResult = await sendBookingNotifications({
            payload,
            bookingId,
            bookingCode: updated.bookingCode,
            eventName: eventObj.name,
            eventDate: eventObj.date,
            eventVenue: eventObj.venue,
            holderName: updated.holderName,
            phone: updated.phone,
            email: updated.email,
            totalPax: updated.totalPax,
            totalAmount: updated.totalAmount,
            tablesSummary: 'Released',
            ticketCodes: ticketsRes.docs.map((t) => t.ticketCode),
            trigger: 'cancelled',
            channels: 'email',
          })
        } catch {
          // Non-fatal
        }
      }

      return NextResponse.json({
        success: true,
        booking: updated,
        releasedTablesCount: existingTables.docs.length,
        retainedAmount: Math.max(0, effectivePaidAmount - refundAmount),
        refundReference: refundReference || null,
        notificationResult,
      })
    }

    return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Booking management action failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
