import React from 'react'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getServerUser } from '@/lib/auth'
import { isEventPast, isScanAllowedForEventDate } from '@/lib/event-date'
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

  const now = new Date()

  return Promise.all(
    eventsRes.docs.map(async (ev) => {
      const bookings = await payload.find({
        collection: 'bookings',
        user,
        overrideAccess: false,
        where: {
          and: [
            { event: { equals: ev.id } },
            { status: { not_in: ['cancelled', 'pending_payment'] } },
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
        color: ev.color || 'sky',
        icon: ev.icon || null,
        iconSvg: ev.iconSvg || null,
        isPast: isEventPast(ev.date, now),
        isScanOpen: isScanAllowedForEventDate(ev.date, now),
        bookingCount: bookings.totalDocs,
        totalPax: bookings.docs.reduce((s, b) => s + (b.totalPax || 0), 0),
        totalRevenue: bookings.docs.reduce(
          (s, b) =>
            s + (b.status === 'pay_at_door' || b.paymentStatus === 'pending' ? 0 : b.totalAmount || 0),
          0,
        ),
      }
    }),
  )
}

export default async function EventsPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const items = await loadEventListItems(user)

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6 pb-24">
      <EventsListClient events={items} />
    </main>
  )
}
