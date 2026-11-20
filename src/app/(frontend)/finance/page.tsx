import React from 'react'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getServerUser, userHasRole } from '@/lib/auth'
import { FinanceClient, type SettlementStatus } from '@/components/FinanceClient'
import type { Event, User } from '@/payload-types'

export const dynamic = 'force-dynamic'

export default async function FinancePage(props: {
  searchParams: Promise<{ eventId?: string }>
}) {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const sp = await props.searchParams
  const initialEventId = sp.eventId ? Number(sp.eventId) : null
  const payload = await getPayload({ config })

  const [eventsRes, bookingsRes] = await Promise.all([
    payload.find({
      collection: 'events',
      user,
      overrideAccess: false,
      sort: '-date',
      limit: 50,
      depth: 0,
    }),
    payload.find({
      collection: 'bookings',
      user,
      overrideAccess: false,
      sort: '-createdAt',
      limit: 2000,
      depth: 1,
    }),
  ])

  const canConfirmReceived = userHasRole(user, ['treasurer', 'super_admin'])
  const canMarkTransferred = userHasRole(user, [
    'booking_officer',
    'gate_staff',
    'treasurer',
    'super_admin',
  ])

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <FinanceClient
          events={eventsRes.docs.map((e) => ({
            id: e.id,
            code: e.code,
            name: e.name,
          }))}
          initialEventId={initialEventId}
          canConfirmReceived={canConfirmReceived}
          canMarkTransferred={canMarkTransferred}
          bookings={bookingsRes.docs.map((b) => {
            const evId = typeof b.event === 'object' ? (b.event as Event).id : b.event
            const officer =
              typeof b.collectedByOfficer === 'object' && b.collectedByOfficer !== null
                ? (b.collectedByOfficer as User).name
                : 'Unassigned'
            const settlementStatus: SettlementStatus =
              b.settlementStatus === 'received_by_treasurer' || b.treasurerVerified
                ? 'received_by_treasurer'
                : b.settlementStatus === 'transferred_to_treasurer'
                  ? 'transferred_to_treasurer'
                  : 'with_officer'

            return {
              id: b.id,
              eventId: evId,
              bookingCode: b.bookingCode,
              holderName: b.holderName,
              phone: b.phone,
              totalPax: b.totalPax,
              totalAmount: b.totalAmount,
              paymentMode: b.paymentMode,
              paymentStatus: b.paymentStatus,
              status: b.status,
              officerName: officer,
              settlementStatus,
              transferReference: b.transferReference || null,
              transferredAt: b.transferredAt || null,
              receivedAt: b.treasurerVerifiedAt || null,
              createdAt: b.createdAt,
            }
          })}
      />
    </main>
  )
}
