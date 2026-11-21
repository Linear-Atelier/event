import React from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import {
  ArrowUpRight,
  Calendar,
  MapPin,
  QrCode,
  Ticket,
  Wallet,
} from 'lucide-react'
import { getServerUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const user = await getServerUser()
  if (!user) {
    redirect('/login')
  }

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
      where: { status: { not_equals: 'cancelled' } },
      limit: 2000,
      depth: 0,
    }),
  ])

  const totalBookings = bookingsRes.totalDocs
  const totalPax = bookingsRes.docs.reduce((sum, b) => sum + (b.totalPax || 0), 0)
  const totalRevenue = bookingsRes.docs.reduce((sum, b) => sum + (b.totalAmount || 0), 0)
  const nextEvent = eventsRes.docs[0] || null
  const firstName = (user.name || user.email || 'Committee').split(' ')[0]

  const tiles = [
    {
      href: '/events',
      label: 'Events',
      subtitle: `${eventsRes.totalDocs} active`,
      icon: Calendar,
      accent: 'from-slate-900 via-slate-900 to-sky-950',
      iconBg: 'bg-sky-500/20 text-sky-300',
    },
    {
      href: '/desk',
      label: 'Booking',
      subtitle: `${totalBookings} bookings · ${totalPax} pax`,
      icon: Ticket,
      accent: 'from-slate-900 via-slate-900 to-indigo-950',
      iconBg: 'bg-indigo-500/20 text-indigo-300',
    },
    {
      href: '/scan',
      label: 'Gate',
      subtitle: 'QR scan & walk-ins',
      icon: QrCode,
      accent: 'from-slate-900 via-slate-900 to-emerald-950',
      iconBg: 'bg-emerald-500/20 text-emerald-300',
    },
    {
      href: '/finance',
      label: 'Finance',
      subtitle: `₹${totalRevenue.toLocaleString('en-IN')} collected`,
      icon: Wallet,
      accent: 'from-slate-900 via-slate-900 to-amber-950',
      iconBg: 'bg-amber-500/20 text-amber-300',
    },
  ]

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-8 pt-6">
      {/* Clean White App Greeting */}
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            AIAIA Cochin Branch
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">
            Hello, {firstName}
          </h1>
        </div>
        {/* {nextEvent && (
            <Link
              href={`/events/${nextEvent.id}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
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
                <div className="mt-0.5 text-xs font-medium text-slate-300/80">
                  {tile.subtitle}
                </div>
              </div>
            </Link>
          )
        })}
      </section>

      {/* Featured Next Event Pass (Dark Frosted Glass Accent Card) */}
      {nextEvent && (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Next Live Event
            </h2>
            <Link
              href="/events"
              className="text-xs font-semibold text-sky-600 hover:text-sky-700"
            >
              All events →
            </Link>
          </div>

          <div className="glass-surface relative overflow-hidden rounded-3xl p-5 text-white shadow-xl">
            <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-sky-500/15 blur-2xl" />

            <div className="relative flex items-start justify-between gap-3">
              <div>
                <span className="inline-block rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold tracking-wider text-sky-300 backdrop-blur-md">
                  {nextEvent.code}
                </span>
                <h3 className="mt-2.5 text-lg font-bold tracking-tight text-white">
                  {nextEvent.name}
                </h3>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-300">
                  <MapPin className="h-3.5 w-3.5 text-sky-400" />
                  {nextEvent.venue}
                </div>
                <div className="mt-2 text-xs font-medium text-slate-400">
                  {new Date(nextEvent.date).toLocaleString('en-IN', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            </div>

            <div className="my-4 border-t border-dashed border-white/15" />

            <div className="relative flex items-stretch justify-between gap-2.5">
              <Link
                href={`/events/${nextEvent.id}`}
                className="flex-1 flex gap-1 items-center justify-center rounded-2xl bg-white py-3 text-center text-sm font-bold text-slate-950 shadow-sm transition hover:bg-slate-100"
              >
                Event Dashboard
              </Link>
              <Link
                href={`/scan?eventId=${nextEvent.id}`}
                className="flex-1 flex gap-1 items-center justify-center py-3 rounded-2xl border border-white/15 bg-white/10 text-sky-300 backdrop-blur-md transition hover:bg-white/20"
                title="Open Gate QR Scanner"
              >
                <QrCode className="h-5 w-5" /> Scan
              </Link>
            </div>
          </div>
        </section>
      )}
    </main>
  )
}
