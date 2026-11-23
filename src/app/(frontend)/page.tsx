import React from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import {
  ArrowUpRight,
  Calendar,
  QrCode,
  Ticket,
  Wallet,
} from 'lucide-react'
import { getServerUser } from '@/lib/auth'
import { isScanAllowedForEventDate } from '@/lib/event-date'
import { EventCard, type EventListItem } from '@/components/EventCard'

export const dynamic = 'force-dynamic'

async function loadHomeData(user: NonNullable<Awaited<ReturnType<typeof getServerUser>>>) {
  const payload = await getPayload({ config })
  const [eventsRes, bookingsRes] = await Promise.all([
    payload.find({
      collection: 'events',
      user,
      overrideAccess: false,
      sort: 'date',
      limit: 50,
      depth: 0,
    }),
    payload.find({
      collection: 'bookings',
      user,
      overrideAccess: false,
      where: { status: { not_equals: 'cancelled' } },
      limit: 2000,
      depth: 0,
    }),
  ])

  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000
  const upcomingEvents = eventsRes.docs.filter((ev) => {
    const ms = new Date(ev.date).getTime()
    return Number.isNaN(ms) || ms >= cutoffMs
  })
  const nextEventDoc = upcomingEvents[0] || eventsRes.docs[eventsRes.docs.length - 1] || null

  let nextEvent: EventListItem | null = null
  if (nextEventDoc) {
    const evBookings = bookingsRes.docs.filter((b) => {
      const evId = typeof b.event === 'object' ? b.event.id : b.event
      return evId === nextEventDoc.id
    })
    const evMs = new Date(nextEventDoc.date).getTime()
    nextEvent = {
      id: nextEventDoc.id,
      code: nextEventDoc.code,
      name: nextEventDoc.name,
      date: nextEventDoc.date,
      venue: nextEventDoc.venue,
      color: nextEventDoc.color || 'sky',
      icon: nextEventDoc.icon || null,
      iconSvg: nextEventDoc.iconSvg || null,
      isPast: !Number.isNaN(evMs) && evMs < cutoffMs,
      isScanOpen: isScanAllowedForEventDate(nextEventDoc.date),
      bookingCount: evBookings.length,
      totalPax: evBookings.reduce((sum, b) => sum + (b.totalPax || 0), 0),
      totalRevenue: evBookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0),
    }
  }

  return {
    eventsCount: eventsRes.totalDocs,
    totalBookings: bookingsRes.totalDocs,
    totalPax: bookingsRes.docs.reduce((sum, b) => sum + (b.totalPax || 0), 0),
    totalRevenue: bookingsRes.docs.reduce((sum, b) => sum + (b.totalAmount || 0), 0),
    nextEvent,
  }
}

export default async function HomePage() {
  const user = await getServerUser()
  if (!user) {
    redirect('/login')
  }

  const { eventsCount, totalBookings, totalPax, totalRevenue, nextEvent } =
    await loadHomeData(user)
  const firstName = (user.name || user.email || 'Committee').split(' ')[0]

  const tiles = [
    {
      href: '/events',
      label: 'Events',
      subtitle: `${eventsCount} active`,
      icon: Calendar,
      accent: 'from-neutral-900 via-neutral-900 to-neutral-950',
      iconBg: 'bg-white/15 text-white',
    },
    {
      href: '/desk',
      label: 'Booking',
      subtitle: `${totalBookings} bookings · ${totalPax} pax`,
      icon: Ticket,
      accent: 'from-neutral-900 via-neutral-900 to-neutral-950',
      iconBg: 'bg-white/15 text-white',
    },
    {
      href: '/scan',
      label: 'Gate',
      subtitle: 'QR scan & walk-ins',
      icon: QrCode,
      accent: 'from-neutral-900 via-neutral-900 to-neutral-950',
      iconBg: 'bg-white/15 text-white',
    },
    {
      href: '/finance',
      label: 'Finance',
      subtitle: `₹${totalRevenue.toLocaleString('en-IN')} collected`,
      icon: Wallet,
      accent: 'from-neutral-900 via-neutral-900 to-neutral-950',
      iconBg: 'bg-white/15 text-white',
    },
  ]

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-8 pt-6">
      {/* Clean White App Greeting */}
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            AIAIA Cochin Branch
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-neutral-950">
            Hello, {firstName}
          </h1>
        </div>
        {/* {nextEvent && (
            <Link
              href={`/events/${nextEvent.id}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-200"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="max-w-[140px] truncate">{nextEvent.code}</span>
            </Link>
          )} */}
      </div>

      {/* 4 Big App Launcher Buttons (2x2 Bento Grid with Frosted Glass Accents) */}
      <section aria-label="Main Actions" className="grid grid-cols-2 gap-3.5 sm:gap-4">
        {tiles.map((tile) => {
          const Icon = tile.icon
          return (
            <Link
              key={tile.href}
              href={tile.href}
              className={`group relative flex min-h-[156px] flex-col justify-between overflow-hidden rounded-3xl bg-gradient-to-br ${tile.accent} p-5 text-white shadow-lg transition duration-200 hover:-translate-y-0.5 hover:shadow-xl active:scale-[0.98] sm:min-h-[176px]`}
            >
              {/* Subtle glass highlight */}
              <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/5 blur-2xl" />

              <div className="flex items-start justify-between">
                {/* <div
                    className={`flex h-12 w-12 items-center justify-center rounded-2xl backdrop-blur-md ${tile.iconBg}`}
                  >
                    <Icon className="h-6 w-6" />
                  </div> */}
                <ArrowUpRight className="h-4 w-4 text-white/40 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-white" />
              </div>
              <Icon className="h-30 w-30 absolute right-2 top-2 opacity-20 stroke-1" />

              <div className="mt-6">
                <div className="text-xl font-bold tracking-tight text-white">
                  {tile.label}
                </div>
                <div className="mt-0.5 text-xs font-medium text-neutral-300/80">
                  {tile.subtitle}
                </div>
              </div>
            </Link>
          )
        })}
      </section>

      {/* Next Upcoming Event (Shared EventCard) */}
      {nextEvent && (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
              Next Upcoming Event
            </h2>
            <Link
              href="/events"
              className="text-xs font-semibold text-neutral-700 hover:text-neutral-900"
            >
              All events →
            </Link>
          </div>

          <EventCard event={nextEvent} />
        </section>
      )}
    </main>
  )
}
