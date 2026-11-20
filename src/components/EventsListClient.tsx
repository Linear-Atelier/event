'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { Calendar, MapPin, QrCode, Ticket, Users } from 'lucide-react'

export interface EventListItem {
  id: number
  code: string
  name: string
  date: string
  venue: string
  bookingCount: number
  totalPax: number
  totalRevenue: number
}

export function EventsListClient({ events }: { events: EventListItem[] }) {
  const [filter, setFilter] = useState<'upcoming' | 'past'>('upcoming')

  const filtered = useMemo(() => {
    const now = Date.now()
    return events.filter((ev) => {
      const evMs = new Date(ev.date).getTime()
      const isPast = !Number.isNaN(evMs) && evMs < now - 24 * 60 * 60 * 1000
      return filter === 'upcoming' ? !isPast : isPast
    })
  }, [events, filter])

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-950">Events</h1>
      </div>

      {/* White Reference Pill Segmented Toggle */}
      <div className="grid grid-cols-2 rounded-2xl bg-slate-100/90 p-1">
        <button
          type="button"
          onClick={() => setFilter('upcoming')}
          className={`rounded-xl py-2.5 text-xs font-bold transition ${
            filter === 'upcoming'
              ? 'bg-white text-slate-950 shadow-xs'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          Future events
        </button>
        <button
          type="button"
          onClick={() => setFilter('past')}
          className={`rounded-xl py-2.5 text-xs font-bold transition ${
            filter === 'past'
              ? 'bg-white text-slate-950 shadow-xs'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          Past events
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <Calendar className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">
            No {filter === 'upcoming' ? 'upcoming' : 'past'} events
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Create events in Payload Admin (`/admin`) to see them here.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {filtered.map((ev) => (
            <div
              key={ev.id}
              className="overflow-hidden rounded-3xl bg-slate-50/70 p-5 transition hover:bg-slate-50"
            >
              {/* Frosted Dark Header Banner Accent */}
              <div className="glass-surface mb-4 flex items-center justify-between rounded-2xl px-4 py-3.5 text-white">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-sky-300">
                    {ev.code}
                  </span>
                  <div className="mt-0.5 text-sm font-bold">{ev.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-extrabold text-emerald-300">
                    ₹{ev.totalRevenue.toLocaleString('en-IN')}
                  </div>
                  <div className="text-[10px] text-slate-300">
                    {ev.bookingCount} bookings
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 px-1">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <MapPin className="h-3.5 w-3.5 text-slate-400" />
                  {ev.venue}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">
                    {new Date(ev.date).toLocaleString('en-IN', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                    <Users className="h-3.5 w-3.5 text-sky-600" />
                    {ev.totalPax} pax
                  </span>
                </div>
              </div>

              {/* Ticket Perforation Divider */}
              <div className="ticket-perforation my-4" />

              {/* Bottom Action Bar (Matching White Screenshot) */}
              <div className="flex items-center gap-2">
                <Link
                  href={`/events/${ev.id}`}
                  className="flex-1 rounded-2xl bg-white py-2.5 text-center text-xs font-bold text-sky-700 shadow-xs transition hover:bg-sky-50"
                >
                  Open Event Dashboard
                </Link>
                <Link
                  href={`/desk?eventId=${ev.id}`}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-xs transition hover:bg-slate-100"
                  title="New Booking"
                >
                  <Ticket className="h-4 w-4" />
                </Link>
                <Link
                  href={`/scan?eventId=${ev.id}`}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-100 text-sky-700 transition hover:bg-sky-200"
                  title="Gate QR Scanner"
                >
                  <QrCode className="h-4 w-4" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
