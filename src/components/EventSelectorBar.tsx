'use client'

import React from 'react'
import { Calendar } from 'lucide-react'

export interface EventSelectorOption {
  id: number
  code: string
  name: string
}

export function EventSelectorBar({
  events,
  value,
  onChange,
  label = 'Event',
  tone = 'light',
}: {
  events: EventSelectorOption[]
  value: number
  onChange: (eventId: number) => void
  label?: string
  tone?: 'light' | 'dark'
}) {
  const isDark = tone === 'dark'

  return (
    <div className="w-full">
      {label && (
        <label
          className={`mb-1.5 flex items-center gap-1.5 text-sm font-bold ${
            isDark ? 'text-neutral-200' : 'text-neutral-800'
          }`}
        >
          <Calendar className="h-4 w-4" />
          {label}
        </label>
      )}
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`min-h-12 w-full rounded-xl border px-3.5 py-2.5 text-base font-bold transition focus:outline-none focus:ring-2 ${
          isDark
            ? 'border-neutral-700 bg-neutral-900 text-white focus:border-white focus:ring-white/25'
            : 'border-neutral-300 bg-white text-neutral-950 focus:border-neutral-950 focus:ring-neutral-950/15'
        }`}
      >
        {events.map((ev) => (
          <option key={ev.id} value={ev.id}>
            {ev.name} ({ev.code})
          </option>
        ))}
      </select>
    </div>
  )
}
