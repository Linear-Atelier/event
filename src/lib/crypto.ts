import * as ed from '@noble/ed25519'
import crypto from 'crypto'

export interface QRPayloadUnsigned {
  bId: number | string
  code: string
  eId: number | string
  pax: number
}

export interface QRPayloadSigned extends QRPayloadUnsigned {
  sig: string
}

function getAesKey(): Buffer {
  const secret = process.env.PAYLOAD_SECRET || 'aiaia-cochin-ticketing-fallback-secret'
  return crypto.createHash('sha256').update(secret).digest()
}

export function encryptPrivateKey(privateKeyHex: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getAesKey(), iv)
  const encrypted = Buffer.concat([cipher.update(privateKeyHex, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptPrivateKey(privateKeyEnc: string): string {
  const parts = privateKeyEnc.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted private key format')
  }
  const [ivHex, tagHex, dataHex] = parts
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getAesKey(),
    Buffer.from(ivHex, 'hex'),
  )
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}

export function canonicalQRMessage(payload: QRPayloadUnsigned): Uint8Array {
  const canonical = JSON.stringify({
    bId: String(payload.bId),
    code: payload.code,
    eId: String(payload.eId),
    pax: Number(payload.pax),
  })
  return new TextEncoder().encode(canonical)
}

export async function generateEventKeyPair(): Promise<{
  publicKeyHex: string
  privateKeyEnc: string
}> {
  const privBytes = ed.utils.randomSecretKey()
  const pubBytes = await ed.getPublicKeyAsync(privBytes)
  const privateKeyHex = Buffer.from(privBytes).toString('hex')
  const publicKeyHex = Buffer.from(pubBytes).toString('hex')
  return {
    publicKeyHex,
    privateKeyEnc: encryptPrivateKey(privateKeyHex),
  }
}

export async function signQRPayload(
  payload: QRPayloadUnsigned,
  privateKeyEnc: string,
): Promise<string> {
  const privateKeyHex = decryptPrivateKey(privateKeyEnc)
  const privBytes = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'))
  const msg = canonicalQRMessage(payload)
  const sigBytes = await ed.signAsync(msg, privBytes)
  return Buffer.from(sigBytes).toString('hex')
}

export function buildSignedQRJson(payload: QRPayloadSigned): string {
  return JSON.stringify({
    bId: String(payload.bId),
    code: payload.code,
    eId: String(payload.eId),
    pax: Number(payload.pax),
    sig: payload.sig,
  })
}

/**
 * Compact strictly-uppercase Alphanumeric QR payload (`XMAS26-B012:9F4A2C8B`).
 * Encodes in QR Alphanumeric mode (20 chars -> Version 1 21x21 at EC level M)
 * while preserving offline tamper-proofing via the 8-char uppercase hex tag
 * derived from the booking's Ed25519 signature.
 */
export function buildCompactQRPayload(
  bookingCode: string,
  qrSignature?: string | null,
): string {
  const cleanCode = bookingCode
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z\-./]/g, '')
  const cleanSig = (qrSignature || '')
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-F]/g, '')
  if (cleanSig.length >= 8) {
    return `${cleanCode}:${cleanSig.slice(0, 8)}`
  }
  return cleanCode
}
