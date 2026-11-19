import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getRequestUser, userHasRole } from '@/lib/auth'

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!userHasRole(user, ['treasurer', 'super_admin'])) {
      return NextResponse.json(
        { error: 'Forbidden: Only Treasurer or Super Admin can verify payments' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const bookingIds: number[] = Array.isArray(body.bookingIds)
      ? body.bookingIds.map(Number).filter((n: number) => !Number.isNaN(n))
      : body.bookingId
        ? [Number(body.bookingId)]
        : []
    const verified = body.verified !== false

    if (bookingIds.length === 0) {
      return NextResponse.json({ error: 'No booking IDs provided' }, { status: 400 })
    }

    const payload = await getPayload({ config })
    const nowIso = new Date().toISOString()
    const updatedIds: number[] = []

    for (const id of bookingIds) {
      await payload.update({
        collection: 'bookings',
        id,
        user,
        overrideAccess: false,
        data: {
          treasurerVerified: verified,
          treasurerVerifiedAt: verified ? nowIso : null,
          treasurerVerifiedBy: verified ? user.id : null,
        },
      })
      updatedIds.push(id)
    }

    return NextResponse.json({ success: true, updatedIds, verified })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
