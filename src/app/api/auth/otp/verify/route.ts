import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import {
  createAuthToken,
  createPayloadRequestFromWebRequest,
  generatePayloadCookie,
  getPayload,
} from 'payload'
import config from '@payload-config'
import { OTP_COOKIE_NAME, OTP_TTL_MS, verifyOtpChallengeToken } from '@/lib/otp'
import type { User } from '@/payload-types'

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string
      code?: string
    }
    const email = (body.email || '').trim().toLowerCase()
    const code = (body.code || '').replace(/\D/g, '').trim()

    if (!email || code.length !== 6) {
      return NextResponse.json(
        { error: 'Please enter your email and the 6-digit verification code.' },
        { status: 400 },
      )
    }

    const cookieStore = await cookies()
    const challengeToken = cookieStore.get(OTP_COOKIE_NAME)?.value
    if (!challengeToken) {
      return NextResponse.json(
        { error: 'Verification session expired. Please request a new code.' },
        { status: 401 },
      )
    }

    const verification = verifyOtpChallengeToken({
      token: challengeToken,
      email,
      code,
    })

    if (!verification.ok) {
      const errorMessage =
        verification.reason === 'expired'
          ? 'This code has expired. Please request a new code.'
          : verification.reason === 'too_many_attempts'
            ? 'Too many incorrect attempts. Please request a new code.'
            : 'Invalid verification code. Please try again.'

      const errorResponse = NextResponse.json({ error: errorMessage }, { status: 401 })

      if (verification.shouldClearCookie) {
        errorResponse.cookies.delete(OTP_COOKIE_NAME)
      } else if (verification.updatedToken) {
        errorResponse.cookies.set(OTP_COOKIE_NAME, verification.updatedToken, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
          maxAge: Math.floor(OTP_TTL_MS / 1000),
        })
      }

      return errorResponse
    }

    const payload = await getPayload({ config })
    const usersCollection = payload.collections['users']
    const req = await createPayloadRequestFromWebRequest({
      config,
      request,
      shouldAuthenticate: false,
    })

    const userDoc = (await payload.db.findOne({
      collection: 'users',
      req,
      where: { id: { equals: verification.userId } },
    })) as (User & { hash?: string; salt?: string; sessions?: unknown[] }) | null

    if (!userDoc || userDoc.email.toLowerCase() !== verification.email) {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
    }

    const { token } = await createAuthToken({
      type: 'login',
      collectionConfig: usersCollection.config,
      email: userDoc.email,
      label: 'Email OTP',
      req,
      user: {
        ...userDoc,
        collection: 'users',
      },
    })

    const authCookie = generatePayloadCookie({
      collectionAuthConfig: usersCollection.config.auth,
      cookiePrefix: payload.config.cookiePrefix,
      returnCookieAsObject: true,
      token,
    })

    const response = NextResponse.json({
      success: true,
      user: {
        id: userDoc.id,
        name: userDoc.name,
        email: userDoc.email,
        roles: userDoc.roles,
      },
    })

    response.cookies.set(authCookie.name, authCookie.value || '', {
      domain: authCookie.domain,
      expires: authCookie.expires ? new Date(authCookie.expires) : undefined,
      httpOnly: authCookie.httpOnly,
      path: authCookie.path || '/',
      sameSite: authCookie.sameSite
        ? (authCookie.sameSite.toLowerCase() as 'lax' | 'strict' | 'none')
        : 'lax',
      secure: authCookie.secure,
    })
    response.cookies.delete(OTP_COOKIE_NAME)

    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
