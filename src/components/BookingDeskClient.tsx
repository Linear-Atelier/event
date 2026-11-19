'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Minus,
  Plus,
  Printer,
  Search,
  Send,
  Ticket,
  UserCheck,
  Users,
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
  const [loadingMeta, setLoadingMeta] = useState(false)

  // Primary Holder member lookup (combined with Holder Full Name field)
  const [holderFocused, setHolderFocused] = useState(false)
  const [memberResults, setMemberResults] = useState<MemberResult[]>([])
  const [selectedMember, setSelectedMember] = useState<MemberResult | null>(null)
  const [searchingMembers, setSearchingMembers] = useState(false)

  // Holder info
  const [holderName, setHolderName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
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
  const [editingTablesFor, setEditingTablesFor] = useState<RecentBookingItem | null>(null)
  const [editSelectedTables, setEditSelectedTables] = useState<string[]>([])
  const [editResend, setEditResend] = useState(true)
  const [manageMessage, setManageMessage] = useState<string | null>(null)

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
      }
    } finally {
      setLoadingMeta(false)
    }
  }, [])

  useEffect(() => {
    if (selectedEventId) {
      loadEventMeta(selectedEventId)
    }
  }, [selectedEventId, loadEventMeta])

  // Debounced member search directly on Holder Full Name input
  useEffect(() => {
    const q = holderName.trim()
    if (!holderFocused || selectedMember || q.length < 2) {
      setMemberResults([])
      return
    }
    const timer = setTimeout(async () => {
      setSearchingMembers(true)
      try {
        const res = await fetch(`/api/members/search?q=${encodeURIComponent(q)}`, {
          credentials: 'include',
        })
        if (res.ok) {
          const data = await res.json()
          setMemberResults(data.members || [])
        }
      } finally {
        setSearchingMembers(false)
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [holderName, holderFocused, selectedMember])

  function selectMember(m: MemberResult) {
    setSelectedMember(m)
    setHolderName(m.fullName)
    setPhone(m.phone)
    setEmail(m.email || '')
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
      const existing = paxDetails[key]
      if (existing?.touched) return existing
      if (key === firstPaxKey) {
        return {
          name: holderName,
          memberId: selectedMember?.id || null,
          memberCode: selectedMember?.memberCode || null,
          subsStatus: selectedMember?.subsStatus || null,
          touched: false,
        }
      }
      return existing || { name: '', memberId: null }
    },
    [paxDetails, firstPaxKey, holderName, selectedMember],
  )

  const missingPaxCount = useMemo(() => {
    let missing = 0
    for (const grp of expandedTicketGroups) {
      for (const k of grp.paxKeys) {
        if (!getPaxEntry(k).name.trim()) {
          missing += 1
        }
      }
    }
    return missing
  }, [expandedTicketGroups, getPaxEntry])

  // Debounced inline member lookup for the active pax input
  const activePaxQuery = activePaxKey ? getPaxEntry(activePaxKey).name.trim() : ''
  const activePaxHasLinkedMember = activePaxKey
    ? Boolean(getPaxEntry(activePaxKey).memberId)
    : false

  useEffect(() => {
    if (!activePaxKey || activePaxHasLinkedMember || activePaxQuery.length < 2) {
      setPaxMemberResults([])
      return
    }
    const timer = setTimeout(async () => {
      setSearchingPax(true)
      try {
        const res = await fetch(`/api/members/search?q=${encodeURIComponent(activePaxQuery)}`, {
          credentials: 'include',
        })
        if (res.ok) {
          const data = await res.json()
          setPaxMemberResults(data.members || [])
        }
      } finally {
        setSearchingPax(false)
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [activePaxKey, activePaxQuery, activePaxHasLinkedMember])

  function selectPaxMember(key: string, m: MemberResult) {
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
    setActivePaxKey(key)
  }

  function clearPaxMemberLink(key: string) {
    const curr = getPaxEntry(key)
    setPaxDetails((prev) => ({
      ...prev,
      [key]: {
        name: curr.name,
        memberId: null,
        memberCode: null,
        subsStatus: null,
        touched: true,
      },
    }))
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

  const filteredRecent = useMemo(() => {
    const q = manageSearch.trim().toLowerCase()
    if (!q) return recentBookings
    return recentBookings.filter(
      (b) =>
        b.bookingCode.toLowerCase().includes(q) ||
        b.holderName.toLowerCase().includes(q) ||
        b.phone.toLowerCase().includes(q) ||
        b.tickets.some((t) => t.ticketCode.toLowerCase().includes(q)),
    )
  }, [recentBookings, manageSearch])

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        {/* <div>
          <h1 className="text-2xl font-bold text-slate-900">Booking Officer POS Desk</h1>
          <p className="text-sm text-slate-600">
            Fast officer-only ticket entry, member subs lookup, smart seating &amp; physical stub tracking.
          </p>
        </div> */}

        <div className="w-full flex flex-col md:flex-row items-stretch md:items-center gap-2">
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(Number(e.target.value))}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800"
          >
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.code} — {ev.name}
              </option>
            ))}
          </select>

          <div className="flex-1 flex rounded-lg border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setMode('new')}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold ${
                mode === 'new' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              New Booking
            </button>
            <button
              type="button"
              onClick={() => setMode('manage')}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold ${
                mode === 'manage' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Manage / Stubs ({recentBookings.length})
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
        <form onSubmit={handleCreateBooking} className="grid gap-6 lg:grid-cols-3">
          {/* Left 2 columns: Member Lookup, Guest Info, Tickets, Tables */}
          <div className="space-y-6 lg:col-span-2">
            {error && (
              <div className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800">
                {error}
              </div>
            )}

            {/* 1. Unified Holder Lookup, Ticket Selection & Required Attendee Names */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <UserCheck className="h-4 w-4 text-sky-600" />
                  1. Booking Name
                </h2>
                {selectedMember && (
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${
                        selectedMember.subsStatus === 'active'
                          ? 'bg-emerald-600 text-white'
                          : selectedMember.subsStatus === 'arrears'
                            ? 'bg-amber-500 text-white'
                            : 'bg-rose-600 text-white'
                      }`}
                    >
                      {selectedMember.memberCode} · Subs: {selectedMember.subsStatus}
                    </span>
                    <button
                      type="button"
                      onClick={clearMember}
                      className="text-xs font-medium text-slate-500 hover:text-rose-600"
                    >
                      Unlink
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="relative">
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Booking Name *
                  </label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      required
                      value={holderName}
                      onFocus={() => setHolderFocused(true)}
                      onBlur={() => setTimeout(() => setHolderFocused(false), 180)}
                      onChange={(e) => {
                        setHolderName(e.target.value)
                        if (selectedMember) setSelectedMember(null)
                        setHolderFocused(true)
                      }}
                      placeholder="Search member or type guest name..."
                      className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-sky-500 focus:outline-none"
                    />
                    {holderFocused && searchingMembers && (
                      <span className="absolute right-2.5 top-2.5 text-xs text-slate-400">
                        …
                      </span>
                    )}
                  </div>

                  {holderFocused && !selectedMember && memberResults.length > 0 && (
                    <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                      {memberResults.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            selectMember(m)
                          }}
                          className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-xs hover:bg-sky-50"
                        >
                          <div>
                            <div className="font-semibold text-slate-900">
                              {m.fullName} ({m.memberCode})
                            </div>
                            <div className="text-slate-500">
                              {m.phone} {m.email ? `· ${m.email}` : ''}
                            </div>
                          </div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                              m.subsStatus === 'active'
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
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    WhatsApp / Phone *
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="9847012345"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="member@example.com"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Ticket Types × Phases */}
              <div className="mt-6 border-t border-slate-100 pt-5">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-700">
                  <Ticket className="h-4 w-4 text-sky-600" />
                  Select Tickets
                </div>

                {loadingMeta ? (
                  <p className="mt-3 text-xs text-slate-500">Loading ticket phases…</p>
                ) : phases.length === 0 ? (
                  <p className="mt-3 text-xs text-amber-700">
                    No active ticket phases configured for this event.
                  </p>
                ) : (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {phases.map((p) => {
                      const qty = quantities[p.id] || 0
                      return (
                        <div
                          key={p.id}
                          className={`flex items-center justify-between rounded-lg border p-3 transition ${
                            qty > 0
                              ? 'border-sky-500 bg-sky-50/50'
                              : 'border-slate-200 bg-white'
                          }`}
                        >
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-bold text-slate-900">
                                {p.ticketTypeName}
                              </span>
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                {p.paxMultiplier} pax
                              </span>
                              {p.memberOnly && (
                                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                                  Member
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500">
                              {p.phaseName} ·{' '}
                              <strong className="text-slate-900">
                                ₹{p.price.toLocaleString('en-IN')}
                              </strong>
                              {p.endsAt && (
                                <span className="ml-1.5 text-[10px] text-slate-400">
                                  (Ends{' '}
                                  {new Date(p.endsAt).toLocaleDateString('en-IN', {
                                    day: 'numeric',
                                    month: 'short',
                                  })}
                                  )
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => adjustQty(p.id, -1)}
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="w-6 text-center text-sm font-bold text-slate-900">
                              {qty}
                            </span>
                            <button
                              type="button"
                              onClick={() => adjustQty(p.id, 1)}
                              className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-600 text-white hover:bg-sky-700"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Per-Ticket Required Pax Names with Inline Member Lookup */}
              {expandedTicketGroups.length > 0 && (
                <div className="mt-6 border-t border-slate-100 pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-700">
                      <Users className="h-4 w-4 text-sky-600" />
                      Guest Names Required per Ticket ({totalPax} Pax)
                    </div>
                    <span className="text-[11px] text-slate-500">
                      Type a guest name or pick a member from lookup
                    </span>
                  </div>

                  <div className="mt-3 space-y-3">
                    {expandedTicketGroups.map((grp) => (
                      <div
                        key={`${grp.phase.id}-${grp.ticketIdx}`}
                        className="rounded-lg border border-slate-200 bg-slate-50/70 p-3"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-900">
                            Ticket #{grp.displayIndex} · {grp.phase.ticketTypeName} (
                            {grp.phase.phaseName})
                          </span>
                          <span className="rounded bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 shadow-xs">
                            {grp.phase.paxMultiplier} Pax
                          </span>
                        </div>

                        <div className="grid gap-2.5 sm:grid-cols-2">
                          {grp.paxKeys.map((paxKey, pIdx) => {
                            const entry = getPaxEntry(paxKey)
                            const isFocused = activePaxKey === paxKey
                            const isFirst = paxKey === firstPaxKey

                            return (
                              <div key={paxKey} className="relative">
                                <div className="mb-1 flex items-center justify-between">
                                  <label className="text-[11px] font-medium text-slate-700">
                                    Pax {pIdx + 1} Full Name *
                                    {isFirst && !entry.touched && holderName.trim() && (
                                      <span className="ml-1 text-[10px] text-sky-600">
                                        (Auto-filled)
                                      </span>
                                    )}
                                  </label>
                                  {entry.memberId && (
                                    <div className="flex items-center gap-1">
                                      <span
                                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                                          entry.subsStatus === 'active'
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : entry.subsStatus === 'arrears'
                                              ? 'bg-amber-100 text-amber-800'
                                              : 'bg-rose-100 text-rose-800'
                                        }`}
                                      >
                                        {entry.memberCode} · {entry.subsStatus}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => clearPaxMemberLink(paxKey)}
                                        className="text-slate-400 hover:text-rose-600"
                                        title="Unlink member"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                  )}
                                </div>

                                <div className="relative">
                                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
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
                                    onChange={(e) => updatePaxName(paxKey, e.target.value)}
                                    placeholder={`Search member or type Pax ${pIdx + 1} name...`}
                                    className={`w-full rounded-lg border bg-white py-1.5 pl-8 pr-3 text-xs focus:border-sky-500 focus:outline-none ${
                                      !entry.name.trim()
                                        ? 'border-amber-300'
                                        : 'border-slate-300'
                                    }`}
                                  />
                                  {isFocused && searchingPax && (
                                    <span className="absolute right-2.5 top-2 text-[10px] text-slate-400">
                                      …
                                    </span>
                                  )}
                                </div>

                                {isFocused &&
                                  !entry.memberId &&
                                  paxMemberResults.length > 0 && (
                                    <div className="absolute z-30 mt-1 max-h-44 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                                      {paxMemberResults.map((m) => (
                                        <button
                                          key={m.id}
                                          type="button"
                                          onMouseDown={(e) => {
                                            e.preventDefault()
                                            selectPaxMember(paxKey, m)
                                          }}
                                          className="flex w-full items-center justify-between border-b border-slate-100 px-2.5 py-1.5 text-left text-[11px] hover:bg-sky-50"
                                        >
                                          <div>
                                            <div className="font-semibold text-slate-900">
                                              {m.fullName} ({m.memberCode})
                                            </div>
                                            <div className="text-[10px] text-slate-500">
                                              {m.phone}
                                            </div>
                                          </div>
                                          <span
                                            className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                                              m.subsStatus === 'active'
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
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 2. Smart Table Allocation (Optional at booking time) */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Users className="h-4 w-4 text-sky-600" />
                  2. Smart Table Allocation (Optional — Can Assign Later)
                </h2>
                {totalPax > 0 && (
                  <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800">
                    {tableEval.recommendationText}
                  </span>
                )}
              </div>

              {tableEval.warningText && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  {tableEval.warningText}
                </div>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
                {tables.map((t) => {
                  const isSelected = selectedTables.includes(t.tableLabel)
                  return (
                    <button
                      key={t.tableLabel}
                      type="button"
                      disabled={t.isReserved}
                      onClick={() => toggleTableSelection(t.tableLabel)}
                      className={`flex flex-col items-start justify-between rounded-lg border p-3 text-left text-xs transition ${
                        t.isReserved
                          ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                          : isSelected
                            ? 'border-sky-600 bg-sky-50 text-slate-900 ring-1 ring-sky-600'
                            : 'border-slate-200 bg-white text-slate-800 hover:border-sky-400'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className="text-sm font-bold">{t.tableLabel}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            t.isReserved
                              ? 'bg-slate-200 text-slate-500'
                              : isSelected
                                ? 'bg-sky-600 text-white'
                                : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {t.maxCapacity} seats
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">{t.tableTypeName}</div>
                      <div className="mt-1.5 text-[10px] font-semibold">
                        {t.isReserved ? (
                          <span className="text-rose-600">
                            Reserved · {t.reservedByBookingCode}
                          </span>
                        ) : isSelected ? (
                          <span className="text-sky-700">✓ Selected (Full Table)</span>
                        ) : (
                          <span className="text-emerald-700">Available — Click to reserve</span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Right Column: Payment & Instant Summary */}
          <div className="space-y-4">
            <div className="sticky top-20 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">Booking Summary &amp; Payment</h2>

              <div className="mt-4 space-y-2 border-b border-slate-100 pb-4 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Total Guests (Pax)</span>
                  <span className="font-bold text-slate-900">{totalPax}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Tables Assigned</span>
                  <span className="font-semibold text-slate-900">
                    {tableEval.totalAllocatedSeats} seats
                  </span>
                </div>
                <div className="flex justify-between pt-2 text-base">
                  <span className="font-bold text-slate-900">Total Amount</span>
                  <span className="font-bold text-emerald-700">
                    ₹{totalAmount.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
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
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                  >
                    <option value="CASH">Cash (Collected by Me)</option>
                    <option value="OFFICER_UPI">Officer UPI</option>
                    <option value="PAY_AT_DOOR">Pay at Door</option>
                    <option value="COMPLIMENTARY">Complimentary (₹0)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Notes (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Vegetarian preference, wheelchair access..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-sky-500 focus:outline-none"
                  />
                </div>

                {totalPax > 0 && missingPaxCount > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
                    {missingPaxCount} guest name{missingPaxCount === 1 ? '' : 's'} required before confirming.
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!canCreate || submitting || totalPax === 0 || missingPaxCount > 0}
                  className="w-full rounded-lg bg-sky-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-sky-700 disabled:opacity-50"
                >
                  {submitting
                    ? 'Creating Master QR Booking…'
                    : `Confirm Booking · ₹${totalAmount.toLocaleString('en-IN')}`}
                </button>
              </div>
            </div>
          </div>
        </form>
      ) : (
        /* MANAGE BOOKINGS, PHYSICAL STUBS, TABLE EDITS, CANCEL/TRANSFER */
        <div className="space-y-4">
          {manageMessage && (
            <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900">
              <span>{manageMessage}</span>
              <button type="button" onClick={() => setManageMessage(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={manageSearch}
              onChange={(e) => setManageSearch(e.target.value)}
              placeholder="Find booking by B042, B042-T01, name, or phone..."
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm"
            />
          </div>

          <div className="space-y-3">
            {filteredRecent.map((b) => (
              <div
                key={b.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-slate-900">
                        {b.bookingCode}
                      </span>
                      <span className="text-sm font-semibold text-slate-700">
                        {b.holderName}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                          b.status === 'confirmed'
                            ? 'bg-emerald-100 text-emerald-800'
                            : b.status === 'transferred'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {b.status}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {b.phone} · {b.totalPax} Pax · ₹{b.totalAmount.toLocaleString('en-IN')} (
                      {b.paymentMode}) · Tables: <strong>{b.tablesSummary}</strong>
                    </div>
                  </div>

                  {canCreate && b.status !== 'cancelled' && (
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTablesFor(b)
                          setEditSelectedTables(b.assignedTableLabels || [])
                        }}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Assign / Edit Tables
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTransferBooking(b)}
                        className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
                      >
                        Transfer
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCancelBooking(b.id)}
                        className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {/* Physical Ticket Stubs */}
                {b.tickets.length > 0 && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Ticket Stubs
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {b.tickets.map((t) => (
                        <div
                          key={t.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-900">{t.ticketCode}</span>
                              {t.ticketTypeName && (
                                <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                                  {t.ticketTypeName} · {t.paxCount}p
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 truncate text-[11px] font-medium text-slate-600">
                              {t.paxNames && t.paxNames.length > 0
                                ? t.paxNames.join(', ')
                                : b.holderName}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={!canCreate}
                            onClick={() => handleTogglePhysical(b.id, t.id, t.physicalIssued)}
                            className={`inline-flex shrink-0 items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold ${
                              t.physicalIssued
                                ? 'bg-emerald-600 text-white'
                                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <Printer className="h-3 w-3" />
                            {t.physicalIssued ? 'Issued' : 'Mark Issued'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* POST-BOOKING RECEIPT & MASTER QR MODAL */}
      {receipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
                <span className="text-sm font-bold">Booking Confirmed!</span>
              </div>
              <button type="button" onClick={() => setReceipt(null)}>
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>

            <div className="mt-4 text-center">
              <div className="text-2xl font-extrabold text-slate-900">
                {receipt.bookingCode}
              </div>
              <div className="text-sm font-medium text-slate-700">
                {receipt.holderName} · {receipt.totalPax} Pax · ₹
                {receipt.totalAmount.toLocaleString('en-IN')}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Tables: {receipt.tablesSummary}
              </div>

              <div className="my-4 flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/qr/${encodeURIComponent(receipt.bookingCode)}`}
                  alt="Master QR"
                  className="h-52 w-52 rounded-xl border border-slate-200 p-2"
                />
              </div>

              <div className="space-y-1 rounded-lg bg-slate-50 p-2.5 text-left text-xs text-slate-700">
                <div>
                  <strong>Ticket Codes:</strong>{' '}
                  {receipt.tickets.map((t) => t.ticketCode).join(', ')}
                </div>
                {receipt.tickets.map((t) => (
                  <div key={t.id} className="text-[11px] text-slate-600">
                    <strong>{t.ticketCode}:</strong>{' '}
                    {t.paxNames && t.paxNames.length > 0
                      ? t.paxNames.join(', ')
                      : `${t.paxCount} pax`}
                  </div>
                ))}
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
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-100"
              >
                <Send className="h-3.5 w-3.5" />
                Resend WhatsApp / Email
              </button>
              <button
                type="button"
                onClick={() => setReceipt(null)}
                className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Done / Next Booking
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT TABLES MODAL */}
      {editingTablesFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Assign Tables · {editingTablesFor.bookingCode} ({editingTablesFor.totalPax} Pax)
              </h3>
              <button type="button" onClick={() => setEditingTablesFor(null)}>
                <X className="h-4 w-4 text-slate-400" />
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
                    className={`flex flex-col items-start justify-between rounded-lg border p-2.5 text-left text-xs transition ${
                      reservedByOther
                        ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                        : isSelected
                          ? 'border-sky-600 bg-sky-50 text-slate-900 ring-1 ring-sky-600'
                          : 'border-slate-200 bg-white text-slate-800 hover:border-sky-400'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="font-bold">{t.tableLabel}</span>
                      <span className="text-[10px] font-semibold">{t.maxCapacity}p</span>
                    </div>
                    <div className="text-[10px] text-slate-500">{t.tableTypeName}</div>
                    <div className="mt-1 text-[10px] font-semibold">
                      {reservedByOther ? (
                        <span className="text-rose-600">
                          Reserved ({t.reservedByBookingCode})
                        </span>
                      ) : isSelected ? (
                        <span className="text-sky-700">✓ Selected</span>
                      ) : (
                        <span className="text-emerald-700">Available</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            <label className="mt-4 flex items-center gap-2 text-xs font-medium text-slate-700">
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
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveTableUpdate}
                className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700"
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
