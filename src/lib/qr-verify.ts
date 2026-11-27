import * as ed from '@noble/ed25519'

export interface ParsedQRPayload {
  bId: string
  code: string
  eId: string
  pax: number
  sig: string
}

export type DecodedTicketQR =
  | {
      format: 'compact'
      code: string
      sigTag: string | null
    }
  | {
      format: 'legacy_json'
      payload: ParsedQRPayload
    }

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim()
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export function parseQRJson(raw: string): ParsedQRPayload | null {
  try {
    const parsed = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed.code === 'string' &&
      typeof parsed.sig === 'string' &&
      (typeof parsed.bId === 'string' || typeof parsed.bId === 'number') &&
      (typeof parsed.eId === 'string' || typeof parsed.eId === 'number') &&
      typeof parsed.pax === 'number'
    ) {
      return {
        bId: String(parsed.bId),
        code: parsed.code,
        eId: String(parsed.eId),
        pax: Number(parsed.pax),
        sig: parsed.sig,
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Parses either the compact uppercase alphanumeric QR format (`XMAS26-B012:9F4A2C8B`
 * or `XMAS26-B012`) or the legacy signed JSON format for backward compatibility.
 */
export function parseTicketQR(raw: string): DecodedTicketQR | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('{')) {
    const legacy = parseQRJson(trimmed)
    return legacy ? { format: 'legacy_json', payload: legacy } : null
  }

  const upper = trimmed.toUpperCase()
  const compactWithSig = upper.match(/^([0-9A-Z-]+):([0-9A-F]{8})$/)
  if (compactWithSig) {
    return {
      format: 'compact',
      code: compactWithSig[1],
      sigTag: compactWithSig[2],
    }
  }

  const plainCode = upper.match(/^([0-9A-Z]+-B\d+|B\d+)$/)
  if (plainCode) {
    return {
      format: 'compact',
      code: plainCode[1],
      sigTag: null,
    }
  }

  return null
}

export async function verifyQRSignatureOffline(
  payload: ParsedQRPayload,
  publicKeyHex: string,
): Promise<boolean> {
  try {
    const canonical = JSON.stringify({
      bId: String(payload.bId),
      code: payload.code,
      eId: String(payload.eId),
      pax: Number(payload.pax),
    })
    const msg = new TextEncoder().encode(canonical)
    const sigBytes = hexToBytes(payload.sig)
    const pubBytes = hexToBytes(publicKeyHex)
    return await ed.verifyAsync(sigBytes, msg, pubBytes)
  } catch {
    return false
  }
}

/**
 * Offline verification for compact `CODE:8HEX` QR payloads:
 * 1. Confirms the 8-character uppercase hex tag matches the cached booking's Ed25519 signature prefix.
 * 2. Verifies the full cached Ed25519 signature against the event's cached public key.
 */
export async function verifyCompactQRTagOffline(params: {
  sigTag: string
  booking: {
    id: number | string
    bookingCode: string
    eventId: number | string
    totalPax: number
    qrSignature: string
  }
  publicKeyHex: string
}): Promise<boolean> {
  const expectedTag = (params.booking.qrSignature || '').trim().slice(0, 8).toUpperCase()
  if (!expectedTag || expectedTag.length < 8) return false
  if (params.sigTag.trim().toUpperCase() !== expectedTag) return false

  return verifyQRSignatureOffline(
    {
      bId: String(params.booking.id),
      code: params.booking.bookingCode,
      eId: String(params.booking.eventId),
      pax: Number(params.booking.totalPax),
      sig: params.booking.qrSignature,
    },
    params.publicKeyHex,
  )
}
