import React from 'react'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getServerUser, userHasRole } from '@/lib/auth'
import { getISTDateKey, isScanAllowedForEventDate } from '@/lib/event-date'
import { GateScannerClient } from '@/components/GateScannerClient'

export const dynamic = 'force-dynamic'

export default async function GateScanPage(props: {
  searchParams: Promise<{ eventId?: string }>
}) {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const sp = await props.searchParams
  const payload = await getPayload({ config })

  const eventsRes = await payload.find({
    collection: 'events',
    user,
    overrideAccess: false,
    sort: 'date',
    limit: 50,
    depth: 0,
  })

  const todayKey = getISTDateKey(new Date())
  const nextUpcomingEvent =
    eventsRes.docs.find((e) => {
      const evKey = getISTDateKey(e.date)
      return !evKey || evKey >= todayKey
    }) ||
    eventsRes.docs[eventsRes.docs.length - 1] ||
    null

  const initialEventId = sp.eventId ? Number(sp.eventId) : nextUpcomingEvent?.id || null
  const canScan = userHasRole(user, ['gate_staff', 'booking_officer', 'super_admin'])

  return (
    <main className="mx-auto w-full max-w-5xl">
      <GateScannerClient
        events={eventsRes.docs.map((e) => ({
          id: e.id,
          code: e.code,
          name: e.name,
          date: e.date,
          venue: e.venue,
          isScanOpen: isScanAllowedForEventDate(e.date),
        }))}
        initialEventId={initialEventId}
        canScan={canScan}
      />
    </main>
  )
}
