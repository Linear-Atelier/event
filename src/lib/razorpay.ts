import crypto from 'crypto'
import type { Payload } from 'payload'
import type { Booking, Event, User } from '@/payload-types'
import { sendBookingNotifications } from './notifications'

export const RAZORPAY_HOLD_MINUTES = 10

function getRazorpayKeyId(): string | undefined {
  return (process.env.RAZORPAY_API_KEY || process.env.RAZORPAY_KEY_ID)?.trim()
}

function getRazorpayKeySecret(): string | undefined {
  return (process.env.RAZORPAY_API_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET)?.trim()
}

function getRazorpayAuthHeader(): string {
  const keyId = getRazorpayKeyId()
  const keySecret = getRazorpayKeySecret()
  if (!keyId || !keySecret) {
    throw new Error(
      'Razorpay credentials (RAZORPAY_API_KEY / RAZORPAY_API_KEY_SECRET) are not configured.',
    )
  }
  const encoded = Buffer.from(`${keyId}:${keySecret}`).toString('base64')
  return `Basic ${encoded}`
}

export function isRazorpayConfigured(): boolean {
  return Boolean(getRazorpayKeyId() && getRazorpayKeySecret())
}

function formatRazorpayContact(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length > 0) return `+${digits}`
  return ''
}

export interface CreatePaymentLinkResult {
  id: string
  shortUrl: string
  status: string
}

export async function createRazorpayPaymentLink(params: {
  bookingId: number
  bookingCode: string
  eventName: string
  holderName: string
  phone: string
  email?: string | null
  amountInr: number
  totalPax: number
}): Promise<CreatePaymentLinkResult> {
  const amountPaise = Math.round(Number(params.amountInr) * 100)
  if (amountPaise < 100) {
    throw new Error('Razorpay requires a minimum amount of ₹1.')
  }

  const contact = formatRazorpayContact(params.phone)
  const email = params.email?.trim() || undefined
  // Razorpay Payment Links API requires expire_by >= 15 minutes from now.
  // We enforce the exact 10-minute POS hold via paymentExpiresAt in our backend and cancel via API.
  const razorpayExpireBy = Math.floor(Date.now() / 1000) + 16 * 60

  const customer: Record<string, string> = {
    name: params.holderName.trim().slice(0, 50) || 'Guest',
  }
  if (contact) customer.contact = contact
  if (email) customer.email = email

  const res = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: {
      Authorization: getRazorpayAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      accept_partial: false,
      expire_by: razorpayExpireBy,
      reference_id: params.bookingCode,
      description: `${params.eventName} · ${params.bookingCode} (${params.totalPax} Pax)`.slice(0, 200),
      customer,
      notify: {
        sms: Boolean(contact),
        email: Boolean(email),
      },
      reminder_enable: false,
      notes: {
        bookingId: String(params.bookingId),
        bookingCode: params.bookingCode,
        eventName: params.eventName,
      },
    }),
  })

  const json = (await res.json().catch(() => ({}))) as {
    id?: string
    short_url?: string
    status?: string
    error?: { description?: string; reason?: string }
  }

  if (!res.ok || !json.id || !json.short_url) {
    throw new Error(
      json.error?.description ||
        json.error?.reason ||
        `Razorpay Payment Link creation failed (HTTP ${res.status})`,
    )
  }

  return {
    id: json.id,
    shortUrl: json.short_url,
    status: json.status || 'created',
  }
}

export interface RazorpayPaymentLinkStatus {
  id: string
  status: string
  shortUrl?: string
  paymentId?: string
}

export async function fetchRazorpayPaymentLink(
  paymentLinkId: string,
): Promise<RazorpayPaymentLinkStatus | null> {
  if (!isRazorpayConfigured() || !paymentLinkId) return null

  const res = await fetch(
    `https://api.razorpay.com/v1/payment_links/${encodeURIComponent(paymentLinkId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: getRazorpayAuthHeader(),
      },
    },
  )

  if (!res.ok) return null

  const json = (await res.json().catch(() => ({}))) as {
    id?: string
    status?: string
    short_url?: string
    payments?: Array<{ payment_id?: string; status?: string }>
  }

  const capturedPayment =
    json.payments?.find((p) => p.status === 'captured') || json.payments?.[0]

  return {
    id: json.id || paymentLinkId,
    status: json.status || 'unknown',
    shortUrl: json.short_url,
    paymentId: capturedPayment?.payment_id,
  }
}

export async function cancelRazorpayPaymentLink(paymentLinkId: string): Promise<void> {
  if (!isRazorpayConfigured() || !paymentLinkId) return
  try {
    await fetch(
      `https://api.razorpay.com/v1/payment_links/${encodeURIComponent(paymentLinkId)}/cancel`,
      {
        method: 'POST',
        headers: {
          Authorization: getRazorpayAuthHeader(),
        },
      },
    )
  } catch {
    // Best-effort cancellation; link may already be expired/cancelled/paid
  }
}

export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signature: string | null,
): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim()
  if (!secret || !signature) return false

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const sigBuf = Buffer.from(signature, 'utf8')
  const expBuf = Buffer.from(expected, 'utf8')
  if (sigBuf.length !== expBuf.length) return false
  return crypto.timingSafeEqual(sigBuf, expBuf)
}

/**
 * Lazily cancels any pending_payment bookings whose 10-minute hold window has elapsed,
 * freeing their reserved tables and attendee slots.
 */
