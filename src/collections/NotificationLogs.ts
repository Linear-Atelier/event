import type { CollectionConfig } from 'payload'
import { isAuthenticated, isBookingOrGateOrAdmin, isSuperAdmin } from '../access/roles'

export const NotificationLogs: CollectionConfig = {
  slug: 'notification-logs',
  admin: {
    useAsTitle: 'channel',
    defaultColumns: ['booking', 'channel', 'trigger', 'status', 'sentAt'],
  },
  access: {
    read: isAuthenticated,
    create: isBookingOrGateOrAdmin,
    update: isSuperAdmin,
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
      name: 'channel',
      type: 'select',
      required: true,
      options: [
        { label: 'WhatsApp', value: 'whatsapp' },
        { label: 'Email (Plunk)', value: 'email' },
      ],
    },
    {
      name: 'trigger',
      type: 'select',
      required: true,
      options: [
        { label: 'Booking Created', value: 'booking_created' },
        { label: 'Table Updated', value: 'table_updated' },
        { label: 'Manual Resend', value: 'manual_resend' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      options: [
        { label: 'Sent', value: 'sent' },
        { label: 'Failed', value: 'failed' },
        { label: 'Queued', value: 'queued' },
        { label: 'Skipped (No Config)', value: 'skipped' },
      ],
    },
    {
      name: 'providerMessageId',
      type: 'text',
    },
    {
      name: 'errorMessage',
      type: 'text',
    },
    {
      name: 'sentAt',
      type: 'date',
    },
  ],
}
