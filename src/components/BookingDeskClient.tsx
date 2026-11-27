'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  Minus,
  Plus,
  Search,
  Send,
  Ticket,
  UserCheck,
  Users,
  X,
} from 'lucide-react'
import { ResendPassModal, type ResendChannel } from '@/components/ResendPassModal'

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

  // Primary Holder member lookup (combined with Holder Full Name field)
  const [holderFocused, setHolderFocused] = useState(false)
  const [memberResults, setMemberResults] = useState<MemberResult[]>([])
  const [selectedMember, setSelectedMember] = useState<MemberResult | null>(null)
  const [searchingMembers, setSearchingMembers] = useState(false)

  // Holder info (auto-prefilled from the first attendee unless manually edited)
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

  // Ticket quantities: phaseId -> qty
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  // Per-ticket, per-pax attendee details: `${phaseId}-${ticketIdx}-${paxIdx}` -> PaxDetailEntry
  const [paxDetails, setPaxDetails] = useState<Record<string, PaxDetailEntry>>({})
  const [activePaxKey, setActivePaxKey] = useState<string | null>(null)
  const [paxMemberResults, setPaxMemberResults] = useState<MemberResult[]>([])
  const [searchingPax, setSearchingPax] = useState(false)

  // Non-sharing table selections: selected tableLabels (e.g. ['T-01', 'T-02'])
  const [selectedTables, setSelectedTables] = useState<string[]>([])

  // Submission state
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
      paxCount: number
      paxNames?: string[]
    }>
  } | null>(null)

  const [copiedCode, setCopiedCode] = useState<string | null>(null)

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

  // Debounced member search directly on Holder Full Name input
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
    holderFocused && !selectedMember && holderName.trim().length >= 2
      ? memberResults
      : []

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
      groups.push({ key: 'member', title: 'Member', items: memberItems })
    }
    if (nonMemberItems.length > 0) {
      groups.push({ key: 'non_member', title: 'Non-Member', items: nonMemberItems })
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

  // Debounced inline member lookup for the active pax input
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

    // Auto-prefill Booking Contact from first attendee (or if contact fields are still untouched/empty)
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
              `${p.ticketTypeName} is Member-Only — please select a registered member for every attendee on Ticket #${tIdx + 1}.`,
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
      setError('Select at least 1 ticket.')
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
          paymentMode,
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

      // Reset form for next fast booking
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

  async function handleCopyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedCode(code)
      setTimeout(() => {
        setCopiedCode((prev) => (prev === code ? null : prev))
      }, 1500)
    } catch {
      window.prompt('Copy Ticket ID:', code)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex w-full items-center gap-2">
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(Number(e.target.value))}
            className="flex-1 rounded-full border border-neutral-300 bg-white px-4 py-2 text-lg font-semibold text-neutral-800"
          >
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} — {ev.code}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!canCreate && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900">
          You are viewing the Booking Desk in read-only mode. Creating bookings requires the{' '}
          <strong>booking_officer</strong> or <strong>super_admin</strong> role.
        </div>
      )}

      <form onSubmit={handleCreateBooking} className="grid gap-6 pb-20 lg:grid-cols-5 lg:pb-0">
          {/* Left columns: Tickets & Tables */}
          <div className="space-y-6 lg:col-span-3">
            {error && (
              <div className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800">
                {error}
              </div>
            )}

            {/* 1. Select Tickets + Inline Member/Guest Entry */}
            <div className="py-1">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-900">
                  <Ticket className="h-4 w-4 text-zinc-700" />
                  1. Select Tickets
                </h2>
                {defaultPhaseName && (
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-700">
                    {defaultPhaseName}
                  </span>
                )}
              </div>

              {loadingMeta ? (
                <p className="mt-3 text-xs text-zinc-500">Loading tickets…</p>
              ) : groupedTicketPhases.length === 0 ? (
                <p className="mt-3 text-xs text-amber-700">
                  No active ticket phases configured for this event.
                </p>
              ) : (
                <div className="mt-4 space-y-5">
                  {groupedTicketPhases.map((group) => (
                    <div key={group.key}>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                        {group.title}
                      </h3>

                      <div className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200">
                        {group.items.map((p) => {
                          const qty = quantities[p.id] || 0
                          const displayName = formatTicketDisplayName(p.ticketTypeName)
                          const showRowPhase =
                            Boolean(defaultPhaseName) && p.phaseName !== defaultPhaseName
                          const lineSubtotal = qty * p.price

                          return (
                            <div
                              key={p.id}
                              className={`px-4 py-3.5 transition first:rounded-t-2xl last:rounded-b-2xl ${qty > 0
                                ? 'bg-zinc-50/80 shadow-[inset_3px_0_0_0_#18181b]'
                                : 'bg-white'
                                }`}
                            >
                              {/* Compact 2-Column Row: Left Info / Right Unified Stepper */}
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-[15px] font-semibold leading-snug text-zinc-900">
                                      {displayName}
                                    </span>
                                    <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">
                                      {p.paxMultiplier} pax
                                    </span>
                                    {showRowPhase && (
                                      <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                                        {p.phaseName}
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-0.5 flex items-baseline gap-1.5 tabular-nums">
                                    <span className="text-sm font-semibold text-zinc-900">
                                      ₹{p.price.toLocaleString('en-IN')}
                                    </span>
                                    {qty > 1 && (
                                      <span className="text-xs font-medium text-zinc-500">
                                        · ₹{lineSubtotal.toLocaleString('en-IN')}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Unified h-9 Stepper (Right-Anchored) */}
                                <div className="shrink-0">
                                  {qty === 0 ? (
                                    <button
                                      type="button"
                                      onClick={() => adjustQty(p.id, 1)}
                                      aria-label={`Add ${p.ticketTypeName} ticket`}
                                      className="inline-flex h-9 items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 active:scale-[0.98]"
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                      <span>Add</span>
                                    </button>
                                  ) : (
                                    <div className="inline-flex h-9 items-center rounded-xl bg-zinc-900 text-white shadow-xs">
                                      <button
                                        type="button"
                                        onClick={() => adjustQty(p.id, -1)}
                                        aria-label={`Decrease ${p.ticketTypeName} tickets`}
                                        className="flex h-9 w-9 items-center justify-center rounded-l-xl transition hover:bg-zinc-800 active:bg-zinc-700"
                                      >
                                        <Minus className="h-3.5 w-3.5" />
                                      </button>
                                      <span className="min-w-[2ch] px-1 text-center text-sm font-bold tabular-nums">
                                        {qty}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => adjustQty(p.id, 1)}
                                        aria-label={`Increase ${p.ticketTypeName} tickets`}
                                        className="flex h-9 w-9 items-center justify-center rounded-r-xl transition hover:bg-zinc-800 active:bg-zinc-700"
                                      >
                                        <Plus className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Inline Member / Guest Inputs inside this selected Ticket */}
                              {qty > 0 && (
                                <div className="mt-3.5 space-y-3 border-t border-dashed border-neutral-200 pt-3">
                                  {Array.from({ length: qty }).map((_, tIdx) => (
                                    <div
                                      key={`${p.id}-inst-${tIdx}`}
                                      className="border-b border-neutral-200 pb-4 last:border-b-0 last:pb-0"
                                    >
                                      {qty > 1 && (
                                        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                                          {p.ticketTypeName} #{tIdx + 1}
                                        </div>
                                      )}

                                      <div className="grid gap-2.5 sm:grid-cols-2">
                                        {Array.from({ length: p.paxMultiplier }).map((__, pIdx) => {
                                          const paxKey = `${p.id}-${tIdx}-${pIdx}`
                                          const entry = getPaxEntry(paxKey)
                                          const isFocused = activePaxKey === paxKey
                                          const dupError = slotDuplicateErrors.get(paxKey)
                                          const requiresMember = Boolean(p.memberOnly)
                                          const label = requiresMember
                                            ? p.paxMultiplier > 1
                                              ? pIdx === 0
                                                ? 'Member (Pax 1) *'
                                                : `Member Spouse / Partner (Pax ${pIdx + 1}) *`
                                              : 'Member *'
                                            : p.paxMultiplier > 1
                                              ? `Guest ${pIdx + 1} Name *`
                                              : 'Guest Name *'

                                          return (
                                            <div key={paxKey} className="relative">
                                              <div className="mb-1 flex items-center justify-between gap-2">
                                                <label className="text-[11px] font-semibold text-neutral-700">
                                                  {label}
                                                </label>
                                                {!requiresMember && entry.memberId && (
                                                  <span
                                                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${entry.subsStatus === 'active'
                                                      ? 'bg-emerald-100 text-emerald-800'
                                                      : entry.subsStatus === 'arrears'
                                                        ? 'bg-amber-100 text-amber-800'
                                                        : 'bg-rose-100 text-rose-800'
                                                      }`}
                                                  >
                                                    {entry.memberCode} · {entry.subsStatus}
                                                  </span>
                                                )}
                                              </div>

                                              {/* Locked Member Chip when a Member is selected on a Member-Only slot */}
                                              {requiresMember && entry.memberId ? (
                                                <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2">
                                                  <div className="min-w-0">
                                                    <div className="truncate text-xs font-bold text-neutral-900">
                                                      {entry.name}
                                                    </div>
                                                    <div className="flex items-center gap-1.5 text-[10px] font-semibold">
                                                      <span className="text-neutral-500">
                                                        {entry.memberCode}
                                                      </span>
                                                      <span
                                                        className={`rounded-full px-1.5 py-0.2 uppercase ${entry.subsStatus === 'active'
                                                          ? 'bg-emerald-100 text-emerald-800'
                                                          : entry.subsStatus === 'arrears'
                                                            ? 'bg-amber-100 text-amber-800'
                                                            : 'bg-rose-100 text-rose-800'
                                                          }`}
                                                      >
                                                        {entry.subsStatus}
                                                      </span>
                                                    </div>
                                                  </div>
                                                  <button
                                                    type="button"
                                                    onClick={() => clearPaxMemberLink(paxKey, true)}
                                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-neutral-500 shadow-xs hover:text-rose-600"
                                                    title="Change member"
                                                  >
                                                    <X className="h-3.5 w-3.5" />
                                                  </button>
                                                </div>
                                              ) : (
                                                <>
                                                  <div className="relative">
                                                    <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-neutral-400" />
                                                    <input
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
                                                          ? 'Search & pick member (name, phone, ID)…'
                                                          : 'Type guest name or search member…'
                                                      }
                                                      className={`w-full rounded-xl border bg-white py-2 pl-8 pr-8 text-xs focus:border-neutral-900 focus:outline-none ${dupError
                                                        ? 'border-rose-400 bg-rose-50/40'
                                                        : requiresMember && !entry.memberId
                                                          ? 'border-amber-300 bg-amber-50/30'
                                                          : !entry.name.trim()
                                                            ? 'border-amber-300'
                                                            : 'border-neutral-300'
                                                        }`}
                                                    />
                                                    {entry.memberId && !requiresMember && (
                                                      <button
                                                        type="button"
                                                        onClick={() => clearPaxMemberLink(paxKey, false)}
                                                        className="absolute right-2 top-2 text-neutral-400 hover:text-rose-600"
                                                        title="Unlink member"
                                                      >
                                                        <X className="h-3.5 w-3.5" />
                                                      </button>
                                                    )}
                                                    {isFocused && searchingPax && (
                                                      <span className="absolute right-2.5 top-2 text-[10px] text-neutral-400">
                                                        …
                                                      </span>
                                                    )}
                                                  </div>

                                                  {dupError && (
                                                    <p className="mt-1 text-[10px] font-semibold text-rose-600">
                                                      {dupError}
                                                    </p>
                                                  )}

                                                  {!dupError &&
                                                    requiresMember &&
                                                    entry.name.trim().length > 0 &&
                                                    !entry.memberId && (
                                                      <p className="mt-1 text-[10px] font-semibold text-amber-700">
                                                        Tap a member from the list below to select
                                                      </p>
                                                    )}

                                                  {isFocused &&
                                                    !entry.memberId &&
                                                    visiblePaxMemberResults.length > 0 && (
                                                      <div className="absolute z-30 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-lg">
                                                        {visiblePaxMemberResults.map((m) => {
                                                          const bookedCode = bookedByMemberId.get(m.id)
                                                          const usedElsewhereInForm = expandedTicketGroups.some((g) =>
                                                            g.paxKeys.some(
                                                              (k) => k !== paxKey && getPaxEntry(k).memberId === m.id,
                                                            ),
                                                          )
                                                          const subsBlocked = requiresMember && m.subsStatus !== 'active'
                                                          const canSelect =
                                                            !subsBlocked && !bookedCode && !usedElsewhereInForm
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
                                                                if (canSelect) selectPaxMember(paxKey, m, requiresMember)
                                                              }}
                                                              className={`flex w-full items-center justify-between border-b border-neutral-100 px-3 py-2 text-left text-xs ${canSelect
                                                                ? 'hover:bg-neutral-100'
                                                                : 'cursor-not-allowed bg-neutral-50/70 opacity-60'
                                                                }`}
                                                            >
                                                              <div>
                                                                <div className="font-semibold text-neutral-900">
                                                                  {m.fullName} ({m.memberCode})
                                                                </div>
                                                                <div className="text-[10px] text-neutral-500">
                                                                  {m.phone}
                                                                  {blockedReason && (
                                                                    <span className="ml-1.5 font-semibold text-rose-600">
                                                                      · {blockedReason}
                                                                    </span>
                                                                  )}
                                                                </div>
                                                              </div>
                                                              <span
                                                                className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${m.subsStatus === 'active'
                                                                  ? 'bg-emerald-100 text-emerald-800'
                                                                  : m.subsStatus === 'arrears'
                                                                    ? 'bg-amber-100 text-amber-800'
                                                                    : 'bg-rose-100 text-rose-800'
                                                                  }`}
                                                              >
                                                                {m.subsStatus}
                                                              </span>
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
            </div>

            {/* 2. Table Selection (Optional at booking time) */}
            <div className="ticket-perforation pt-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-900">
                  <Users className="h-4 w-4 text-neutral-700" />
                  2. Table Selection (Optional)
                </h2>
                {selectedTables.length > 0 && (
                  <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-800">
                    {selectedTables.length} table{selectedTables.length === 1 ? '' : 's'} selected
                  </span>
                )}
              </div>

              {loadingMeta ? (
                <div className="mt-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/70 px-4 py-8 text-center text-xs font-medium text-neutral-400">
                  Loading tables…
                </div>
              ) : tables.length === 0 ? (
                <div className="mt-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/70 px-4 py-8 text-center">
                  {/* <Users className="mx-auto h-7 w-7 text-neutral-300" /> */}
                  <p className="mt-2 text-xs font-bold text-neutral-700">
                    No tables configured for this event
                  </p>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    You can still confirm this booking now and assign tables later.
                  </p>
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
                  {tables.map((t) => {
                    const isSelected = selectedTables.includes(t.tableLabel)
                    return (
                      <button
                        key={t.tableLabel}
                        type="button"
                        disabled={t.isReserved}
                        onClick={() => toggleTableSelection(t.tableLabel)}
                        className={`flex flex-col items-start justify-between rounded-lg border p-3 text-left text-xs transition ${t.isReserved
                          ? 'cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400'
                          : isSelected
                            ? 'border-neutral-900 bg-neutral-100 text-neutral-900 ring-1 ring-neutral-900'
                            : 'border-neutral-200 bg-white text-neutral-800 hover:border-neutral-500'
                          }`}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="text-sm font-bold">{t.tableLabel}</span>
                          {(t.price || 0) > 0 && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${t.isReserved
                                ? 'bg-neutral-200 text-neutral-500'
                                : isSelected
                                  ? 'bg-neutral-900 text-white'
                                  : 'bg-neutral-100 text-neutral-800'
                                }`}
                            >
                              +₹{Number(t.price).toLocaleString('en-IN')}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[11px] text-neutral-500">{t.tableTypeName}</div>
                        <div className="mt-1.5 text-[10px] font-semibold">
                          {t.isReserved ? (
                            <span className="text-rose-600">
                              Reserved · {t.reservedByBookingCode}
                            </span>
                          ) : isSelected ? (
                            <span className="text-neutral-900">✓ Selected</span>
                          ) : (
                            <span className="text-emerald-700">Available</span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: 3. Booking Contact, Summary & Payment */}
          <div className="space-y-4 lg:col-span-2 lg:pb-0">
            <div className="sticky top-20 rounded-3xl bg-neutral-950 p-5 text-white shadow-xl">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold text-white">
                  <UserCheck className="h-4 w-4 text-neutral-300" />
                  3. Booking Contact &amp; Payment
                </h2>
                {selectedMember && (
                  <button
                    type="button"
                    onClick={clearMember}
                    className="text-[11px] font-semibold text-neutral-400 transition hover:text-rose-400"
                  >
                    Unlink {selectedMember.memberCode}
                  </button>
                )}
              </div>

              {/* Prefilled Booking Holder Contact */}
              <div className="mt-4 space-y-3 border-b border-dashed border-white/15 pb-4">
                <div className="relative">
                  <label className="mb-1 block text-xs font-semibold text-neutral-300">
                    Booking Name *
                  </label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-neutral-400" />
                    <input
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
                      placeholder="Auto-fills from first ticket..."
                      className="w-full rounded-xl border border-white/15 bg-white py-2 pl-8 pr-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-white focus:outline-none focus:ring-2 focus:ring-white/25"
                    />
                    {holderFocused && searchingMembers && (
                      <span className="absolute right-2.5 top-2.5 text-xs text-neutral-400">
                        …
                      </span>
                    )}
                  </div>

                  {visibleMemberResults.length > 0 && (
                    <div className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-lg">
                      {visibleMemberResults.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            selectMember(m)
                          }}
                          className="flex w-full items-center justify-between border-b border-neutral-100 px-3 py-2 text-left text-xs hover:bg-neutral-100"
                        >
                          <div>
                            <div className="font-semibold text-neutral-900">
                              {m.fullName} ({m.memberCode})
                            </div>
                            <div className="text-[10px] text-neutral-500">
                              {m.phone} {m.email ? `· ${m.email}` : ''}
                            </div>
                          </div>
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${m.subsStatus === 'active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : m.subsStatus === 'arrears'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                              }`}
                          >
                            {m.subsStatus}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid gap-2.5 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-neutral-300">
                      WhatsApp / Phone *
                    </label>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value)
                        setPhoneTouched(true)
                      }}
                      placeholder="9847012345"
                      className="w-full rounded-xl border border-white/15 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-white focus:outline-none focus:ring-2 focus:ring-white/25"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-neutral-300">
                      Email *
                    </label>
                    <input
                      type="email"
                      value={email}
                      required
                      onChange={(e) => {
                        setEmail(e.target.value)
                        setEmailTouched(true)
                      }}
                      placeholder="member@example.com"
                      className="w-full rounded-xl border border-white/15 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-white focus:outline-none focus:ring-2 focus:ring-white/25"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2 border-b border-white/15 pb-4 text-xs">
                <div className="flex justify-between">
                  <span className="text-neutral-400">Total Guests (Pax)</span>
                  <span className="font-bold text-white tabular-nums">{totalPax}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-400">Tables Selected</span>
                  <span className="font-semibold text-white tabular-nums">
                    {selectedTables.length > 0 ? selectedTables.join(', ') : 'None'}
                    {tablesTotal > 0 ? ` (+₹${tablesTotal.toLocaleString('en-IN')})` : ''}
                  </span>
                </div>
                <div className="flex justify-between pt-2 text-base">
                  <span className="font-bold text-white">Total Amount</span>
                  <span className="font-extrabold text-emerald-400 tabular-nums">
                    ₹{totalAmount.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-neutral-300">
                    Payment Mode
                  </label>
                  <select
                    value={paymentMode}
                    onChange={(e) =>
                      setPaymentMode(
                        e.target.value as
                        | 'RAZORPAY'
                        | 'CASH'
                        | 'OFFICER_UPI'
                        | 'COMPLIMENTARY'
                        | 'PAY_AT_DOOR',
                      )
                    }
                    className="w-full rounded-xl border border-white/15 bg-white px-3 py-2.5 text-sm font-semibold text-neutral-900 focus:border-white focus:outline-none focus:ring-2 focus:ring-white/25"
                  >
                    <option value="RAZORPAY">Razorpay</option>
                    <option value="CASH">Cash</option>
                    <option value="OFFICER_UPI">Officer UPI</option>
                    <option value="PAY_AT_DOOR">Pay at Door</option>
                    <option value="COMPLIMENTARY">Complimentary (₹0)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-neutral-300">
                    Notes (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Vegetarian preference, wheelchair access..."
                    className="w-full rounded-xl border border-white/15 bg-white px-3 py-2 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-white focus:outline-none focus:ring-2 focus:ring-white/25"
                  />
                </div>

                {totalPax > 0 && duplicatePaxCount > 0 && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/15 px-3 py-2 text-[11px] font-semibold text-rose-200">
                    {duplicatePaxCount} duplicate or already-booked attendee
                    {duplicatePaxCount === 1 ? '' : 's'} — each ticket must have a unique guest.
                  </div>
                )}

                {totalPax > 0 && missingPaxCount > 0 && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/15 px-3 py-2 text-[11px] font-medium text-amber-200">
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
                  className="w-full rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-extrabold text-neutral-950 shadow-sm transition hover:bg-neutral-200 active:scale-[0.99] disabled:opacity-45"
                >
                  {submitting
                    ? paymentMode === 'RAZORPAY' && totalAmount > 0
                      ? 'Generating Razorpay Link…'
                      : 'Creating Master QR Booking…'
                    : paymentMode === 'RAZORPAY' && totalAmount > 0
                      ? `Generate Payment QR · ₹${totalAmount.toLocaleString('en-IN')}`
                      : `Confirm Booking · ₹${totalAmount.toLocaleString('en-IN')}`}
                </button>
              </div>
            </div>
          </div>
        </form>

      {/* PENDING RAZORPAY PAYMENT MODAL (10-Min Hold + Live Polling + 1-Tap Cash/UPI Switch) */}
      {pendingPayment && (
        <PendingRazorpayModal
          key={pendingPayment.bookingId}
          pending={pendingPayment}
          eventName={
            events.find((e) => e.id === selectedEventId)?.name || pendingPayment.holderName
          }
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

      {/* POST-BOOKING RECEIPT & MASTER QR MODAL (Dark Frosted Glass Ticket Pass) */}
      {receipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/75 p-4 backdrop-blur-sm">
          <div className="glass-surface w-full max-w-sm overflow-hidden rounded-3xl p-6 text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  Master QR Pass
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setReceipt(null)
                  setResendFeedback(null)
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 text-center">
              <div className="text-xl font-extrabold tracking-tight text-white">
                {events.find((e) => e.id === selectedEventId)?.name || receipt.holderName}
              </div>
              <div className="mt-1 text-xs text-neutral-300/80">
                Show this QR code at the event entrance
              </div>
              <div className="mt-1 text-xs font-semibold text-neutral-200">
                Ticket: {receipt.bookingCode} · {receipt.holderName} ({receipt.totalPax} Pax)
              </div>

              <div className="my-5 flex justify-center">
                <QrPassImage key={receipt.bookingCode} bookingCode={receipt.bookingCode} />
              </div>

              {/* White Inset Info Card (Inspired by Reference Ticket Pass) */}
              <div className="rounded-2xl bg-white p-3.5 text-left text-xs text-neutral-800 shadow-sm">
                <div className="flex items-center justify-between border-b border-dashed border-neutral-200 pb-2">
                  <div>
                    <div className="text-[10px] font-medium text-neutral-400">Tables</div>
                    <div className="font-bold text-neutral-900">{receipt.tablesSummary}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-medium text-neutral-400">Total</div>
                    <div className="font-extrabold text-emerald-700">
                      ₹{receipt.totalAmount.toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>
                <div className="mt-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                      Ticket IDs (for physical cards if requested)
                    </span>
                  </div>
                  {receipt.tickets.map((t) => {
                    const isCopied = copiedCode === t.ticketCode
                    return (
                      <div
                        key={t.id}
                        className="flex items-center justify-between gap-2 rounded-xl bg-neutral-50 px-2.5 py-1.5"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-[11px] font-bold text-neutral-900">
                            {t.ticketCode}
                          </div>
                          <div className="truncate text-[11px] text-neutral-600">
                            {t.paxNames && t.paxNames.length > 0
                              ? t.paxNames.join(', ')
                              : `${t.paxCount} pax`}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyCode(t.ticketCode)}
                          aria-label={`Copy Ticket ID ${t.ticketCode}`}
                          className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[10px] font-bold transition ${isCopied
                            ? 'bg-emerald-600 text-white'
                            : 'border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100'
                            }`}
                        >
                          {isCopied ? (
                            <>
                              <Check className="h-3 w-3" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3 text-neutral-400" />
                              Copy
                            </>
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {resendFeedback && (
              <div
                className={`mt-3 rounded-xl px-3 py-2 text-center text-[11px] font-semibold ${resendFeedback.type === 'ok'
                  ? 'border border-emerald-400/25 bg-emerald-500/15 text-emerald-200'
                  : 'border border-rose-400/25 bg-rose-500/15 text-rose-200'
                  }`}
              >
                {resendFeedback.text}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={resendingReceipt}
                onClick={() => setShowResendModal(true)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-white/10 px-3 py-2.5 text-xs font-semibold text-white backdrop-blur-md transition hover:bg-white/20 disabled:opacity-60"
              >
                {resendingReceipt ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    Resend
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setReceipt(null)
                  setShowResendModal(false)
                  setResendFeedback(null)
                }}
                className="flex-1 rounded-2xl bg-white px-3 py-2.5 text-xs font-bold text-neutral-950 hover:bg-neutral-100"
              >
                Done
              </button>
            </div>
          </div>
        </div>
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

function QrPassImage({ bookingCode }: { bookingCode: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [retryCount, setRetryCount] = useState(0)

  const src = `/api/qr/${encodeURIComponent(bookingCode)}?style=qr&v=5${retryCount > 0 ? `&r=${retryCount}` : ''}`

  return (
    <div className="relative flex h-56 w-56 items-center justify-center overflow-hidden rounded-2xl">
      {status === 'loading' && (
        <div
          role="status"
          aria-label="Loading QR code"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5"
        >
          {/* Subtle pulsing QR finder-corner skeleton */}
          <div className="pointer-events-none absolute inset-5 animate-pulse">
            <div className="absolute left-0 top-0 h-8 w-8 rounded-lg border-[3px] border-white/15" />
            <div className="absolute right-0 top-0 h-8 w-8 rounded-lg border-[3px] border-white/15" />
            <div className="absolute bottom-0 left-0 h-8 w-8 rounded-lg border-[3px] border-white/15" />
            <div className="absolute bottom-2 right-2 h-5 w-5 rounded bg-white/10" />
          </div>
          <Loader2 className="h-7 w-7 animate-spin text-emerald-300" />
          <span className="text-[11px] font-medium tracking-wide text-neutral-300">
            Loading QR…
          </span>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl border border-rose-400/25 bg-rose-500/10 p-4 text-center">
          <AlertTriangle className="h-6 w-6 text-rose-300" />
          <span className="text-xs font-semibold text-rose-200">
            Couldn&apos;t load QR
          </span>
          <button
            type="button"
            onClick={() => {
              setStatus('loading')
              setRetryCount((c) => c + 1)
            }}
            className="mt-1 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-white/25"
          >
            Retry
          </button>
        </div>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={retryCount}
        src={src}
        alt="Master QR"
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
        className={`h-56 w-56 transition-opacity duration-300 ${status === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  )
}

function QrLinkImage({ paymentLinkUrl }: { paymentLinkUrl: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [retryCount, setRetryCount] = useState(0)

  const src = `/api/qr/link?url=${encodeURIComponent(paymentLinkUrl)}${retryCount > 0 ? `&r=${retryCount}` : ''}`

  return (
    <div className="relative flex h-52 w-52 items-center justify-center overflow-hidden rounded-2xl">
      {status === 'loading' && (
        <div
          role="status"
          aria-label="Loading Razorpay QR"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5"
        >
          <div className="pointer-events-none absolute inset-4 animate-pulse">
            <div className="absolute left-0 top-0 h-7 w-7 rounded-lg border-[3px] border-white/15" />
            <div className="absolute right-0 top-0 h-7 w-7 rounded-lg border-[3px] border-white/15" />
            <div className="absolute bottom-0 left-0 h-7 w-7 rounded-lg border-[3px] border-white/15" />
          </div>
          <Loader2 className="h-6 w-6 animate-spin text-amber-300" />
          <span className="text-[11px] font-medium tracking-wide text-neutral-300">
            Generating Payment QR…
          </span>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl border border-rose-400/25 bg-rose-500/10 p-4 text-center">
          <AlertTriangle className="h-5 w-5 text-rose-300" />
          <span className="text-xs font-semibold text-rose-200">QR failed to load</span>
          <button
            type="button"
            onClick={() => {
              setStatus('loading')
              setRetryCount((c) => c + 1)
            }}
            className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white hover:bg-white/25"
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
        className={`h-52 w-52 transition-opacity duration-300 ${status === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
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

  // 1-second countdown ticker
  useEffect(() => {
    if (expired) return
    const timer = setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => clearInterval(timer)
  }, [expired])

  // 3-second live Razorpay payment status poller
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/75 p-4 backdrop-blur-sm">
      <div className="glass-surface w-full max-w-sm overflow-hidden rounded-3xl p-6 text-white shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-300">
            <Clock className="h-4 w-4" />
            <span className="text-xs font-bold uppercase tracking-wider">
              {expired ? 'Hold Expired' : 'Awaiting Razorpay'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!expired && (
              <span
                className={`rounded-full px-2.5 py-0.5 font-mono text-xs font-bold tabular-nums ${remainingSec <= 120
                  ? 'bg-rose-500/25 text-rose-200'
                  : 'bg-amber-400/20 text-amber-200'
                  }`}
              >
                {countdownText}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close payment modal"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-3 text-center">
          <div className="text-lg font-extrabold tracking-tight text-white">{eventName}</div>
          <div className="mt-0.5 text-xs font-semibold text-neutral-200 tabular-nums">
            {pending.bookingCode} · {pending.holderName} · ₹
            {pending.totalAmount.toLocaleString('en-IN')}
          </div>
          <div className="mt-1 text-[11px] text-neutral-300/80">
            {expired
              ? '10-minute reservation expired. Held tables & attendee slots have been released.'
              : pending.email
                ? `Scan QR below or pay via the link sent to ${pending.email} / SMS.`
                : 'Scan QR below or pay via the SMS link sent to the booking holder.'}
          </div>

          {!expired && (
            <>
              <div className="my-4 flex justify-center">
                <QrLinkImage paymentLinkUrl={pending.paymentLinkUrl} />
              </div>

              <div className="flex items-center justify-center gap-2 text-[11px] text-emerald-300/90">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Listening for payment confirmation…</span>
              </div>

              {/* Copy Link + Open Link (No WhatsApp — WhatsApp is strictly for Ticket Pass) */}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-300" />
                      Copied Link
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy Payment Link
                    </>
                  )}
                </button>
                <a
                  href={pending.paymentLinkUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open Razorpay payment link"
                  className="flex items-center justify-center rounded-2xl bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </>
          )}

          {switchError && (
            <div className="mt-3 rounded-xl border border-rose-400/30 bg-rose-500/15 px-3 py-2 text-[11px] font-medium text-rose-200">
              {switchError}
            </div>
          )}

          {/* 1-Tap Switch to Cash / Officer UPI fallback */}
          {!expired && canSwitchManual && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                Customer paying in person instead?
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={switchingMode !== null}
                  onClick={() => handleSwitchManual('CASH')}
                  className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-neutral-950 transition hover:bg-neutral-200 disabled:opacity-50"
                >
                  {switchingMode === 'CASH' ? 'Switching…' : 'Switch to Cash'}
                </button>
                <button
                  type="button"
                  disabled={switchingMode !== null}
                  onClick={() => handleSwitchManual('OFFICER_UPI')}
                  className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-50"
                >
                  {switchingMode === 'OFFICER_UPI' ? 'Switching…' : 'Switch to UPI'}
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="mt-3 w-full rounded-2xl border border-white/15 bg-transparent px-3 py-2 text-xs font-semibold text-neutral-300 transition hover:bg-white/10 hover:text-white"
          >
            {expired ? 'Close' : 'Close & Serve Next (Confirms in Background)'}
          </button>
        </div>
      </div>
    </div>
  )
}
