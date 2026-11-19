import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import QRCode from 'qrcode'
import { buildSignedQRJson } from '@/lib/crypto'

export async function GET(
  _request: Request,
  context: { params: Promise<{ bookingCode: string }> },
) {
  try {
    const { bookingCode } = await context.params
    const cleanCode = decodeURIComponent(bookingCode).replace(/\.png$/i, '').trim()

    const payload = await getPayload({ config })
    const res = await payload.find({
      collection: 'bookings',
      overrideAccess: true,
      where: { bookingCode: { equals: cleanCode } },
      limit: 1,
      depth: 0,
    })

    const booking = res.docs[0]
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    const eventId = typeof booking.event === 'object' ? booking.event.id : booking.event
    const qrContent = buildSignedQRJson({
      bId: booking.id,
      code: booking.bookingCode,
      eId: eventId,
      pax: booking.totalPax,
      sig: booking.qrSignature || '',
    })

    const pngBuffer = await QRCode.toBuffer(qrContent, {
      type: 'png',
      width: 480,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })

    return new NextResponse(new Uint8Array(pngBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300',
      },
    })
  } catch {
    return NextResponse.json({ error: 'QR generation failed' }, { status: 500 })
  }
}
