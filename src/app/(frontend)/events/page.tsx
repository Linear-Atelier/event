import React from 'react'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getServerUser } from '@/lib/auth'
import { EventsListClient } from '@/components/EventsListClient'

export const dynamic = 'force-dynamic'

export default async function EventsPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const payload = await getPayload({ config })
  const eventsRes = await payload.find({
    collection: 'events',
    user,
    overrideAccess: false,
    sort: '-date',
    limit: 50,
    depth: 0,
  })

  const items = await Promise.all(
    eventsRes.docs.map(async (ev) => {
      const bookings = await payload.find({
        collection: 'bookings',
        user,
        overrideAccess: false,
        where: {
          and: [
            { event: { equals: ev.id } },
            { status: { not_equals: 'cancelled' } },
          ],
        },
        limit: 1000,
        depth: 0,
      })
      return {
        id: ev.id,
        code: ev.code,
        name: ev.name,
        date: ev.date,
        venue: ev.venue,
        bookingCount: bookings.totalDocs,
        totalPax: bookings.docs.reduce((s, b) => s + (b.totalPax || 0), 0),
        totalRevenue: bookings.docs.reduce((s, b) => s + (b.totalAmount || 0), 0),
      }
    }),
  )

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <EventsListClient events={items} />
    </main>
  )
}
