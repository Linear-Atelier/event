'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  Minus,
  Plus,
  Search,
  Ticket,
  UserCheck,
  Users,
  X,
} from 'lucide-react'
import { EventSelectorBar } from '@/components/EventSelectorBar'
import { ResendPassModal, type ResendChannel } from '@/components/ResendPassModal'
import { TicketPassModal } from '@/components/TicketPassModal'
import {
  Button,
  Card,
  FieldLabel,
  ModalShell,
  PageHeader,
  StatusBadge,
  TextArea,
  TextInput,
  buttonClasses,
  type BadgeTone,
} from '@/components/ui/primitives'

interface EventOption {
  id: number
  code: string
  name: string
  date: string
  venue: string
}

interface MemberResult {
  id: number
  memberCode: string
  fullName: string
  phone: string
  email?: string | null
  subsStatus: 'active' | 'arrears' | 'inactive'
  subsPaidUntil?: string | null
}

interface PhaseOption {
  id: string
  phaseName: string
  price: number
  maxQty: number | null
  startsAt?: string | null
  endsAt?: string | null
  overrideStatus?: 'auto' | 'force_active' | 'force_inactive'
  isActive: boolean
  ticketTypeId: string
  ticketTypeName: string
  paxMultiplier: number
  memberOnly: boolean
}

interface TableOption {
  tableLabel: string
  tableTypeName: string
  maxCapacity: number
  price?: number
  isReserved: boolean
  reservedByBookingId: number | null
  reservedByBookingCode: string | null
  reservedByHolderName: string | null
}

interface PaxDetailEntry {
  name: string
  memberId: number | null
  memberCode?: string | null
  subsStatus?: 'active' | 'arrears' | 'inactive' | null
  touched?: boolean
}

