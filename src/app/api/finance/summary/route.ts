import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { sql } from '@payloadcms/db-postgres/drizzle'
import config from '@payload-config'
import { getRequestUser } from '@/lib/auth'
import { getFinancialYearForDate, parseFinancialYearCode } from '@/lib/financial-year'

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const eventIdParam = searchParams.get('eventId')
    const eventId = eventIdParam ? Number(eventIdParam) : null
    const fy =
      parseFinancialYearCode(searchParams.get('fy')) || getFinancialYearForDate(new Date())

    const payload = await getPayload({ config })
    const db = payload.db.drizzle

    const scopeFilter = eventId
      ? sql`AND b.event_id = ${eventId}`
      : sql`AND e.date >= ${fy.startIso} AND e.date <= ${fy.endIso}`

    const [byPaymentModeRes, byOfficerRes, totalsRes] = await Promise.all([
      db.execute(sql`
        SELECT
          b.payment_mode AS "paymentMode",
          COUNT(*)::int AS "bookingCount",
          COALESCE(SUM(b.total_pax), 0)::int AS "totalPax",
          COALESCE(SUM(b.total_amount), 0)::numeric AS "totalAmount",
          COALESCE(SUM(CASE WHEN b.settlement_status = 'received_by_treasurer' OR b.treasurer_verified = true THEN b.total_amount ELSE 0 END), 0)::numeric AS "receivedAmount",
          COALESCE(SUM(CASE WHEN b.settlement_status = 'transferred_to_treasurer' AND b.treasurer_verified IS NOT TRUE THEN b.total_amount ELSE 0 END), 0)::numeric AS "transferredAmount",
          COALESCE(SUM(CASE WHEN (b.settlement_status = 'with_officer' OR b.settlement_status IS NULL) AND b.treasurer_verified IS NOT TRUE THEN b.total_amount ELSE 0 END), 0)::numeric AS "withOfficerAmount"
        FROM bookings b
        JOIN events e ON e.id = b.event_id
        WHERE b.status NOT IN ('cancelled', 'pending_payment') ${scopeFilter}
        GROUP BY b.payment_mode
        ORDER BY b.payment_mode
      `),
      db.execute(sql`
        SELECT
          u.id AS "officerId",
          COALESCE(u.name, 'Unassigned') AS "officerName",
          COALESCE(u.email, '') AS "officerEmail",
          COUNT(*)::int AS "bookingCount",
          COALESCE(SUM(b.total_pax), 0)::int AS "totalPax",
          COALESCE(SUM(CASE WHEN b.payment_mode = 'RAZORPAY' THEN b.total_amount ELSE 0 END), 0)::numeric AS "razorpayAmount",
          COALESCE(SUM(CASE WHEN b.payment_mode = 'CASH' THEN b.total_amount ELSE 0 END), 0)::numeric AS "cashAmount",
          COALESCE(SUM(CASE WHEN b.payment_mode = 'OFFICER_UPI' THEN b.total_amount ELSE 0 END), 0)::numeric AS "upiAmount",
          COALESCE(SUM(CASE WHEN b.payment_mode = 'PAY_AT_DOOR' THEN b.total_amount ELSE 0 END), 0)::numeric AS "doorAmount",
          COALESCE(SUM(b.total_amount), 0)::numeric AS "totalAmount",
          COALESCE(SUM(CASE WHEN b.settlement_status = 'received_by_treasurer' OR b.treasurer_verified = true THEN b.total_amount ELSE 0 END), 0)::numeric AS "receivedAmount",
          COALESCE(SUM(CASE WHEN b.settlement_status = 'transferred_to_treasurer' AND b.treasurer_verified IS NOT TRUE THEN b.total_amount ELSE 0 END), 0)::numeric AS "transferredAmount",
          COALESCE(SUM(CASE WHEN (b.settlement_status = 'with_officer' OR b.settlement_status IS NULL) AND b.treasurer_verified IS NOT TRUE THEN b.total_amount ELSE 0 END), 0)::numeric AS "withOfficerAmount"
        FROM bookings b
        JOIN events e ON e.id = b.event_id
        LEFT JOIN users u ON u.id = b.collected_by_officer_id
        WHERE b.status NOT IN ('cancelled', 'pending_payment') ${scopeFilter}
        GROUP BY u.id, u.name, u.email
        ORDER BY "totalAmount" DESC
      `),
      db.execute(sql`
        SELECT
          COUNT(*)::int AS "activeBookings",
          COALESCE(SUM(b.total_pax), 0)::int AS "totalPax",
          COALESCE(SUM(b.total_amount), 0)::numeric AS "grossRevenue",
          COALESCE(SUM(CASE WHEN b.settlement_status = 'received_by_treasurer' OR b.treasurer_verified = true THEN b.total_amount ELSE 0 END), 0)::numeric AS "receivedRevenue",
          COALESCE(SUM(CASE WHEN b.settlement_status = 'transferred_to_treasurer' AND b.treasurer_verified IS NOT TRUE THEN b.total_amount ELSE 0 END), 0)::numeric AS "transferredRevenue",
          COALESCE(SUM(CASE WHEN (b.settlement_status = 'with_officer' OR b.settlement_status IS NULL) AND b.treasurer_verified IS NOT TRUE THEN b.total_amount ELSE 0 END), 0)::numeric AS "withOfficerRevenue"
        FROM bookings b
        JOIN events e ON e.id = b.event_id
        WHERE b.status NOT IN ('cancelled', 'pending_payment') ${scopeFilter}
      `),
    ])

    return NextResponse.json({
      financialYear: eventId ? null : fy.code,
      totals: totalsRes.rows[0] || {
        activeBookings: 0,
        totalPax: 0,
        grossRevenue: 0,
        receivedRevenue: 0,
        transferredRevenue: 0,
        withOfficerRevenue: 0,
      },
      byPaymentMode: byPaymentModeRes.rows,
      byOfficer: byOfficerRes.rows,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to compute finance summary'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
