import type { Payload } from 'payload'
import { buildSignedQRJson } from '@/lib/crypto'
import { generateStyledQrPng } from '@/lib/qr-image'

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
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return 'http://localhost:3000'
}

export function normalizeWhatsAppPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `91${digits}`
  return digits
}

export async function sendPlunkEmail(params: {
  to: string
  subject: string
  body: string
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const plunkKey = process.env.PLUNK_API_KEY
  if (!plunkKey) {
    return { ok: false, error: 'PLUNK_API_KEY not configured' }
  }

  const payload: Record<string, string> = {
    to: params.to,
    subject: params.subject,
    body: params.body,
  }
  if (process.env.PLUNK_FROM_EMAIL) {
    payload.from = process.env.PLUNK_FROM_EMAIL
  }
  if (process.env.PLUNK_FROM_NAME) {
    payload.name = process.env.PLUNK_FROM_NAME
  }

  const plunkBaseUrl = (
    process.env.PLUNK_API_URL || 'https://next-api.useplunk.com'
  ).replace(/\/$/, '')

  const res = await fetch(`${plunkBaseUrl}/v1/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${plunkKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean
    id?: string
    message?: string
    error?: string
  }

  if (res.ok && json.success !== false) {
    return { ok: true, id: json.id || '' }
  }
  return { ok: false, error: json.message || json.error || `HTTP ${res.status}` }
}

export async function uploadWhatsAppMedia(
  pngBuffer: Buffer,
  filename: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const waToken = process.env.WHATSAPP_ACCESS_TOKEN
  const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!waToken || !waPhoneId) {
    return {
      ok: false,
      error: 'WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured',
    }
  }

  const formData = new FormData()
  formData.append('messaging_product', 'whatsapp')
  formData.append('type', 'image/png')
  formData.append(
    'file',
    new Blob([new Uint8Array(pngBuffer)], { type: 'image/png' }),
    filename,
  )

  const res = await fetch(`https://graph.facebook.com/v21.0/${waPhoneId}/media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${waToken}`,
    },
    body: formData,
  })

  const json = (await res.json().catch(() => ({}))) as {
    id?: string
    error?: { message?: string }
  }

  if (res.ok && json.id) {
    return { ok: true, id: json.id }
  }
  return { ok: false, error: json.error?.message || `Media upload HTTP ${res.status}` }
}