interface BookedAttendee {
  memberId: number | null
  name: string
  bookingCode: string
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

function formatTicketDisplayName(name: string): string {
  const stripped = name.replace(/^(?:non[-\s]?member|member)\s+/i, '').trim()
  return stripped || name
}

function subsBadgeTone(status?: string | null): BadgeTone {
  if (status === 'active') return 'emerald'
  if (status === 'arrears') return 'amber'
  return 'rose'
}

interface BookingDeskClientProps {
  events: EventOption[]
  initialEventId: number | null
  canCreate: boolean
}

export function BookingDeskClient({
  events,
  initialEventId,
  canCreate,
}: BookingDeskClientProps) {
  const [selectedEventId, setSelectedEventId] = useState<number>(
    initialEventId || events[0]?.id || 0,
  )
  const [phases, setPhases] = useState<PhaseOption[]>([])
  const [tables, setTables] = useState<TableOption[]>([])
  const [bookedAttendees, setBookedAttendees] = useState<BookedAttendee[]>([])
  const [loadingMeta, setLoadingMeta] = useState(false)

  // Primary Holder member lookup
  const [holderFocused, setHolderFocused] = useState(false)
  const [memberResults, setMemberResults] = useState<MemberResult[]>([])
  const [selectedMember, setSelectedMember] = useState<MemberResult | null>(null)
  const [searchingMembers, setSearchingMembers] = useState(false)

  // Holder info
  const [holderName, setHolderName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [holderTouched, setHolderTouched] = useState(false)
  const [phoneTouched, setPhoneTouched] = useState(false)
  const [emailTouched, setEmailTouched] = useState(false)
  const [paymentMode, setPaymentMode] = useState<
    'RAZORPAY' | 'CASH' | 'OFFICER_UPI' | 'COMPLIMENTARY' | 'PAY_AT_DOOR'
  >('RAZORPAY')
  const [notes, setNotes] = useState('')

  // Ticket quantities & pax details
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [paxDetails, setPaxDetails] = useState<Record<string, PaxDetailEntry>>({})
  const [activePaxKey, setActivePaxKey] = useState<string | null>(null)
  const [paxMemberResults, setPaxMemberResults] = useState<MemberResult[]>([])
  const [searchingPax, setSearchingPax] = useState(false)

  // Table selections
  const [selectedTables, setSelectedTables] = useState<string[]>([])

  // Submission & modals
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<{
    bookingId: number
    bookingCode: string
    holderName: string
    phone?: string | null
    email?: string | null
    totalPax: number
    totalAmount: number
    tablesSummary: string
    tickets: Array<{
      id: number
      ticketCode: string
      ticketTypeName?: string
      paxCount: number
      paxNames?: string[]
    }>
  } | null>(null)
  const [showResendModal, setShowResendModal] = useState(false)
  const [resendingReceipt, setResendingReceipt] = useState(false)
  const [resendFeedback, setResendFeedback] = useState<{
    type: 'ok' | 'err'
    text: string
  } | null>(null)
  const [pendingPayment, setPendingPayment] = useState<{
    bookingId: number
    bookingCode: string
    holderName: string
    phone: string
    email?: string | null
    totalPax: number
    totalAmount: number
    tablesSummary: string
    paymentLinkUrl: string
    paymentExpiresAt: string
    tickets: Array<{
      id: number
      ticketCode: string
      ticketTypeName?: string
      paxCount: number
      paxNames?: string[]
    }>
  } | null>(null)

  const loadEventMeta = useCallback(async (eventId: number) => {
    if (!eventId) return
    setLoadingMeta(true)
    try {
      const res = await fetch(`/api/events/meta?eventId=${eventId}`, {
        credentials: 'include',
      })
      if (res.ok) {
        const data = await res.json()
        setPhases((data.ticketPhases || []).filter((p: PhaseOption) => p.isActive))
        setTables(data.tables || [])
        setBookedAttendees(Array.isArray(data.bookedAttendees) ? data.bookedAttendees : [])
      }
    } finally {
      setLoadingMeta(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedEventId) return
    const timer = setTimeout(() => {
      void loadEventMeta(selectedEventId)
    }, 0)
    return () => clearTimeout(timer)
  }, [selectedEventId, loadEventMeta])

  // Debounced member search on Holder Name
  useEffect(() => {
    const q = holderName.trim()
    if (!holderFocused || selectedMember || q.length < 2) return

    let cancelled = false
    const timer = setTimeout(async () => {
      setSearchingMembers(true)
      try {
        const res = await fetch(`/api/members/search?q=${encodeURIComponent(q)}`, {
          credentials: 'include',
        })
        if (res.ok && !cancelled) {
          const data = await res.json()
          setMemberResults(data.members || [])
        }
      } finally {
        if (!cancelled) setSearchingMembers(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [holderName, holderFocused, selectedMember])

  const visibleMemberResults =
    holderFocused && !selectedMember && holderName.trim().length >= 2 ? memberResults : []

  function selectMember(m: MemberResult) {
    setSelectedMember(m)
    setHolderName(m.fullName)
    setPhone(m.phone)
    setEmail(m.email || '')
    setHolderTouched(true)
    setPhoneTouched(true)
    setEmailTouched(true)
    setMemberResults([])
    setHolderFocused(false)
  }

  function clearMember() {
    setSelectedMember(null)
  }

  function adjustQty(phaseId: string, delta: number) {
    const nextQty = Math.max(0, (quantities[phaseId] || 0) + delta)
    setQuantities((prev) => ({ ...prev, [phaseId]: nextQty }))
    if (delta < 0) {
      setPaxDetails((prev) => {
        const cleaned: Record<string, PaxDetailEntry> = {}
        for (const [k, v] of Object.entries(prev)) {
          const prefix = `${phaseId}-`
          if (k.startsWith(prefix)) {
            const rest = k.slice(prefix.length).split('-')
            if (Number(rest[0]) >= nextQty) {
              continue
            }
          }
          cleaned[k] = v
        }
        return cleaned
      })
    }
  }

  const selectedPhases = useMemo(
    () => phases.filter((p) => (quantities[p.id] || 0) > 0),
    [phases, quantities],
  )

  const defaultPhaseName = useMemo(() => {
    if (phases.length === 0) return null
    const counts = new Map<string, number>()
    for (const p of phases) {
      counts.set(p.phaseName, (counts.get(p.phaseName) || 0) + 1)
    }
    let best = phases[0].phaseName
    let bestCount = 0
    for (const [name, count] of counts.entries()) {
      if (count > bestCount) {
        best = name
        bestCount = count
      }
    }
    return best
  }, [phases])

  const groupedTicketPhases = useMemo(() => {
    const memberItems = phases.filter((p) => p.memberOnly)
    const nonMemberItems = phases.filter((p) => !p.memberOnly)
    const groups: Array<{ key: 'member' | 'non_member'; title: string; items: PhaseOption[] }> = []
    if (memberItems.length > 0) {
      groups.push({ key: 'member', title: 'Member Tickets', items: memberItems })
    }
    if (nonMemberItems.length > 0) {
      groups.push({ key: 'non_member', title: 'Non-Member / Guest Tickets', items: nonMemberItems })
    }
    return groups
  }, [phases])

  const expandedTicketGroups = useMemo(() => {
    const groups: Array<{
      phase: PhaseOption
      ticketIdx: number
      displayIndex: number
      paxKeys: string[]
    }> = []
    let counter = 0
    for (const p of selectedPhases) {
      const qty = quantities[p.id] || 0
      for (let tIdx = 0; tIdx < qty; tIdx++) {
        counter += 1
        const paxKeys: string[] = []
        for (let pIdx = 0; pIdx < p.paxMultiplier; pIdx++) {
          paxKeys.push(`${p.id}-${tIdx}-${pIdx}`)
        }
        groups.push({
          phase: p,
          ticketIdx: tIdx,
          displayIndex: counter,
          paxKeys,
        })
      }
    }
    return groups
  }, [selectedPhases, quantities])

  const firstPaxKey = expandedTicketGroups[0]?.paxKeys[0] || null

  const getPaxEntry = useCallback(
    (key: string): PaxDetailEntry => {
      return paxDetails[key] || { name: '', memberId: null }
    },
    [paxDetails],
  )

  const { bookedByMemberId, bookedByNormalizedName } = useMemo(() => {
    const byId = new Map<number, string>()
    const byName = new Map<string, string>()
    for (const a of bookedAttendees) {
      if (a.memberId) byId.set(a.memberId, a.bookingCode)
      const norm = normalizeName(a.name)
      if (norm) byName.set(norm, a.bookingCode)
    }
    return { bookedByMemberId: byId, bookedByNormalizedName: byName }
  }, [bookedAttendees])

  const { missingPaxCount, missingMemberCount, slotDuplicateErrors, duplicatePaxCount } =
    useMemo(() => {
      let missingNames = 0
      let missingMembers = 0
      const dupErrors = new Map<string, string>()
      const seenMemberKey = new Map<number, string>()
      const seenNameKey = new Map<string, string>()

      for (const grp of expandedTicketGroups) {
        grp.paxKeys.forEach((k) => {
          const entry = getPaxEntry(k)
          const requiresMember = Boolean(grp.phase.memberOnly)
          if (requiresMember && !entry.memberId) {
            missingMembers += 1
          } else if (!entry.name.trim()) {
            missingNames += 1
          }

          if (entry.memberId) {
            const existingCode = bookedByMemberId.get(entry.memberId)
            if (existingCode) {
              dupErrors.set(k, `Already booked on ${existingCode}`)
            } else if (seenMemberKey.has(entry.memberId)) {
              dupErrors.set(k, 'Already added in another ticket slot')
            } else {
              seenMemberKey.set(entry.memberId, k)
            }
          }

          const norm = normalizeName(entry.name)
          if (norm && !dupErrors.has(k)) {
            const existingCode = bookedByNormalizedName.get(norm)
            if (existingCode) {
              dupErrors.set(k, `Already booked on ${existingCode}`)
            } else if (seenNameKey.has(norm)) {
              dupErrors.set(k, 'Duplicate name in this booking')
            } else {
              seenNameKey.set(norm, k)
            }
          }
        })
      }

      return {
        missingPaxCount: missingNames + missingMembers,
        missingMemberCount: missingMembers,
        slotDuplicateErrors: dupErrors,
        duplicatePaxCount: dupErrors.size,
      }
    }, [expandedTicketGroups, getPaxEntry, bookedByMemberId, bookedByNormalizedName])

  // Debounced inline member lookup for active pax input
  const activePaxQuery = activePaxKey ? getPaxEntry(activePaxKey).name.trim() : ''
  const activePaxHasLinkedMember = activePaxKey
    ? Boolean(getPaxEntry(activePaxKey).memberId)
    : false

  useEffect(() => {
    if (!activePaxKey || activePaxHasLinkedMember || activePaxQuery.length < 2) return

    let cancelled = false
    const timer = setTimeout(async () => {
      setSearchingPax(true)
      try {
        const res = await fetch(`/api/members/search?q=${encodeURIComponent(activePaxQuery)}`, {
          credentials: 'include',
        })
        if (res.ok && !cancelled) {
          const data = await res.json()
          setPaxMemberResults(data.members || [])
        }
      } finally {
        if (!cancelled) setSearchingPax(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [activePaxKey, activePaxQuery, activePaxHasLinkedMember])

  const visiblePaxMemberResults =
    activePaxKey && !activePaxHasLinkedMember && activePaxQuery.length >= 2
      ? paxMemberResults
      : []

  function selectPaxMember(key: string, m: MemberResult, requiresMember: boolean) {
    if (requiresMember && m.subsStatus !== 'active') return
    setPaxDetails((prev) => ({
      ...prev,
      [key]: {
        name: m.fullName,
        memberId: m.id,
        memberCode: m.memberCode,
        subsStatus: m.subsStatus,
        touched: true,
      },
    }))

    if (key === firstPaxKey || (!holderTouched && !holderName.trim())) {
      if (!holderTouched) {
        setHolderName(m.fullName)
        setSelectedMember(m)
      }
      if (!phoneTouched && m.phone) {
        setPhone(m.phone)
      }
      if (!emailTouched && m.email) {
        setEmail(m.email)
      }
    } else {
      if (!phoneTouched && !phone.trim() && m.phone) {
        setPhone(m.phone)
      }
      if (!emailTouched && !email.trim() && m.email) {
        setEmail(m.email)
      }
    }

    setPaxMemberResults([])
    setActivePaxKey(null)
  }

  function updatePaxName(key: string, value: string) {
    setPaxDetails((prev) => ({
      ...prev,
      [key]: {
        name: value,
        memberId: null,
        memberCode: null,
        subsStatus: null,
        touched: true,
      },
    }))

    if (key === firstPaxKey && !holderTouched) {
      setHolderName(value)
      setSelectedMember(null)
    }

    setActivePaxKey(key)
  }

  function clearPaxMemberLink(key: string, clearText = false) {
    const curr = getPaxEntry(key)
    setPaxDetails((prev) => ({
      ...prev,
      [key]: {
        name: clearText ? '' : curr.name,
        memberId: null,
        memberCode: null,
        subsStatus: null,
        touched: true,
      },
    }))
    if (key === firstPaxKey && !holderTouched) {
      setSelectedMember(null)
      if (clearText) setHolderName('')
    }
  }

  const { totalPax, tablesTotal, totalAmount } = useMemo(() => {
    let pax = 0
    let ticketsAmt = 0
    for (const p of phases) {
      const qty = quantities[p.id] || 0
      if (qty > 0) {
        pax += qty * p.paxMultiplier
        ticketsAmt += paymentMode === 'COMPLIMENTARY' ? 0 : qty * p.price
      }
    }
    let tblAmt = 0
    for (const lbl of selectedTables) {
      const t = tables.find((x) => x.tableLabel === lbl)
      if (t && (t.price || 0) > 0) {
        tblAmt += paymentMode === 'COMPLIMENTARY' ? 0 : Number(t.price) || 0
      }
    }
    return { totalPax: pax, tablesTotal: tblAmt, totalAmount: ticketsAmt + tblAmt }
  }, [phases, quantities, paymentMode, selectedTables, tables])

  function toggleTableSelection(tableLabel: string) {
    setSelectedTables((prev) =>
      prev.includes(tableLabel)
        ? prev.filter((x) => x !== tableLabel)
        : [...prev, tableLabel],
    )
  }

  async function handleCreateBooking(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!selectedEventId) {
      setError('Please select an event.')
      return
    }
    const ticketLines: Array<{
      ticketPhaseId: string
      quantity: number
      paxList: Array<{ name: string; memberId: number | null }>
    }> = []

    for (const p of selectedPhases) {
      const quantity = quantities[p.id] || 0
      const paxList: Array<{ name: string; memberId: number | null }> = []
      for (let tIdx = 0; tIdx < quantity; tIdx++) {
        for (let pIdx = 0; pIdx < p.paxMultiplier; pIdx++) {
          const key = `${p.id}-${tIdx}-${pIdx}`
          const entry = getPaxEntry(key)
          const trimmedName = entry.name.trim()
          const requiresMember = Boolean(p.memberOnly)
          if (requiresMember && !entry.memberId) {
            setError(
              `${p.ticketTypeName} is Member-Only — please select a registered member for every guest on Ticket #${tIdx + 1}.`,
            )
            return
          }
          if (!trimmedName) {
            setError(
              `Please enter a name for every guest on ${p.ticketTypeName} (${p.phaseName}).`,
            )
            return
          }
          paxList.push({
            name: trimmedName,
            memberId: entry.memberId || null,
          })
        }
      }
      ticketLines.push({ ticketPhaseId: p.id, quantity, paxList })
    }

    if (ticketLines.length === 0) {
      setError('Please add at least 1 ticket.')
      return
    }

    const tableLines = selectedTables.map((tableLabel) => ({ tableLabel }))

    setSubmitting(true)
    try {
      const res = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          eventId: selectedEventId,
          memberId: selectedMember?.id || null,
          holderName,
          phone,
          email: email || null,
          payAtDoor: paymentMode === 'PAY_AT_DOOR',
          paymentMode: paymentMode === 'PAY_AT_DOOR' ? null : paymentMode,
          notes,
          tickets: ticketLines,
          tables: tableLines,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create booking')
        return
      }

      const paxNamesByTicket = new Map<number, string[]>()
      for (const s of data.slots || []) {
        const tId =
          typeof s.bookingTicket === 'object' && s.bookingTicket !== null
            ? Number(s.bookingTicket.id)
            : Number(s.bookingTicket)
        const arr = paxNamesByTicket.get(tId) || []
        arr.push(s.attendeeName || s.label)
        paxNamesByTicket.set(tId, arr)
      }

      const mappedTickets = (data.tickets || []).map(
        (t: {
          id: number
          ticketCode: string
          ticketTypeName?: string
          attendeeNames?: string | null
          paxCount: number
        }) => ({
          id: t.id,
          ticketCode: t.ticketCode,
          ticketTypeName: t.ticketTypeName || 'Ticket',
          paxCount: t.paxCount,
          paxNames:
            paxNamesByTicket.get(t.id) ||
            (t.attendeeNames
              ? t.attendeeNames
                .split(',')
                .map((n) => n.trim())
                .filter(Boolean)
              : []),
        }),
      )

      if (data.booking.status === 'pending_payment' && data.paymentLinkUrl) {
        setPendingPayment({
          bookingId: data.booking.id,
          bookingCode: data.booking.bookingCode,
          holderName: data.booking.holderName,
          phone: data.booking.phone,
          email: data.booking.email,
          totalPax: data.booking.totalPax,
          totalAmount: data.booking.totalAmount,
          tablesSummary: data.tablesSummary,
          paymentLinkUrl: data.paymentLinkUrl,
          paymentExpiresAt:
            data.paymentExpiresAt || new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          tickets: mappedTickets,
        })
      } else {
        setReceipt({
          bookingId: data.booking.id,
          bookingCode: data.booking.bookingCode,
          holderName: data.booking.holderName,
          phone: data.booking.phone,
          email: data.booking.email,
          totalPax: data.booking.totalPax,
          totalAmount: data.booking.totalAmount,
          tablesSummary: data.tablesSummary,
          tickets: mappedTickets,
        })
      }

      // Reset form for next booking
      setSelectedMember(null)
      setHolderName('')
      setPhone('')
      setEmail('')
      setHolderTouched(false)
      setPhoneTouched(false)
      setEmailTouched(false)
      setNotes('')
      setQuantities({})
      setPaxDetails({})
      setActivePaxKey(null)
      setPaxMemberResults([])
      setSelectedTables([])
      loadEventMeta(selectedEventId)
    } catch {
      setError('Network error while saving booking')
    } finally {
      setSubmitting(false)
    }
  }

  const activeEventName =
    events.find((e) => e.id === selectedEventId)?.name || 'Event'

  const paymentOptions = [
    { key: 'RAZORPAY', label: 'Razorpay QR' },
    { key: 'CASH', label: 'Cash' },
    { key: 'OFFICER_UPI', label: 'Officer UPI' },
    { key: 'PAY_AT_DOOR', label: 'Pay at Door' },
    { key: 'COMPLIMENTARY', label: 'Complimentary (₹0)' },
  ] as const

  return (
    <div className="space-y-5">
      {/* <PageHeader
        title="Book Tickets"
        subtitle="Add tickets, enter guest names, pick tables if needed, and confirm payment."
      /> */}

      <EventSelectorBar
        events={events}
        value={selectedEventId}
        onChange={setSelectedEventId}
        label="Select Event"
      />

      {!canCreate && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          You are viewing Booking Desk in read-only mode. Creating bookings requires the{' '}
          <strong>booking_officer</strong> or <strong>super_admin</strong> role.
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3.5 text-sm font-semibold text-rose-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleCreateBooking} className="grid gap-5 lg:grid-cols-5">
        {/* Left Columns: Step 1 (Tickets) & Step 2 (Tables) */}
        <div className="space-y-5 lg:col-span-3">
          {/* STEP 1: SELECT TICKETS */}
          {/* <Card> */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-neutral-950">
              <Ticket className="h-5 w-5 text-neutral-700" />
              1. Select Tickets
            </h2>
            {defaultPhaseName && <StatusBadge tone="neutral">{defaultPhaseName}</StatusBadge>}
          </div>

          {loadingMeta ? (
            <p className="mt-4 text-sm font-medium text-neutral-600">Loading tickets…</p>
          ) : groupedTicketPhases.length === 0 ? (
            <p className="mt-4 text-sm font-semibold text-amber-800">
              No active ticket phases configured for this event.
            </p>
          ) : (
            <div className="mt-4 space-y-5">
              {groupedTicketPhases.map((group) => (
                <div key={group.key}>
                  <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-neutral-600">
                    {group.title}
                  </h3>

                  <div className="divide-y divide-neutral-200 overflow-hidden rounded-2xl border border-neutral-200">
                    {group.items.map((p) => {
                      const qty = quantities[p.id] || 0
                      const displayName = formatTicketDisplayName(p.ticketTypeName)
                      const showRowPhase =
                        Boolean(defaultPhaseName) && p.phaseName !== defaultPhaseName
                      const lineSubtotal = qty * p.price

                      return (
                        <div
                          key={p.id}
                          className={`p-4 transition ${qty > 0
                            ? 'bg-neutral-50 shadow-[inset_4px_0_0_0_#0a0a0a]'
                            : 'bg-white'
                            }`}
                        >
                          {/* Ticket Info + 48px Touch Stepper */}
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-base font-extrabold text-neutral-950">
                                  {displayName}
                                </span>
                                <StatusBadge tone="neutral">
                                  {p.paxMultiplier} {p.paxMultiplier === 1 ? 'guest' : 'guests'}
                                </StatusBadge>
                                {showRowPhase && (
                                  <StatusBadge tone="neutral">{p.phaseName}</StatusBadge>
                                )}
                              </div>
                              <div className="mt-1 flex items-baseline gap-2 tabular-nums">
                                <span className="text-base font-bold text-neutral-900">
                                  ₹{p.price.toLocaleString('en-IN')}
                                </span>
                                {qty > 1 && (
                                  <span className="text-sm font-semibold text-neutral-600">
                                    · Subtotal ₹{lineSubtotal.toLocaleString('en-IN')}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="shrink-0">
                              {qty === 0 ? (
                                <button
                                  type="button"
                                  onClick={() => adjustQty(p.id, 1)}
                                  aria-label={`Add ${p.ticketTypeName} ticket`}
                                  className="inline-flex h-12 items-center gap-1.5 rounded-xl border border-neutral-300 bg-white px-4 text-base font-bold text-neutral-950 transition hover:bg-neutral-100 active:bg-neutral-200"
                                >
                                  <Plus className="h-5 w-5" />
                                  <span>Add</span>
                                </button>
                              ) : (
                                <div className="inline-flex h-12 items-center rounded-xl bg-neutral-900 text-white">
                                  <button
                                    type="button"
                                    onClick={() => adjustQty(p.id, -1)}
                                    aria-label={`Decrease ${p.ticketTypeName} tickets`}
                                    className="flex h-12 w-12 items-center justify-center rounded-l-xl transition hover:bg-neutral-800 active:bg-neutral-700"
                                  >
                                    <Minus className="h-5 w-5" />
                                  </button>
                                  <span className="min-w-[2.5ch] px-1 text-center text-lg font-extrabold tabular-nums">
                                    {qty}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => adjustQty(p.id, 1)}
                                    aria-label={`Increase ${p.ticketTypeName} tickets`}
                                    className="flex h-12 w-12 items-center justify-center rounded-r-xl transition hover:bg-neutral-800 active:bg-neutral-700"
                                  >
                                    <Plus className="h-5 w-5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Inline Guest / Member Inputs */}
                          {qty > 0 && (
                            <div className="mt-4 space-y-4 border-t border-dashed border-neutral-300 pt-4">
                              {Array.from({ length: qty }).map((_, tIdx) => (
                                <div
                                  key={`${p.id}-inst-${tIdx}`}
                                  className="border-b border-neutral-200 pb-4 last:border-b-0 last:pb-0"
                                >
                                  {qty > 1 && (
                                    <div className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-600">
                                      {p.ticketTypeName} #{tIdx + 1}
                                    </div>
                                  )}

                                  <div className="grid gap-3 sm:grid-cols-2">
                                    {Array.from({ length: p.paxMultiplier }).map((__, pIdx) => {
                                      const paxKey = `${p.id}-${tIdx}-${pIdx}`
                                      const entry = getPaxEntry(paxKey)
                                      const isFocused = activePaxKey === paxKey
                                      const dupError = slotDuplicateErrors.get(paxKey)
                                      const requiresMember = Boolean(p.memberOnly)
                                      const label = requiresMember
                                        ? p.paxMultiplier > 1
                                          ? pIdx === 0
                                            ? 'Member (Guest 1) *'
                                            : `Spouse / Partner (Guest ${pIdx + 1}) *`
                                          : 'Member *'
                                        : p.paxMultiplier > 1
                                          ? `Guest ${pIdx + 1} Name *`
                                          : 'Guest Name *'

                                      return (
                                        <div key={paxKey} className="relative">
                                          <div className="mb-1.5 flex items-center justify-between gap-2">
                                            <label className="text-sm font-bold text-neutral-800">
                                              {label}
                                            </label>
                                            {!requiresMember && entry.memberId && (
                                              <StatusBadge tone={subsBadgeTone(entry.subsStatus)}>
                                                {entry.memberCode} · {entry.subsStatus}
                                              </StatusBadge>
                                            )}
                                          </div>

                                          {requiresMember && entry.memberId ? (
                                            <div className="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2">
                                              <div className="min-w-0">
                                                <div className="truncate text-base font-bold text-neutral-950">
                                                  {entry.name}
                                                </div>
                                                <div className="mt-0.5 flex items-center gap-2 text-xs font-bold">
                                                  <span className="text-neutral-700">
                                                    {entry.memberCode}
                                                  </span>
                                                  <StatusBadge
                                                    tone={subsBadgeTone(entry.subsStatus)}
                                                  >
                                                    {entry.subsStatus}
                                                  </StatusBadge>
                                                </div>
                                              </div>
                                              <button
                                                type="button"
                                                onClick={() => clearPaxMemberLink(paxKey, true)}
                                                aria-label="Change member"
                                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-300 bg-white text-neutral-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
                                              >
                                                <X className="h-5 w-5" />
                                              </button>
                                            </div>
                                          ) : (
                                            <>
                                              <div className="relative">
                                                <Search className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-neutral-500" />
                                                <TextInput
                                                  type="text"
                                                  required
                                                  value={entry.name}
                                                  onFocus={() => setActivePaxKey(paxKey)}
                                                  onBlur={() =>
                                                    setTimeout(
                                                      () =>
                                                        setActivePaxKey((curr) =>
                                                          curr === paxKey ? null : curr,
                                                        ),
                                                      180,
                                                    )
                                                  }
                                                  onChange={(e) =>
                                                    updatePaxName(paxKey, e.target.value)
                                                  }
                                                  placeholder={
                                                    requiresMember
                                                      ? 'Search member name or phone…'
                                                      : 'Enter guest name or search member…'
                                                  }
                                                  className={`pl-11 pr-11 ${dupError
                                                    ? 'border-rose-400 bg-rose-50'
                                                    : requiresMember && !entry.memberId
                                                      ? 'border-amber-400 bg-amber-50/40'
                                                      : !entry.name.trim()
                                                        ? 'border-amber-400'
                                                        : ''
                                                    }`}
                                                />
                                                {entry.memberId && !requiresMember && (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      clearPaxMemberLink(paxKey, false)
                                                    }
                                                    aria-label="Unlink member"
                                                    className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 hover:text-rose-700"
                                                  >
                                                    <X className="h-4 w-4" />
                                                  </button>
                                                )}
                                                {isFocused && searchingPax && (
                                                  <Loader2 className="absolute right-3.5 top-3.5 h-5 w-5 animate-spin text-neutral-500" />
                                                )}
                                              </div>

                                              {dupError && (
                                                <p className="mt-1.5 text-sm font-bold text-rose-700">
                                                  {dupError}
                                                </p>
                                              )}

                                              {!dupError &&
                                                requiresMember &&
                                                entry.name.trim().length > 0 &&
                                                !entry.memberId && (
                                                  <p className="mt-1.5 text-sm font-semibold text-amber-800">
                                                    Tap a member from the list below to select
                                                  </p>
                                                )}

                                              {isFocused &&
                                                !entry.memberId &&
                                                visiblePaxMemberResults.length > 0 && (
                                                  <div className="absolute z-30 mt-1.5 max-h-60 w-full overflow-y-auto rounded-xl border border-neutral-300 bg-white shadow-xl">
                                                    {visiblePaxMemberResults.map((m) => {
                                                      const bookedCode = bookedByMemberId.get(
                                                        m.id,
                                                      )
                                                      const usedElsewhereInForm =
                                                        expandedTicketGroups.some((g) =>
                                                          g.paxKeys.some(
                                                            (k) =>
                                                              k !== paxKey &&
                                                              getPaxEntry(k).memberId === m.id,
                                                          ),
                                                        )
                                                      const subsBlocked =
                                                        requiresMember &&
                                                        m.subsStatus !== 'active'
                                                      const canSelect =
                                                        !subsBlocked &&
                                                        !bookedCode &&
                                                        !usedElsewhereInForm
                                                      const blockedReason = bookedCode
                                                        ? `Booked on ${bookedCode}`
                                                        : usedElsewhereInForm
                                                          ? 'Already selected'
                                                          : subsBlocked
                                                            ? 'Active subs required'
                                                            : null

                                                      return (
                                                        <button
                                                          key={m.id}
                                                          type="button"
                                                          disabled={!canSelect}
                                                          onMouseDown={(e) => {
                                                            e.preventDefault()
                                                            if (canSelect)
                                                              selectPaxMember(
                                                                paxKey,
                                                                m,
                                                                requiresMember,
                                                              )
                                                          }}
                                                          className={`flex min-h-14 w-full items-center justify-between gap-2 border-b border-neutral-200 px-3.5 py-2.5 text-left last:border-b-0 ${canSelect
                                                            ? 'hover:bg-neutral-100'
                                                            : 'cursor-not-allowed bg-neutral-50 opacity-60'
                                                            }`}
                                                        >
                                                          <div className="min-w-0">
                                                            <div className="text-sm font-bold text-neutral-950">
                                                              {m.fullName} ({m.memberCode})
                                                            </div>
                                                            <div className="text-xs font-medium text-neutral-600">
                                                              {m.phone}
                                                              {blockedReason && (
                                                                <span className="ml-1.5 font-bold text-rose-700">
                                                                  · {blockedReason}
                                                                </span>
                                                              )}
                                                            </div>
                                                          </div>
                                                          <StatusBadge
                                                            tone={subsBadgeTone(m.subsStatus)}
                                                          >
                                                            {m.subsStatus}
                                                          </StatusBadge>
                                                        </button>
                                                      )
                                                    })}
                                                  </div>
                                                )}
                                            </>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* </Card> */}

          {/* STEP 2: TABLE SELECTION */}
          {/* <Card> */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-neutral-950">
              <Users className="h-5 w-5 text-neutral-700" />
              2. Select Tables (Optional)
            </h2>
            {selectedTables.length > 0 && (
              <StatusBadge tone="dark">
                {selectedTables.length} {selectedTables.length === 1 ? 'table' : 'tables'} selected
              </StatusBadge>
            )}
          </div>

          {loadingMeta ? (
            <p className="mt-4 text-sm font-medium text-neutral-600">Loading tables…</p>
          ) : tables.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-center">
              <p className="text-sm font-bold text-neutral-800">
                No tables configured for this event
              </p>
              <p className="mt-1 text-sm text-neutral-600">
                You can confirm this booking now and assign tables later.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {[...tables]
                .sort((a, b) => Number(a.isReserved) - Number(b.isReserved))
                .map((t) => {
                  const isSelected = selectedTables.includes(t.tableLabel)
                  return (
                    <button
                      key={t.tableLabel}
                      type="button"
                      disabled={t.isReserved}
                      onClick={() => toggleTableSelection(t.tableLabel)}
                      className={`flex min-h-16 flex-col items-start justify-between rounded-xl border p-3.5 text-left transition ${t.isReserved
                        ? 'cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-500'
                        : isSelected
                          ? 'border-2 border-neutral-950 bg-neutral-900 text-white'
                          : 'border-neutral-300 bg-white text-neutral-950 hover:border-neutral-500'
                        }`}
                    >
                      <div className="flex w-full items-center justify-between gap-1">
                        <span className="text-base font-extrabold">{t.tableLabel}</span>
                        {(t.price || 0) > 0 && (
                          <span
                            className={`rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${t.isReserved
                              ? 'bg-neutral-200 text-neutral-600'
                              : isSelected
                                ? 'bg-white/20 text-emerald-300'
                                : 'bg-neutral-100 text-neutral-900'
                              }`}
                          >
                            +₹{Number(t.price).toLocaleString('en-IN')}
                          </span>
                        )}
                      </div>
                      <div
                        className={`mt-1 text-xs font-medium ${isSelected ? 'text-neutral-300' : 'text-neutral-600'
                          }`}
                      >
                        {t.tableTypeName}
                      </div>
                      <div className="mt-1.5 text-xs font-bold">
                        {t.isReserved ? (
                          <span className="text-rose-700">
                            Reserved
                          </span>
                        ) : isSelected ? (
                          <span className="text-emerald-300">✓ Selected</span>
                        ) : (
                          <span className="text-emerald-700">Available</span>
                        )}
                      </div>
                    </button>
                  )
                })}
            </div>
          )}
          {/* </Card> */}
        </div>

        {/* Right Column: STEP 3 (Contact & Payment — High-Contrast Dark Card) */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4 text-white sm:p-5 lg:sticky lg:top-20">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-lg font-extrabold text-white">
                <UserCheck className="h-5 w-5 text-neutral-300" />
                3. Contact &amp; Payment
              </h2>
              {selectedMember && (
                <button
                  type="button"
                  onClick={clearMember}
                  className="min-h-10 rounded-lg px-2 text-sm font-bold text-rose-300 hover:bg-rose-500/15"
                >
                  Unlink {selectedMember.memberCode}
                </button>
              )}
            </div>

            <div className="mt-4 space-y-3.5">
              {/* Booking Holder Name */}
              <div className="relative">
                <FieldLabel tone="dark">Booking Holder Name *</FieldLabel>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-neutral-500" />
                  <TextInput
                    type="text"
                    required
                    value={holderName}
                    onFocus={() => setHolderFocused(true)}
                    onBlur={() => setTimeout(() => setHolderFocused(false), 180)}
                    onChange={(e) => {
                      setHolderName(e.target.value)
                      setHolderTouched(true)
                      if (selectedMember) setSelectedMember(null)
                      setHolderFocused(true)
                    }}
                    placeholder="Auto-fills from first guest…"
                    className="border-neutral-700 pl-11 focus:border-white focus:ring-white/25"
                  />
                  {holderFocused && searchingMembers && (
                    <Loader2 className="absolute right-3.5 top-3.5 h-5 w-5 animate-spin text-neutral-500" />
                  )}
                </div>

                {visibleMemberResults.length > 0 && (
                  <div className="absolute z-30 mt-1.5 max-h-60 w-full overflow-y-auto rounded-xl border border-neutral-300 bg-white shadow-xl">
                    {visibleMemberResults.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          selectMember(m)
                        }}
                        className="flex min-h-14 w-full items-center justify-between gap-2 border-b border-neutral-200 px-3.5 py-2.5 text-left last:border-b-0 hover:bg-neutral-100"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-neutral-950">
                            {m.fullName} ({m.memberCode})
                          </div>
                          <div className="truncate text-xs font-medium text-neutral-600">
                            {m.phone} {m.email ? `· ${m.email}` : ''}
                          </div>
                        </div>
                        <StatusBadge tone={subsBadgeTone(m.subsStatus)}>
                          {m.subsStatus}
                        </StatusBadge>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div>
                  <FieldLabel tone="dark">WhatsApp / Phone *</FieldLabel>
                  <TextInput
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value)
                      setPhoneTouched(true)
                    }}
                    placeholder="9847012345"
                    className="border-neutral-700 focus:border-white focus:ring-white/25"
                  />
                </div>
                <div>
                  <FieldLabel tone="dark">Email *</FieldLabel>
                  <TextInput
                    type="email"
                    required
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      setEmailTouched(true)
                    }}
                    placeholder="member@example.com"
                    className="border-neutral-700 focus:border-white focus:ring-white/25"
                  />
                </div>
              </div>

              {/* Payment Mode Tappable Buttons */}
              <div>
                <FieldLabel tone="dark">Payment Mode</FieldLabel>
                <div className="grid grid-cols-2 gap-2">
                  {paymentOptions.map((opt) => {
                    const active = paymentMode === opt.key
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setPaymentMode(opt.key)}
                        className={`min-h-12 rounded-xl border px-3 text-sm font-bold transition ${opt.key === 'COMPLIMENTARY' ? 'col-span-2' : ''
                          } ${active
                            ? 'border-emerald-400 bg-emerald-500 text-neutral-950'
                            : 'border-neutral-700 bg-neutral-900 text-neutral-100 hover:border-emerald-500/60 hover:bg-neutral-800'
                          }`}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <FieldLabel tone="dark">Notes (Optional)</FieldLabel>
                <TextArea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Vegetarian preference, wheelchair access…"
                  className="border-neutral-700 focus:border-white focus:ring-white/25"
                />
              </div>

              {/* Order Summary Box */}
              <div className="space-y-2 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-neutral-300">Total Guests</span>
                  <span className="font-extrabold text-white tabular-nums">{totalPax}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-neutral-300">Tables</span>
                  <span className="text-right font-bold text-white tabular-nums">
                    {selectedTables.length > 0 ? selectedTables.join(', ') : 'None'}
                    {tablesTotal > 0 ? ` (+₹${tablesTotal.toLocaleString('en-IN')})` : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-neutral-800 pt-2.5 text-lg">
                  <span className="font-extrabold text-white">Total Amount</span>
                  <span className="font-extrabold text-emerald-400 tabular-nums">
                    ₹{totalAmount.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>

              {totalPax > 0 && duplicatePaxCount > 0 && (
                <div className="rounded-xl border border-rose-400/40 bg-rose-500/15 px-3.5 py-2.5 text-sm font-bold text-rose-200">
                  {duplicatePaxCount} duplicate or already-booked guest
                  {duplicatePaxCount === 1 ? '' : 's'} — each ticket must have a unique guest.
                </div>
              )}

              {totalPax > 0 && missingPaxCount > 0 && (
                <div className="rounded-xl border border-amber-400/40 bg-amber-500/15 px-3.5 py-2.5 text-sm font-semibold text-amber-200">
                  {missingMemberCount > 0
                    ? `Select a registered member for ${missingMemberCount} Member-Only ticket${missingMemberCount === 1 ? '' : 's'}.`
                    : `${missingPaxCount} guest name${missingPaxCount === 1 ? '' : 's'} required before confirming.`}
                </div>
              )}

              <button
                type="submit"
                disabled={
                  !canCreate ||
                  submitting ||
                  totalPax === 0 ||
                  missingPaxCount > 0 ||
                  duplicatePaxCount > 0
                }
                className={`inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl px-5 text-base font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:cursor-not-allowed disabled:opacity-45 ${paymentMode === 'RAZORPAY' && totalAmount > 0
                  ? 'bg-white text-neutral-950 hover:bg-neutral-200 active:bg-neutral-300'
                  : 'bg-emerald-500 text-neutral-950 hover:bg-emerald-400 active:bg-emerald-600'
                  }`}
              >
                {submitting && <Loader2 className="h-5 w-5 shrink-0 animate-spin" />}
                {submitting
                  ? paymentMode === 'RAZORPAY' && totalAmount > 0
                    ? 'Generating Razorpay Link…'
                    : 'Creating Master QR Booking…'
                  : paymentMode === 'RAZORPAY' && totalAmount > 0
                    ? `Generate Payment QR · ₹${totalAmount.toLocaleString('en-IN')}`
                    : paymentMode === 'PAY_AT_DOOR'
                      ? `Reserve (Pay at Door) · ₹${totalAmount.toLocaleString('en-IN')}`
                      : `Confirm Booking · ₹${totalAmount.toLocaleString('en-IN')}`}
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* PENDING RAZORPAY PAYMENT MODAL */}
      {pendingPayment && (
        <PendingRazorpayModal
          key={pendingPayment.bookingId}
          pending={pendingPayment}
          eventName={activeEventName}
          canSwitchManual={canCreate}
          onClose={() => setPendingPayment(null)}
          onConfirmed={() => {
            const p = pendingPayment
            setPendingPayment(null)
            setReceipt({
              bookingId: p.bookingId,
              bookingCode: p.bookingCode,
              holderName: p.holderName,
              phone: p.phone,
              email: p.email,
              totalPax: p.totalPax,
              totalAmount: p.totalAmount,
              tablesSummary: p.tablesSummary,
              tickets: p.tickets,
            })
            loadEventMeta(selectedEventId)
          }}
          onExpired={() => {
            loadEventMeta(selectedEventId)
          }}
        />
      )}

      {/* SHARED MASTER QR RECEIPT MODAL */}
      {receipt && (
        <TicketPassModal
          eventName={activeEventName}
          bookingCode={receipt.bookingCode}
          holderName={receipt.holderName}
          totalPax={receipt.totalPax}
          totalAmount={receipt.totalAmount}
          tablesSummary={receipt.tablesSummary}
          tickets={receipt.tickets}
          feedback={resendFeedback}
          resending={resendingReceipt}
          onResend={() => setShowResendModal(true)}
          onClose={() => {
            setReceipt(null)
            setShowResendModal(false)
            setResendFeedback(null)
          }}
        />
      )}

      {receipt && showResendModal && (
        <ResendPassModal
          bookingCode={receipt.bookingCode}
          holderName={receipt.holderName}
          phone={receipt.phone}
          email={receipt.email}
          submitting={resendingReceipt}
          onClose={() => setShowResendModal(false)}
          onConfirm={async (channels: ResendChannel) => {
            setResendingReceipt(true)
            setResendFeedback(null)
            try {
              const res = await fetch(`/api/bookings/${receipt.bookingId}/resend`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ channels }),
              })
              const data = await res.json().catch(() => ({}))
              if (res.ok) {
                const parts: string[] = []
                if (channels === 'both' || channels === 'whatsapp') {
                  parts.push(`WhatsApp: ${data.result?.whatsapp || 'logged'}`)
                }
                if (channels === 'both' || channels === 'email') {
                  parts.push(`Email: ${data.result?.email || 'logged'}`)
                }
                setResendFeedback({
                  type: 'ok',
                  text: `Pass resent · ${parts.join(', ')}`,
                })
                setShowResendModal(false)
              } else {
                setResendFeedback({
                  type: 'err',
                  text: data.error || 'Failed to resend pass',
                })
                setShowResendModal(false)
              }
            } catch {
              setResendFeedback({
                type: 'err',
                text: 'Network error while resending pass',
              })
              setShowResendModal(false)
            } finally {
              setResendingReceipt(false)
            }
          }}
        />
      )}
    </div>
  )
}

function QrLinkImage({ paymentLinkUrl }: { paymentLinkUrl: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [retryCount, setRetryCount] = useState(0)

  const src = `/api/qr/link?url=${encodeURIComponent(paymentLinkUrl)}${retryCount > 0 ? `&r=${retryCount}` : ''
    }`

  return (
    <div className="relative flex h-60 w-60 items-center justify-center overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 p-3">
      {status === 'loading' && (
        <div
          role="status"
          aria-label="Loading Razorpay QR"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-neutral-900"
        >
          <Loader2 className="h-7 w-7 animate-spin text-amber-400" />
          <span className="text-sm font-semibold text-neutral-300">Generating QR…</span>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-rose-950/80 p-4 text-center">
          <AlertTriangle className="h-6 w-6 text-rose-300" />
          <span className="text-sm font-bold text-rose-100">QR failed to load</span>
          <button
            type="button"
            onClick={() => {
              setStatus('loading')
              setRetryCount((c) => c + 1)
            }}
            className="min-h-11 rounded-xl border border-neutral-700 bg-neutral-900 px-4 text-sm font-bold text-white hover:bg-neutral-800"
          >
            Retry
          </button>
        </div>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={retryCount}
        src={src}
        alt="Razorpay Payment QR"
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
        className={`h-56 w-56 transition-opacity duration-200 ${status === 'loaded' ? 'opacity-100' : 'opacity-0'
          }`}
      />
    </div>
  )
}

function PendingRazorpayModal({
  pending,
  eventName,
  canSwitchManual,
  onClose,
  onConfirmed,
  onExpired,
}: {
  pending: {
    bookingId: number
    bookingCode: string
    holderName: string
    phone: string
    email?: string | null
    totalPax: number
    totalAmount: number
    tablesSummary: string
    paymentLinkUrl: string
    paymentExpiresAt: string
    tickets: Array<{
      id: number
      ticketCode: string
      ticketTypeName?: string
      paxCount: number
      paxNames?: string[]
    }>
  }
  eventName: string
  canSwitchManual: boolean
  onClose: () => void
  onConfirmed: (newPaymentMode?: string) => void
  onExpired: () => void
}) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [expired, setExpired] = useState(false)
  const [copied, setCopied] = useState(false)
  const [switchingMode, setSwitchingMode] = useState<'CASH' | 'OFFICER_UPI' | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)

  const expiresMs = new Date(pending.paymentExpiresAt).getTime()
  const remainingSec = Math.max(0, Math.ceil((expiresMs - nowMs) / 1000))
  const mins = Math.floor(remainingSec / 60)
  const secs = remainingSec % 60
  const countdownText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`

  useEffect(() => {
    if (expired) return
    const timer = setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => clearInterval(timer)
  }, [expired])

  useEffect(() => {
    if (expired) return
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch(`/api/bookings/${pending.bookingId}/payment-status`, {
          credentials: 'include',
        })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as {
          status?: string
          paymentStatus?: string
          expired?: boolean
        }
        if (cancelled) return

        if (data.status === 'confirmed' && data.paymentStatus === 'paid') {
          onConfirmed('RAZORPAY')
        } else if (data.status === 'cancelled' || data.expired) {
          setExpired(true)
          onExpired()
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
  }, [pending.bookingId, expired, onConfirmed, onExpired])

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(pending.paymentLinkUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy payment link:', pending.paymentLinkUrl)
    }
  }

  async function handleSwitchManual(mode: 'CASH' | 'OFFICER_UPI') {
    setSwitchError(null)
    setSwitchingMode(mode)
    try {
      const res = await fetch(`/api/bookings/${pending.bookingId}/switch-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ paymentMode: mode }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSwitchError(data.error || 'Could not switch payment mode')
        return
      }
      onConfirmed(mode)
    } catch {
      setSwitchError('Network error while switching payment mode')
    } finally {
      setSwitchingMode(null)
    }
  }

  return (
    <ModalShell
      tone="dark"
      title={expired ? 'Hold Expired' : 'Awaiting Payment'}
      badge={
        !expired ? (
          <StatusBadge tone={remainingSec <= 120 ? 'rose' : 'amber'}>
            <Clock className="h-3.5 w-3.5" />
            {countdownText}
          </StatusBadge>
        ) : (
          <StatusBadge tone="rose">Expired</StatusBadge>
        )
      }
      subtitle={`${eventName} · ${pending.bookingCode} · ₹${pending.totalAmount.toLocaleString('en-IN')}`}
      onClose={onClose}
      maxWidthClass="max-w-md"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-neutral-700 bg-neutral-900 px-4 text-sm font-bold text-neutral-200 transition hover:bg-neutral-800 hover:text-white"
        >
          {expired ? 'Close' : 'Close & Serve Next (Confirms in Background)'}
        </button>
      }
    >
      <div className="space-y-4 text-center">
        <p className="text-sm font-medium text-neutral-300">
          {expired
            ? '10-minute reservation expired. Held tables & guest slots have been released.'
            : pending.email
              ? `Ask ${pending.holderName} to scan the QR below or use the link sent to ${pending.email} / SMS.`
              : `Ask ${pending.holderName} to scan the QR below or pay via the SMS link.`}
        </p>

        {!expired && (
          <>
            <div className="flex justify-center">
              <QrLinkImage paymentLinkUrl={pending.paymentLinkUrl} />
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3.5 py-1.5 text-sm font-bold text-emerald-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Listening for payment confirmation…</span>
            </div>

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-4 text-sm font-bold text-white transition hover:bg-neutral-800"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied Link' : 'Copy Link'}
              </button>
              <a
                href={pending.paymentLinkUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-extrabold text-neutral-950 transition hover:bg-neutral-200"
              >
                <ExternalLink className="h-4 w-4" />
                Open
              </a>
            </div>
          </>
        )}

        {switchError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/15 px-3.5 py-2.5 text-sm font-semibold text-rose-200">
            {switchError}
          </div>
        )}

        {!expired && canSwitchManual && (
          <div className="border-t border-neutral-800 pt-4">
            <div className="mb-2.5 text-xs font-bold uppercase tracking-wide text-neutral-400">
              Customer paying in person instead?
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={switchingMode !== null}
                onClick={() => handleSwitchManual('CASH')}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-extrabold text-neutral-950 transition hover:bg-neutral-200 disabled:opacity-45"
              >
                {switchingMode === 'CASH' && <Loader2 className="h-4 w-4 animate-spin" />}
                Switch to Cash
              </button>
              <button
                type="button"
                disabled={switchingMode !== null}
                onClick={() => handleSwitchManual('OFFICER_UPI')}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-4 text-sm font-bold text-white transition hover:bg-neutral-800 disabled:opacity-45"
              >
                {switchingMode === 'OFFICER_UPI' && <Loader2 className="h-4 w-4 animate-spin" />}
                Switch to UPI
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  )
}
