import { NextResponse } from 'next/server'
import { getRequestUser, userHasRole } from '@/lib/auth'
import { sendPlunkEmail, sendWhatsAppTemplate } from '@/lib/notifications'

export async function POST(request: Request) {
  const user = await getRequestUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!userHasRole(user, ['super_admin'])) {
    return NextResponse.json({ error: 'Forbidden (super_admin only)' }, { status: 403 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    channel?: 'email' | 'whatsapp'
    email?: string
    phone?: string
    templateName?: string
    languageCode?: string
  }

  if (body.channel === 'email') {
    if (!body.email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 })
    }
    const res = await sendPlunkEmail({
      to: body.email,
      subject: 'AIAIA Cochin Branch — Plunk Email Test',
      body: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px;">
          <h2 style="margin: 0 0 8px;">Plunk Email Connected</h2>
          <p style="margin: 0; color: #475569;">This is a test email from the AIAIA Cochin Branch Ticketing Portal.</p>
          <p style="margin: 16px 0 0; font-size: 12px; color: #94a3b8;">Linear Atelier · Ticketing Partner</p>
        </div>
      `,
    })
    return NextResponse.json(res, { status: res.ok ? 200 : 400 })
  }

  if (body.channel === 'whatsapp') {
    if (!body.phone) {
      return NextResponse.json({ error: 'phone is required' }, { status: 400 })
    }
    const templateName = body.templateName || 'hello_world'
    const languageCode =
      body.languageCode || (templateName === 'hello_world' ? 'en_US' : undefined)

    const res = await sendWhatsAppTemplate({
      toPhone: body.phone,
      templateName,
      languageCode,
    })
    return NextResponse.json(res, { status: res.ok ? 200 : 400 })
  }

  return NextResponse.json(
    {
      configured: {
        plunk: Boolean(process.env.PLUNK_API_KEY),
        whatsapp: Boolean(
          process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID,
        ),
        appUrl: process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || 'http://localhost:3000',
      },
    },
    { status: 200 },
  )
}
