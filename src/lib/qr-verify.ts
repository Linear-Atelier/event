import * as ed from '@noble/ed25519'

export interface ParsedQRPayload {
  bId: string
  code: string
  eId: string
  pax: number
  sig: string
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
