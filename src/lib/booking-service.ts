import type { Payload } from 'payload'
import type { Event, TicketType, User } from '@/payload-types'
import { signQRPayload } from './crypto'
import { expandEventTables } from './event-tables'
import { sendBookingNotifications } from './notifications'
import {
  createRazorpayPaymentLink,
  expireStalePendingBookings,
  RAZORPAY_HOLD_MINUTES,
} from './razorpay'

export interface TicketPaxInput {
  name: string
  memberId?: number | null
}

export interface TicketSelectionInput {
  ticketPhaseId: string
  quantity: number
  paxList?: TicketPaxInput[]
}

export type TableAssignmentInput = string | { tableLabel: string }

export interface CreateBookingInput {
  payload: Payload
  user: User
  eventId: number
  memberId?: number | null
  holderName: string
  phone: string
  email?: string | null
  paymentMode: 'RAZORPAY' | 'CASH' | 'OFFICER_UPI' | 'COMPLIMENTARY' | 'PAY_AT_DOOR'
  paymentStatus?: 'paid' | 'pending' | 'refunded'
  notes?: string
  tickets: TicketSelectionInput[]
  tables?: TableAssignmentInput[]
  autoCheckInAll?: boolean
  deviceId?: string
  checkInMethod?: 'qr_scan' | 'manual_code' | 'door_sale'
}

function normalizeAttendeeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export async function generateNextBookingCode(
  payload: Payload,
  eventId: number,
  eventCode: string,
): Promise<string> {
  const prefix = eventCode.trim().toUpperCase()
  const latest = await payload.find({
    collection: 'bookings',
    overrideAccess: true,
    where: { event: { equals: eventId } },
    sort: '-id',
    limit: 1,
    depth: 0,
  })
  let nextNum = 1
  if (latest.docs.length > 0) {
    const lastCode = latest.docs[0].bookingCode || ''
    const match = lastCode.match(/B(\d+)$/i)
    if (match) {
      nextNum = parseInt(match[1], 10) + 1
    } else {
      nextNum = Number(latest.docs[0].id) + 1
    }
  }
  return `${prefix}-B${String(nextNum).padStart(3, '0')}`
}

