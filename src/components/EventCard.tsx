import React from 'react'
import Link from 'next/link'
import { Calendar, Lock, MapPin, QrCode, Sparkles, Ticket } from 'lucide-react'
import { getEventColorTheme } from '@/lib/event-colors'
import { formatEventDayLabel } from '@/lib/event-date'

export interface EventListItem {
  id: number
  code: string
  name: string
  date: string
  venue: string
  color?: string | null
  icon?: string | null
  iconSvg?: string | null
  isPast: boolean
  isScanOpen?: boolean
  bookingCount: number
  totalPax: number
  totalRevenue: number
}

function iconifyFallbackUrl(iconId?: string | null): string | null {
  if (!iconId) return null
  const [prefix, name] = iconId.trim().split(':')
  if (!prefix || !name) return null
  return `https://api.iconify.design/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`
}

export function EventCard({ event: ev }: { event: EventListItem }) {
  const theme = getEventColorTheme(ev.color)
  const fallbackUrl = iconifyFallbackUrl(ev.icon)

  return (
    <div
      className="overflow-hidden rounded-[32px] p-[2px] shadow-sm"
      style={{ backgroundColor: theme.hex }}
    >
      {/* Top Colored Header Strip (Winter Skate Style) */}
      <div className="flex items-center justify-between gap-2 px-4 py-4 text-white">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs font-semibold sm:text-sm">
            <Calendar className="h-4 w-4 shrink-0 text-white/90" />
            <span>
              {new Date(ev.date).toLocaleString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold sm:text-sm">
            <MapPin className="h-4 w-4 shrink-0 text-white/90" />
            <span>{ev.venue}</span>
          </div>
        </div>
        <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
          {ev.code}
        </span>
      </div>

      {/* Inner Soft Tinted White Card */}
      <div className="rounded-[30px] bg-white/95 p-5 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <Link href={`/events/${ev.id}`} className="group min-w-0 flex-1">
            <div className="text-xs font-medium text-neutral-500">
              {ev.bookingCount} bookings · {ev.totalPax} pax · ₹
              {ev.totalRevenue.toLocaleString('en-IN')}
            </div>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-neutral-950 transition group-hover:opacity-80">
              {ev.name}
            </h2>
          </Link>

          {/* Dedicated Iconify SVG Icon Display Area */}
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${theme.badgeBg} ${theme.accentText}`}
            title={ev.icon || ev.name}
          >
            {ev.iconSvg ? (
              <span
                className="inline-flex h-7 w-7 items-center justify-center [&>svg]:h-7 [&>svg]:w-7"
                dangerouslySetInnerHTML={{ __html: ev.iconSvg }}
              />
            ) : fallbackUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={fallbackUrl}
                alt={ev.icon || 'Event icon'}
                className="h-7 w-7"
              />
            ) : (
              <Sparkles className="h-6 w-6" />
            )}
          </div>
        </div>

        {/* Subtle Hairline Divider */}
        <div className="my-4 border-t border-neutral-200/80" />

        {/* Bottom Row: Action Pill Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/events/${ev.id}`}
            className="flex w-full items-center justify-center rounded-full bg-white px-4 py-4 text-xs font-bold text-neutral-700 shadow-xs ring-1 ring-neutral-200/80 transition hover:bg-neutral-50"
          >
            Dashboard
          </Link>
          <Link
            href={`/desk?eventId=${ev.id}`}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white px-4 py-4 text-xs font-bold shadow-xs ring-1 ring-neutral-200/80 transition hover:bg-neutral-50 ${theme.accentText}`}
            title="New Booking"
          >
            <Ticket className="h-3.5 w-3.5" />
            Book
          </Link>
          {ev.isScanOpen === false ? (
            <button
              type="button"
              disabled
              className="flex flex-1 cursor-not-allowed items-center justify-center gap-1.5 rounded-full bg-neutral-100 px-4 py-4 text-xs font-bold text-neutral-400 ring-1 ring-neutral-200/80"
              title={`Gate scan opens on ${formatEventDayLabel(ev.date)}`}
            >
              <Lock className="h-3.5 w-3.5" />
              Scan
            </button>
          ) : (
            <Link
              href={`/scan?eventId=${ev.id}`}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-4 text-xs text-white font-bold shadow-xs transition`}
              title="Gate QR Scanner"
              style={{ backgroundColor: theme.hex }}
            >
              <QrCode className="h-3.5 w-3.5" />
              Scan
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
