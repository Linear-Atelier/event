import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { sql } from '@payloadcms/db-postgres/drizzle'
import config from '@payload-config'
import { getRequestUser, userHasRole } from '@/lib/auth'

interface SyncCheckinItem {
  slotId: number
  checkedInAt: string
  deviceId: string
  method?: 'qr_scan' | 'manual_code' | 'door_sale'
}

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!userHasRole(user, ['gate_staff', 'booking_officer', 'super_admin'])) {
      return NextResponse.json({ error: 'Forbidden: Gate Staff role required' }, { status: 403 })
    }

    const body = await request.json()
    const items: SyncCheckinItem[] = Array.isArray(body.checkins) ? body.checkins : []

    if (items.length === 0) {
      return NextResponse.json({ synced: 0, alreadyLocked: 0, results: [] })
    }

    const payload = await getPayload({ config })
    const db = payload.db.drizzle

    let synced = 0
    let alreadyLocked = 0
    const results: Array<{ slotId: number; status: 'synced' | 'already_checked_in' }> = []

    for (const item of items) {
      const slotId = Number(item.slotId)
      if (!slotId || Number.isNaN(slotId)) continue

      const checkedInAt = item.checkedInAt || new Date().toISOString()
      const deviceId = String(item.deviceId || 'GATE-DEVICE').slice(0, 64)
      const method =
        item.method === 'manual_code' || item.method === 'door_sale' ? item.method : 'qr_scan'

      // Atomic idempotent UPDATE: only locks slots where checked_in_at IS NULL
      const res = await db.execute(sql`
        UPDATE ticket_checkin_slots
        SET
          checked_in_at = ${checkedInAt},
          checked_in_by_user_id = ${user.id},
          device_id = ${deviceId},
          method = ${method},
          updated_at = NOW()
        WHERE id = ${slotId} AND checked_in_at IS NULL
        RETURNING id
      `)

      if (res.rows.length > 0) {
        synced += 1
        results.push({ slotId, status: 'synced' })
      } else {
        alreadyLocked += 1
        results.push({ slotId, status: 'already_checked_in' })
      }
    }

    return NextResponse.json({
      success: true,
      synced,
      alreadyLocked,
      results,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Check-in sync failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
