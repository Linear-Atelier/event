import {
  offlineDb,
  type CachedBooking,
  type CachedEvent,
  type CachedSlot,
  type CachedTicket,
} from '../lib/offline-db'

const AUTO_SYNC_INTERVAL_MS = 60_000

export type GateSyncWorkerInMessage =
  | { type: 'CONFIGURE'; eventId: number; isOnline: boolean }
  | { type: 'SYNC_NOW'; eventId: number; manual: boolean }

export type GateSyncWorkerOutMessage =
  | { type: 'SYNC_START'; eventId: number; manual: boolean }
  | {
      type: 'SYNC_COMPLETE'
      eventId: number
      cachedEvent: CachedEvent | null
      bookingCount: number
      slotCount: number
      pendingCount: number
      pushedCount: number
      alreadyLocked: number
      manual: boolean
      syncedAt: string
    }
  | { type: 'SYNC_ERROR'; eventId: number; error: string; manual: boolean }

let activeEventId = 0
let online = true
let isSyncing = false
let intervalHandle: ReturnType<typeof setInterval> | null = null

function postMsg(msg: GateSyncWorkerOutMessage) {
  self.postMessage(msg)
}

async function runFullSync(eventId: number, manual: boolean) {
  if (!eventId || !online || isSyncing) return
  isSyncing = true
  postMsg({ type: 'SYNC_START', eventId, manual })

  try {
    let pushedCount = 0
    let alreadyLocked = 0

    // Phase 1: Push pending offline check-ins to server (idempotent)
    const pending = await offlineDb.pendingSync.where('synced').equals(0).toArray()
    if (pending.length > 0) {
      const pushRes = await fetch('/api/sync/checkins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          checkins: pending.map((p) => ({
            slotId: p.slotId,
            checkedInAt: p.checkedInAt,
            deviceId: p.deviceId,
            method: p.method,
          })),
        }),
      })

      if (pushRes.ok) {
        const pushData = (await pushRes.json()) as {
          synced?: number
          alreadyLocked?: number
        }
        pushedCount = pushData.synced || 0
        alreadyLocked = pushData.alreadyLocked || 0
        const ids = pending.map((p) => p.id!).filter(Boolean)
        if (ids.length > 0) {
          await offlineDb.pendingSync.where('id').anyOf(ids).modify({ synced: 1 })
        }
      } else if (manual) {
        const errData = (await pushRes.json().catch(() => ({}))) as { error?: string }
        throw new Error(errData.error || `Check-in sync failed (HTTP ${pushRes.status})`)
      }
    }

    // Phase 2: Pull latest event roster, bookings, tickets, and slots
    const rosterRes = await fetch(`/api/sync/roster?eventId=${eventId}`, {
      credentials: 'include',
    })
    const rosterData = (await rosterRes.json().catch(() => ({}))) as {
      error?: string
      event?: CachedEvent
      bookings?: CachedBooking[]
      tickets?: CachedTicket[]
      slots?: CachedSlot[]
    }

    if (!rosterRes.ok || !rosterData.event) {
      throw new Error(rosterData.error || `Roster sync failed (HTTP ${rosterRes.status})`)
    }

    // Preserve any local check-ins that are still unsynced (e.g. checked in mid-sync)
    const stillPending = await offlineDb.pendingSync.where('synced').equals(0).toArray()
    const pendingBySlotId = new Map(stillPending.map((p) => [p.slotId, p]))

    const mergedSlots: CachedSlot[] = (rosterData.slots || []).map((slot) => {
      const localPending = pendingBySlotId.get(slot.id)
      if (localPending && !slot.checkedInAt) {
        return {
          ...slot,
          checkedInAt: localPending.checkedInAt,
          deviceId: localPending.deviceId,
          method: localPending.method,
        }
      }
      return slot
    })

    await offlineDb.transaction(
      'rw',
      [offlineDb.events, offlineDb.bookings, offlineDb.tickets, offlineDb.slots],
      async () => {
        await offlineDb.events.put(rosterData.event!)
        const oldBookings = await offlineDb.bookings
          .where('eventId')
          .equals(eventId)
          .toArray()
        const oldIds = oldBookings.map((b) => b.id)
        if (oldIds.length > 0) {
          await offlineDb.bookings.bulkDelete(oldIds)
          await offlineDb.tickets.where('bookingId').anyOf(oldIds).delete()
          await offlineDb.slots.where('bookingId').anyOf(oldIds).delete()
        }
        if (rosterData.bookings?.length) {
          await offlineDb.bookings.bulkPut(rosterData.bookings)
        }
        if (rosterData.tickets?.length) {
          await offlineDb.tickets.bulkPut(rosterData.tickets)
        }
        if (mergedSlots.length) {
          await offlineDb.slots.bulkPut(mergedSlots)
        }
      },
    )

    const [cachedEvent, bookingCount, pendingCount] = await Promise.all([
      offlineDb.events.get(eventId),
      offlineDb.bookings.where('eventId').equals(eventId).count(),
      offlineDb.pendingSync.where('synced').equals(0).count(),
    ])

    postMsg({
      type: 'SYNC_COMPLETE',
      eventId,
      cachedEvent: cachedEvent || null,
      bookingCount,
      slotCount: mergedSlots.length,
      pendingCount,
      pushedCount,
      alreadyLocked,
      manual,
      syncedAt: new Date().toISOString(),
    })
  } catch (err) {
    postMsg({
      type: 'SYNC_ERROR',
      eventId,
      error: err instanceof Error ? err.message : 'Sync failed — will retry automatically.',
      manual,
    })
  } finally {
    isSyncing = false
  }
}

function resetAutoSyncTimer() {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
  if (activeEventId && online) {
    intervalHandle = setInterval(() => {
      if (activeEventId && online) {
        void runFullSync(activeEventId, false)
      }
    }, AUTO_SYNC_INTERVAL_MS)
  }
}

self.onmessage = (event: MessageEvent<GateSyncWorkerInMessage>) => {
  const msg = event.data
  if (msg.type === 'CONFIGURE') {
    const shouldImmediateSync =
      msg.isOnline && msg.eventId > 0 && (msg.eventId !== activeEventId || !online)
    activeEventId = msg.eventId
    online = msg.isOnline
    resetAutoSyncTimer()
    if (shouldImmediateSync) {
      void runFullSync(activeEventId, false)
    }
  } else if (msg.type === 'SYNC_NOW') {
    activeEventId = msg.eventId
    void runFullSync(msg.eventId, msg.manual)
  }
}
