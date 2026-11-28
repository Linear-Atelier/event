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
import { EventSelectorBar } from '@/components/EventSelectorBar'
import { Button, ModalShell, StatusBadge } from '@/components/ui/primitives'

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
  const [lookupFocused, setLookupFocused] = useState(false)
  const [lookupResults, setLookupResults] = useState<CachedBooking[]>([])
  const isManualLookupActive =
    isScanOpen && (lookupFocused || lookupQuery.trim().length > 0)

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
  >('RAZORPAY')
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
    const worker = new Worker(new URL('../workers/gate-sync.worker.ts', import.meta.url))
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
            `${pushSummary}Synced ${msg.bookingCount} bookings & ${msg.slotCount} guest slots.`,
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

  useEffect(() => {
    if (!syncWorkerRef.current || !selectedEventId) return
    const msg: GateSyncWorkerInMessage = {
      type: 'CONFIGURE',
      eventId: selectedEventId,
      isOnline,
    }
    syncWorkerRef.current.postMessage(msg)
  }, [selectedEventId, isOnline])

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
      setDoorPaymentMethod(isOnline ? 'RAZORPAY' : 'CASH')
      setDoorPaymentConfirmed(false)
      setDoorRzpLink(null)
      setDoorRzpError(null)
    },
    [isOnline, isScanOpen, scanOpensLabel],
  )

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

  useEffect(() => {
    const q = lookupQuery.trim().toLowerCase()
    if (!q) return

    let cancelled = false
      ; (async () => {
        const allBookings = await offlineDb.bookings
          .where('eventId')
          .equals(selectedEventId)
          .toArray()

        const [matchingTickets, matchingSlots] = await Promise.all([
          offlineDb.tickets.filter((t) => t.ticketCode.toLowerCase().includes(q)).toArray(),
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
            status: 'confirmed',
            paymentMode: 'RAZORPAY',
            paymentStatus: 'paid',
          })
          setActiveBooking((prev) =>
            prev && prev.id === bookingId
              ? { ...prev, status: 'confirmed', paymentMode: 'RAZORPAY', paymentStatus: 'paid' }
              : prev,
          )
          setDoorRzpLink(null)
          setDoorRzpError(null)
        }
      } catch {
        // Ignore transient network errors
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
          status: 'confirmed',
          paymentMode: 'RAZORPAY',
          paymentStatus: 'paid',
        })
        setActiveBooking((prev) =>
          prev
            ? { ...prev, status: 'confirmed', paymentMode: 'RAZORPAY', paymentStatus: 'paid' }
            : prev,
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

  async function handleConfirmCheckin() {
    if (!activeBooking || !canScan) return
    if (!isScanOpen) {
      setStatusBanner(`Gate check-in opens on ${scanOpensLabel}.`)
      setActiveBooking(null)
      return
    }
    const needsDoorPayment =
      activeBooking.status === 'pay_at_door' || activeBooking.paymentStatus !== 'paid'
    if (needsDoorPayment && (doorPaymentMethod === 'RAZORPAY' || !doorPaymentConfirmed)) {
      return
    }

    const toCheckIn = activeSlots.filter((s) => !s.checkedInAt && checkedSlotIds[s.id])
    const offlineDoorMode =
      needsDoorPayment && doorPaymentMethod !== 'RAZORPAY' ? doorPaymentMethod : undefined

    if (toCheckIn.length === 0 && !offlineDoorMode) {
      setActiveBooking(null)
      return
    }

    setSavingCheckin(true)
    const nowIso = new Date().toISOString()

    try {
      await offlineDb.transaction(
        'rw',
        [offlineDb.bookings, offlineDb.slots, offlineDb.pendingSync],
        async () => {
          if (offlineDoorMode) {
            await offlineDb.bookings.update(activeBooking.id, {
              status: 'confirmed',
              paymentMode: offlineDoorMode,
              paymentStatus: 'paid',
              totalAmount:
                offlineDoorMode === 'COMPLIMENTARY' ? 0 : activeBooking.totalAmount,
            })
          }
          if (toCheckIn.length > 0) {
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
          } else if (offlineDoorMode) {
            // All slots already checked in (or booking has no slots): queue booking-level payment settlement
            await offlineDb.pendingSync.add({
              slotId: activeSlots[0]?.id || 0,
              bookingId: activeBooking.id,
              checkedInAt: activeSlots[0]?.checkedInAt || nowIso,
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
            ? toCheckIn.length > 0
              ? `Marked complimentary (₹0) & checked in ${toCheckIn.length} guest(s) for ${activeBooking.bookingCode}.`
              : `Marked complimentary (₹0) for ${activeBooking.bookingCode}.`
            : toCheckIn.length > 0
              ? `Collected ₹${activeBooking.totalAmount.toLocaleString('en-IN')} (${modeText}) & checked in ${toCheckIn.length} guest(s) for ${activeBooking.bookingCode}.`
              : `Collected ₹${activeBooking.totalAmount.toLocaleString('en-IN')} (${modeText}) for ${activeBooking.bookingCode}.`
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

  function handleSelectEvent(nextId: number) {
    const nextEv = events.find((ev) => ev.id === nextId)
    if (nextEv && (nextEv.isScanOpen === false || !isScanAllowedForEventDate(nextEv.date))) {
      stopCamera()
      setLookupQuery('')
      setActiveBooking(null)
    }
    setSelectedEventId(nextId)
  }

  return (
    <div className="flex min-h-[calc(100dvh-5.5rem)] flex-col bg-neutral-950 text-white">
      {/* Dark Gate Control Header */}
      <div className="shrink-0 space-y-3 border-b border-neutral-800 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${isOnline
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-amber-500/20 text-amber-300'
                }`}
            >
              {isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              {isOnline ? 'Online' : 'Offline Mode'}
            </span>
          </div>
          <span className="text-xs font-semibold text-neutral-400">Device: {deviceId}</span>
        </div>

        <EventSelectorBar
          events={events}
          value={selectedEventId}
          onChange={handleSelectEvent}
          label=""
          tone="dark"
        />

        {/* Offline Roster Sync Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-3.5 py-2.5">
          <div className="min-w-0 flex-1 text-sm text-neutral-200">
            {cachedEvent ? (
              <div>
                <span className="font-bold text-white">{cachedBookingCount} bookings</span> cached
                {lastSyncedAt && (
                  <span className="ml-1.5 text-neutral-400">
                    ·{' '}
                    {new Date(lastSyncedAt).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
              </div>
            ) : (
              <span className="font-semibold text-amber-300">
                No roster cached — tap Sync before arriving at venue
              </span>
            )}
          </div>

          <button
            type="button"
            disabled={syncing || !isOnline}
            onClick={() => triggerUnifiedSync(true)}
            className={`inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-extrabold transition disabled:opacity-45 ${pendingSyncCount > 0
              ? 'bg-amber-400 text-neutral-950 hover:bg-amber-300'
              : 'bg-white text-neutral-950 hover:bg-neutral-200'
              }`}
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing
              ? 'Syncing…'
              : pendingSyncCount > 0
                ? `Sync (${pendingSyncCount})`
                : 'Sync Roster'}
          </button>
        </div>
      </div>

      {statusBanner && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-900 px-4 py-3 text-sm font-semibold text-white">
          <span>{statusBanner}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            aria-label="Dismiss status message"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-neutral-300 hover:bg-neutral-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Camera Viewport (shrinks into a compact bar while Manual Lookup is active) */}
      <div
        className={`relative flex items-center justify-center overflow-hidden bg-black transition-all ${isManualLookupActive ? 'shrink-0 px-4 py-3' : 'min-h-[340px] flex-1'
          }`}
      >
        {isManualLookupActive ? (
          <button
            type="button"
            onClick={() => {
              setLookupQuery('')
              setLookupFocused(false)
              userStoppedCameraRef.current = false
              void startCamera()
            }}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-4 text-sm font-bold text-white transition hover:border-white hover:bg-neutral-800"
          >
            <Camera className="h-5 w-5" />
            Switch Back to QR Camera
          </button>
        ) : cameraActive ? (
          <div className="absolute inset-0 bg-black">
            <video
              ref={videoRef}
              playsInline
              muted
              className="h-full w-full object-cover"
            />
            <canvas ref={canvasRef} className="hidden" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-16">
              <div className="relative h-56 w-56 rounded-3xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
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
                className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/25 bg-neutral-950/90 px-5 text-sm font-bold text-white transition hover:bg-rose-600"
              >
                <CameraOff className="h-5 w-5" />
                Stop Camera
              </button>
            </div>
          </div>
        ) : !isScanOpen ? (
          <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-900 text-neutral-300">
              <Lock className="h-6 w-6" />
            </div>
            <p className="mt-3 text-lg font-extrabold text-white">
              Gate Check-In Opens on{' '}
              {selectedEvent ? formatEventDayLabel(selectedEvent.date) : 'Event Day'}
            </p>
            <p className="mt-1.5 max-w-sm text-sm text-neutral-300">
              Scanning is locked until event day. You can still tap Sync Roster above to download
              the guest list ahead of time.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
            <button
              type="button"
              onClick={() => {
                userStoppedCameraRef.current = false
                void startCamera()
              }}
              className="inline-flex min-h-14 items-center gap-2.5 rounded-2xl bg-white px-7 text-base font-extrabold text-neutral-950 transition hover:bg-neutral-200 active:scale-[0.98]"
            >
              <Camera className="h-5 w-5" />
              Start Camera
            </button>
            <p className="mt-3 text-sm font-medium text-neutral-300">
              Tap to scan Master QR passes offline
            </p>
            {cameraError && (
              <p className="mt-2 max-w-sm text-sm font-semibold text-rose-400">{cameraError}</p>
            )}
          </div>
        )}
      </div>

      {/* Offline Manual Lookup */}
      <div
        className={`border-t border-neutral-800 bg-neutral-950 px-4 py-4 ${isManualLookupActive ? 'flex min-h-0 flex-1 flex-col' : 'shrink-0'
          }`}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-extrabold text-white">Manual Lookup</h2>
          {!isScanOpen ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-800 px-3 py-1 text-xs font-bold text-neutral-200">
              <Lock className="h-3.5 w-3.5" />
              Opens {scanOpensLabel}
            </span>
          ) : isManualLookupActive ? (
            <button
              type="button"
              onClick={() => {
                setLookupQuery('')
                setLookupFocused(false)
              }}
              className="min-h-10 rounded-lg px-2.5 text-sm font-bold text-neutral-300 hover:bg-neutral-800 hover:text-white"
            >
              Done
            </button>
          ) : null}
        </div>

        <div className="relative mt-2.5">
          {isScanOpen ? (
            <Search className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-neutral-400" />
          ) : (
            <Lock className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-neutral-500" />
          )}
          <input
            type="text"
            disabled={!isScanOpen}
            value={isScanOpen ? lookupQuery : ''}
            onFocus={() => {
              setLookupFocused(true)
              if (cameraActive) {
                userStoppedCameraRef.current = true
                stopCamera()
              }
            }}
            onBlur={() => {
              if (!lookupQuery.trim()) {
                setLookupFocused(false)
              }
            }}
            onChange={(e) => {
              const next = e.target.value
              setLookupQuery(next)
              if (next.trim() && cameraActive) {
                userStoppedCameraRef.current = true
                stopCamera()
              }
            }}
            placeholder={
              isScanOpen
                ? 'Type booking code, phone, or guest name…'
                : `Manual check-in opens on ${scanOpensLabel}…`
            }
            className="min-h-12 w-full rounded-xl border border-neutral-700 bg-neutral-900 py-2.5 pl-11 pr-11 text-base text-white placeholder:text-neutral-400 transition focus:border-white focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          {isScanOpen && lookupQuery && (
            <button
              type="button"
              onClick={() => setLookupQuery('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {visibleLookupResults.length > 0 && (
          <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto  pb-24">
            {visibleLookupResults.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => openBookingChecklist(b, 'manual', 'manual_code')}
                className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-3.5 py-3 text-left transition hover:border-neutral-600 hover:bg-neutral-800"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-extrabold text-white">{b.bookingCode}</span>
                    <span className="truncate text-base font-semibold text-neutral-200">
                      {b.holderName}
                    </span>
                    {b.status === 'pay_at_door' && (
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300 tabular-nums">
                        Pay at Door · ₹{b.totalAmount.toLocaleString('en-IN')}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-sm text-neutral-400">
                    {b.phone} · {b.totalPax} Guests · Tables: {b.tablesSummary}
                  </div>
                </div>
                <span className="shrink-0 rounded-xl bg-white px-3.5 py-2 text-sm font-extrabold text-neutral-950">
                  Check In
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* HIGH-CONTRAST WHITE ATTENDEE CHECKLIST MODAL */}
      {activeBooking && (
        <ModalShell
          title={activeBooking.bookingCode}
          badge={
            activeBooking.status === 'cancelled' ? (
              <StatusBadge tone="rose">CANCELLED</StatusBadge>
            ) : undefined
          }
          subtitle={`${activeBooking.holderName} · ${activeBooking.totalPax} Guests · Tables: ${activeBooking.tablesSummary}`}
          onClose={() => setActiveBooking(null)}
          disableClose={savingCheckin}
          maxWidthClass="max-w-md"
          footer={
            <div className="flex gap-2.5">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setActiveBooking(null)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="success"
                loading={savingCheckin}
                disabled={
                  !canScan ||
                  !isScanOpen ||
                  activeBooking.status === 'cancelled' ||
                  (activeBooking.status === 'pay_at_door' ||
                    activeBooking.paymentStatus !== 'paid'
                    ? doorPaymentMethod === 'RAZORPAY' || !doorPaymentConfirmed
                    : activeSlots.every((s) => Boolean(s.checkedInAt)))
                }
                onClick={handleConfirmCheckin}
                className="flex-[1.7]"
              >
                {savingCheckin
                  ? 'Saving…'
                  : activeBooking.status === 'pay_at_door' ||
                    activeBooking.paymentStatus !== 'paid'
                    ? doorPaymentMethod === 'RAZORPAY'
                      ? 'Awaiting Razorpay…'
                      : doorPaymentMethod === 'COMPLIMENTARY'
                        ? activeSlots.every((s) => Boolean(s.checkedInAt))
                          ? 'Mark Free (₹0)'
                          : 'Mark Free & Check In'
                        : activeSlots.every((s) => Boolean(s.checkedInAt))
                          ? `Collect ₹${activeBooking.totalAmount.toLocaleString('en-IN')}`
                          : `Collect ₹${activeBooking.totalAmount.toLocaleString('en-IN')} & Check In`
                    : 'Confirm & Lock Check-In'}
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            {/* Ed25519 Signature Status */}
            {sigStatus === 'verified' && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-bold text-emerald-900">
                <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-700" />
                QR Signature Verified Offline
              </div>
            )}
            {sigStatus === 'invalid' && (
              <div className="flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-2.5 text-sm font-bold text-rose-900">
                <ShieldAlert className="h-5 w-5 shrink-0 text-rose-700" />
                Warning: QR signature could not be verified!
              </div>
            )}

            {/* Pay-at-Door Collection Step */}
            {(activeBooking.status === 'pay_at_door' ||
              activeBooking.paymentStatus !== 'paid') && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-extrabold text-amber-950">
                      <Wallet className="h-5 w-5 text-amber-800" />
                      Payment Due at Door
                    </div>
                    <span className="text-lg font-extrabold text-amber-950 tabular-nums">
                      {doorPaymentMethod === 'COMPLIMENTARY'
                        ? '₹0'
                        : `₹${activeBooking.totalAmount.toLocaleString('en-IN')}`}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
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
                        className={`min-h-12 rounded-xl px-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-45 ${doorPaymentMethod === opt.key
                          ? 'bg-amber-900 text-white'
                          : 'border border-amber-300 bg-white text-amber-950 hover:bg-amber-100'
                          }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {doorPaymentMethod === 'RAZORPAY' ? (
                    <div className="mt-3 ">
                      {doorRzpLink ? (
                        <div className="flex flex-col items-center gap-2.5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/qr/link?url=${encodeURIComponent(doorRzpLink)}`}
                            alt="Razorpay Payment QR"
                            className="h-44 w-44 rounded-xl border border-neutral-800 bg-neutral-950 p-2.5"
                          />
                          <div className="flex items-center gap-2 text-sm font-bold text-emerald-700">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Waiting for Razorpay payment…</span>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Button
                            type="button"
                            variant="primary"
                            fullWidth
                            loading={doorRzpLoading}
                            disabled={!isOnline}
                            onClick={handleGenerateDoorRazorpay}
                          >
                            {!doorRzpLoading && <QrCode className="h-4 w-4" />}
                            {doorRzpLoading
                              ? 'Generating QR…'
                              : `Generate QR · ₹${activeBooking.totalAmount.toLocaleString('en-IN')}`}
                          </Button>
                          {doorRzpError && (
                            <p className="text-sm font-semibold text-rose-700">{doorRzpError}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <label className="mt-3 flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-amber-300 bg-white px-3.5 py-2.5 font-bold text-amber-950">
                      <input
                        type="checkbox"
                        checked={doorPaymentConfirmed}
                        onChange={(e) => setDoorPaymentConfirmed(e.target.checked)}
                        className="h-6 w-6 shrink-0 rounded accent-amber-800"
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

            {/* Pre-Ticked Guest Checklist */}
            <div className="space-y-3">
              <div className="text-sm font-bold text-neutral-700">
                Uncheck absent guests, then confirm check-in:
              </div>
              {activeTicketGroups.map((grp) => (
                <div
                  key={grp.ticketId}
                  className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2 px-1">
                    <span className="text-sm font-extrabold text-neutral-900">
                      {grp.ticketCode} · {grp.typeName}
                    </span>
                    <StatusBadge tone="neutral">
                      {grp.slots.length} {grp.slots.length === 1 ? 'Guest' : 'Guests'}
                    </StatusBadge>
                  </div>

                  <div className="space-y-2">
                    {grp.slots.map((slot) => {
                      const alreadyLocked = Boolean(slot.checkedInAt)
                      const checked = alreadyLocked || Boolean(checkedSlotIds[slot.id])
                      const displayName =
                        slot.attendeeName || slot.label.split(' — ')[0] || slot.label

                      return (
                        <label
                          key={slot.id}
                          className={`flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 transition ${alreadyLocked
                            ? 'cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-600'
                            : checked
                              ? 'border-emerald-500 bg-emerald-50 text-neutral-950'
                              : 'border-neutral-300 bg-white text-neutral-800'
                            }`}
                        >
                          <div className="flex items-center gap-3">
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
                              className="h-6 w-6 shrink-0 rounded accent-emerald-700"
                            />
                            <div>
                              <div className="text-base font-bold">{displayName}</div>
                              {grp.slots.length > 1 && !alreadyLocked && (
                                <div className="text-xs font-medium text-neutral-600">
                                  Guest {slot.slotIndex} of {grp.slots.length}
                                </div>
                              )}
                              {alreadyLocked && (
                                <div className="text-xs font-medium text-neutral-600">
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
                            <StatusBadge tone="neutral">
                              <Lock className="h-3.5 w-3.5" />
                              LOCKED
                            </StatusBadge>
                          ) : (
                            <CheckCircle2
                              className={`h-5 w-5 shrink-0 ${checked ? 'text-emerald-700' : 'text-neutral-300'
                                }`}
                            />
                          )}
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  )
}