export async function createFullBooking(input: CreateBookingInput) {
  const { payload, user } = input

  if (!input.tickets || input.tickets.length === 0) {
    throw new Error('At least one ticket must be selected.')
  }

  // Fetch event with overrideAccess: true to read privateKeyEnc and populate phases[].tickets[].ticketType
  const eventDoc = (await payload.findByID({
    collection: 'events',
    id: input.eventId,
    overrideAccess: true,
    depth: 1,
  })) as Event | null

  if (!eventDoc) {
    throw new Error('Event not found.')
  }

  // Build lookup map of embedded phases -> tickets directly from eventDoc
  const phaseLookup = new Map<
    string,
    {
      phaseId: string
      phaseName: string
      price: number
      ticketTypeName: string
      paxMultiplier: number
      memberOnly: boolean
    }
  >()

  for (const ph of eventDoc.phases || []) {
    for (const row of ph.tickets || []) {
      const tt =
        typeof row.ticketType === 'object' && row.ticketType !== null
          ? (row.ticketType as TicketType)
          : null
      const pid = String(row.id || `${ph.id || ph.phaseName}-${tt?.id || row.ticketType}`)
      phaseLookup.set(pid, {
        phaseId: pid,
        phaseName: ph.phaseName,
        price: Number(row.price) || 0,
        ticketTypeName: tt?.name || 'Ticket',
        paxMultiplier: Math.max(1, Number(tt?.paxMultiplier) || 1),
        memberOnly: Boolean(tt?.memberOnly),
      })
    }
  }

  // Resolve all selected ticket phases & types
  const resolvedLines: Array<{
    phaseId: string
    phaseName: string
    price: number
    ticketTypeName: string
    paxMultiplier: number
    memberOnly: boolean
    quantity: number
    paxList: TicketPaxInput[]
  }> = []

  let totalPax = 0
  let totalAmount = 0
  const requiredMemberIds = new Set<number>()

  for (const item of input.tickets) {
    const qty = Math.max(0, Math.floor(Number(item.quantity) || 0))
    if (qty <= 0) continue

    const resolved = phaseLookup.get(String(item.ticketPhaseId))
    if (!resolved) {
      throw new Error(`Ticket pricing phase "${item.ticketPhaseId}" was not found on this event.`)
    }

    const paxPerTicket = resolved.paxMultiplier
    const expectedPaxCount = paxPerTicket * qty
    const sanitizedPaxList: TicketPaxInput[] = Array.isArray(item.paxList)
      ? item.paxList.slice(0, expectedPaxCount).map((p) => ({
        name: String(p?.name || '').trim(),
        memberId: p?.memberId ? Number(p.memberId) : null,
      }))
      : []

    if (
      sanitizedPaxList.length !== expectedPaxCount ||
      sanitizedPaxList.some((p) => !p.name)
    ) {
      throw new Error(
        `Please enter a name for every guest on ${resolved.ticketTypeName} (${resolved.phaseName}).`,
      )
    }

    if (resolved.memberOnly) {
      for (let i = 0; i < sanitizedPaxList.length; i++) {
        const attendee = sanitizedPaxList[i]
        if (!attendee?.memberId) {
          const ticketNo = Math.floor(i / paxPerTicket) + 1
          const paxNo = (i % paxPerTicket) + 1
          throw new Error(
            `${resolved.ticketTypeName} is a Member-Only ticket — please select a registered member for Ticket #${ticketNo} (Pax ${paxNo}).`,
          )
        }
        requiredMemberIds.add(attendee.memberId)
      }
    }

    totalPax += expectedPaxCount
    totalAmount += input.paymentMode === 'COMPLIMENTARY' ? 0 : resolved.price * qty

    resolvedLines.push({ ...resolved, quantity: qty, paxList: sanitizedPaxList })
  }

  if (requiredMemberIds.size > 0) {
    const ids = Array.from(requiredMemberIds)
    const foundMembers = await payload.find({
      collection: 'members',
      overrideAccess: true,
      where: { id: { in: ids } },
      limit: ids.length,
      depth: 0,
    })
    const membersById = new Map(foundMembers.docs.map((m) => [Number(m.id), m]))
    for (const id of ids) {
      const memberDoc = membersById.get(id)
      if (!memberDoc) {
        throw new Error('Selected member record for a Member-Only ticket was not found.')
      }
      if (memberDoc.subsStatus !== 'active') {
        throw new Error(
          `Member "${memberDoc.fullName}" (${memberDoc.memberCode}) cannot be added to a Member-Only ticket because their subscription status is "${memberDoc.subsStatus}".`,
        )
      }
    }
  }

  if (resolvedLines.length === 0 || totalPax <= 0) {
    throw new Error('Please select at least 1 valid ticket.')
  }

  // Enforce unique ticket attendees within this booking (intra-booking check)
  const seenMemberIds = new Set<number>()
  const seenNormalizedNames = new Set<string>()
  for (const line of resolvedLines) {
    for (const attendee of line.paxList) {
      if (attendee.memberId) {
        if (seenMemberIds.has(attendee.memberId)) {
          throw new Error(
            `${attendee.name} is added more than once in this booking. Each ticket attendee must be unique.`,
          )
        }
        seenMemberIds.add(attendee.memberId)
      }
      const normName = normalizeAttendeeName(attendee.name)
      if (normName) {
        if (seenNormalizedNames.has(normName)) {
          throw new Error(
            `"${attendee.name}" is listed more than once in this booking. Each ticket attendee must be unique.`,
          )
        }
        seenNormalizedNames.add(normName)
      }
    }
  }

  // Release any expired 10-minute pending Razorpay holds before checking duplicates/tables
  await expireStalePendingBookings(payload, eventDoc.id)

  // Fetch active bookings for this event (used for both duplicate attendee check and table conflict check)
  const activeBookingsRes = await payload.find({
    collection: 'bookings',
    overrideAccess: true,
    where: {
      and: [
        { event: { equals: eventDoc.id } },
        { status: { not_equals: 'cancelled' } },
      ],
    },
    limit: 2000,
    depth: 0,
  })
  const activeIds = activeBookingsRes.docs.map((b) => b.id)
  const activeBookingCodeById = new Map(
    activeBookingsRes.docs.map((b) => [b.id, b.bookingCode]),
  )

  // Enforce unique ticket attendees across all existing active bookings for this event
  if (activeIds.length > 0) {
    const existingSlotsRes = await payload.find({
      collection: 'ticket-checkin-slots',
      overrideAccess: true,
      where: { booking: { in: activeIds } },
      limit: 10000,
      depth: 0,
    })

    const bookedMemberCode = new Map<number, string>()
    const bookedNameCode = new Map<string, string>()

    for (const slot of existingSlotsRes.docs) {
      const bId = typeof slot.booking === 'object' ? slot.booking.id : slot.booking
      const bCode = activeBookingCodeById.get(bId) || 'an existing booking'
      const mId =
        slot.member && typeof slot.member === 'object'
          ? Number(slot.member.id)
          : slot.member
            ? Number(slot.member)
            : null
      if (mId) {
        bookedMemberCode.set(mId, bCode)
      }
      const slotName = normalizeAttendeeName(
        slot.attendeeName || slot.label.split(' — ')[0] || '',
      )
      if (slotName) {
        bookedNameCode.set(slotName, bCode)
      }
    }

    for (const line of resolvedLines) {
      for (const attendee of line.paxList) {
        if (attendee.memberId && bookedMemberCode.has(attendee.memberId)) {
          throw new Error(
            `${attendee.name} is already booked on ${bookedMemberCode.get(attendee.memberId)} for this event.`,
          )
        }
        const normName = normalizeAttendeeName(attendee.name)
        if (normName && bookedNameCode.has(normName)) {
          throw new Error(
            `"${attendee.name}" is already booked on ${bookedNameCode.get(normName)} for this event.`,
          )
        }
      }
    }
  }

  // Optional non-sharing table assignments (validated before creating booking)
  const requestedLabels = Array.from(
    new Set(
      (input.tables || [])
        .map((t) => (typeof t === 'string' ? t.trim() : String(t?.tableLabel || '').trim()))
        .filter(Boolean),
    ),
  )

  const virtualTables = expandEventTables(eventDoc.tables)
  const virtualByLabel = new Map(virtualTables.map((t) => [t.tableLabel, t]))

  if (requestedLabels.length > 0) {
    for (const lbl of requestedLabels) {
      if (!virtualByLabel.has(lbl)) {
        throw new Error(`Table "${lbl}" does not exist on this event.`)
      }
    }

    // Check non-sharing conflict against active bookings for this event
    if (activeIds.length > 0) {
      const existingAllocs = await payload.find({
        collection: 'booking-tables',
        user,
        overrideAccess: false,
        where: {
          and: [
            { booking: { in: activeIds } },
            { tableLabel: { in: requestedLabels } },
          ],
        },
        limit: 100,
        depth: 1,
      })
      if (existingAllocs.docs.length > 0) {
        const conflict = existingAllocs.docs[0]
        const conflictCode =
          typeof conflict.booking === 'object' && conflict.booking !== null
            ? conflict.booking.bookingCode
            : `#${conflict.booking}`
        throw new Error(
          `Table ${conflict.tableLabel} is already reserved by booking ${conflictCode} (tables are non-sharing).`,
        )
      }
    }
  }

  const bookingCode = await generateNextBookingCode(payload, eventDoc.id, eventDoc.code)
  const isRazorpayPending = input.paymentMode === 'RAZORPAY' && totalAmount > 0
  const paymentExpiresAt = isRazorpayPending
    ? new Date(Date.now() + RAZORPAY_HOLD_MINUTES * 60 * 1000).toISOString()
    : undefined
  const effectivePaymentStatus =
    input.paymentStatus ||
    (isRazorpayPending || input.paymentMode === 'PAY_AT_DOOR' ? 'pending' : 'paid')

  // Create Booking respecting user's RBAC
  const booking = await payload.create({
    collection: 'bookings',
    user,
    overrideAccess: false,
    data: {
      bookingCode,
      event: eventDoc.id,
      member: input.memberId ?? undefined,
      holderName: input.holderName.trim(),
      phone: input.phone.trim(),
      email: input.email?.trim() || undefined,
      totalPax,
      totalAmount,
      status: isRazorpayPending ? 'pending_payment' : 'confirmed',
      notes: input.notes?.trim() || undefined,
      paymentMode: input.paymentMode,
      paymentStatus: effectivePaymentStatus,
      collectedByOfficer: user.id,
      settlementStatus: 'with_officer',
      gatewayProvider: isRazorpayPending ? 'razorpay' : undefined,
      paymentExpiresAt,
    },
  })

  // Sign Ed25519 QR payload using event's privateKeyEnc
  let qrSignature = ''
  if (eventDoc.privateKeyEnc) {
    qrSignature = await signQRPayload(
      {
        bId: booking.id,
        code: bookingCode,
        eId: eventDoc.id,
        pax: totalPax,
      },
      eventDoc.privateKeyEnc,
    )
    await payload.update({
      collection: 'bookings',
      id: booking.id,
      overrideAccess: true,
      data: { qrSignature },
    })
  }

  // Create booking-tickets and expand ticket-checkin-slots
  const createdTickets = []
  const createdSlots = []
  let ticketCounter = 0

  for (const line of resolvedLines) {
    const paxPerTicket = line.paxMultiplier
    const unitPrice = input.paymentMode === 'COMPLIMENTARY' ? 0 : line.price

    for (let i = 0; i < line.quantity; i++) {
      ticketCounter += 1
      const ticketCode = `${bookingCode}-T${String(ticketCounter).padStart(3, '0')}`
      const ticketPaxEntries = line.paxList.slice(
        i * paxPerTicket,
        (i + 1) * paxPerTicket,
      )
      const attendeeNames = ticketPaxEntries.map((p) => p.name).join(', ')

      const ticketDoc = await payload.create({
        collection: 'booking-tickets',
        user,
        overrideAccess: false,
        data: {
          booking: booking.id,
          ticketCode,
          ticketTypeName: line.ticketTypeName,
          phaseName: line.phaseName,
          phaseRowId: line.phaseId,
          attendeeNames,
          paxCount: paxPerTicket,
          unitPrice,
          physicalIssued: false,
        },
      })
      createdTickets.push(ticketDoc)

      // Expand into individual attendee check-in slots
      const nowIso = new Date().toISOString()
      for (let s = 1; s <= paxPerTicket; s++) {
        const flatIdx = i * paxPerTicket + (s - 1)
        const paxEntry = line.paxList[flatIdx]
        const paxName = paxEntry.name
        const label =
          paxPerTicket > 1
            ? `${paxName} — ${line.ticketTypeName} (${ticketCode} · Pax ${s}/${paxPerTicket})`
            : `${paxName} — ${line.ticketTypeName} (${ticketCode})`

        const slotDoc = await payload.create({
          collection: 'ticket-checkin-slots',
          user,
          overrideAccess: false,
          data: {
            booking: booking.id,
            bookingTicket: ticketDoc.id,
            slotIndex: s,
            label,
            attendeeName: paxName,
            member: paxEntry.memberId ?? undefined,
            checkedInAt: input.autoCheckInAll ? nowIso : undefined,
            checkedInByUser: input.autoCheckInAll ? user.id : undefined,
            deviceId: input.autoCheckInAll ? input.deviceId || 'GATE-DOOR' : undefined,
            method: input.autoCheckInAll ? input.checkInMethod || 'door_sale' : 'qr_scan',
          },
        })
        createdSlots.push(slotDoc)
      }
    }
  }

  // Save non-sharing table assignments
  const tableLabels: string[] = []
  if (requestedLabels.length > 0) {
    const nowIso = new Date().toISOString()
    for (const lbl of requestedLabels) {
      const vt = virtualByLabel.get(lbl)!
      await payload.create({
        collection: 'booking-tables',
        user,
        overrideAccess: false,
        data: {
          booking: booking.id,
          tableLabel: vt.tableLabel,
          tableTypeName: vt.tableTypeName,
          capacity: vt.capacity,
          assignedByOfficer: user.id,
          assignedAt: nowIso,
        },
      })
      tableLabels.push(`${vt.tableLabel} (${vt.capacity}p)`)
    }
  }

  const tablesSummary = tableLabels.length > 0 ? tableLabels.join(', ') : 'Unassigned'

  // If Razorpay pending payment: create Razorpay Payment Link & send Email-only invoice (NO WhatsApp)
  let paymentLinkUrl: string | null = null
  let gatewayRefId: string | null = null
  let notificationResult: { whatsapp: string; email: string } = {
    whatsapp: 'skipped',
    email: 'skipped',
  }

  if (isRazorpayPending) {
    try {
      const plink = await createRazorpayPaymentLink({
        bookingId: booking.id,
        bookingCode,
        eventName: eventDoc.name,
        holderName: booking.holderName,
        phone: booking.phone,
        email: booking.email,
        amountInr: totalAmount,
        totalPax,
      })
      paymentLinkUrl = plink.shortUrl
      gatewayRefId = plink.id

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
    } catch (err) {
      // Roll back the hold immediately so tables/attendees are not stranded
      await payload.update({
        collection: 'bookings',
        id: booking.id,
        overrideAccess: true,
        data: {
          status: 'cancelled',
          notes: `[Cancelled: Razorpay payment link creation failed]`,
        },
      })
      throw err
    }

    // Razorpay's native SMS & Email handles sending the payment link; no duplicate Plunk email needed.
    notificationResult = { whatsapp: 'skipped', email: 'skipped' }
  } else {
    // Fire WhatsApp + Email Master QR notifications immediately for non-Razorpay bookings
    try {
      notificationResult = await sendBookingNotifications({
        payload,
        bookingId: booking.id,
        bookingCode,
        eventName: eventDoc.name,
        eventDate: eventDoc.date,
        eventVenue: eventDoc.venue,
        holderName: booking.holderName,
        phone: booking.phone,
        email: booking.email,
        totalPax,
        totalAmount,
        tablesSummary,
        ticketCodes: createdTickets.map((t) => t.ticketCode),
        trigger: 'booking_created',
      })
    } catch {
      // Notification errors never roll back a confirmed booking
    }
  }

  return {
    booking: {
      ...booking,
      qrSignature,
      paymentLinkUrl,
      gatewayRefId,
      paymentExpiresAt: paymentExpiresAt || null,
    },
    tickets: createdTickets,
    slots: createdSlots,
    tablesSummary,
    notificationResult,
    paymentLinkUrl,
    paymentExpiresAt: paymentExpiresAt || null,
  }
}
