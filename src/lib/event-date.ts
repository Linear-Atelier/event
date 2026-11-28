export function getISTDateKey(dateInput: Date | string): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const year = parts.find((p) => p.type === 'year')?.value || ''
  const month = parts.find((p) => p.type === 'month')?.value || ''
  const day = parts.find((p) => p.type === 'day')?.value || ''
  return `${year}-${month}-${day}`
}

/**
 * Returns true if the event's calendar date (IST / Asia/Kolkata) is strictly before today.
 * Events occurring today remain upcoming/active until the end of the day.
 */
export function isEventPast(
  eventDate: string,
  now: Date = new Date(),
): boolean {
  const eventKey = getISTDateKey(eventDate)
  const todayKey = getISTDateKey(now)
  if (!eventKey || !todayKey) return false
  return eventKey < todayKey
}

/**
 * Returns true on or after the event's calendar date (IST / Asia/Kolkata).
 * Gate scanning stays disabled on days prior to the event date.
 */
export function isScanAllowedForEventDate(
  eventDate: string,
  now: Date = new Date(),
): boolean {
  const eventKey = getISTDateKey(eventDate)
  const todayKey = getISTDateKey(now)
  if (!eventKey || !todayKey) return false
  return todayKey >= eventKey
}

export function formatEventDayLabel(eventDate: string): string {
  const d = new Date(eventDate)
  if (Number.isNaN(d.getTime())) return 'event day'
  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Returns a short IST calendar-day countdown label until the event date
 * (e.g. "In 1 day", "In 12 days").
 */
export function formatDaysUntilEvent(
  eventDate: string,
  now: Date = new Date(),
): string {
  const eventKey = getISTDateKey(eventDate)
  const todayKey = getISTDateKey(now)
  if (!eventKey || !todayKey) return formatEventDayLabel(eventDate)

  const [ey, em, ed] = eventKey.split('-').map(Number)
  const [ty, tm, td] = todayKey.split('-').map(Number)
  const diffDays = Math.round(
    (Date.UTC(ey, em - 1, ed) - Date.UTC(ty, tm - 1, td)) / 86_400_000,
  )

  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'In 1 day'
  return `In ${diffDays} days`
}
