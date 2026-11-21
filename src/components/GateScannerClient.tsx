'use client'

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import jsQR from 'jsqr'
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import {
  getOrCreateDeviceId,
  offlineDb,
  type CachedBooking,
  type CachedEvent,
  type CachedSlot,
} from '@/lib/offline-db'
import { parseQRJson, verifyQRSignatureOffline } from '@/lib/qr-verify'
import type {
  GateSyncWorkerInMessage,
  GateSyncWorkerOutMessage,
} from '@/workers/gate-sync.worker'

interface EventOption {
  id: number
  code: string
  name: string
  date: string
  venue: string
}

interface DoorPhaseOption {
  id: string
  phaseName: string
  price: number
  ticketTypeName: string
  paxMultiplier: number
}

interface ActiveTicketGroup {
  ticketId: number
  ticketCode: string
  typeName: string
  paxCount: number
  slots: CachedSlot[]
}

interface GateScannerClientProps {
  events: EventOption[]
  initialEventId: number | null
  canScan: boolean
}

export function GateScannerClient({
  events,
  initialEventId,
  canScan,
}: GateScannerClientProps) {
  const [tab, setTab] = useState<'scan' | 'door'>('scan')
  const [selectedEventId, setSelectedEventId] = useState<number>(
    initialEventId || events[0]?.id || 0,
  )
  const isOnline = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener('online', onStoreChange)
      window.addEventListener('offline', onStoreChange)
      return () => {
        window.removeEventListener('online', onStoreChange)
        window.removeEventListener('offline', onStoreChange)
      }
    },
    () => navigator.onLine,
    () => true,
  )
  const deviceId = useSyncExternalStore(
    () => () => { },
    () => getOrCreateDeviceId(),
    () => 'GATE-LOCAL',
  )
  const [cachedEvent, setCachedEvent] = useState<CachedEvent | null>(null)
  const [cachedBookingCount, setCachedBookingCount] = useState(0)
  const [pendingSyncCount, setPendingSyncCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [statusBanner, setStatusBanner] = useState<string | null>(null)
  const syncWorkerRef = useRef<Worker | null>(null)

  // Camera & QR
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const userStoppedCameraRef = useRef(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  // Manual lookup
  const [lookupQuery, setLookupQuery] = useState('')
  const [lookupResults, setLookupResults] = useState<CachedBooking[]>([])

  // Active check-in checklist modal
  const [activeBooking, setActiveBooking] = useState<CachedBooking | null>(null)
  const [activeSlots, setActiveSlots] = useState<CachedSlot[]>([])
  const [activeTicketGroups, setActiveTicketGroups] = useState<ActiveTicketGroup[]>([])
  const [checkedSlotIds, setCheckedSlotIds] = useState<Record<number, boolean>>({})
  const [sigStatus, setSigStatus] = useState<'verified' | 'manual' | 'invalid'>('manual')
  const [scanMethod, setScanMethod] = useState<'qr_scan' | 'manual_code'>('manual_code')
  const [savingCheckin, setSavingCheckin] = useState(false)

  // Door sales state
  const [doorPhases, setDoorPhases] = useState<DoorPhaseOption[]>([])
  const [doorName, setDoorName] = useState('')
  const [doorPhone, setDoorPhone] = useState('')
  const [doorMode, setDoorMode] = useState<'CASH' | 'OFFICER_UPI' | 'PAY_AT_DOOR'>('CASH')
  const [doorQty, setDoorQty] = useState<Record<string, number>>({})
  const [doorPaxNames, setDoorPaxNames] = useState<Record<string, { name: string; touched?: boolean }>>({})
  const [doorSubmitting, setDoorSubmitting] = useState(false)
  const [doorSuccess, setDoorSuccess] = useState<string | null>(null)

  // Register Service Worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => { })
    }
  }, [])

  const refreshLocalStats = useCallback(async (eventId: number) => {
    if (!eventId) return
    const [ev, bCount, pCount] = await Promise.all([
      offlineDb.events.get(eventId),
      offlineDb.bookings.where('eventId').equals(eventId).count(),
      offlineDb.pendingSync.where('synced').equals(0).count(),
    ])
    setCachedEvent(ev || null)
    setCachedBookingCount(bCount)
    setPendingSyncCount(pCount)
  }, [])

  useEffect(() => {
    if (!selectedEventId) return
    let cancelled = false
    void (async () => {
      const [ev, bCount, pCount] = await Promise.all([
        offlineDb.events.get(selectedEventId),
        offlineDb.bookings.where('eventId').equals(selectedEventId).count(),
        offlineDb.pendingSync.where('synced').equals(0).count(),
      ])
      if (cancelled) return
      setCachedEvent(ev || null)
      setCachedBookingCount(bCount)
      setPendingSyncCount(pCount)
    })()
    return () => {
      cancelled = true
    }
  }, [selectedEventId])

  // Load door-sale ticket phases when online
  useEffect(() => {
    if (!selectedEventId || !isOnline) return
    fetch(`/api/events/meta?eventId=${selectedEventId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return
        const allActive = (data.ticketPhases || []).filter(
          (p: { isActive: boolean }) => p.isActive,
        )
        setDoorPhases(allActive)
      })
      .catch(() => { })
  }, [selectedEventId, isOnline])

  // Dedicated Web Worker for off-main-thread Push -> Pull sync (auto-runs every 60s)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') return
    const worker = new Worker(
      new URL('../workers/gate-sync.worker.ts', import.meta.url),
    )
    syncWorkerRef.current = worker

    worker.onmessage = (event: MessageEvent<GateSyncWorkerOutMessage>) => {
      const msg = event.data
      if (msg.type === 'SYNC_START') {
        setSyncing(true)
        if (msg.manual) setStatusBanner(null)
      } else if (msg.type === 'SYNC_COMPLETE') {
        setSyncing(false)
        setCachedEvent(msg.cachedEvent)
        setCachedBookingCount(msg.bookingCount)
        setPendingSyncCount(msg.pendingCount)
        setLastSyncedAt(msg.syncedAt)
        if (msg.manual) {
          const pushSummary =
            msg.pushedCount > 0 ? `Pushed ${msg.pushedCount} check-in(s) · ` : ''
          setStatusBanner(
            `${pushSummary}Synced ${msg.bookingCount} bookings & ${msg.slotCount} attendee slots.`,
          )
        }
      } else if (msg.type === 'SYNC_ERROR') {
        setSyncing(false)
        if (msg.manual) {
          setStatusBanner(msg.error)
        }
      }
    }

    return () => {
      worker.terminate()
      syncWorkerRef.current = null
    }
  }, [])

  // Configure worker with active event & online status (triggers immediate sync + 60s loop)
  useEffect(() => {
    if (!syncWorkerRef.current || !selectedEventId) return
    const msg: GateSyncWorkerInMessage = {
      type: 'CONFIGURE',
      eventId: selectedEventId,
      isOnline,
    }
    syncWorkerRef.current.postMessage(msg)
  }, [selectedEventId, isOnline])

  // Unified one-button Push + Pull sync on the worker thread
  const triggerUnifiedSync = useCallback(
    (manual: boolean) => {
      if (!selectedEventId || !isOnline || !syncWorkerRef.current) return
      const msg: GateSyncWorkerInMessage = {
        type: 'SYNC_NOW',
        eventId: selectedEventId,
        manual,
      }
      syncWorkerRef.current.postMessage(msg)
    },
    [selectedEventId, isOnline],
  )

  // Open pre-ticked checklist for a booking, grouping couples / multi-pax tickets together
  const openBookingChecklist = useCallback(
    async (
      booking: CachedBooking,
      verification: 'verified' | 'manual' | 'invalid',
      method: 'qr_scan' | 'manual_code',
    ) => {
      const [tickets, rawSlots] = await Promise.all([
        offlineDb.tickets.where('bookingId').equals(booking.id).toArray(),
        offlineDb.slots.where('bookingId').equals(booking.id).toArray(),
      ])

      tickets.sort((a, b) => a.ticketCode.localeCompare(b.ticketCode))

      // Group slots by bookingTicketId and sort each ticket's guests by slotIndex (1, 2, ...)
      const slotsByTicket = new Map<number, CachedSlot[]>()
      for (const s of rawSlots) {
        const list = slotsByTicket.get(s.bookingTicketId) || []
        list.push(s)
        slotsByTicket.set(s.bookingTicketId, list)
      }
      for (const list of slotsByTicket.values()) {
        list.sort((a, b) => a.slotIndex - b.slotIndex)
      }

      const groups: ActiveTicketGroup[] = []
      const orderedSlots: CachedSlot[] = []

      for (const t of tickets) {
        const tSlots = slotsByTicket.get(t.id) || []
        if (tSlots.length === 0) continue
        groups.push({
          ticketId: t.id,
          ticketCode: t.ticketCode,
          typeName: t.typeName || 'Ticket',
          paxCount: t.paxCount || tSlots.length,
          slots: tSlots,
        })
        orderedSlots.push(...tSlots)
        slotsByTicket.delete(t.id)
      }

      // Fallback for any slots without a matching cached ticket entry
      for (const [tId, tSlots] of slotsByTicket.entries()) {
        groups.push({
          ticketId: tId,
          ticketCode: `${booking.bookingCode}-T${tId}`,
          typeName: tSlots.length === 2 ? 'Couple' : 'Ticket',
          paxCount: tSlots.length,
          slots: tSlots,
        })
        orderedSlots.push(...tSlots)
      }

      // Pre-tick ALL remaining pending slots by default!
      const preTicked: Record<number, boolean> = {}
      for (const s of orderedSlots) {
        if (!s.checkedInAt) {
          preTicked[s.id] = true
        }
      }

      setActiveBooking(booking)
      setActiveSlots(orderedSlots)
      setActiveTicketGroups(groups)
      setCheckedSlotIds(preTicked)
      setSigStatus(verification)
      setScanMethod(method)
    },
    [],
  )

  // Handle decoded QR string
  const handleQrDecoded = useCallback(
    async (raw: string) => {
      const parsed = parseQRJson(raw)
      if (!parsed) {
        setStatusBanner(`Unrecognized QR code: ${raw.slice(0, 40)}`)
        return
      }

      const ev = await offlineDb.events.get(Number(parsed.eId))
      let verification: 'verified' | 'invalid' = 'invalid'
      if (ev?.publicKey) {
        const ok = await verifyQRSignatureOffline(parsed, ev.publicKey)
        verification = ok ? 'verified' : 'invalid'
      }

      const booking =
        (await offlineDb.bookings.get(Number(parsed.bId))) ||
        (await offlineDb.bookings.where('bookingCode').equals(parsed.code).first())

      if (!booking) {
        setStatusBanner(
          `Booking ${parsed.code} not found in offline cache. Download roster first.`,
        )
        return
      }

      await openBookingChecklist(booking, verification, 'qr_scan')
    },
    [openBookingChecklist],
  )

  // Camera scanner lifecycle
  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setCameraActive(false)
  }, [])

  const startCamera = useCallback(async () => {
    setCameraError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      streamRef.current = stream
      setCameraActive(true)

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => { })
        }

        const tick = () => {
          const video = videoRef.current
          const canvas = canvasRef.current
          if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            const ctx = canvas.getContext('2d')
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
              const code = jsQR(imageData.data, imageData.width, imageData.height)
              if (code?.data) {
                stopCamera()
                handleQrDecoded(code.data)
                return
              }
            }
          }
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      }, 150)
    } catch {
      setCameraError('Camera permission denied or unavailable. Use manual code lookup below.')
    }
  }, [handleQrDecoded, stopCamera])

  // Auto-open camera on mount if camera permission is already granted
  useEffect(() => {
    if (tab !== 'scan' || userStoppedCameraRef.current) return
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return

    let cancelled = false
    navigator.permissions
      .query({ name: 'camera' as PermissionName })
      .then((status) => {
        if (!cancelled && status.state === 'granted' && !streamRef.current) {
          void startCamera()
        }
      })
      .catch(() => { })

    return () => {
      cancelled = true
    }
  }, [tab, startCamera])

  useEffect(() => {
    return () => stopCamera()
  }, [stopCamera])

  // Offline manual search by B042, B042-T01, phone, or holderName
  useEffect(() => {
    const q = lookupQuery.trim().toLowerCase()
    if (!q) return

    let cancelled = false
      ; (async () => {
        const allBookings = await offlineDb.bookings
          .where('eventId')
          .equals(selectedEventId)
          .toArray()

        // Also match ticket codes (e.g. B042-T01) and individual attendee names
        const [matchingTickets, matchingSlots] = await Promise.all([
          offlineDb.tickets
            .filter((t) => t.ticketCode.toLowerCase().includes(q))
            .toArray(),
          offlineDb.slots
            .filter(
              (s) =>
                (s.attendeeName?.toLowerCase().includes(q) ?? false) ||
                s.label.toLowerCase().includes(q),
            )
            .toArray(),
        ])
        if (cancelled) return

        const ticketBookingIds = new Set(matchingTickets.map((t) => t.bookingId))
        const slotBookingIds = new Set(matchingSlots.map((s) => s.bookingId))

        const matched = allBookings.filter(
          (b) =>
            b.bookingCode.toLowerCase().includes(q) ||
            b.holderName.toLowerCase().includes(q) ||
            b.phone.toLowerCase().includes(q) ||
            ticketBookingIds.has(b.id) ||
            slotBookingIds.has(b.id),
        )
        setLookupResults(matched.slice(0, 15))
      })()

    return () => {
      cancelled = true
    }
  }, [lookupQuery, selectedEventId])

  const visibleLookupResults = lookupQuery.trim() ? lookupResults : []

  // Confirm pre-ticked check-in slots (locks permanently!)
  async function handleConfirmCheckin() {
    if (!activeBooking || !canScan) return
    const toCheckIn = activeSlots.filter((s) => !s.checkedInAt && checkedSlotIds[s.id])
    if (toCheckIn.length === 0) {
      setActiveBooking(null)
      return
    }

    setSavingCheckin(true)
    const nowIso = new Date().toISOString()

    try {
      await offlineDb.transaction('rw', [offlineDb.slots, offlineDb.pendingSync], async () => {
        for (const s of toCheckIn) {
          await offlineDb.slots.update(s.id, {
            checkedInAt: nowIso,
            deviceId,
            method: scanMethod,
          })
          await offlineDb.pendingSync.add({
            slotId: s.id,
            bookingId: activeBooking.id,
            checkedInAt: nowIso,
            deviceId,
            method: scanMethod,
            synced: 0,
          })
        }
      })

      await refreshLocalStats(selectedEventId)
      setStatusBanner(
        `Checked in ${toCheckIn.length} guest(s) for ${activeBooking.bookingCode} (permanently locked).`,
      )
      setActiveBooking(null)
      setLookupQuery('')

      if (navigator.onLine) {
        triggerUnifiedSync(false)
      }
    } finally {
      setSavingCheckin(false)
    }
  }

  // Selected door-sale tickets expanded for per-pax names
  const selectedDoorPhases = doorPhases.filter((p) => (doorQty[p.id] || 0) > 0)
  const firstDoorKey =
    selectedDoorPhases.length > 0 ? `${selectedDoorPhases[0].id}-0-0` : null

  function getDoorPaxName(key: string): string {
    const entry = doorPaxNames[key]
    if (entry?.touched) return entry.name
    if (key === firstDoorKey) return doorName
    return entry?.name || ''
  }

  // Door Sales submit
  async function handleDoorSaleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const lines: Array<{
      ticketPhaseId: string
      quantity: number
      paxList: Array<{ name: string }>
    }> = []

    for (const p of selectedDoorPhases) {
      const quantity = doorQty[p.id] || 0
      const paxList: Array<{ name: string }> = []
      for (let tIdx = 0; tIdx < quantity; tIdx++) {
        for (let pIdx = 0; pIdx < p.paxMultiplier; pIdx++) {
          const key = `${p.id}-${tIdx}-${pIdx}`
          const nm = getDoorPaxName(key).trim()
          if (!nm) {
            setDoorSuccess(`Please enter a name for every guest on ${p.ticketTypeName}.`)
            return
          }
          paxList.push({ name: nm })
        }
      }
      lines.push({ ticketPhaseId: p.id, quantity, paxList })
    }

    if (lines.length === 0) return
    setDoorSubmitting(true)
    setDoorSuccess(null)
    try {
      const res = await fetch('/api/door-sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          eventId: selectedEventId,
          holderName: doorName,
          phone: doorPhone,
          paymentMode: doorMode,
          tickets: lines,
          autoCheckInAll: true,
          deviceId,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setDoorSuccess(
          `Walk-in booking ${data.booking.bookingCode} created & checked in (${data.booking.totalPax} pax · ₹${data.booking.totalAmount}).`,
        )
        setDoorName('')
        setDoorPhone('')
        setDoorQty({})
        setDoorPaxNames({})
      } else {
        setDoorSuccess(data.error || 'Door sale failed')
      }
    } finally {
      setDoorSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-[70px] top-0 z-10 mx-auto flex max-w-2xl flex-col bg-white">
      {/* Top Frosted Glass Scanner Hero */}
      <div className="glass-surface shrink-0 px-4 py-3.5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${isOnline ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                }`}
            >
              {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {isOnline ? 'Online' : 'Offline Dead-Zone Mode'}
            </span>
            <span>Device: {deviceId}</span>
          </div>

          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(Number(e.target.value))}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white"
          >
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.code} — {ev.name}
              </option>
            ))}
          </select>
        </div>

        {/* Unified Offline Sync Bar (Auto-syncs every 60s in Web Worker) */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2.5">
          <div className="text-xs text-slate-300">
            {cachedEvent ? (
              <span>
                Cached: <strong>{cachedBookingCount} bookings</strong>
                {lastSyncedAt && (
                  <span className="ml-2 text-[11px] text-slate-400">
                    · Synced{' '}
                    {new Date(lastSyncedAt).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-amber-300">
                No roster cached yet — tap Sync before venue dead-zone!
              </span>
            )}
          </div>

          <button
            type="button"
            disabled={syncing || !isOnline}
            onClick={() => triggerUnifiedSync(true)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${pendingSyncCount > 0
              ? 'bg-amber-400 text-slate-950 hover:bg-amber-300'
              : 'bg-sky-500 text-slate-950 hover:bg-sky-400'
              } disabled:opacity-50`}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing
              ? 'Syncing…'
              : pendingSyncCount > 0
                ? `Sync (${pendingSyncCount})`
                : 'Sync'}
          </button>
        </div>
      </div>

      {statusBanner && (
        <div className="flex shrink-0 items-center justify-between border-b border-sky-200 bg-sky-50 px-4 py-2 text-xs font-medium text-sky-900">
          <span>{statusBanner}</span>
          <button type="button" onClick={() => setStatusBanner(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {tab === 'scan' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Center Camera Viewport / Centered Camera Toggle */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
            {cameraActive ? (
              <div className="relative h-full w-full bg-black">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
                <canvas ref={canvasRef} className="hidden" />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-52 w-52 rounded-3xl border-2 border-sky-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
                </div>
                <div className="absolute inset-x-0 bottom-4 flex justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      userStoppedCameraRef.current = true
                      stopCamera()
                    }}
                    className="inline-flex items-center gap-2 rounded-full bg-slate-950/80 px-4 py-2 text-xs font-bold text-white backdrop-blur-md transition hover:bg-rose-600"
                  >
                    <CameraOff className="h-4 w-4" />
                    Stop Camera
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center px-6 text-center">
                <button
                  type="button"
                  onClick={() => {
                    userStoppedCameraRef.current = false
                    void startCamera()
                  }}
                  className="glass-surface inline-flex items-center gap-2.5 rounded-full px-6 py-3.5 text-sm font-bold text-white shadow-xl transition hover:scale-[1.02] active:scale-[0.98]"
                >
                  <Camera className="h-5 w-5 text-sky-300" />
                  Start Camera
                </button>
                <p className="mt-3 text-xs text-slate-400">
                  Tap to scan Master QR passes offline
                </p>
                {cameraError && (
                  <p className="mt-2 max-w-xs text-xs font-medium text-rose-600">
                    {cameraError}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* DOOR SALES / WALK-IN ENTRY */
        <form
          onSubmit={handleDoorSaleSubmit}
          className="space-y-4 py-1"
        >
          <h2 className="text-sm font-bold text-slate-900">
            Fast Walk-In / Door Sales Entry (Auto Check-In)
          </h2>

          {!isOnline && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              Door Sales requires internet connectivity to create a new booking on the server.
            </div>
          )}

          {doorSuccess && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-900">
              {doorSuccess}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Guest Name *
              </label>
              <input
                type="text"
                required
                value={doorName}
                onChange={(e) => setDoorName(e.target.value)}
                placeholder="Walk-in Guest Name"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Phone *
              </label>
              <input
                type="tel"
                required
                value={doorPhone}
                onChange={(e) => setDoorPhone(e.target.value)}
                placeholder="9847012345"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-700">
              Select Walk-In Tickets
            </label>
            {doorPhases.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs"
              >
                <div>
                  <span className="font-bold text-slate-900">{p.ticketTypeName}</span>{' '}
                  <span className="text-slate-500">
                    ({p.phaseName} · {p.paxMultiplier} pax · ₹{p.price})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setDoorQty((prev) => ({
                        ...prev,
                        [p.id]: Math.max(0, (prev[p.id] || 0) - 1),
                      }))
                    }
                    className="rounded border border-slate-300 px-2 py-0.5 font-bold"
                  >
                    -
                  </button>
                  <span className="w-5 text-center font-bold">{doorQty[p.id] || 0}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setDoorQty((prev) => ({ ...prev, [p.id]: (prev[p.id] || 0) + 1 }))
                    }
                    className="rounded bg-sky-600 px-2 py-0.5 font-bold text-white"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {selectedDoorPhases.length > 0 && (
            <div className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-bold text-slate-800">
                Attendee Names (Required for Every Pax)
              </div>
              {selectedDoorPhases.map((p) => {
                const qty = doorQty[p.id] || 0
                return Array.from({ length: qty }).map((_, tIdx) => (
                  <div
                    key={`${p.id}-${tIdx}`}
                    className="space-y-1.5 rounded-md border border-slate-200 bg-white p-2.5"
                  >
                    <div className="text-[11px] font-bold text-slate-700">
                      Ticket #{tIdx + 1} · {p.ticketTypeName} ({p.phaseName}) — {p.paxMultiplier}{' '}
                      Pax
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {Array.from({ length: p.paxMultiplier }).map((__, pIdx) => {
                        const key = `${p.id}-${tIdx}-${pIdx}`
                        return (
                          <input
                            key={key}
                            type="text"
                            required
                            value={getDoorPaxName(key)}
                            onChange={(e) =>
                              setDoorPaxNames((prev) => ({
                                ...prev,
                                [key]: { name: e.target.value, touched: true },
                              }))
                            }
                            placeholder={`Guest ${pIdx + 1} Full Name *`}
                            className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs focus:border-sky-500 focus:outline-none"
                          />
                        )
                      })}
                    </div>
                  </div>
                ))
              })}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Payment Mode
            </label>
            <select
              value={doorMode}
              onChange={(e) =>
                setDoorMode(e.target.value as 'CASH' | 'OFFICER_UPI' | 'PAY_AT_DOOR')
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="CASH">Cash at Gate</option>
              <option value="OFFICER_UPI">Officer UPI</option>
              <option value="PAY_AT_DOOR">Pay at Door (Pending)</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={!canScan || !isOnline || doorSubmitting}
            className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {doorSubmitting ? 'Processing Walk-In…' : 'Complete Door Sale & Check In'}
          </button>
        </form>
      )}


      {/* Offline Manual Lookup (Dark Frosted Glass Sheet at Bottom) */}
      <div className="glass-surface border-t border-white/15 px-4 py-4 pb-6 text-white">
        <h2 className="text-sm font-bold text-white">
          Manual Lookup
        </h2>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={lookupQuery}
            onChange={(e) => setLookupQuery(e.target.value)}
            placeholder="Type XMAS26-B001, phone number, or guest name..."
            className="w-full rounded-2xl border border-white/15 bg-white/10 py-2.5 pl-9 pr-3 text-sm text-white placeholder-slate-400 transition focus:border-sky-400 focus:bg-white/15 focus:outline-none"
          />
        </div>

        {visibleLookupResults.length > 0 && (
          <div className="mt-3 max-h-52 divide-y divide-dashed divide-white/10 overflow-y-auto">
            {visibleLookupResults.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => openBookingChecklist(b, 'manual', 'manual_code')}
                className="flex w-full items-center justify-between rounded-xl px-2 py-3 text-left transition hover:bg-white/10"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">{b.bookingCode}</span>
                    <span className="text-sm font-medium text-slate-200">
                      {b.holderName}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">
                    {b.phone} · {b.totalPax} Pax · Tables: {b.tablesSummary}
                  </div>
                </div>
                <span className="rounded-xl bg-sky-500/20 px-3 py-1.5 text-xs font-bold text-sky-300">
                  Check In →
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* PRE-TICKED ATTENDEE CHECKLIST MODAL */}
      {activeBooking && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-extrabold text-slate-900">
                    {activeBooking.bookingCode}
                  </span>
                  {activeBooking.status === 'cancelled' && (
                    <span className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                      CANCELLED
                    </span>
                  )}
                </div>
                <div className="text-sm font-semibold text-slate-800">
                  {activeBooking.holderName} · {activeBooking.totalPax} Pax
                </div>
                <div className="text-xs text-slate-500">
                  Tables: {activeBooking.tablesSummary} · {activeBooking.paymentMode} (
                  {activeBooking.paymentStatus})
                </div>
              </div>
              <button type="button" onClick={() => setActiveBooking(null)}>
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>

            {/* Ed25519 Signature Status */}
            <div className="mt-3">
              {sigStatus === 'verified' && (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Ed25519 QR Signature Verified Offline
                </div>
              )}
              {sigStatus === 'invalid' && (
                <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">
                  <ShieldAlert className="h-4 w-4 text-rose-600" />
                  Warning: QR signature could not be verified!
                </div>
              )}
            </div>

            {/* Attendee Slots Checklist (Grouped by Ticket; Pre-ticked by default; checked-in slots locked permanently) */}
            <div className="mt-4 h-[60vh] max-h-[90vh] space-y-3 overflow-y-auto pr-0.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Uncheck absent guests, then confirm check-in:
              </div>
              {activeTicketGroups.map((grp) => (
                <div
                  key={grp.ticketId}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5"
                >
                  <div className="mb-1.5 flex items-center justify-between px-1">
                    <span className="text-xs font-bold text-slate-800">
                      {grp.ticketCode} · {grp.typeName}
                    </span>
                    <span className="rounded bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 shadow-xs">
                      {grp.slots.length} {grp.slots.length === 1 ? 'Guest' : 'Guests'}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {grp.slots.map((slot) => {
                      const alreadyLocked = Boolean(slot.checkedInAt)
                      const checked = alreadyLocked || Boolean(checkedSlotIds[slot.id])
                      const displayName =
                        slot.attendeeName ||
                        slot.label.split(' — ')[0] ||
                        slot.label

                      return (
                        <label
                          key={slot.id}
                          className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-xs transition ${alreadyLocked
                            ? 'border-slate-200 bg-slate-100 text-slate-500'
                            : checked
                              ? 'border-emerald-400 bg-emerald-50/80 text-slate-900'
                              : 'border-slate-200 bg-white text-slate-700'
                            }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <input
                              type="checkbox"
                              disabled={alreadyLocked || activeBooking.status === 'cancelled'}
                              checked={checked}
                              onChange={(e) =>
                                setCheckedSlotIds((prev) => ({
                                  ...prev,
                                  [slot.id]: e.target.checked,
                                }))
                              }
                              className="h-4 w-4 rounded accent-emerald-600"
                            />
                            <div>
                              <div className="font-semibold">{displayName}</div>
                              {grp.slots.length > 1 && !alreadyLocked && (
                                <div className="text-[10px] text-slate-500">
                                  Guest {slot.slotIndex} of {grp.slots.length}
                                </div>
                              )}
                              {alreadyLocked && (
                                <div className="text-[10px] text-slate-500">
                                  Checked in at{' '}
                                  {new Date(slot.checkedInAt!).toLocaleTimeString('en-IN', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </div>
                              )}
                            </div>
                          </div>

                          {alreadyLocked ? (
                            <span className="inline-flex items-center gap-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                              <Lock className="h-3 w-3" /> LOCKED
                            </span>
                          ) : (
                            <CheckCircle2
                              className={`h-4 w-4 ${checked ? 'text-emerald-600' : 'text-slate-300'}`}
                            />
                          )}
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setActiveBooking(null)}
                className="flex-1 rounded-xl border border-slate-300 py-2.5 text-xs font-bold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  !canScan ||
                  savingCheckin ||
                  activeBooking.status === 'cancelled' ||
                  activeSlots.every((s) => Boolean(s.checkedInAt))
                }
                onClick={handleConfirmCheckin}
                className="flex-[2] rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50"
              >
                {savingCheckin ? 'Locking Check-In…' : 'Confirm & Lock Check-In'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
