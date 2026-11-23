'use client'

import React, { useMemo, useState } from 'react'
import { Calendar } from 'lucide-react'
import { EventCard, type EventListItem } from '@/components/EventCard'

export type { EventListItem }

export function EventsListClient({ events }: { events: EventListItem[] }) {
  const [filter, setFilter] = useState<'upcoming' | 'past'>('upcoming')

  const filtered = useMemo(() => {
    return events
      .filter((ev) => (filter === 'upcoming' ? !ev.isPast : ev.isPast))
      .sort((a, b) => {
        const aMs = new Date(a.date).getTime()
        const bMs = new Date(b.date).getTime()
        return filter === 'upcoming' ? aMs - bMs : bMs - aMs
      })
  }, [events, filter])

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-neutral-950">Events</h1>
      </div>

      {/* White Reference Pill Segmented Toggle */}
      <div className="grid grid-cols-2 rounded-2xl bg-neutral-100/90 p-1">
        <button
          type="button"
          onClick={() => setFilter('upcoming')}
          className={`rounded-xl py-2.5 text-xs font-bold transition ${
            filter === 'upcoming'
              ? 'bg-white text-neutral-950 shadow-xs'
              : 'text-neutral-500 hover:text-neutral-800'
          }`}
        >
          Upcoming events
        </button>
        <button
          type="button"
          onClick={() => setFilter('past')}
          className={`rounded-xl py-2.5 text-xs font-bold transition ${
            filter === 'past'
              ? 'bg-white text-neutral-950 shadow-xs'
              : 'text-neutral-500 hover:text-neutral-800'
          }`}
        >
          Past events
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <Calendar className="mx-auto h-10 w-10 text-neutral-300" />
          <p className="mt-3 text-sm font-semibold text-neutral-700">
            No {filter === 'upcoming' ? 'upcoming' : 'past'} events
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            Create events in Payload Admin (`/admin`) to see them here.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {filtered.map((ev) => (
            <EventCard key={ev.id} event={ev} />
          ))}
        </div>
      )}
    </div>
  )
}