export async function expireStalePendingBookings(
  payload: Payload,
  eventId?: number,
): Promise<number> {
  const nowIso = new Date().toISOString()
  const whereClauses: Array<Record<string, unknown>> = [
    { status: { equals: 'pending_payment' } },
    { paymentExpiresAt: { less_than_equal: nowIso } },
  ]
  if (eventId) {
    whereClauses.push({ event: { equals: eventId } })
  }

  const expiredRes = await payload.find({
    collection: 'bookings',
    overrideAccess: true,
    where: { and: whereClauses } as never,
    limit: 100,
    depth: 0,
  })

  if (expiredRes.docs.length === 0) return 0

  let cancelledCount = 0
  for (const booking of expiredRes.docs) {
    // Double-check with Razorpay before cancelling in case payment just completed
    if (booking.gatewayRefId && isRazorpayConfigured()) {
      const rzp = await fetchRazorpayPaymentLink(booking.gatewayRefId).catch(() => null)
      if (rzp?.status === 'paid') {
        await finalizeRazorpayBookingPayment(payload, booking.id, rzp.paymentId)
        continue
      }
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
    cancelledCount += 1
  }

  return cancelledCount
}

/**
 * Idempotently confirms a pending Razorpay booking, auto-settles it to 'received_by_treasurer',
 * and dispatches the Master QR Pass via WhatsApp + Email.
 */
export async function finalizeRazorpayBookingPayment(
  payload: Payload,
  bookingId: number,
  razorpayPaymentId?: string,
): Promise<{ booking: Booking; alreadyConfirmed: boolean }> {
  const existing = (await payload.findByID({
    collection: 'bookings',
    id: bookingId,
    overrideAccess: true,
    depth: 1,
  })) as Booking | null

  if (!existing) {
    throw new Error(`Booking #${bookingId} not found`)
  }

  if (existing.status === 'confirmed' && existing.paymentStatus === 'paid') {
    return { booking: existing, alreadyConfirmed: true }
  }

  const nowIso = new Date().toISOString()
  const updated = (await payload.update({
    collection: 'bookings',
    id: bookingId,
    overrideAccess: true,
    data: {
      status: 'confirmed',
      paymentStatus: 'paid',
      settlementStatus: 'received_by_treasurer',
      treasurerVerified: true,
      treasurerVerifiedAt: nowIso,
      transferReference: razorpayPaymentId || existing.gatewayRefId || 'RAZORPAY',
    },
  })) as Booking

  // Load event, tickets, and tables to dispatch the Master QR Ticket Pass (WhatsApp + Email)
  const eventDoc =
    typeof existing.event === 'object' && existing.event !== null
      ? (existing.event as Event)
      : ((await payload.findByID({
          collection: 'events',
          id: existing.event as number,
          overrideAccess: true,
          depth: 0,
        })) as Event)

  const [ticketsRes, tablesRes] = await Promise.all([
    payload.find({
      collection: 'booking-tickets',
      overrideAccess: true,
      where: { booking: { equals: bookingId } },
      sort: 'ticketCode',
      limit: 200,
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
    await sendBookingNotifications({
      payload,
      bookingId: updated.id,
      bookingCode: updated.bookingCode,
      eventName: eventDoc.name,
      eventDate: eventDoc.date,
      eventVenue: eventDoc.venue,
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
    // Non-fatal: payment is already captured and confirmed
  }

  return { booking: updated, alreadyConfirmed: false }
}

/**
 * 1-tap POS fallback: cancels the pending Razorpay payment link, switches the booking
 * to CASH or OFFICER_UPI, marks it confirmed/paid, and dispatches the Master QR Pass.
 */
export async function switchPendingBookingToManual(params: {
  payload: Payload
  user: User
  bookingId: number
  newPaymentMode: 'CASH' | 'OFFICER_UPI'
}): Promise<{ booking: Booking; tablesSummary: string }> {
  const { payload, user, bookingId, newPaymentMode } = params

  const existing = (await payload.findByID({
    collection: 'bookings',
    id: bookingId,
    user,
    overrideAccess: false,
    depth: 1,
  })) as Booking | null

  if (!existing) {
    throw new Error('Booking not found.')
  }
  if (existing.status !== 'pending_payment') {
    throw new Error(`Booking ${existing.bookingCode} is no longer pending payment.`)
  }

  // Cancel the Razorpay Payment Link so the customer cannot double-pay later
  if (existing.gatewayRefId) {
    await cancelRazorpayPaymentLink(existing.gatewayRefId)
  }

  const updated = (await payload.update({
    collection: 'bookings',
    id: bookingId,
    user,
    overrideAccess: false,
    data: {
      paymentMode: newPaymentMode,
      paymentStatus: 'paid',
      status: 'confirmed',
      settlementStatus: 'with_officer',
      collectedByOfficer: user.id,
      paymentExpiresAt: null,
    },
  })) as Booking

  const eventDoc =
    typeof existing.event === 'object' && existing.event !== null
      ? (existing.event as Event)
      : ((await payload.findByID({
          collection: 'events',
          id: existing.event as number,
          overrideAccess: true,
          depth: 0,
        })) as Event)

  const [ticketsRes, tablesRes] = await Promise.all([
    payload.find({
      collection: 'booking-tickets',
      overrideAccess: true,
      where: { booking: { equals: bookingId } },
      sort: 'ticketCode',
      limit: 200,
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
    await sendBookingNotifications({
      payload,
      bookingId: updated.id,
      bookingCode: updated.bookingCode,
      eventName: eventDoc.name,
      eventDate: eventDoc.date,
      eventVenue: eventDoc.venue,
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

  return { booking: updated, tablesSummary }
}
