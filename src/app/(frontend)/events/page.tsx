import React from 'react'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getServerUser } from '@/lib/auth'
import { isScanAllowedForEventDate } from '@/lib/event-date'
import { EventsListClient } from '@/components/EventsListClient'

export const dynamic = 'force-dynamic'

async function loadEventListItems(user: NonNullable<Awaited<ReturnType<typeof getServerUser>>>) {
  const payload = await getPayload({ config })
  const eventsRes = await payload.find({
    collection: 'events',
    user,
    overrideAccess: false,
    sort: 'date',
    limit: 50,
    depth: 0,
  })

  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000

  return Promise.all(
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
      const evMs = new Date(ev.date).getTime()
      return {
        id: ev.id,
        code: ev.code,
        name: ev.name,
        date: ev.date,
        venue: ev.venue,
        color: ev.color || 'sky',
        icon: ev.icon || null,
        iconSvg: ev.iconSvg || null,
        isPast: !Number.isNaN(evMs) && evMs < cutoffMs,
        isScanOpen: isScanAllowedForEventDate(ev.date),
        bookingCount: bookings.totalDocs,
        totalPax: bookings.docs.reduce((s, b) => s + (b.totalPax || 0), 0),
        totalRevenue: bookings.docs.reduce((s, b) => s + (b.totalAmount || 0), 0),
      }
    }),
  )
}

export default async function EventsPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const items = await loadEventListItems(user)

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <EventsListClient events={items} />
    </main>
  )
}
