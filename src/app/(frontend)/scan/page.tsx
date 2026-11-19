import React from 'react'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getServerUser, userHasRole } from '@/lib/auth'
import { AppNavbar, PageFooter } from '@/components/AppNavbar'
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
    sort: '-date',
    limit: 50,
    depth: 0,
  })

  const initialEventId = sp.eventId ? Number(sp.eventId) : eventsRes.docs[0]?.id || null
  const canScan = userHasRole(user, ['gate_staff', 'booking_officer', 'super_admin'])

  return (
    <div className="flex min-h-screen flex-col">
      <AppNavbar user={user} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <GateScannerClient
          events={eventsRes.docs.map((e) => ({
            id: e.id,
            code: e.code,
            name: e.name,
            date: e.date,
            venue: e.venue,
          }))}
          initialEventId={initialEventId}
          canScan={canScan}
        />
      </main>
      <PageFooter />
    </div>
  )
}
