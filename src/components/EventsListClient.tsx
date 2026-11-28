'use client'

import React, { useMemo, useState } from 'react'
import { Calendar } from 'lucide-react'
import { EventCard, type EventListItem } from '@/components/EventCard'
import { EmptyState, PageHeader, SegmentedTabs } from '@/components/ui/primitives'

export type { EventListItem }

export function EventsListClient({ events }: { events: EventListItem[] }) {
  const [filter, setFilter] = useState<'upcoming' | 'past'>('upcoming')

  const upcomingCount = useMemo(() => events.filter((ev) => !ev.isPast).length, [events])
  const pastCount = useMemo(() => events.filter((ev) => ev.isPast).length, [events])

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
    <div className="space-y-5">

      <SegmentedTabs
        value={filter}
        onChange={setFilter}
        items={[
          { key: 'upcoming', label: `Upcoming (${upcomingCount})` },
          { key: 'past', label: `Past (${pastCount})` },
        ]}
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title={`No ${filter === 'upcoming' ? 'upcoming' : 'past'} events`}
          description="Create or manage events in Payload Admin (/admin) to see them here."
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((ev) => (
            <EventCard key={ev.id} event={ev} />
          ))}
        </div>
      )}
    </div>
  )
}
