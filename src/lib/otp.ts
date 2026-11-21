import crypto from 'crypto'

export const OTP_COOKIE_NAME = 'aiaia-otp-challenge'
export const OTP_TTL_MS = 5 * 60 * 1000 // 5 minutes
export const OTP_MAX_ATTEMPTS = 5

interface OtpChallengePayload {
  email: string
  userId: number | string
  exp: number
  nonce: string
  attempts: number
  codeSig: string
}

function getSecret(): string {
  const secret = process.env.PAYLOAD_SECRET
  if (!secret) {
    throw new Error('PAYLOAD_SECRET is not configured')
  }
  return secret
}

function hmacHex(data: string): string {
  return crypto.createHmac('sha256', getSecret()).update(data).digest('hex')
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex')
  const bufB = Buffer.from(b, 'hex')
  if (bufA.length !== bufB.length || bufA.length === 0) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export function generateSixDigitOtp(): string {
  return String(crypto.randomInt(100000, 1000000))
}

function encodeSignedChallenge(payload: OtpChallengePayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const envelopeSig = hmacHex(`env|${encoded}`)
  return `${encoded}.${envelopeSig}`
}

function decodeSignedChallenge(token: string): OtpChallengePayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [encoded, envelopeSig] = parts
  const expectedEnvSig = hmacHex(`env|${encoded}`)
  if (!timingSafeHexEqual(envelopeSig, expectedEnvSig)) return null

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as OtpChallengePayload
    if (
      typeof parsed.email !== 'string' ||
      (typeof parsed.userId !== 'number' && typeof parsed.userId !== 'string') ||
      typeof parsed.exp !== 'number' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.attempts !== 'number' ||
      typeof parsed.codeSig !== 'string'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function createOtpChallengeToken(params: {
  email: string
  userId: number | string
  code: string
  ttlMs?: number
}): string {
  const normalizedEmail = params.email.trim().toLowerCase()
  const exp = Date.now() + (params.ttlMs ?? OTP_TTL_MS)
  const nonce = crypto.randomBytes(12).toString('hex')
  const codeSig = hmacHex(
    `otp|${normalizedEmail}|${params.userId}|${exp}|${nonce}|${params.code.trim()}`,
  )

  return encodeSignedChallenge({
    email: normalizedEmail,
    userId: params.userId,
    exp,
    nonce,
    attempts: 0,
    codeSig,
  })
}

export type VerifyOtpResult =
  | { ok: true; userId: number | string; email: string }
  | {
      ok: false
      reason: 'invalid_token' | 'expired' | 'too_many_attempts' | 'mismatch'
      updatedToken?: string
      shouldClearCookie?: boolean
    }

export function verifyOtpChallengeToken(params: {
  token: string
  email: string
  code: string
}): VerifyOtpResult {
  const payload = decodeSignedChallenge(params.token)
  if (!payload) {
    return { ok: false, reason: 'invalid_token', shouldClearCookie: true }
  }

  if (Date.now() > payload.exp) {
    return { ok: false, reason: 'expired', shouldClearCookie: true }
  }

  if (payload.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts', shouldClearCookie: true }
  }

  const normalizedEmail = params.email.trim().toLowerCase()
  const cleanCode = params.code.trim()
  const expectedCodeSig = hmacHex(
    `otp|${normalizedEmail}|${payload.userId}|${payload.exp}|${payload.nonce}|${cleanCode}`,
  )

  if (
    normalizedEmail === payload.email &&
    timingSafeHexEqual(payload.codeSig, expectedCodeSig)
  ) {
    return { ok: true, userId: payload.userId, email: payload.email }
  }

  const nextAttempts = payload.attempts + 1
  if (nextAttempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts', shouldClearCookie: true }
  }

  return {
    ok: false,
    reason: 'mismatch',
    updatedToken: encodeSignedChallenge({
      ...payload,
      attempts: nextAttempts,
    }),
  }
}
