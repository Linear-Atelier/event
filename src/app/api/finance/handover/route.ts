import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getRequestUser, userHasRole } from '@/lib/auth'

type HandoverAction = 'mark_transferred' | 'confirm_received' | 'reset_with_officer'

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const action = body.action as HandoverAction
    const transferReference = body.transferReference
      ? String(body.transferReference).trim()
      : undefined

    const bookingIds: number[] = Array.isArray(body.bookingIds)
      ? body.bookingIds.map(Number).filter((n: number) => !Number.isNaN(n))
      : body.bookingId
        ? [Number(body.bookingId)]
        : []

    if (bookingIds.length === 0) {
      return NextResponse.json({ error: 'No booking IDs provided' }, { status: 400 })
    }

    const isTreasurer = userHasRole(user, ['treasurer', 'super_admin'])
    const isOfficer = userHasRole(user, ['booking_officer', 'gate_staff', 'treasurer', 'super_admin'])

    if (action === 'confirm_received' && !isTreasurer) {
      return NextResponse.json(
        { error: 'Forbidden: Only Treasurer or Super Admin can confirm funds received.' },
        { status: 403 },
      )
    }

    if ((action === 'mark_transferred' || action === 'reset_with_officer') && !isOfficer) {
      return NextResponse.json(
        { error: 'Forbidden: Officer or Treasurer role required.' },
        { status: 403 },
      )
    }

    const payload = await getPayload({ config })
    const nowIso = new Date().toISOString()
    const updatedIds: number[] = []

    for (const id of bookingIds) {
      if (action === 'mark_transferred') {
        const existing = await payload.findByID({
          collection: 'bookings',
          id,
          user,
          overrideAccess: false,
          depth: 0,
        })
        if (existing.settlementStatus === 'received_by_treasurer' && !isTreasurer) {
          continue
        }
        await payload.update({
          collection: 'bookings',
          id,
          user,
          overrideAccess: false,
          data: {
            settlementStatus: 'transferred_to_treasurer',
            transferredAt: nowIso,
            transferredBy: user.id,
            transferReference: transferReference || existing.transferReference || null,
          },
        })
        updatedIds.push(id)
      } else if (action === 'confirm_received') {
        await payload.update({
          collection: 'bookings',
          id,
          user,
          overrideAccess: false,
          data: {
            settlementStatus: 'received_by_treasurer',
            treasurerVerified: true,
            treasurerVerifiedAt: nowIso,
            treasurerVerifiedBy: user.id,
            ...(transferReference ? { transferReference } : {}),
          },
        })
        updatedIds.push(id)
      } else if (action === 'reset_with_officer') {
        const existing = await payload.findByID({
          collection: 'bookings',
          id,
          user,
          overrideAccess: false,
          depth: 0,
        })
        if (existing.settlementStatus === 'received_by_treasurer' && !isTreasurer) {
          return NextResponse.json(
            { error: 'Only Treasurer or Super Admin can revert a confirmed receipt.' },
            { status: 403 },
          )
        }
        await payload.update({
          collection: 'bookings',
          id,
          user,
          overrideAccess: false,
          data: {
            settlementStatus: 'with_officer',
            transferredAt: null,
            transferredBy: null,
            transferReference: null,
            ...(isTreasurer
              ? {
                  treasurerVerified: false,
                  treasurerVerifiedAt: null,
                  treasurerVerifiedBy: null,
                }
              : {}),
          },
        })
        updatedIds.push(id)
      }
    }

    return NextResponse.json({
      success: true,
      action,
      updatedIds,
      timestamp: nowIso,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Handover update failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
