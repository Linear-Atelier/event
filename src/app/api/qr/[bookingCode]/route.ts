import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { buildCompactQRPayload } from '@/lib/crypto'
import { generateStyledQrPng } from '@/lib/qr-image'
import type { Event } from '@/payload-types'

export async function GET(
  request: Request,
  context: { params: Promise<{ bookingCode: string }> },
) {
  try {
    const { bookingCode } = await context.params
    const cleanCode = decodeURIComponent(bookingCode).replace(/\.png$/i, '').trim()
    const url = new URL(request.url)
    const styleParam = url.searchParams.get('style')
    const style =
      styleParam === 'qr'
        ? 'qr'
        : styleParam === 'card'
          ? 'card'
          : 'square'

    const payload = await getPayload({ config })
    const res = await payload.find({
      collection: 'bookings',
      overrideAccess: true,
      where: { bookingCode: { equals: cleanCode } },
      limit: 1,
      depth: 1,
    })

    const booking = res.docs[0]
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    const eventObj =
      typeof booking.event === 'object' && booking.event !== null
        ? (booking.event as Event)
        : null
    const eventName = eventObj?.name || 'AIAIA Cochin Event'

    const qrContent = buildCompactQRPayload(booking.bookingCode, booking.qrSignature)

    const pngBuffer = await generateStyledQrPng({
      qrContent,
      eventName,
      bookingCode: booking.bookingCode,
      style,
    })

    return new NextResponse(new Uint8Array(pngBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=60, must-revalidate',
      },
    })
  } catch {
    return NextResponse.json({ error: 'QR generation failed' }, { status: 500 })
  }
}