export async function sendWhatsAppTemplate(params: {
  toPhone: string
  templateName?: string
  languageCode?: string
  headerImageId?: string
  headerImageUrl?: string
  bodyParams?: Array<string | { name: string; text: string }>
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const waToken = process.env.WHATSAPP_ACCESS_TOKEN
  const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!waToken || !waPhoneId) {
    return {
      ok: false,
      error: 'WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured',
    }
  }

  const to = normalizeWhatsAppPhone(params.toPhone)
  const templateName =
    params.templateName || process.env.WHATSAPP_TEMPLATE_NAME || 'aiaia_ticket_pass'
  const languageCode =
    params.languageCode || process.env.WHATSAPP_TEMPLATE_LANG || 'en'

  const components: Array<Record<string, unknown>> = []
  if (params.headerImageId) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { id: params.headerImageId } }],
    })
  } else if (params.headerImageUrl) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { link: params.headerImageUrl } }],
    })
  }
  if (params.bodyParams && params.bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: params.bodyParams.map((item) =>
        typeof item === 'string'
          ? { type: 'text', text: item }
          : { type: 'text', parameter_name: item.name, text: item.text },
      ),
    })
  }

  const templatePayload: Record<string, unknown> = {
    name: templateName,
    language: { code: languageCode },
  }
  if (components.length > 0) {
    templatePayload.components = components
  }

  const res = await fetch(`https://graph.facebook.com/v27.0/${waPhoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${waToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: templatePayload,
    }),
  })

  const json = (await res.json().catch(() => ({}))) as {
    messages?: { id?: string }[]
    error?: { message?: string }
  }

  if (res.ok) {
    return { ok: true, id: json.messages?.[0]?.id || '' }
  }
  return { ok: false, error: json.error?.message || `HTTP ${res.status}` }
}

export async function sendBookingNotifications(
  input: SendBookingNotificationInput,
): Promise<{
  whatsapp: string
  email: string
  whatsappError?: string
  emailError?: string
}> {
  const baseUrl = getAppBaseUrl()
  const qrPngUrl = `${baseUrl}/api/qr/${encodeURIComponent(input.bookingCode)}.png?style=square&v=3`
  const formattedDate = input.eventDate
    ? new Date(input.eventDate).toLocaleString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'TBA'

  const results: {
    whatsapp: string
    email: string
    whatsappError?: string
    emailError?: string
  } = { whatsapp: 'skipped', email: 'skipped' }

  // 1. WhatsApp Business Cloud API (Utility Template)
  const waToken = process.env.WHATSAPP_ACCESS_TOKEN
  const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID

  if (waToken && waPhoneId && input.phone) {
    try {
      // Generate the styled QR PNG buffer and upload directly to Meta Media API
      const bookingDoc = await input.payload.findByID({
        collection: 'bookings',
        id: input.bookingId,
        overrideAccess: true,
        depth: 0,
      })

      const eventId =
        typeof bookingDoc.event === 'object' ? bookingDoc.event.id : bookingDoc.event

      const qrContent = buildSignedQRJson({
        bId: bookingDoc.id,
        code: bookingDoc.bookingCode,
        eId: eventId,
        pax: bookingDoc.totalPax,
        sig: bookingDoc.qrSignature || '',
      })

      const pngBuffer = await generateStyledQrPng({
        qrContent,
        eventName: input.eventName,
        bookingCode: input.bookingCode,
        style: 'square',
      })

      const uploadRes = await uploadWhatsAppMedia(
        pngBuffer,
        `${input.bookingCode}.png`,
      )

      if (!uploadRes.ok || !uploadRes.id) {
        results.whatsapp = 'failed'
        results.whatsappError = uploadRes.error || 'WhatsApp media upload failed'
        await input.payload.create({
          collection: 'notification-logs',
          overrideAccess: true,
          data: {
            booking: input.bookingId,
            channel: 'whatsapp',
            trigger: input.trigger,
            status: 'failed',
            errorMessage: results.whatsappError,
            sentAt: new Date().toISOString(),
          },
        })
      } else {
        const waRes = await sendWhatsAppTemplate({
          toPhone: input.phone,
          headerImageId: uploadRes.id,
          bodyParams: [
            { name: 'customer_name', text: input.holderName },
            { name: 'event_name', text: input.eventName },
            { name: 'booking_id', text: input.bookingCode },
            { name: 'event_date', text: formattedDate },
            { name: 'event_venue', text: input.eventVenue },
            { name: 'pax', text: `${input.totalPax} Pax` },
            { name: 'table', text: input.tablesSummary || 'To be assigned' },
          ],
        })

        if (waRes.ok) {
          results.whatsapp = 'sent'
          await input.payload.create({
            collection: 'notification-logs',
            overrideAccess: true,
            data: {
              booking: input.bookingId,
              channel: 'whatsapp',
              trigger: input.trigger,
              status: 'sent',
              providerMessageId: waRes.id || '',
              sentAt: new Date().toISOString(),
            },
          })
        } else {
          results.whatsapp = 'failed'
          results.whatsappError = waRes.error || 'WhatsApp send failed'
          await input.payload.create({
            collection: 'notification-logs',
            overrideAccess: true,
            data: {
              booking: input.bookingId,
              channel: 'whatsapp',
              trigger: input.trigger,
              status: 'failed',
              errorMessage: waRes.error || 'WhatsApp send failed',
              sentAt: new Date().toISOString(),
            },
          })
        }
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

      const introLine =
        input.trigger === 'table_updated'
          ? `Your seating for <strong>${input.eventName}</strong> has been updated. Here are your reservation details:`
          : input.trigger === 'cancelled'
            ? `Your booking for <strong>${input.eventName}</strong> has been cancelled.`
            : `Your booking for <strong>${input.eventName}</strong> is confirmed. Here are your reservation details:`

      const htmlBody = `
        <div style="font-family: 'Nunito Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px 24px; background: #ffffff; color: #0f172a;">
          <p style="margin: 0 0 18px; text-align: center; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #64748b; font-weight: 700;">
            AIAIA Cochin Branch · Digital Ticket
          </p>

          ${input.trigger !== 'cancelled'
          ? `<div style="margin: 0 auto 24px; text-align: center;">
                  <img src="${qrPngUrl}" alt="Master QR Pass ${input.bookingCode}" width="240" height="240" style="display: inline-block; width: 240px; height: 240px; border-radius: 24px;" />
                </div>`
          : `<div style="background: #fff1f2; border: 1px solid #fecdd3; border-radius: 16px; padding: 16px; text-align: center; margin-bottom: 20px;">
                  <p style="margin: 0; font-size: 14px; font-weight: 700; color: #be123c;">Booking ${input.bookingCode} has been cancelled.</p>
                </div>`
        }

          <p style="margin: 0 0 12px; font-size: 15px; line-height: 1.6; color: #0f172a;">
            Hello <strong>${input.holderName}</strong>,
          </p>
          <p style="margin: 0 0 18px; font-size: 14px; line-height: 1.6; color: #334155;">
            ${introLine}
          </p>

          <div style="background: #f8fafc; border-radius: 18px; padding: 16px 18px; text-align: left; font-size: 14px; line-height: 1.85; color: #334155;">
            <div><strong style="color: #0f172a;">Booking Reference:</strong> ${input.bookingCode}</div>
            <div><strong style="color: #0f172a;">Date &amp; Time:</strong> ${formattedDate}</div>
            <div><strong style="color: #0f172a;">Venue:</strong> ${input.eventVenue}</div>
            <div><strong style="color: #0f172a;">Guests:</strong> ${input.totalPax} Pax</div>
            <div><strong style="color: #0f172a;">Table:</strong> ${input.tablesSummary || 'To be assigned'}</div>
            <div style="border-top: 1px dashed #cbd5e1; margin: 10px 0;"></div>
            <div style="font-size: 12px; color: #64748b;">
              <strong>Tickets:</strong> ${input.ticketCodes.join(', ')} · <strong>Amount:</strong> ₹${input.totalAmount.toLocaleString('en-IN')}
            </div>
          </div>

          ${input.trigger !== 'cancelled'
          ? `<p style="margin: 18px 0 0; font-size: 13px; line-height: 1.6; color: #475569;">
                  Please show the digital ticket above or share your Booking Reference at the entrance for check-in.
                </p>`
          : ''
        }

          <div style="border-top: 1px dashed #e2e8f0; margin: 22px 0 14px;"></div>
          <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
            Linear Atelier · Ticketing Partner
          </p>
        </div>
      `

      const emailRes = (await input.payload.sendEmail({
        to: input.email,
        subject,
        html: htmlBody,
      })) as { id?: string } | undefined

      results.email = 'sent'
      await input.payload.create({
        collection: 'notification-logs',
        overrideAccess: true,
        data: {
          booking: input.bookingId,
          channel: 'email',
          trigger: input.trigger,
          status: 'sent',
          providerMessageId: emailRes?.id || '',
          sentAt: new Date().toISOString(),
        },
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Plunk email failed'
      results.email = 'failed'
      results.emailError = errMsg
      await input.payload.create({
        collection: 'notification-logs',
        overrideAccess: true,
        data: {
          booking: input.bookingId,
          channel: 'email',
          trigger: input.trigger,
          status: 'failed',
          errorMessage: errMsg,
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
