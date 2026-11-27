'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import jsQR from 'jsqr'
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Loader2,
  Lock,
  QrCode,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Wallet,
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
import { formatEventDayLabel, isScanAllowedForEventDate } from '@/lib/event-date'
import {
  parseTicketQR,
  verifyCompactQRTagOffline,
  verifyQRSignatureOffline,
} from '@/lib/qr-verify'
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
  isScanOpen?: boolean
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
  const [selectedEventId, setSelectedEventId] = useState<number>(
    initialEventId || events[0]?.id || 0,
  )
  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) || null,
    [events, selectedEventId],
  )
  const isScanOpen = useMemo(
    () =>
      selectedEvent
        ? selectedEvent.isScanOpen !== false && isScanAllowedForEventDate(selectedEvent.date)
        : false,
    [selectedEvent],
  )
  const scanOpensLabel = useMemo(
    () => (selectedEvent ? formatEventDayLabel(selectedEvent.date) : 'Event Day'),
    [selectedEvent],
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
  const [doorPaymentMethod, setDoorPaymentMethod] = useState<
    'RAZORPAY' | 'CASH' | 'OFFICER_UPI' | 'COMPLIMENTARY'
  >('CASH')
  const [doorPaymentConfirmed, setDoorPaymentConfirmed] = useState(false)
  const [doorRzpLink, setDoorRzpLink] = useState<string | null>(null)
  const [doorRzpLoading, setDoorRzpLoading] = useState(false)
  const [doorRzpError, setDoorRzpError] = useState<string | null>(null)

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
      if (!isScanOpen) {
        setStatusBanner(`Gate check-in opens on ${scanOpensLabel}.`)
        return
      }
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
      setDoorPaymentMethod('CASH')
      setDoorPaymentConfirmed(false)
      setDoorRzpLink(null)
      setDoorRzpError(null)
    },
    [isScanOpen, scanOpensLabel, setActiveBooking, setCheckedSlotIds],
  )

  // Handle decoded QR string (supports compact `XMAS26-B012:9F4A2C8B` and legacy JSON)
  const handleQrDecoded = useCallback(
    async (raw: string) => {
      if (!isScanOpen) {
        setStatusBanner(`Gate check-in opens on ${scanOpensLabel}.`)
        return
      }
      const decoded = parseTicketQR(raw)
      if (!decoded) {
        setStatusBanner(`Unrecognized QR code: ${raw.slice(0, 40)}`)
        return
      }

      if (decoded.format === 'compact') {
        const booking = await offlineDb.bookings
          .where('bookingCode')
          .equalsIgnoreCase(decoded.code)
          .first()

        if (!booking) {
          setStatusBanner(
            `Booking ${decoded.code} not found in offline cache. Tap Sync first.`,
          )
          return
        }

        if (booking.status === 'cancelled' || booking.status === 'pending_payment') {
          setStatusBanner(
            `Booking ${booking.bookingCode} is ${booking.status === 'cancelled' ? 'cancelled' : 'pending payment'} and cannot be checked in.`,
          )
          return
        }

        const ev = await offlineDb.events.get(Number(booking.eventId))
        let verification: 'verified' | 'manual' | 'invalid' = 'invalid'
        if (decoded.sigTag && ev?.publicKey) {
          const ok = await verifyCompactQRTagOffline({
            sigTag: decoded.sigTag,
            booking,
            publicKeyHex: ev.publicKey,
          })
          verification = ok ? 'verified' : 'invalid'
        } else if (!decoded.sigTag) {
          verification = 'manual'
        }

        await openBookingChecklist(booking, verification, 'qr_scan')
        return
      }

      // Legacy JSON QR fallback
      const parsed = decoded.payload
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
    [isScanOpen, openBookingChecklist, scanOpensLabel],
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
              const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'attemptBoth',
              })
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

  // Auto-open camera on mount if camera permission is already granted (only when scan is open)
  useEffect(() => {
    if (!isScanOpen || userStoppedCameraRef.current) return
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
  }, [isScanOpen, startCamera])

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
            b.status !== 'cancelled' &&
            b.status !== 'pending_payment' &&
            (b.bookingCode.toLowerCase().includes(q) ||
              b.holderName.toLowerCase().includes(q) ||
              b.phone.toLowerCase().includes(q) ||
              ticketBookingIds.has(b.id) ||
              slotBookingIds.has(b.id)),
        )
        setLookupResults(matched.slice(0, 15))
      })()

    return () => {
      cancelled = true
    }
  }, [lookupQuery, selectedEventId])

  const visibleLookupResults = isScanOpen && lookupQuery.trim() ? lookupResults : []

  // Poll Razorpay status while a door Razorpay QR is open in the check-in modal
  useEffect(() => {
    if (
      !activeBooking ||
      doorPaymentMethod !== 'RAZORPAY' ||
      !doorRzpLink ||
      activeBooking.paymentStatus === 'paid'
    ) {
      return
    }
    let cancelled = false
    const bookingId = activeBooking.id

    const poll = async () => {
      try {
        const res = await fetch(`/api/bookings/${bookingId}/payment-status`, {
          credentials: 'include',
        })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { paymentStatus?: string }
        if (cancelled) return
        if (data.paymentStatus === 'paid') {
          await offlineDb.bookings.update(bookingId, {
            paymentMode: 'RAZORPAY',
            paymentStatus: 'paid',
          })
          setActiveBooking((prev) =>
            prev && prev.id === bookingId
              ? { ...prev, paymentMode: 'RAZORPAY', paymentStatus: 'paid' }
              : prev,
          )
          setDoorRzpLink(null)
          setDoorRzpError(null)
        }
      } catch {
        // Ignore transient network errors while polling
      }
    }

    const timer = setInterval(() => {
      void poll()
    }, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [activeBooking, doorPaymentMethod, doorRzpLink])

  async function handleGenerateDoorRazorpay() {
    if (!activeBooking || !isOnline) return
    setDoorRzpLoading(true)
    setDoorRzpError(null)
    try {
      const res = await fetch(`/api/bookings/${activeBooking.id}/door-razorpay`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = (await res.json().catch(() => ({}))) as {
        alreadyPaid?: boolean
        paymentLinkUrl?: string
        error?: string
      }
      if (!res.ok) {
        setDoorRzpError(data.error || 'Could not generate Razorpay QR')
        return
      }
      if (data.alreadyPaid) {
        await offlineDb.bookings.update(activeBooking.id, {
          paymentMode: 'RAZORPAY',
          paymentStatus: 'paid',
        })
        setActiveBooking((prev) =>
          prev ? { ...prev, paymentMode: 'RAZORPAY', paymentStatus: 'paid' } : prev,
        )
        return
      }
      if (data.paymentLinkUrl) {
        setDoorRzpLink(data.paymentLinkUrl)
      }
    } catch {
      setDoorRzpError('Network error while generating Razorpay QR')
    } finally {
      setDoorRzpLoading(false)
    }
  }

  // Confirm pre-ticked check-in slots (locks permanently!)
  async function handleConfirmCheckin() {
    if (!activeBooking || !canScan) return
    if (!isScanOpen) {
      setStatusBanner(`Gate check-in opens on ${scanOpensLabel}.`)
      setActiveBooking(null)
      return
    }
    const needsDoorPayment =
      activeBooking.paymentMode === 'PAY_AT_DOOR' && activeBooking.paymentStatus !== 'paid'
    if (needsDoorPayment && (doorPaymentMethod === 'RAZORPAY' || !doorPaymentConfirmed)) {
      return
    }

    const toCheckIn = activeSlots.filter((s) => !s.checkedInAt && checkedSlotIds[s.id])
    if (toCheckIn.length === 0) {
      setActiveBooking(null)
      return
    }

    setSavingCheckin(true)
    const nowIso = new Date().toISOString()
    const offlineDoorMode =
      needsDoorPayment && doorPaymentMethod !== 'RAZORPAY' ? doorPaymentMethod : undefined

    try {
      await offlineDb.transaction(
        'rw',
        [offlineDb.bookings, offlineDb.slots, offlineDb.pendingSync],
        async () => {
          if (offlineDoorMode) {
            await offlineDb.bookings.update(activeBooking.id, {
              paymentMode: offlineDoorMode,
              paymentStatus: 'paid',
              totalAmount:
                offlineDoorMode === 'COMPLIMENTARY' ? 0 : activeBooking.totalAmount,
            })
          }
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
              doorPaymentMode: offlineDoorMode,
              synced: 0,
            })
          }
        },
      )

      await refreshLocalStats(selectedEventId)
      const modeText =
        offlineDoorMode === 'OFFICER_UPI'
          ? 'Officer UPI'
          : offlineDoorMode === 'COMPLIMENTARY'
            ? 'Complimentary'
            : 'Cash'
      setStatusBanner(
        offlineDoorMode
          ? offlineDoorMode === 'COMPLIMENTARY'
            ? `Marked complimentary (₹0) & checked in ${toCheckIn.length} guest(s) for ${activeBooking.bookingCode}.`
            : `Collected ₹${activeBooking.totalAmount.toLocaleString('en-IN')} (${modeText}) & checked in ${toCheckIn.length} guest(s) for ${activeBooking.bookingCode}.`
          : `Checked in ${toCheckIn.length} guest(s) for ${activeBooking.bookingCode} (permanently locked).`,
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

  return (
    <div className="fixed inset-x-0 bottom-[70px] top-0 z-10 mx-auto flex max-w-2xl flex-col bg-black">
      {/* Top Frosted Glass Scanner Hero */}
      <div className="shrink-0 px-4 py-3.5 text-white">
        <div className="flex flex-wrap justify-between gap-2.5">
          <div className="flex flex-col items-start gap-2 text-xs text-neutral-300">
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
            onChange={(e) => {
              const nextId = Number(e.target.value)
              const nextEv = events.find((ev) => ev.id === nextId)
              if (nextEv && (nextEv.isScanOpen === false || !isScanAllowedForEventDate(nextEv.date))) {
                stopCamera()
                setLookupQuery('')
                setActiveBooking(null)
              }
              setSelectedEventId(nextId)
            }}
            className="rounded-full border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-white"
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
          <div className="text-xs text-neutral-300">
            {cachedEvent ? (
              <span>
                Cached: <strong>{cachedBookingCount} bookings</strong>
                {lastSyncedAt && (
                  <span className="ml-2 text-[11px] text-neutral-400">
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
              ? 'bg-amber-400 text-neutral-950 hover:bg-amber-300'
              : 'bg-white text-neutral-950 hover:bg-neutral-200'
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
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-neutral-100 px-4 py-2 text-xs font-medium text-neutral-900">
          <span>{statusBanner}</span>
          <button type="button" onClick={() => setStatusBanner(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

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
              {/* Top & bottom black vignette gradients blending camera feed into header and manual lookup */}
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-black via-black/45 to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-gradient-to-t from-black via-black/55 to-transparent" />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative h-58 w-58 rounded-3xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                  <span className="absolute left-0 top-0 h-8 w-8 rounded-tl-3xl border-l-[3px] border-t-[3px] border-white" />
                  <span className="absolute right-0 top-0 h-8 w-8 rounded-tr-3xl border-r-[3px] border-t-[3px] border-white" />
                  <span className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-3xl border-b-[3px] border-l-[3px] border-white" />
                  <span className="absolute bottom-0 right-0 h-8 w-8 rounded-br-3xl border-b-[3px] border-r-[3px] border-white" />
                </div>
              </div>
              <div className="absolute inset-x-0 bottom-4 z-20 flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    userStoppedCameraRef.current = true
                    stopCamera()
                  }}
                  className="inline-flex items-center gap-2 rounded-full bg-neutral-950/80 px-4 py-2 text-xs font-bold text-white backdrop-blur-md transition hover:bg-rose-600"
                >
                  <CameraOff className="h-4 w-4" />
                  Stop Camera
                </button>
              </div>
            </div>
          ) : !isScanOpen ? (
            <div className="flex flex-col items-center justify-center px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-neutral-300">
                <Lock className="h-5 w-5" />
              </div>
              <p className="mt-3 text-sm font-bold text-white">
                Gate Check-In Opens on{' '}
                {selectedEvent ? formatEventDayLabel(selectedEvent.date) : 'Event Day'}
              </p>
              <p className="mt-1 max-w-xs text-xs text-neutral-400">
                Scanning is disabled until the date of the event. You can still tap Sync above to pre-download the offline roster.
              </p>
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
                <Camera className="h-5 w-5 text-white" />
                Start Camera
              </button>
              <p className="mt-3 text-xs text-neutral-400">
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

      {/* Offline Manual Lookup (Dark Frosted Glass Sheet at Bottom) */}
      <div className="px-4 py-4 pb-6 text-white">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">
            Manual Lookup
          </h2>
          {!isScanOpen && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-neutral-300">
              <Lock className="h-3 w-3" />
              Opens {scanOpensLabel}
            </span>
          )}
        </div>
        <div className="relative mt-2">
          {isScanOpen ? (
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
          ) : (
            <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-neutral-500" />
          )}
          <input
            type="text"
            disabled={!isScanOpen}
            value={isScanOpen ? lookupQuery : ''}
            onChange={(e) => setLookupQuery(e.target.value)}
            placeholder={
              isScanOpen
                ? 'Type XMAS26-B001, phone number, or guest name...'
                : `Manual check-in opens on ${scanOpensLabel}...`
            }
            className="w-full rounded-2xl border border-white/15 bg-white/10 py-2.5 pl-9 pr-3 text-sm text-white placeholder-neutral-400 transition focus:border-white/60 focus:bg-white/15 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
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
                    <span className="text-sm font-medium text-neutral-200">
                      {b.holderName}
                    </span>
                  </div>
                  <div className="text-xs text-neutral-400">
                    {b.phone} · {b.totalPax} Pax · Tables: {b.tablesSummary}
                  </div>
                </div>
                <span className="rounded-xl bg-white/15 px-3 py-1.5 text-xs font-bold text-white">
                  Check In →
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* PRE-TICKED ATTENDEE CHECKLIST MODAL */}
      {activeBooking && (
        <div className="fixed inset-x-0 bottom-[70px] top-0 z-50 flex items-end justify-center bg-neutral-950/70 p-3 sm:items-center sm:p-4">
          <div className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex shrink-0 items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-extrabold text-neutral-900">
                    {activeBooking.bookingCode}
                  </span>
                  {activeBooking.status === 'cancelled' && (
                    <span className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                      CANCELLED
                    </span>
                  )}
                </div>
                <div className="text-sm font-semibold text-neutral-800">
                  {activeBooking.holderName} · {activeBooking.totalPax} Pax
                </div>
                <div className="text-xs text-neutral-500">
                  Tables: {activeBooking.tablesSummary} · {activeBooking.paymentMode} (
                  {activeBooking.paymentStatus})
                </div>
              </div>
              <button type="button" onClick={() => setActiveBooking(null)}>
                <X className="h-5 w-5 text-neutral-400" />
              </button>
            </div>

            {/* Ed25519 Signature Status */}
            <div className="mt-3">
              {sigStatus === 'verified' && (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  QR Signature Verified
                </div>
              )}
              {sigStatus === 'invalid' && (
                <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">
                  <ShieldAlert className="h-4 w-4 text-rose-600" />
                  Warning: QR signature could not be verified!
                </div>
              )}
            </div>

            {/* Mandatory Pay-at-Door Collection Step (All /desk payment options) */}
            {activeBooking.paymentMode === 'PAY_AT_DOOR' &&
              activeBooking.paymentStatus !== 'paid' && (
                <div className="mt-3 shrink-0 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-bold text-amber-900">
                      <Wallet className="h-4 w-4 text-amber-700" />
                      Payment Due at Door
                    </div>
                    <span className="text-sm font-extrabold text-amber-950 tabular-nums">
                      {doorPaymentMethod === 'COMPLIMENTARY'
                        ? '₹0'
                        : `₹${activeBooking.totalAmount.toLocaleString('en-IN')}`}
                    </span>
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                    {(
                      [
                        { key: 'RAZORPAY', label: isOnline ? 'Razorpay QR' : 'Razorpay (Offline)' },
                        { key: 'CASH', label: 'Cash' },
                        { key: 'OFFICER_UPI', label: 'Officer UPI' },
                        { key: 'COMPLIMENTARY', label: 'Complimentary (₹0)' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        disabled={opt.key === 'RAZORPAY' && !isOnline}
                        onClick={() => {
                          setDoorPaymentMethod(opt.key)
                          setDoorPaymentConfirmed(false)
                          setDoorRzpError(null)
                        }}
                        className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-45 ${doorPaymentMethod === opt.key
                          ? 'bg-amber-900 text-white shadow-xs'
                          : 'border border-amber-300 bg-white text-amber-900 hover:bg-amber-100/70'
                          }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {doorPaymentMethod === 'RAZORPAY' ? (
                    <div className="mt-2.5 rounded-lg bg-neutral-950 p-3 text-center text-white">
                      {doorRzpLink ? (
                        <div className="flex flex-col items-center gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/qr/link?url=${encodeURIComponent(doorRzpLink)}`}
                            alt="Razorpay Payment QR"
                            className="h-36 w-36 rounded-xl"
                          />
                          <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-300">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Waiting for Razorpay payment…</span>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <button
                            type="button"
                            disabled={doorRzpLoading || !isOnline}
                            onClick={handleGenerateDoorRazorpay}
                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-bold text-neutral-950 transition hover:bg-neutral-200 disabled:opacity-50"
                          >
                            {doorRzpLoading ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Generating QR…
                              </>
                            ) : (
                              <>
                                <QrCode className="h-3.5 w-3.5" />
                                Generate Razorpay QR · ₹
                                {activeBooking.totalAmount.toLocaleString('en-IN')}
                              </>
                            )}
                          </button>
                          {doorRzpError && (
                            <p className="text-[11px] font-medium text-rose-300">{doorRzpError}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <label className="mt-2.5 flex cursor-pointer items-center gap-2 rounded-lg bg-white/80 px-2.5 py-2 font-semibold text-amber-950 ring-1 ring-amber-200">
                      <input
                        type="checkbox"
                        checked={doorPaymentConfirmed}
                        onChange={(e) => setDoorPaymentConfirmed(e.target.checked)}
                        className="h-4 w-4 rounded accent-amber-700"
                      />
                      <span>
                        {doorPaymentMethod === 'COMPLIMENTARY'
                          ? 'Confirm Complimentary entry (₹0)'
                          : `Collected ₹${activeBooking.totalAmount.toLocaleString('en-IN')} via ${doorPaymentMethod === 'OFFICER_UPI' ? 'Officer UPI' : 'Cash'}`}
                      </span>
                    </label>
                  )}
                </div>
              )}

            {/* Attendee Slots Checklist (Grouped by Ticket; Pre-ticked by default; checked-in slots locked permanently) */}
            <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Uncheck absent guests, then confirm check-in:
              </div>
              {activeTicketGroups.map((grp) => (
                <div
                  key={grp.ticketId}
                  className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-2.5"
                >
                  <div className="mb-1.5 flex items-center justify-between px-1">
                    <span className="text-xs font-bold text-neutral-800">
                      {grp.ticketCode} · {grp.typeName}
                    </span>
                    <span className="rounded bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-600 shadow-xs">
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
                            ? 'border-neutral-200 bg-neutral-100 text-neutral-500'
                            : checked
                              ? 'border-emerald-400 bg-emerald-50/80 text-neutral-900'
                              : 'border-neutral-200 bg-white text-neutral-700'
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
                                <div className="text-[10px] text-neutral-500">
                                  Guest {slot.slotIndex} of {grp.slots.length}
                                </div>
                              )}
                              {alreadyLocked && (
                                <div className="text-[10px] text-neutral-500">
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
                            <span className="inline-flex items-center gap-1 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-bold text-neutral-600">
                              <Lock className="h-3 w-3" /> LOCKED
                            </span>
                          ) : (
                            <CheckCircle2
                              className={`h-4 w-4 ${checked ? 'text-emerald-600' : 'text-neutral-300'}`}
                            />
                          )}
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setActiveBooking(null)}
                className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-xs font-bold text-neutral-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  !canScan ||
                  !isScanOpen ||
                  savingCheckin ||
                  activeBooking.status === 'cancelled' ||
                  activeSlots.every((s) => Boolean(s.checkedInAt)) ||
                  (activeBooking.paymentMode === 'PAY_AT_DOOR' &&
                    activeBooking.paymentStatus !== 'paid' &&
                    (doorPaymentMethod === 'RAZORPAY' || !doorPaymentConfirmed))
                }
                onClick={handleConfirmCheckin}
                className="flex-[2] rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50"
              >
                {savingCheckin
                  ? 'Locking Check-In…'
                  : activeBooking.paymentMode === 'PAY_AT_DOOR' &&
                    activeBooking.paymentStatus !== 'paid'
                    ? doorPaymentMethod === 'RAZORPAY'
                      ? 'Awaiting Razorpay…'
                      : doorPaymentMethod === 'COMPLIMENTARY'
                        ? 'Mark Complimentary & Check In'
                        : `Collect ₹${activeBooking.totalAmount.toLocaleString('en-IN')} & Check In`
                    : 'Confirm & Lock Check-In'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
