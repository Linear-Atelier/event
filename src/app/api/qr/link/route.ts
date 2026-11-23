import { NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { generateStyledQrPng } from '@/lib/qr-image'

const ALLOWED_PREFIXES = [
  'https://rzp.io/',
  'https://pages.razorpay.com/',
  'https://api.razorpay.com/',
]

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const url = (searchParams.get('url') || '').trim()
    if (!url || !ALLOWED_PREFIXES.some((prefix) => url.startsWith(prefix))) {
      return NextResponse.json({ error: 'Invalid payment link URL' }, { status: 400 })
    }

    const pngBuffer = await generateStyledQrPng({
      qrContent: url,
      eventName: 'Razorpay Payment',
      bookingCode: 'PAY',
      style: 'qr',
    })

    return new NextResponse(new Uint8Array(pngBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=600',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'QR generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
