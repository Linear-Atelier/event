'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { Calendar, MapPin, QrCode, Ticket, Users } from 'lucide-react'
import { getEventColorTheme } from '@/lib/event-colors'

export interface EventListItem {
  id: number
  code: string
  name: string
  date: string
  venue: string
  color?: string | null
  isPast: boolean
  bookingCount: number
  totalPax: number
  totalRevenue: number
}

export function EventsListClient({ events }: { events: EventListItem[] }) {
  const [filter, setFilter] = useState<'upcoming' | 'past'>('upcoming')

  const filtered = useMemo(() => {
    return events.filter((ev) => (filter === 'upcoming' ? !ev.isPast : ev.isPast))
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
          className={`rounded-xl py-2.5 text-xs font-bold transition ${filter === 'upcoming'
            ? 'bg-white text-slate-950 shadow-xs'
            : 'text-slate-500 hover:text-slate-800'
            }`}
        >
          Upcoming events
        </button>
        <button
          type="button"
          onClick={() => setFilter('past')}
          className={`rounded-xl py-2.5 text-xs font-bold transition ${filter === 'past'
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
          {filtered.map((ev) => {
            const theme = getEventColorTheme(ev.color)
            return (
              <div
                key={ev.id}
                className={`flex flex-col gap-4 overflow-hidden rounded-3xl border p-5 ${theme.cardBg} ${theme.cardBorder}`}
              >
                {/* Header */}
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-bold text-slate-950">{ev.name}</div>
                    <span
                      className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${theme.badgeBg} ${theme.badgeText}`}
                    >
                      {ev.code}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-extrabold text-slate-950">
                      ₹{ev.totalRevenue.toLocaleString('en-IN')}
                    </div>
                    <div className="text-[10px] text-neutral-600">
                      {ev.bookingCount} bookings
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5 px-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <MapPin className={`h-3.5 w-3.5 ${theme.iconText}`} />
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
                      <Users className={`h-3.5 w-3.5 ${theme.iconText}`} />
                      {ev.totalPax} pax
                    </span>
                  </div>
                </div>

                {/* Bottom Action Bar */}
                <div className="flex flex-wrap items-stretch gap-2">
                  <Link
                    href={`/events/${ev.id}`}
                    className={`flex-1 whitespace-nowrap rounded-2xl bg-white p-4 text-center text-sm font-bold shadow-xs transition hover:bg-white/80 `}
                  >
                    View Dashboard
                  </Link>
                  <Link
                    href={`/desk?eventId=${ev.id}`}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white p-4 shadow-xs transition hover:bg-white/80 ${theme.accentText}`}
                    title="New Booking"
                  >
                    <Ticket className="h-5 w-5" /> Book
                  </Link>
                  <Link
                    href={`/scan?eventId=${ev.id}`}
                    className={`flex w-full flex-1 items-center justify-center gap-2 rounded-2xl p-4 text-white transition hover:bg-neutral-800`}
                    style={{ backgroundColor: `${theme.hex}` }}
                    title="Gate QR Scanner"
                  >
                    <QrCode className="h-5 w-5" /> Scan
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
