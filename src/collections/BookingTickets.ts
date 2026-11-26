import type { CollectionConfig } from 'payload'
import {
  isAuthenticated,
  isBookingOfficerOrAdmin,
  isBookingOrGateOrAdmin,
  isSuperAdmin,
} from '../access/roles'

export const BookingTickets: CollectionConfig = {
  slug: 'booking-tickets',
  admin: {
    useAsTitle: 'ticketCode',
    defaultColumns: [
      'ticketCode',
      'booking',
      'ticketTypeName',
      'attendeeNames',
      'paxCount',
      'unitPrice',
      'physicalIssued',
    ],
  },
  access: {
    read: isAuthenticated,
    create: isBookingOrGateOrAdmin,
    update: isBookingOfficerOrAdmin,
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
      name: 'ticketCode',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'ticketTypeName',
      type: 'text',
      required: true,
      defaultValue: 'Ticket',
    },
    {
      name: 'phaseName',
      type: 'text',
      required: true,
      defaultValue: 'Standard',
    },
    {
      name: 'phaseRowId',
      type: 'text',
      index: true,
    },
    {
      name: 'attendeeNames',
      type: 'text',
      admin: {
        description: 'Comma-separated guest name(s) assigned to this ticket.',
      },
    },
    {
      name: 'paxCount',
      type: 'number',
      required: true,
      min: 1,
    },
    {
      name: 'unitPrice',
      type: 'number',
      required: true,
      min: 0,
    },
    {
      name: 'physicalIssued',
      type: 'checkbox',
      defaultValue: false,
      index: true,
    },
    {
      name: 'physicalIssuedBy',
      type: 'relationship',
      relationTo: 'users',
    },
    {
      name: 'physicalIssuedAt',
      type: 'date',
    },
  ],
}
