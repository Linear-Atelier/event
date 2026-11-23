'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Minus,
  Plus,
  Printer,
  QrCode,
  Search,
  Send,
  Ticket,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { evaluateTableAllocation } from '@/lib/table-allocation'

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
  isReserved: boolean
  reservedByBookingId: number | null
  reservedByBookingCode: string | null
  reservedByHolderName: string | null
}

interface RecentBookingItem {
  id: number
  eventId: number
  bookingCode: string
  holderName: string
  phone: string
  email?: string | null
  totalPax: number
  totalAmount: number
  status: string
  paymentMode: string
  tablesSummary: string
  assignedTableLabels?: string[]
  tickets: Array<{
    id: number
    ticketCode: string
    ticketTypeName?: string
    paxCount: number
    physicalIssued: boolean
    paxNames?: string[]
  }>
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
  recentBookings: RecentBookingItem[]
}

export function BookingDeskClient({
  events,
  initialEventId,
  canCreate,
  recentBookings: initialRecent,
}: BookingDeskClientProps) {
  const [mode, setMode] = useState<'new' | 'manage'>('new')
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
    'CASH' | 'OFFICER_UPI' | 'COMPLIMENTARY' | 'PAY_AT_DOOR'
  >('CASH')
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

  // Manage bookings state
  const [recentBookings, setRecentBookings] = useState<RecentBookingItem[]>(initialRecent)
  const [manageSearch, setManageSearch] = useState('')
  const [manageFilter, setManageFilter] = useState<'all' | 'unissued' | 'no_table'>('all')
  const [editingTablesFor, setEditingTablesFor] = useState<RecentBookingItem | null>(null)
  const [editSelectedTables, setEditSelectedTables] = useState<string[]>([])
  const [editResend, setEditResend] = useState(true)
  const [manageMessage, setManageMessage] = useState<string | null>(null)
  const summaryCardRef = useRef<HTMLDivElement | null>(null)
  const [isSummaryInView, setIsSummaryInView] = useState(false)

  useEffect(() => {
    if (mode !== 'new') return
    const el = summaryCardRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsSummaryInView(entry.isIntersecting)
      },
      { threshold: 0.15 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [mode])

  const paymentModeLabel: Record<typeof paymentMode, string> = {
    CASH: 'CASH',
    OFFICER_UPI: 'OFFICER UPI',
    PAY_AT_DOOR: 'PAY AT DOOR',
    COMPLIMENTARY: 'COMPLIMENTARY',
  }

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

  const { totalPax, totalAmount } = useMemo(() => {
    let pax = 0
    let amt = 0
    for (const p of phases) {
      const qty = quantities[p.id] || 0
      if (qty > 0) {
        pax += qty * p.paxMultiplier
        amt += paymentMode === 'COMPLIMENTARY' ? 0 : qty * p.price
      }
    }
    return { totalPax: pax, totalAmount: amt }
  }, [phases, quantities, paymentMode])

  const defaultTableCap =
    tables.find((t) => !t.isReserved)?.maxCapacity || tables[0]?.maxCapacity || 8

  const tableEval = useMemo(() => {
    const assigned = selectedTables
      .map((lbl) => tables.find((t) => t.tableLabel === lbl))
      .filter((t): t is TableOption => Boolean(t))
      .map((t) => ({
        tableId: t.tableLabel,
        tableLabel: t.tableLabel,
        maxCapacity: t.maxCapacity,
        isShared: false,
        allocatedSeats: t.maxCapacity,
      }))
    return evaluateTableAllocation(totalPax, assigned, defaultTableCap)
  }, [selectedTables, tables, totalPax, defaultTableCap])

  function toggleTableSelection(tableLabel: string) {
    setSelectedTables((prev) =>
      prev.includes(tableLabel)
        ? prev.filter((x) => x !== tableLabel)
        : [...prev, tableLabel],
    )
  }

  function toggleEditTableSelection(tableLabel: string) {
    setEditSelectedTables((prev) =>
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

      setReceipt({
        bookingId: data.booking.id,
        bookingCode: data.booking.bookingCode,
        holderName: data.booking.holderName,
        totalPax: data.booking.totalPax,
        totalAmount: data.booking.totalAmount,
        tablesSummary: data.tablesSummary,
        tickets: (data.tickets || []).map(
          (t: { id: number; ticketCode: string; paxCount: number }) => ({
            id: t.id,
            ticketCode: t.ticketCode,
            paxCount: t.paxCount,
            paxNames: paxNamesByTicket.get(t.id) || [],
          }),
        ),
      })

      setRecentBookings((prev) => [
        {
          id: data.booking.id,
          eventId: selectedEventId,
          bookingCode: data.booking.bookingCode,
          holderName: data.booking.holderName,
          phone: data.booking.phone,
          email: data.booking.email,
          totalPax: data.booking.totalPax,
          totalAmount: data.booking.totalAmount,
          status: data.booking.status,
          paymentMode: data.booking.paymentMode,
          tablesSummary: data.tablesSummary,
          assignedTableLabels: [...selectedTables],
          tickets: (data.tickets || []).map(
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
              physicalIssued: false,
              paxNames:
                paxNamesByTicket.get(t.id) ||
                (t.attendeeNames
                  ? t.attendeeNames
                    .split(',')
                    .map((n) => n.trim())
                    .filter(Boolean)
                  : []),
            }),
          ),
        },
        ...prev,
      ])

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

  async function handleTogglePhysical(bookingId: number, ticketId: number, current: boolean) {
    setManageMessage(null)
    const res = await fetch(`/api/bookings/${bookingId}/physical`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        ticketId,
        physicalIssued: !current,
      }),
    })
    if (res.ok) {
      setRecentBookings((prev) =>
        prev.map((b) =>
          b.id !== bookingId
            ? b
            : {
              ...b,
              tickets: b.tickets.map((t) =>
                t.id !== ticketId ? t : { ...t, physicalIssued: !current },
              ),
            },
        ),
      )
      setManageMessage(!current ? 'Physical ticket marked issued.' : 'Physical ticket unmarked.')
    }
  }

  async function handleCancelBooking(bookingId: number) {
    const reason = window.prompt('Enter cancellation reason (booking will be marked cancelled, never deleted):')
    if (reason === null) return
    const res = await fetch(`/api/bookings/${bookingId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        status: 'cancelled',
        paymentStatus: 'refunded',
        notes: reason || 'Cancelled by officer',
      }),
    })
    if (res.ok) {
      setRecentBookings((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, status: 'cancelled' } : b)),
      )
      setManageMessage('Booking marked cancelled with audit history preserved.')
    }
  }

  async function handleTransferBooking(booking: RecentBookingItem) {
    const newName = window.prompt('Transfer ticket to (New Holder Name):', booking.holderName)
    if (!newName) return
    const newPhone = window.prompt('New Holder Phone:', booking.phone)
    if (!newPhone) return
    const res = await fetch(`/api/bookings/${booking.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        status: 'transferred',
        holderName: newName,
        phone: newPhone,
        notes: `Transferred from ${booking.holderName} (${booking.phone})`,
      }),
    })
    if (res.ok) {
      setRecentBookings((prev) =>
        prev.map((b) =>
          b.id === booking.id
            ? { ...b, status: 'transferred', holderName: newName, phone: newPhone }
            : b,
        ),
      )
      setManageMessage(`Booking ${booking.bookingCode} transferred to ${newName}.`)
    }
  }

  async function handleSaveTableUpdate() {
    if (!editingTablesFor) return

    const res = await fetch(`/api/bookings/${editingTablesFor.id}/tables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        tables: editSelectedTables,
        resendNotification: editResend,
      }),
    })
    const data = await res.json()
    if (res.ok) {
      setRecentBookings((prev) =>
        prev.map((b) =>
          b.id === editingTablesFor.id
            ? {
              ...b,
              tablesSummary: data.tablesSummary,
              assignedTableLabels: [...editSelectedTables],
            }
            : b,
        ),
      )
      setManageMessage(
        `Tables updated for ${editingTablesFor.bookingCode}: ${data.tablesSummary}${editResend ? ' (Master QR resent)' : ''}`,
      )
      setEditingTablesFor(null)
      loadEventMeta(selectedEventId)
    } else {
      window.alert(data.error || 'Failed to update tables')
    }
  }

  const eventRecentBookings = useMemo(
    () => recentBookings.filter((b) => b.eventId === selectedEventId),
    [recentBookings, selectedEventId],
  )

  const filteredRecent = useMemo(() => {
    const q = manageSearch.trim().toLowerCase()
    return eventRecentBookings.filter((b) => {
      if (manageFilter === 'unissued') {
        if (b.status === 'cancelled' || !b.tickets.some((t) => !t.physicalIssued)) {
          return false
        }
      } else if (manageFilter === 'no_table') {
        if (b.status === 'cancelled' || (b.assignedTableLabels && b.assignedTableLabels.length > 0)) {
          return false
        }
      }
      if (!q) return true
      return (
        b.bookingCode.toLowerCase().includes(q) ||
        b.holderName.toLowerCase().includes(q) ||
        b.phone.toLowerCase().includes(q) ||
        b.tickets.some(
          (t) =>
            t.ticketCode.toLowerCase().includes(q) ||
            (t.paxNames || []).some((n) => n.toLowerCase().includes(q)),
        )
      )
    })
  }, [eventRecentBookings, manageSearch, manageFilter])

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        {/* <div>
          <h1 className="text-2xl font-bold text-neutral-900">Booking Officer POS Desk</h1>
          <p className="text-sm text-neutral-600">
            Fast officer-only ticket entry, member subs lookup, smart seating &amp; physical stub tracking.
          </p>
        </div> */}

        <div className="w-full flex flex-col md:flex-row items-stretch md:items-center gap-2">
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(Number(e.target.value))}
            className="flex-1 rounded-full border border-neutral-300 bg-white px-3 py-2 text-lg font-semibold text-neutral-800"
          >
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} — {ev.code}
              </option>
            ))}
          </select>

          <div className="flex flex-1 rounded-2xl bg-neutral-100/90 p-1">
            <button
              type="button"
              onClick={() => setMode('new')}
              className={`flex-1 rounded-xl px-3 py-2 text-xs font-bold transition ${mode === 'new'
                ? 'bg-white text-neutral-950 shadow-xs'
                : 'text-neutral-500 hover:text-neutral-800'
                }`}
            >
              New Booking
            </button>
            <button
              type="button"
              onClick={() => setMode('manage')}
              className={`flex-1 rounded-xl px-3 py-2 text-xs font-bold transition ${mode === 'manage'
                ? 'bg-white text-neutral-950 shadow-xs'
                : 'text-neutral-500 hover:text-neutral-800'
                }`}
            >
              Manage / Stubs ({eventRecentBookings.length})
            </button>
          </div>
        </div>
      </div>

      {!canCreate && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900">
          You are viewing the Booking Desk in read-only mode. Creating or editing bookings requires the{' '}
          <strong>booking_officer</strong> or <strong>super_admin</strong> role.
        </div>
      )}

      {mode === 'new' ? (
        <form onSubmit={handleCreateBooking} className="grid gap-6 pb-40 lg:grid-cols-5 lg:pb-0">
          {/* Left columns: Tickets & Tables */}
          <div className="space-y-6 lg:col-span-3">
            {error && (
              <div className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800">
                {error}
              </div>
            )}

            {/* 1. Select Tickets + Inline Member/Guest Entry */}
            <div className="bg-white py-1">
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

                      <div className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white">
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

            {/* 2. Smart Table Allocation (Optional at booking time) */}
            <div className="ticket-perforation pt-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-900">
                  <Users className="h-4 w-4 text-neutral-700" />
                  2. Smart Table Allocation
                </h2>
                {totalPax > 0 && tables.length > 0 && (
                  <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-800">
                    {tableEval.recommendationText}
                  </span>
                )}
              </div>

              {tableEval.warningText && tables.length > 0 && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  {tableEval.warningText}
                </div>
              )}

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
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${t.isReserved
                              ? 'bg-neutral-200 text-neutral-500'
                              : isSelected
                                ? 'bg-neutral-900 text-white'
                                : 'bg-neutral-100 text-neutral-700'
                              }`}
                          >
                            {t.maxCapacity} seats
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-neutral-500">{t.tableTypeName}</div>
                        <div className="mt-1.5 text-[10px] font-semibold">
                          {t.isReserved ? (
                            <span className="text-rose-600">
                              Reserved · {t.reservedByBookingCode}
                            </span>
                          ) : isSelected ? (
                            <span className="text-neutral-900">✓ Selected (Full Table)</span>
                          ) : (
                            <span className="text-emerald-700">Available — Click to reserve</span>
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
          <div className="space-y-4 pb-20 lg:col-span-2 lg:pb-0">
            <div ref={summaryCardRef} className="sticky top-20 rounded-3xl bg-neutral-50/90 p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-900">
                  <UserCheck className="h-4 w-4 text-neutral-700" />
                  3. Booking Contact &amp; Payment
                </h2>
                {selectedMember && (
                  <button
                    type="button"
                    onClick={clearMember}
                    className="text-[11px] font-semibold text-neutral-500 hover:text-rose-600"
                  >
                    Unlink {selectedMember.memberCode}
                  </button>
                )}
              </div>

              {/* Prefilled Booking Holder Contact */}
              <div className="mt-4 space-y-3 border-b border-dashed border-neutral-200 pb-4">
                <div className="relative">
                  <label className="mb-1 block text-xs font-semibold text-neutral-700">
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
                      className="w-full rounded-xl border border-neutral-300 bg-white py-2 pl-8 pr-3 text-sm focus:border-neutral-900 focus:outline-none"
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
                    <label className="mb-1 block text-xs font-semibold text-neutral-700">
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
                      className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-neutral-700">
                      Email
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value)
                        setEmailTouched(true)
                      }}
                      placeholder="member@example.com"
                      className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2 border-b border-neutral-200/70 pb-4 text-xs">
                <div className="flex justify-between">
                  <span className="text-neutral-500">Total Guests (Pax)</span>
                  <span className="font-bold text-neutral-900">{totalPax}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Tables Assigned</span>
                  <span className="font-semibold text-neutral-900">
                    {tableEval.totalAllocatedSeats} seats
                  </span>
                </div>
                <div className="flex justify-between pt-2 text-base">
                  <span className="font-bold text-neutral-900">Total Amount</span>
                  <span className="font-bold text-emerald-700">
                    ₹{totalAmount.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-700">
                    Payment Mode
                  </label>
                  <select
                    value={paymentMode}
                    onChange={(e) =>
                      setPaymentMode(
                        e.target.value as
                        | 'CASH'
                        | 'OFFICER_UPI'
                        | 'COMPLIMENTARY'
                        | 'PAY_AT_DOOR',
                      )
                    }
                    className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800"
                  >
                    <option value="CASH">Cash (Collected by Me)</option>
                    <option value="OFFICER_UPI">Officer UPI</option>
                    <option value="PAY_AT_DOOR">Pay at Door</option>
                    <option value="COMPLIMENTARY">Complimentary (₹0)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-700">
                    Notes (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Vegetarian preference, wheelchair access..."
                    className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs focus:border-neutral-900 focus:outline-none"
                  />
                </div>

                {totalPax > 0 && duplicatePaxCount > 0 && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                    {duplicatePaxCount} duplicate or already-booked attendee
                    {duplicatePaxCount === 1 ? '' : 's'} — each ticket must have a unique guest.
                  </div>
                )}

                {totalPax > 0 && missingPaxCount > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
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
                  className="w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-neutral-800 disabled:opacity-50"
                >
                  {submitting
                    ? 'Creating Master QR Booking…'
                    : `Confirm Booking · ₹${totalAmount.toLocaleString('en-IN')}`}
                </button>
              </div>
            </div>
          </div>

          {/* Zomato-Style Sticky Mobile Checkout Bar (shown when Booking Summary & Payment is out of view) */}
          {!isSummaryInView && (
            <div className="fixed inset-x-0 bottom-19 z-30 border-t border-white/10 bg-neutral-950/95 px-4 py-2.5 text-white shadow-2xl backdrop-blur-xl lg:hidden">
              <div className="mx-auto flex max-w-2xl items-center gap-3">
                {/* Left: PAY USING ▲ + Payment Mode Picker */}
                <div className="relative flex shrink-0 flex-col justify-center pr-1">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                    <span className="flex h-4 w-5 items-center justify-center rounded bg-white text-neutral-950">
                      <Wallet className="h-3 w-3" />
                    </span>
                    <span>PAY USING</span>
                    <span className="text-[8px] leading-none">▲</span>
                  </div>
                  <div className="mt-0.5 text-xs font-extrabold tracking-wide text-white">
                    {paymentModeLabel[paymentMode]}
                  </div>
                  <select
                    aria-label="Select Payment Mode"
                    value={paymentMode}
                    onChange={(e) =>
                      setPaymentMode(
                        e.target.value as
                        | 'CASH'
                        | 'OFFICER_UPI'
                        | 'COMPLIMENTARY'
                        | 'PAY_AT_DOOR',
                      )
                    }
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0 bg-neutral-800 "
                  >
                    <option value="CASH">Cash (Collected by Me)</option>
                    <option value="OFFICER_UPI">Officer UPI</option>
                    <option value="PAY_AT_DOOR">Pay at Door</option>
                    <option value="COMPLIMENTARY">Complimentary (₹0)</option>
                  </select>
                </div>

                {/* Right: Split Total Amount + Confirm Button */}
                <button
                  type="submit"
                  disabled={
                    !canCreate ||
                    submitting ||
                    totalPax === 0 ||
                    missingPaxCount > 0 ||
                    duplicatePaxCount > 0
                  }
                  className="flex flex-1 items-center justify-between rounded-2xl bg-white px-4 py-2.5 text-neutral-950 shadow-lg transition hover:bg-neutral-200 active:scale-[0.99] disabled:opacity-45"
                >
                  <div className="text-left leading-tight">
                    <div className="text-base font-extrabold tracking-tight">
                      ₹{totalAmount.toLocaleString('en-IN')}
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-950/75">
                      TOTAL{totalPax > 0 ? ` · ${totalPax} PAX` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-sm font-extrabold">
                    <span>{submitting ? 'Booking…' : 'Confirm'}</span>
                    <span className="text-xs leading-none">▸</span>
                  </div>
                </button>
              </div>
            </div>
          )}
        </form>
      ) : (
        /* MANAGE BOOKINGS, PHYSICAL STUBS, TABLE EDITS, CANCEL/TRANSFER */
        <div className="space-y-4 pb-28">
          {manageMessage && (
            <div className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-900">
              <span>{manageMessage}</span>
              <button type="button" onClick={() => setManageMessage(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Compact Search + Quick Filter Pills */}
          <div className="space-y-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-zinc-400" />
              <input
                type="text"
                value={manageSearch}
                onChange={(e) => setManageSearch(e.target.value)}
                placeholder="Search code, holder, guest name, or phone..."
                className="w-full rounded-2xl border border-zinc-200 bg-zinc-50/70 py-2.5 pl-10 pr-4 text-sm text-zinc-900 placeholder-zinc-400 transition focus:border-zinc-900 focus:bg-white focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { key: 'all', label: `All (${eventRecentBookings.length})` },
                  {
                    key: 'unissued',
                    label: `Unissued (${eventRecentBookings.filter((b) => b.status !== 'cancelled' && b.tickets.some((t) => !t.physicalIssued)).length})`,
                  },
                  {
                    key: 'no_table',
                    label: `No Table (${eventRecentBookings.filter((b) => b.status !== 'cancelled' && (!b.assignedTableLabels || b.assignedTableLabels.length === 0)).length})`,
                  },
                ] as const
              ).map((pill) => (
                <button
                  key={pill.key}
                  type="button"
                  onClick={() => setManageFilter(pill.key)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${manageFilter === pill.key
                    ? 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/80'
                    }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>

          {filteredRecent.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-12 text-center">
              <Ticket className="mx-auto h-7 w-7 text-zinc-300" />
              <p className="mt-2 text-sm font-semibold text-zinc-700">No matching bookings</p>
              <p className="mt-0.5 text-xs text-zinc-400">
                Try clearing your search or switching the filter above.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRecent.map((b) => {
                const issuedCount = b.tickets.filter((t) => t.physicalIssued).length
                const hasTables = Boolean(b.assignedTableLabels && b.assignedTableLabels.length > 0)

                return (
                  <div
                    key={b.id}
                    className={`overflow-hidden rounded-2xl border border-zinc-200 bg-white ${b.status === 'cancelled' ? 'opacity-65' : ''
                      }`}
                  >
                    {/* Booking Header */}
                    <div className="px-4 py-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[15px] font-bold leading-snug text-zinc-900">
                              {b.holderName}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${b.status === 'confirmed'
                                ? 'bg-emerald-100 text-emerald-800'
                                : b.status === 'transferred'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-rose-100 text-rose-800'
                                }`}
                            >
                              {b.status}
                            </span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500 tabular-nums">
                            <span className="font-semibold text-zinc-800">{b.bookingCode}</span>
                            <span>·</span>
                            <span>{b.phone}</span>
                          </div>
                        </div>

                        <div className="shrink-0 text-right tabular-nums">
                          <div className="text-sm font-bold text-zinc-900">
                            ₹{b.totalAmount.toLocaleString('en-IN')}
                          </div>
                          <div className="text-[11px] font-medium text-zinc-500">
                            {b.totalPax} pax · {b.paymentMode}
                          </div>
                        </div>
                      </div>

                      {/* Compact Status Chips: Table + Stubs Progress */}
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span
                          className={`rounded-md px-2 py-0.5 font-semibold ${hasTables
                            ? 'bg-zinc-100 text-zinc-800'
                            : 'bg-amber-50 text-amber-700'
                            }`}
                        >
                          Table: {b.tablesSummary}
                        </span>
                        <span
                          className={`rounded-md px-2 py-0.5 font-semibold tabular-nums ${issuedCount === b.tickets.length && b.tickets.length > 0
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-zinc-100 text-zinc-600'
                            }`}
                        >
                          Stubs: {issuedCount}/{b.tickets.length}
                        </span>
                      </div>
                    </div>

                    {/* Compact Grouped Ticket Stubs List (Left Info / Right Action) */}
                    {b.tickets.length > 0 && (
                      <div className="divide-y divide-zinc-100 border-t border-zinc-100 bg-zinc-50/50">
                        {b.tickets.map((t) => {
                          const shortStub = t.ticketCode.split('-').pop() || t.ticketCode
                          return (
                            <div
                              key={t.id}
                              className="flex items-center justify-between gap-3 px-4 py-2.5"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="rounded bg-zinc-200/70 px-1.5 py-0.5 font-mono text-[10px] font-bold text-zinc-800">
                                    {shortStub}
                                  </span>
                                  {t.ticketTypeName && (
                                    <span className="text-xs font-semibold text-zinc-900">
                                      {t.ticketTypeName}
                                    </span>
                                  )}
                                  <span className="text-[11px] text-zinc-500">
                                    · {t.paxCount} pax
                                  </span>
                                </div>
                                <div className="mt-0.5 truncate text-xs text-zinc-600">
                                  {t.paxNames && t.paxNames.length > 0
                                    ? t.paxNames.join(', ')
                                    : b.holderName}
                                </div>
                              </div>

                              <button
                                type="button"
                                disabled={!canCreate || b.status === 'cancelled'}
                                onClick={() => handleTogglePhysical(b.id, t.id, t.physicalIssued)}
                                aria-label={
                                  t.physicalIssued
                                    ? `Unmark ${t.ticketCode} as issued`
                                    : `Mark ${t.ticketCode} as issued`
                                }
                                className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-xl px-3 text-xs font-semibold transition disabled:opacity-45 ${t.physicalIssued
                                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                  : 'border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-100'
                                  }`}
                              >
                                {t.physicalIssued ? (
                                  <>
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Issued
                                  </>
                                ) : (
                                  <>
                                    <Printer className="h-3.5 w-3.5 text-zinc-500" />
                                    Issue
                                  </>
                                )}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Compact Action Footer */}
                    {b.status !== 'cancelled' && (
                      <div className="flex items-center justify-between gap-2 border-t border-zinc-100 bg-white px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setReceipt({
                                bookingId: b.id,
                                bookingCode: b.bookingCode,
                                holderName: b.holderName,
                                totalPax: b.totalPax,
                                totalAmount: b.totalAmount,
                                tablesSummary: b.tablesSummary,
                                tickets: b.tickets.map((t) => ({
                                  id: t.id,
                                  ticketCode: t.ticketCode,
                                  paxCount: t.paxCount,
                                  paxNames: t.paxNames,
                                })),
                              })
                            }
                            className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-zinc-900 px-3 text-xs font-semibold text-white transition hover:bg-zinc-800"
                          >
                            <QrCode className="h-3.5 w-3.5" />
                            QR Pass
                          </button>

                          {canCreate && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTablesFor(b)
                                setEditSelectedTables(b.assignedTableLabels || [])
                              }}
                              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-100"
                            >
                              <Users className="h-3.5 w-3.5 text-zinc-500" />
                              {hasTables ? 'Edit Tables' : 'Assign Table'}
                            </button>
                          )}
                        </div>

                        {canCreate && (
                          <button
                            type="button"
                            onClick={() => handleCancelBooking(b.id)}
                            className="h-8 rounded-xl px-2.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
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
                onClick={() => setReceipt(null)}
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
                <div className="mt-2 space-y-1">
                  {receipt.tickets.map((t) => (
                    <div key={t.id} className="text-[11px] text-neutral-600">
                      <strong className="text-neutral-900">{t.ticketCode}:</strong>{' '}
                      {t.paxNames && t.paxNames.length > 0
                        ? t.paxNames.join(', ')
                        : `${t.paxCount} pax`}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  await fetch(`/api/bookings/${receipt.bookingId}/resend`, {
                    method: 'POST',
                    credentials: 'include',
                  })
                  window.alert('WhatsApp & Email pass resend triggered!')
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-white/10 px-3 py-2.5 text-xs font-semibold text-white backdrop-blur-md hover:bg-white/20"
              >
                <Send className="h-3.5 w-3.5" />
                Resend
              </button>
              <button
                type="button"
                onClick={() => setReceipt(null)}
                className="flex-1 rounded-2xl bg-white px-3 py-2.5 text-xs font-bold text-neutral-950 hover:bg-neutral-100"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT TABLES MODAL */}
      {editingTablesFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-neutral-900">
                Assign Tables · {editingTablesFor.bookingCode} ({editingTablesFor.totalPax} Pax)
              </h3>
              <button type="button" onClick={() => setEditingTablesFor(null)}>
                <X className="h-4 w-4 text-neutral-400" />
              </button>
            </div>

            <div className="mt-3 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {tables.map((t) => {
                const reservedByOther =
                  t.isReserved && t.reservedByBookingId !== editingTablesFor.id
                const isSelected = editSelectedTables.includes(t.tableLabel)
                return (
                  <button
                    key={t.tableLabel}
                    type="button"
                    disabled={reservedByOther}
                    onClick={() => toggleEditTableSelection(t.tableLabel)}
                    className={`flex flex-col items-start justify-between rounded-lg border p-2.5 text-left text-xs transition ${reservedByOther
                      ? 'cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400'
                      : isSelected
                        ? 'border-neutral-900 bg-neutral-100 text-neutral-900 ring-1 ring-neutral-900'
                        : 'border-neutral-200 bg-white text-neutral-800 hover:border-neutral-500'
                      }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="font-bold">{t.tableLabel}</span>
                      <span className="text-[10px] font-semibold">{t.maxCapacity}p</span>
                    </div>
                    <div className="text-[10px] text-neutral-500">{t.tableTypeName}</div>
                    <div className="mt-1 text-[10px] font-semibold">
                      {reservedByOther ? (
                        <span className="text-rose-600">
                          Reserved ({t.reservedByBookingCode})
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

            <label className="mt-4 flex items-center gap-2 text-xs font-medium text-neutral-700">
              <input
                type="checkbox"
                checked={editResend}
                onChange={(e) => setEditResend(e.target.checked)}
              />
              One-tap resend updated seating via WhatsApp / Email (same Master QR)
            </label>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingTablesFor(null)}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveTableUpdate}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800"
              >
                Save Seating
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function QrPassImage({ bookingCode }: { bookingCode: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [retryCount, setRetryCount] = useState(0)

  const src = `/api/qr/${encodeURIComponent(bookingCode)}?style=qr&v=2${retryCount > 0 ? `&r=${retryCount}` : ''}`

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
