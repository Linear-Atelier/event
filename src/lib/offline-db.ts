import Dexie, { type Table } from 'dexie'

export interface CachedEvent {
  id: number
  code: string
  name: string
  date: string
  venue: string
  publicKey: string
  downloadedAt: string
}

export interface CachedBooking {
  id: number
  eventId: number
  bookingCode: string
  holderName: string
  phone: string
  email?: string | null
  totalPax: number
  totalAmount: number
  status: string
  paymentMode: string | null
  paymentStatus: string
  tablesSummary: string
  qrSignature: string
}

export interface CachedTicket {
  id: number
  bookingId: number
  ticketCode: string
  phaseName: string
  typeName: string
  paxCount: number
}

export interface CachedSlot {
  id: number
  bookingId: number
  bookingTicketId: number
  slotIndex: number
  label: string
  attendeeName?: string | null
  checkedInAt: string | null
  checkedInByUserName: string | null
  deviceId: string | null
  method: string | null
}

export interface PendingSyncItem {
  id?: number
  slotId: number
  bookingId: number
  checkedInAt: string
  deviceId: string
  method: 'qr_scan' | 'manual_code'
  doorPaymentMode?: 'CASH' | 'OFFICER_UPI' | 'COMPLIMENTARY'
  synced: number // 0 = pending, 1 = synced
}

class GateOfflineDB extends Dexie {
  events!: Table<CachedEvent, number>
  bookings!: Table<CachedBooking, number>
  tickets!: Table<CachedTicket, number>
  slots!: Table<CachedSlot, number>
  pendingSync!: Table<PendingSyncItem, number>

  constructor() {
    super('AiaiaGateScannerDB')
    this.version(1).stores({
      events: 'id, code',
      bookings: 'id, eventId, bookingCode, phone, holderName',
      tickets: 'id, bookingId, ticketCode',
      slots: 'id, bookingId, bookingTicketId, checkedInAt',
      pendingSync: '++id, slotId, bookingId, synced',
    })
  }
}

export const offlineDb = new GateOfflineDB()

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'server'
  const existing = window.localStorage.getItem('aiaia_gate_device_id')
  if (existing) return existing
  const created = `GATE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  window.localStorage.setItem('aiaia_gate_device_id', created)
  return created
}
