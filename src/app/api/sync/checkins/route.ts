import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { sql } from '@payloadcms/db-postgres/drizzle'
import config from '@payload-config'
import { getRequestUser, userHasRole } from '@/lib/auth'
import { formatEventDayLabel, isScanAllowedForEventDate } from '@/lib/event-date'

interface SyncCheckinItem {
  slotId: number
  checkedInAt: string
  deviceId: string
  method?: 'qr_scan' | 'manual_code'
  doorPaymentMode?: 'CASH' | 'OFFICER_UPI' | 'COMPLIMENTARY'
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
      return NextResponse.json({ synced: 0, alreadyLocked: 0, blockedBeforeEventDate: 0, results: [] })
    }

    const slotIds = Array.from(
      new Set(
        items
          .map((i) => Number(i.slotId))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    )

    if (slotIds.length === 0) {
      return NextResponse.json({ synced: 0, alreadyLocked: 0, blockedBeforeEventDate: 0, results: [] })
    }

    const payload = await getPayload({ config })
    const db = payload.db.drizzle

    // Resolve each slot's parent booking status, payment info & event date before updating
    const metaRes = await db.execute(sql`
      SELECT
        s.id AS "slotId",
        b.id AS "bookingId",
        b.status AS "bookingStatus",
        b.payment_mode AS "paymentMode",
        b.payment_status AS "paymentStatus",
        e.date AS "eventDate",
        e.name AS "eventName"
      FROM ticket_checkin_slots s
      JOIN bookings b ON b.id = s.booking_id
      JOIN events e ON e.id = b.event_id
      WHERE s.id IN (${sql.join(
        slotIds.map((id) => sql`${id}`),
        sql`, `,
      )})
    `)

    const metaBySlotId = new Map<
      number,
      {
        bookingId: number
        bookingStatus: string
        paymentMode: string
        paymentStatus: string
        eventDate: string
        eventName: string
      }
    >()
    for (const row of metaRes.rows as Array<{
      slotId: number
      bookingId: number
      bookingStatus: string
      paymentMode: string
      paymentStatus: string
      eventDate: string
      eventName: string
    }>) {
      metaBySlotId.set(Number(row.slotId), {
        ...row,
        bookingId: Number(row.bookingId),
      })
    }

    let synced = 0
    let alreadyLocked = 0
    let blockedBeforeEventDate = 0
    let firstBlockedDateLabel = ''
    const results: Array<{
      slotId: number
      status: 'synced' | 'already_checked_in' | 'blocked_before_event_date' | 'blocked_invalid_booking'
    }> = []

    const now = new Date()

    for (const item of items) {
      const slotId = Number(item.slotId)
      if (!slotId || Number.isNaN(slotId)) continue

      const meta = metaBySlotId.get(slotId)
      if (!meta) continue

      if (meta.bookingStatus === 'cancelled' || meta.bookingStatus === 'pending_payment') {
        results.push({ slotId, status: 'blocked_invalid_booking' })
        continue
      }

      if (!isScanAllowedForEventDate(meta.eventDate, now)) {
        blockedBeforeEventDate += 1
        if (!firstBlockedDateLabel) {
          firstBlockedDateLabel = formatEventDayLabel(meta.eventDate)
        }
        results.push({ slotId, status: 'blocked_before_event_date' })
        continue
      }

      const checkedInAt = item.checkedInAt || now.toISOString()
      const deviceId = String(item.deviceId || 'GATE-DEVICE').slice(0, 64)
      const method = item.method === 'manual_code' ? 'manual_code' : 'qr_scan'

      // If this booking was PAY_AT_DOOR (pending) and gate staff settled payment at check-in,
      // mark it paid & attribute collection appropriately for Treasurer reconciliation.
      if (meta.paymentMode === 'PAY_AT_DOOR' && meta.paymentStatus === 'pending') {
        if (item.doorPaymentMode === 'COMPLIMENTARY') {
          await db.execute(sql`
            UPDATE bookings
            SET
              payment_status = 'paid',
              payment_mode = 'COMPLIMENTARY',
              total_amount = 0,
              paid_amount = 0,
              collected_by_officer_id = ${user.id},
              settlement_status = 'received_by_treasurer',
              treasurer_verified = true,
              treasurer_verified_at = NOW(),
              updated_at = NOW()
            WHERE id = ${meta.bookingId}
              AND payment_mode = 'PAY_AT_DOOR'
              AND payment_status = 'pending'
          `)
          meta.paymentMode = 'COMPLIMENTARY'
          meta.paymentStatus = 'paid'
        } else if (item.doorPaymentMode === 'CASH' || item.doorPaymentMode === 'OFFICER_UPI') {
          await db.execute(sql`
            UPDATE bookings
            SET
              payment_status = 'paid',
              payment_mode = ${item.doorPaymentMode},
              paid_amount = total_amount,
              collected_by_officer_id = ${user.id},
              settlement_status = 'with_officer',
              updated_at = NOW()
            WHERE id = ${meta.bookingId}
              AND payment_mode = 'PAY_AT_DOOR'
              AND payment_status = 'pending'
          `)
          meta.paymentMode = item.doorPaymentMode
          meta.paymentStatus = 'paid'
        }
      }

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

    if (blockedBeforeEventDate > 0 && synced === 0 && alreadyLocked === 0) {
      return NextResponse.json(
        {
          error: `Gate check-in opens on ${firstBlockedDateLabel || 'event day'}.`,
          synced,
          alreadyLocked,
          blockedBeforeEventDate,
          results,
        },
        { status: 403 },
      )
    }

    return NextResponse.json({
      success: true,
      synced,
      alreadyLocked,
      blockedBeforeEventDate,
      results,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Check-in sync failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
