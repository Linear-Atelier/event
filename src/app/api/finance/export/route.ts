import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { sql } from '@payloadcms/db-postgres/drizzle'
import ExcelJS from 'exceljs'
import config from '@payload-config'
import { getRequestUser } from '@/lib/auth'
import { getFinancialYearForDate, parseFinancialYearCode } from '@/lib/financial-year'
import type { Event, User } from '@/payload-types'

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

    let fyEventIds: number[] = []
    let scopeSlug = fy.code
    if (eventId) {
      const ev = await payload
        .findByID({
          collection: 'events',
          id: eventId,
          user,
          overrideAccess: false,
          depth: 0,
        })
        .catch(() => null)
      scopeSlug = ev?.code || String(eventId)
    } else {
      const fyEventsRes = await payload.find({
        collection: 'events',
        user,
        overrideAccess: false,
        where: {
          and: [
            { date: { greater_than_equal: fy.startIso } },
            { date: { less_than_equal: fy.endIso } },
          ],
        },
        limit: 200,
        depth: 0,
      })
      fyEventIds = fyEventsRes.docs.map((e) => e.id)
    }

    const scopeFilter = eventId
      ? sql`AND b.event_id = ${eventId}`
      : sql`AND e.date >= ${fy.startIso} AND e.date <= ${fy.endIso}`

    const [bookingsRes, byOfficerRes, byModeRes] = await Promise.all([
      eventId
        ? payload.find({
            collection: 'bookings',
            user,
            overrideAccess: false,
            where: { event: { equals: eventId } },
            sort: 'bookingCode',
            limit: 2000,
            depth: 1,
          })
        : fyEventIds.length > 0
          ? payload.find({
              collection: 'bookings',
              user,
              overrideAccess: false,
              where: { event: { in: fyEventIds } },
              sort: 'bookingCode',
              limit: 2000,
              depth: 1,
            })
          : Promise.resolve({ docs: [] }),
      db.execute(sql`
        SELECT
          COALESCE(u.name, 'Unassigned') AS "officerName",
          COUNT(*)::int AS "bookingCount",
          COALESCE(SUM(b.total_pax), 0)::int AS "totalPax",
          COALESCE(SUM(CASE WHEN b.payment_mode = 'RAZORPAY' THEN b.total_amount ELSE 0 END), 0)::numeric AS "razorpayAmount",
          COALESCE(SUM(CASE WHEN b.payment_mode = 'CASH' THEN b.total_amount ELSE 0 END), 0)::numeric AS "cashAmount",
          COALESCE(SUM(CASE WHEN b.payment_mode = 'OFFICER_UPI' THEN b.total_amount ELSE 0 END), 0)::numeric AS "upiAmount",
          COALESCE(SUM(CASE WHEN b.payment_mode = 'PAY_AT_DOOR' THEN b.total_amount ELSE 0 END), 0)::numeric AS "doorAmount",
          COALESCE(SUM(b.total_amount), 0)::numeric AS "totalAmount",
          COALESCE(SUM(CASE WHEN b.treasurer_verified = true THEN b.total_amount ELSE 0 END), 0)::numeric AS "verifiedAmount"
        FROM bookings b
        JOIN events e ON e.id = b.event_id
        LEFT JOIN users u ON u.id = b.collected_by_officer_id
        WHERE b.status NOT IN ('cancelled', 'pending_payment') ${scopeFilter}
        GROUP BY u.id, u.name
        ORDER BY "totalAmount" DESC
      `),
      db.execute(sql`
        SELECT
          b.payment_mode AS "paymentMode",
          COUNT(*)::int AS "bookingCount",
          COALESCE(SUM(b.total_pax), 0)::int AS "totalPax",
          COALESCE(SUM(b.total_amount), 0)::numeric AS "totalAmount",
          COALESCE(SUM(CASE WHEN b.treasurer_verified = true THEN b.total_amount ELSE 0 END), 0)::numeric AS "verifiedAmount"
        FROM bookings b
        JOIN events e ON e.id = b.event_id
        WHERE b.status NOT IN ('cancelled', 'pending_payment') ${scopeFilter}
        GROUP BY b.payment_mode
      `),
    ])

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'AIAIA Cochin Branch · Linear Atelier Ticketing'
    workbook.created = new Date()

    // Sheet 1: Payment Mode Summary
    const summarySheet = workbook.addWorksheet('AGM Summary')
    summarySheet.columns = [
      { header: 'Payment Mode', key: 'paymentMode', width: 20 },
      { header: 'Bookings', key: 'bookingCount', width: 12 },
      { header: 'Total Pax', key: 'totalPax', width: 12 },
      { header: 'Total Amount (INR)', key: 'totalAmount', width: 20 },
      { header: 'Verified Amount (INR)', key: 'verifiedAmount', width: 22 },
    ]
    for (const row of byModeRes.rows) {
      summarySheet.addRow({
        paymentMode: row.paymentMode,
        bookingCount: Number(row.bookingCount),
        totalPax: Number(row.totalPax),
        totalAmount: Number(row.totalAmount),
        verifiedAmount: Number(row.verifiedAmount),
      })
    }
    summarySheet.getRow(1).font = { bold: true }

    // Sheet 2: Officer Cash Reconciliation
    const officerSheet = workbook.addWorksheet('Officer Reconciliation')
    officerSheet.columns = [
      { header: 'Collecting Officer', key: 'officerName', width: 26 },
      { header: 'Bookings', key: 'bookingCount', width: 12 },
      { header: 'Total Pax', key: 'totalPax', width: 12 },
      { header: 'Razorpay (INR)', key: 'razorpayAmount', width: 16 },
      { header: 'Cash (INR)', key: 'cashAmount', width: 16 },
      { header: 'Officer UPI (INR)', key: 'upiAmount', width: 18 },
      { header: 'Pay at Door (INR)', key: 'doorAmount', width: 18 },
      { header: 'Total Collected (INR)', key: 'totalAmount', width: 22 },
      { header: 'Verified (INR)', key: 'verifiedAmount', width: 18 },
    ]
    for (const row of byOfficerRes.rows) {
      officerSheet.addRow({
        officerName: row.officerName,
        bookingCount: Number(row.bookingCount),
        totalPax: Number(row.totalPax),
        razorpayAmount: Number(row.razorpayAmount),
        cashAmount: Number(row.cashAmount),
        upiAmount: Number(row.upiAmount),
        doorAmount: Number(row.doorAmount),
        totalAmount: Number(row.totalAmount),
        verifiedAmount: Number(row.verifiedAmount),
      })
    }
    officerSheet.getRow(1).font = { bold: true }

    // Sheet 3: Full Bookings Ledger
    const ledgerSheet = workbook.addWorksheet('Bookings Ledger')
    ledgerSheet.columns = [
      { header: 'Booking Code', key: 'bookingCode', width: 14 },
      { header: 'Event', key: 'eventName', width: 28 },
      { header: 'Holder Name', key: 'holderName', width: 26 },
      { header: 'Phone', key: 'phone', width: 16 },
      { header: 'Pax', key: 'totalPax', width: 8 },
      { header: 'Amount (INR)', key: 'totalAmount', width: 15 },
      { header: 'Payment Mode', key: 'paymentMode', width: 16 },
      { header: 'Payment Status', key: 'paymentStatus', width: 15 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Collected By', key: 'officer', width: 22 },
      { header: 'Treasurer Handover Status', key: 'settlementStatus', width: 24 },
      { header: 'Transfer Reference', key: 'transferReference', width: 24 },
      { header: 'Received At', key: 'verifiedAt', width: 22 },
    ]
    for (const b of bookingsRes.docs) {
      const ev = typeof b.event === 'object' && b.event !== null ? (b.event as Event).name : String(b.event)
      const officer =
        typeof b.collectedByOfficer === 'object' && b.collectedByOfficer !== null
          ? (b.collectedByOfficer as User).name
          : ''
      const statusLabel =
        b.settlementStatus === 'received_by_treasurer' || b.treasurerVerified
          ? 'Received by Treasurer'
          : b.settlementStatus === 'transferred_to_treasurer'
            ? 'Transferred (Awaiting Receipt)'
            : 'With Officer'
      ledgerSheet.addRow({
        bookingCode: b.bookingCode,
        eventName: ev,
        holderName: b.holderName,
        phone: b.phone,
        totalPax: b.totalPax,
        totalAmount: b.totalAmount,
        paymentMode: b.paymentMode,
        paymentStatus: b.paymentStatus,
        status: b.status,
        officer,
        settlementStatus: statusLabel,
        transferReference: b.transferReference || '',
        verifiedAt: b.treasurerVerifiedAt || '',
      })
    }
    ledgerSheet.getRow(1).font = { bold: true }

    const buffer = await workbook.xlsx.writeBuffer()
    const fileName = `aiaia-agm-finance-${scopeSlug}-${new Date().toISOString().slice(0, 10)}.xlsx`

    return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Export failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
