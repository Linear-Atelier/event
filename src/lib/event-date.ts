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
