import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getRequestUser, userHasRole } from '@/lib/auth'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getRequestUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!userHasRole(user, ['booking_officer', 'super_admin'])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await context.params
    const body = await request.json()
    const ticketId = Number(body.ticketId)
    const physicalIssued = body.physicalIssued !== false

    const payload = await getPayload({ config })
    const updated = await payload.update({
      collection: 'booking-tickets',
      id: ticketId,
      user,
      overrideAccess: false,
      data: {
        physicalIssued,
        physicalIssuedBy: physicalIssued ? user.id : null,
        physicalIssuedAt: physicalIssued ? new Date().toISOString() : null,
      },
    })

    return NextResponse.json({ ticket: updated })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update physical stub'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
