import type { CollectionConfig } from 'payload'
import {
  gateStaffUncheckedOnly,
  isAuthenticated,
  isBookingOrGateOrAdmin,
  isSuperAdmin,
} from '../access/roles'

export const TicketCheckinSlots: CollectionConfig = {
  slug: 'ticket-checkin-slots',
  admin: {
    useAsTitle: 'label',
    defaultColumns: ['label', 'attendeeName', 'booking', 'bookingTicket', 'checkedInAt', 'method'],
  },
  access: {
    read: isAuthenticated,
    create: isBookingOrGateOrAdmin,
    update: gateStaffUncheckedOnly,
    delete: isSuperAdmin,
  },
  versions: false,
  fields: [
    {
      name: 'booking',
      type: 'relationship',
      relationTo: 'bookings',
      required: true,
      index: true,
    },
    {
      name: 'bookingTicket',
      type: 'relationship',
      relationTo: 'booking-tickets',
      required: true,
      index: true,
    },
    {
      name: 'slotIndex',
      type: 'number',
      required: true,
      min: 1,
    },
    {
      name: 'label',
      type: 'text',
      required: true,
    },
    {
      name: 'attendeeName',
      type: 'text',
      index: true,
    },
    {
      name: 'member',
      type: 'relationship',
      relationTo: 'members',
      index: true,
    },
    {
      name: 'checkedInAt',
      type: 'date',
      index: true,
    },
    {
      name: 'checkedInByUser',
      type: 'relationship',
      relationTo: 'users',
    },
    {
      name: 'deviceId',
      type: 'text',
    },
    {
      name: 'method',
      type: 'select',
      defaultValue: 'qr_scan',
      options: [
        { label: 'QR Scan', value: 'qr_scan' },
        { label: 'Manual Code', value: 'manual_code' },
        { label: 'Door Sale', value: 'door_sale' },
      ],
    },
  ],
}
