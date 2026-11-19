import React from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { Calendar, CreditCard, MapPin, QrCode, Ticket, Users, ArrowRight } from 'lucide-react'
import { getServerUser } from '@/lib/auth'
import { AppNavbar, PageFooter } from '@/components/AppNavbar'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const user = await getServerUser()
  if (!user) {
    redirect('/login')
  }

  const payload = await getPayload({ config })
  const eventsRes = await payload.find({
    collection: 'events',
    user,
    overrideAccess: false,
    sort: '-date',
    limit: 50,
    depth: 0,
  })

  // Quick counts per event
  const eventStats = await Promise.all(
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
      const totalPax = bookings.docs.reduce((sum, b) => sum + (b.totalPax || 0), 0)
      const totalRevenue = bookings.docs.reduce((sum, b) => sum + (b.totalAmount || 0), 0)
      return {
        event: ev,
        bookingCount: bookings.totalDocs,
        totalPax,
        totalRevenue,
      }
    }),
  )

  return (
    <div className="flex min-h-screen flex-col">
      <AppNavbar user={user} />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Committee Operations Hub
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Universal read transparency across all AIAIA Cochin Branch events, bookings, seating &amp; finances.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/desk"
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700"
            >
              <Ticket className="h-4 w-4" />
              Open Booking Desk
            </Link>
            <Link
              href="/finance"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <CreditCard className="h-4 w-4" />
              Treasurer Finance
            </Link>
            <Link
              href="/scan"
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              <QrCode className="h-4 w-4" />
              Launch Gate PWA
            </Link>
          </div>
        </div>

        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
            Active &amp; Upcoming Events ({eventStats.length})
          </h2>

          {eventStats.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
              <Calendar className="mx-auto h-10 w-10 text-slate-400" />
              <h3 className="mt-3 text-base font-semibold text-slate-900">No events yet</h3>
              <p className="mt-1 text-sm text-slate-500">
                Create an event in Payload Admin (`/admin`) or run the seed script to load demo data.
              </p>
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {eventStats.map(({ event, bookingCount, totalPax, totalRevenue }) => (
                <Link
                  key={event.id}
                  href={`/events/${event.id}`}
                  className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-sky-400 hover:shadow-md"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-md bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
                        {event.code}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(event.date).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </div>

                    <h3 className="mt-3 text-lg font-bold text-slate-900 group-hover:text-sky-700">
                      {event.name}
                    </h3>

                    <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
                      <MapPin className="h-3.5 w-3.5 text-slate-400" />
                      {event.venue}
                    </div>
                  </div>

                  <div className="mt-5 border-t border-slate-100 pt-4">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-slate-50 p-2">
                        <div className="text-[11px] text-slate-500">Bookings</div>
                        <div className="text-sm font-bold text-slate-900">{bookingCount}</div>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2">
                        <div className="text-[11px] text-slate-500">Total Pax</div>
                        <div className="flex items-center justify-center gap-1 text-sm font-bold text-slate-900">
                          <Users className="h-3.5 w-3.5 text-sky-600" />
                          {totalPax}
                        </div>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2">
                        <div className="text-[11px] text-slate-500">Revenue</div>
                        <div className="text-sm font-bold text-emerald-700">
                          ₹{totalRevenue.toLocaleString('en-IN')}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-end gap-1 text-xs font-semibold text-sky-600">
                      Open Event Dashboard
                      <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>

      <PageFooter />
    </div>
  )
}
