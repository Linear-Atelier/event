import type { CollectionConfig } from 'payload'
import {
  gateStaffUncheckedOnly,
  isAuthenticated,
  isBookingOfficerOrAdmin,
  isSuperAdmin,
} from '../access/roles'
import { formatEventDayLabel, isScanAllowedForEventDate } from '../lib/event-date'

export const TicketCheckinSlots: CollectionConfig = {
  slug: 'ticket-checkin-slots',
  admin: {
    useAsTitle: 'label',
    defaultColumns: ['label', 'attendeeName', 'booking', 'bookingTicket', 'checkedInAt', 'method'],
  },
  access: {
    read: isAuthenticated,
    create: isBookingOfficerOrAdmin,
    update: gateStaffUncheckedOnly,
    delete: isSuperAdmin,
  },
  versions: false,
  hooks: {
    beforeChange: [
      async ({ data, operation, originalDoc, req }) => {
        if (operation !== 'update' || !data?.checkedInAt || originalDoc?.checkedInAt) {
          return data
        }
        const bookingRef = data.booking ?? originalDoc?.booking
        const bookingId =
          typeof bookingRef === 'object' && bookingRef !== null ? bookingRef.id : bookingRef
        if (!bookingId) return data

        const bookingDoc = await req.payload.findByID({
          collection: 'bookings',
          id: bookingId,
          overrideAccess: true,
          depth: 1,
        })
        if (!bookingDoc) return data

        if (bookingDoc.status === 'cancelled' || bookingDoc.status === 'pending_payment') {
          throw new Error(`Cannot check in a ${bookingDoc.status} booking.`)
        }

        const eventObj =
          typeof bookingDoc.event === 'object' && bookingDoc.event !== null
            ? bookingDoc.event
            : await req.payload.findByID({
                collection: 'events',
                id: bookingDoc.event,
                overrideAccess: true,
                depth: 0,
              })

        if (eventObj?.date && !isScanAllowedForEventDate(eventObj.date)) {
          throw new Error(
            `Gate check-in opens on ${formatEventDayLabel(eventObj.date)}.`,
          )
        }
        return data
      },
    ],
  },
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
      ],
    },
  ],
}
