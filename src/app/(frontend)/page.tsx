import React from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import {
  ArrowRight,
  Calendar,
  QrCode,
  Ticket,
  Wallet,
} from 'lucide-react'
import { getServerUser } from '@/lib/auth'
import { isEventPast, isScanAllowedForEventDate } from '@/lib/event-date'
import { getFinancialYearForDate } from '@/lib/financial-year'
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
      where: { status: { not_equals: 'pending_payment' } },
      limit: 2000,
      depth: 0,
    }),
  ])

  const getNetAmt = (b: (typeof bookingsRes.docs)[number]) => {
    if (b.status === 'pay_at_door' || b.paymentStatus === 'pending') return 0
    return b.status === 'cancelled'
      ? Math.max(0, (Number(b.paidAmount) || 0) - (Number(b.refundAmount) || 0))
      : b.totalAmount || 0
  }

  const now = new Date()
  const currentFy = getFinancialYearForDate(now)
  const fyEventIds = new Set(
    eventsRes.docs
      .filter((ev) => getFinancialYearForDate(ev.date).code === currentFy.code)
      .map((ev) => ev.id),
  )
  const fyBookings = bookingsRes.docs.filter((b) => {
    const evId = typeof b.event === 'object' ? b.event.id : b.event
    return fyEventIds.has(evId)
  })
  const activeFyBookings = fyBookings.filter((b) => b.status !== 'cancelled')

  const upcomingEvents = eventsRes.docs.filter((ev) => !isEventPast(ev.date, now))
  const nextEventDoc = upcomingEvents[0] || null

  let nextEvent: EventListItem | null = null
  if (nextEventDoc) {
    const evBookings = bookingsRes.docs.filter((b) => {
      const evId = typeof b.event === 'object' ? b.event.id : b.event
      return evId === nextEventDoc.id
    })
    const activeEvBookings = evBookings.filter((b) => b.status !== 'cancelled')
    nextEvent = {
      id: nextEventDoc.id,
      code: nextEventDoc.code,
      name: nextEventDoc.name,
      date: nextEventDoc.date,
      venue: nextEventDoc.venue,
      color: nextEventDoc.color || 'sky',
      icon: nextEventDoc.icon || null,
      iconSvg: nextEventDoc.iconSvg || null,
      isPast: isEventPast(nextEventDoc.date, now),
      isScanOpen: isScanAllowedForEventDate(nextEventDoc.date, now),
      bookingCount: activeEvBookings.length,
      totalPax: activeEvBookings.reduce((sum, b) => sum + (b.totalPax || 0), 0),
      totalRevenue: evBookings.reduce((sum, b) => sum + getNetAmt(b), 0),
    }
  }

  return {
    fyCode: currentFy.code,
    eventsCount: fyEventIds.size,
    totalBookings: activeFyBookings.length,
    totalPax: activeFyBookings.reduce((sum, b) => sum + (b.totalPax || 0), 0),
    totalRevenue: fyBookings.reduce((sum, b) => sum + getNetAmt(b), 0),
    nextEvent,
  }
}

export default async function HomePage() {
  const user = await getServerUser()
  if (!user) {
    redirect('/login')
  }

  const { fyCode, eventsCount, totalBookings, totalPax, totalRevenue, nextEvent } =
    await loadHomeData(user)

  const tiles = [
    {
      href: '/events',
      label: 'Events',
      subtitle: `${eventsCount} in ${fyCode}`,
      icon: Calendar,
    },
    {
      href: '/desk',
      label: 'Book Tickets',
      subtitle: `${totalBookings} bookings · ${totalPax} guests`,
      icon: Ticket,
    },
    {
      href: '/scan',
      label: 'Gate Scan',
      subtitle: 'QR scan & check-in',
      icon: QrCode,
    },
    {
      href: '/finance',
      label: 'Finance',
      subtitle: `₹${totalRevenue.toLocaleString('en-IN')} · ${fyCode}`,
      icon: Wallet,
    },
  ]

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-5 sm:px-6 pb-24">
      {/* Next Upcoming Event */}
      <section aria-label="Next Upcoming Event">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-neutral-700">
            Next Upcoming Event
          </h2>
          <Link
            href="/events"
            className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2.5 text-sm font-bold text-neutral-900 transition hover:bg-neutral-200/70"
          >
            All events
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {nextEvent ? (
          <EventCard event={nextEvent} />
        ) : (
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-5 py-8 text-center">
            <Calendar className="mx-auto h-9 w-9 text-neutral-400" />
            <p className="mt-2.5 text-base font-bold text-neutral-900">
              No upcoming events scheduled
            </p>
            <p className="mt-1 text-sm text-neutral-600">
              View past events or add a new event in Admin.
            </p>
            <Link
              href="/events"
              className="mt-4 inline-flex min-h-12 items-center justify-center rounded-xl border border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-900 transition hover:bg-neutral-100"
            >
              View All Events
            </Link>
          </div>
        )}
      </section>

      {/* Primary Quick Actions (Clean 2x2 Grid) */}
      <section aria-label="Main Actions">
        <h2 className="mb-2.5 text-sm font-bold uppercase tracking-wide text-neutral-700">
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {tiles.map((tile) => {
            const Icon = tile.icon
            return (
              <Link
                key={tile.href}
                href={tile.href}
                className="group flex min-h-[132px] flex-col justify-between rounded-2xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-400 active:bg-neutral-50 sm:p-5"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-100 text-neutral-900 transition group-hover:bg-neutral-900 group-hover:text-white">
                    <Icon className="h-5 w-5" />
                  </span>
                  <ArrowRight className="h-4 w-4 text-neutral-400 transition group-hover:translate-x-0.5 group-hover:text-neutral-900" />
                </div>

                <div className="mt-4">
                  <div className="text-lg font-extrabold tracking-tight text-neutral-950">
                    {tile.label}
                  </div>
                  <div className="mt-0.5 text-sm font-medium text-neutral-600 tabular-nums">
                    {tile.subtitle}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </section>
    </main>
  )
}
