import type { Payload } from 'payload'

export type NotificationTrigger =
  | 'booking_created'
  | 'table_updated'
  | 'manual_resend'
  | 'cancelled'

export interface SendBookingNotificationInput {
  payload: Payload
  bookingId: number
  bookingCode: string
  eventName: string
  eventDate: string
  eventVenue: string
  holderName: string
  phone: string
  email?: string | null
  totalPax: number
  totalAmount: number
  tablesSummary: string
  ticketCodes: string[]
  trigger: NotificationTrigger
}

function getAppBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
      process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000'
  )
}

function normalizeWhatsAppPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `91${digits}`
  return digits
}

export async function sendBookingNotifications(
  input: SendBookingNotificationInput,
): Promise<{ whatsapp: string; email: string }> {
  const baseUrl = getAppBaseUrl()
  const qrPngUrl = `${baseUrl}/api/qr/${encodeURIComponent(input.bookingCode)}`

  const results = { whatsapp: 'skipped', email: 'skipped' }

  // 1. WhatsApp Business Cloud API (Utility Template)
  const waToken = process.env.WHATSAPP_ACCESS_TOKEN
  const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const waTemplate = process.env.WHATSAPP_TEMPLATE_NAME || 'aiaia_ticket_pass'

  if (waToken && waPhoneId && input.phone) {
    try {
      const to = normalizeWhatsAppPhone(input.phone)
      const res = await fetch(`https://graph.facebook.com/v21.0/${waPhoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${waToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: waTemplate,
            language: { code: 'en' },
            components: [
              {
                type: 'header',
                parameters: [{ type: 'image', image: { link: qrPngUrl } }],
              },
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: input.holderName },
                  { type: 'text', text: input.eventName },
                  { type: 'text', text: input.bookingCode },
                  { type: 'text', text: `${input.totalPax} Pax` },
                  { type: 'text', text: input.tablesSummary || 'To be assigned' },
                ],
              },
            ],
          },
        }),
      })

      const json = (await res.json().catch(() => ({}))) as {
        messages?: { id?: string }[]
        error?: { message?: string }
      }

      if (res.ok) {
        results.whatsapp = 'sent'
        await input.payload.create({
          collection: 'notification-logs',
          overrideAccess: true,
          data: {
            booking: input.bookingId,
            channel: 'whatsapp',
            trigger: input.trigger,
            status: 'sent',
            providerMessageId: json.messages?.[0]?.id || '',
            sentAt: new Date().toISOString(),
          },
        })
      } else {
        results.whatsapp = 'failed'
        await input.payload.create({
          collection: 'notification-logs',
          overrideAccess: true,
          data: {
            booking: input.bookingId,
            channel: 'whatsapp',
            trigger: input.trigger,
            status: 'failed',
            errorMessage: json.error?.message || `HTTP ${res.status}`,
            sentAt: new Date().toISOString(),
          },
        })
      }
    } catch (err) {
      results.whatsapp = 'failed'
      await input.payload.create({
        collection: 'notification-logs',
        overrideAccess: true,
        data: {
          booking: input.bookingId,
          channel: 'whatsapp',
          trigger: input.trigger,
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : 'WhatsApp send failed',
          sentAt: new Date().toISOString(),
        },
      })
    }
  } else {
    await input.payload.create({
      collection: 'notification-logs',
      overrideAccess: true,
      data: {
        booking: input.bookingId,
        channel: 'whatsapp',
        trigger: input.trigger,
        status: 'skipped',
        errorMessage: 'WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured',
        sentAt: new Date().toISOString(),
      },
    })
  }

  // 2. Plunk Email Fallback (hosted PNG URL for QR card, never inline base64)
  const plunkKey = process.env.PLUNK_API_KEY
  if (plunkKey && input.email) {
    try {
      const subject =
        input.trigger === 'table_updated'
          ? `Seating Updated: ${input.eventName} (${input.bookingCode})`
          : input.trigger === 'cancelled'
            ? `Booking Cancelled: ${input.eventName} (${input.bookingCode})`
            : `Your Event Pass: ${input.eventName} (${input.bookingCode})`

      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="margin: 0 0 8px; color: #0f172a;">AIAIA Cochin Branch</h2>
          <p style="margin: 0 0 16px; color: #475569; font-size: 14px;">${input.eventName} · ${input.eventVenue}</p>
          <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
            <p style="margin: 0 0 6px;"><strong>Booking Code:</strong> ${input.bookingCode}</p>
            <p style="margin: 0 0 6px;"><strong>Holder:</strong> ${input.holderName}</p>
            <p style="margin: 0 0 6px;"><strong>Guests:</strong> ${input.totalPax} Pax</p>
            <p style="margin: 0 0 6px;"><strong>Tickets:</strong> ${input.ticketCodes.join(', ')}</p>
            <p style="margin: 0;"><strong>Tables:</strong> ${input.tablesSummary || 'To be assigned'}</p>
          </div>
          <div style="text-align: center; margin: 24px 0;">
            <img src="${qrPngUrl}" alt="Master QR Pass ${input.bookingCode}" width="240" height="240" style="border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px;" />
            <p style="font-size: 12px; color: #64748b; margin-top: 8px;">Present this Master QR at the gate for fast check-in.</p>
          </div>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="font-size: 12px; color: #64748b; text-align: center; margin: 0;">
            Linear Atelier · Ticketing Partner
          </p>
        </div>
      `

      const res = await fetch('https://api.useplunk.com/v1/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${plunkKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: input.email,
          subject,
          body: htmlBody,
        }),
      })

      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean
        id?: string
        message?: string
      }

      if (res.ok) {
        results.email = 'sent'
        await input.payload.create({
          collection: 'notification-logs',
          overrideAccess: true,
          data: {
            booking: input.bookingId,
            channel: 'email',
            trigger: input.trigger,
            status: 'sent',
            providerMessageId: json.id || '',
            sentAt: new Date().toISOString(),
          },
        })
      } else {
        results.email = 'failed'
        await input.payload.create({
          collection: 'notification-logs',
          overrideAccess: true,
          data: {
            booking: input.bookingId,
            channel: 'email',
            trigger: input.trigger,
            status: 'failed',
            errorMessage: json.message || `HTTP ${res.status}`,
            sentAt: new Date().toISOString(),
          },
        })
      }
    } catch (err) {
      results.email = 'failed'
      await input.payload.create({
        collection: 'notification-logs',
        overrideAccess: true,
        data: {
          booking: input.bookingId,
          channel: 'email',
          trigger: input.trigger,
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : 'Plunk email failed',
          sentAt: new Date().toISOString(),
        },
      })
    }
  } else if (input.email) {
    await input.payload.create({
      collection: 'notification-logs',
      overrideAccess: true,
      data: {
        booking: input.bookingId,
        channel: 'email',
        trigger: input.trigger,
        status: 'skipped',
        errorMessage: 'PLUNK_API_KEY not configured',
        sentAt: new Date().toISOString(),
      },
    })
  }

  return results
}
