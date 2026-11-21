import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import {
  createOtpChallengeToken,
  generateSixDigitOtp,
  OTP_COOKIE_NAME,
  OTP_TTL_MS,
} from '@/lib/otp'

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { email?: string }
    const email = (body.email || '').trim().toLowerCase()

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Please enter a valid committee email.' }, { status: 400 })
    }

    const payload = await getPayload({ config })
    const usersRes = await payload.find({
      collection: 'users',
      overrideAccess: true,
      where: { email: { equals: email } },
      limit: 1,
      depth: 0,
    })

    const user = usersRes.docs[0]
    if (!user) {
      return NextResponse.json(
        { error: 'No committee account found with this email.' },
        { status: 404 },
      )
    }

    const code = generateSixDigitOtp()
    const challengeToken = createOtpChallengeToken({
      email: user.email,
      userId: user.id,
      code,
    })

    const html = `
      <div style="font-family: 'Nunito Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 28px 24px; background: #ffffff; color: #0f172a;">
        <p style="margin: 0 0 16px; text-align: center; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #64748b; font-weight: 700;">
          AIAIA Cochin Branch · Committee Portal
        </p>

        <p style="margin: 0 0 12px; font-size: 15px; line-height: 1.6; color: #0f172a;">
          Hello <strong>${user.name || 'Committee Member'}</strong>,
        </p>
        <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #334155;">
          Use the 6-digit verification code below to sign in to the Committee Portal. This code expires in <strong>5 minutes</strong>.
        </p>

        <div style="background: #0f172a; color: #ffffff; border-radius: 20px; padding: 22px; text-align: center; margin: 0 0 20px;">
          <div style="font-size: 32px; font-weight: 800; letter-spacing: 0.35em; padding-left: 0.35em; color: #ffffff;">
            ${code}
          </div>
        </div>

        <p style="margin: 0; font-size: 12px; line-height: 1.6; color: #64748b;">
          If you didn't request this sign-in code, you can safely ignore this email.
        </p>

        <div style="border-top: 1px dashed #e2e8f0; margin: 22px 0 14px;"></div>
        <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
          Linear Atelier · Ticketing Partner
        </p>
      </div>
    `

    await payload.sendEmail({
      to: user.email,
      subject: `${code} is your AIAIA Cochin Portal login code`,
      html,
    })

    const response = NextResponse.json({
      success: true,
      message: 'Verification code sent to your email.',
    })

    response.cookies.set(OTP_COOKIE_NAME, challengeToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: Math.floor(OTP_TTL_MS / 1000),
    })

    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send verification code.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
