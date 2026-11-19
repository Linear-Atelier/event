export type PhaseOverrideStatus = 'auto' | 'force_active' | 'force_inactive'

export interface PhaseWindowInput {
  startsAt?: string | Date | null
  endsAt?: string | Date | null
  overrideStatus?: PhaseOverrideStatus | null
}

/**
 * Determines whether a ticket pricing phase is currently active.
 * - 'force_active' -> always true
 * - 'force_inactive' -> always false
 * - 'auto' (default) -> true if now is within [startsAt, endsAt] (open-ended when omitted)
 */
export function isPhaseActiveNow(
  phase: PhaseWindowInput,
  now: Date = new Date(),
): boolean {
  const mode = phase.overrideStatus || 'auto'
  if (mode === 'force_active') return true
  if (mode === 'force_inactive') return false

  const nowMs = now.getTime()
  if (phase.startsAt) {
    const startMs = new Date(phase.startsAt).getTime()
    if (!Number.isNaN(startMs) && nowMs < startMs) {
      return false
    }
  }
  if (phase.endsAt) {
    const endMs = new Date(phase.endsAt).getTime()
    if (!Number.isNaN(endMs) && nowMs > endMs) {
      return false
    }
  }
  return true
}
