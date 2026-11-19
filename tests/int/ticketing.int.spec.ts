import { describe, expect, it } from 'vitest'
import { generateEventKeyPair, signQRPayload, buildSignedQRJson } from '@/lib/crypto'
import { parseQRJson, verifyQRSignatureOffline } from '@/lib/qr-verify'
import { evaluateTableAllocation } from '@/lib/table-allocation'

describe('AIAIA Ticketing Core Logic', () => {
  it('signs and verifies Ed25519 QR payloads offline', async () => {
    const { publicKeyHex, privateKeyEnc } = await generateEventKeyPair()
    expect(publicKeyHex.length).toBe(64)

    const sig = await signQRPayload(
      { bId: 42, code: 'B042', eId: 7, pax: 4 },
      privateKeyEnc,
    )

    const qrJson = buildSignedQRJson({
      bId: 42,
      code: 'B042',
      eId: 7,
      pax: 4,
      sig,
    })

    const parsed = parseQRJson(qrJson)
    expect(parsed).not.toBeNull()

    const valid = await verifyQRSignatureOffline(parsed!, publicKeyHex)
    expect(valid).toBe(true)

    // Tampering with pax invalidates the signature
    const tampered = await verifyQRSignatureOffline({ ...parsed!, pax: 5 }, publicKeyHex)
    expect(tampered).toBe(false)
  })

  it('computes smart table capacity recommendations and under-allocation warnings', () => {
    const rec = evaluateTableAllocation(10, [], 8)
    expect(rec.recommendedTables).toBe(2)
    expect(rec.recommendationText).toContain('2 tables recommended')
    expect(rec.isUnderAllocated).toBe(false)

    const under = evaluateTableAllocation(
      10,
      [{ tableId: 1, tableLabel: 'T-01', maxCapacity: 8, allocatedSeats: 6 }],
      8,
    )
    expect(under.isUnderAllocated).toBe(true)
    expect(under.shortfallSeats).toBe(4)
    expect(under.warningText).toContain('4 seats short')

    const sufficient = evaluateTableAllocation(
      10,
      [
        { tableId: 1, tableLabel: 'T-01', maxCapacity: 8, allocatedSeats: 8 },
        { tableId: 2, tableLabel: 'T-02', maxCapacity: 6, allocatedSeats: 2 },
      ],
      8,
    )
    expect(sufficient.isUnderAllocated).toBe(false)
    expect(sufficient.warningText).toBeNull()
  })
})
