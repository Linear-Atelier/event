import type { CollectionConfig } from 'payload'
import { isAuthenticated, isBookingOfficerOrAdmin, isBookingOrGateOrAdmin } from '../access/roles'

export const BookingTables: CollectionConfig = {
  slug: 'booking-tables',
  admin: {
    useAsTitle: 'tableLabel',
    defaultColumns: ['booking', 'tableLabel', 'tableTypeName', 'capacity', 'price', 'assignedByOfficer', 'assignedAt'],
  },
  access: {
    read: isAuthenticated,
    create: isBookingOrGateOrAdmin,
    update: isBookingOfficerOrAdmin,
    delete: isBookingOfficerOrAdmin,
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
      name: 'tableLabel',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'tableTypeName',
      type: 'text',
      required: true,
      defaultValue: 'Table',
    },
    {
      name: 'capacity',
      type: 'number',
      required: true,
      defaultValue: 8,
      min: 1,
    },
    {
      name: 'price',
      type: 'number',
      defaultValue: 0,
      min: 0,
    },
    {
      name: 'assignedByOfficer',
      type: 'relationship',
      relationTo: 'users',
    },
    {
      name: 'assignedAt',
      type: 'date',
    },
  ],
}
