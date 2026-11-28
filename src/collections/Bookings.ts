import type { CollectionConfig } from 'payload'
import {
  fieldBookingOfficerOrAdminUpdate,
  fieldTreasurerOrAdminUpdate,
  isAuthenticated,
  isBookingOfficerOrAdmin,
  isBookingOrTreasurerOrAdmin,
  isSuperAdmin,
} from '../access/roles'

export const Bookings: CollectionConfig = {
  slug: 'bookings',
  admin: {
    useAsTitle: 'bookingCode',
    defaultColumns: [
      'bookingCode',
      'holderName',
      'phone',
      'totalPax',
      'totalAmount',
      'paymentMode',
      'status',
      'treasurerVerified',
    ],
  },
  access: {
    read: isAuthenticated,
    create: isBookingOfficerOrAdmin,
    update: isBookingOrTreasurerOrAdmin,
    // Never hard-delete bookings; use status: 'cancelled' with audit history
    delete: isSuperAdmin,
  },
  versions: false,
  fields: [
    {
      name: 'bookingCode',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'event',
      type: 'relationship',
      relationTo: 'events',
      required: true,
      index: true,
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'member',
      type: 'relationship',
      relationTo: 'members',
      index: true,
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'holderName',
      type: 'text',
      required: true,
      index: true,
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'phone',
      type: 'text',
      required: true,
      index: true,
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'email',
      type: 'email',
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'totalPax',
      type: 'number',
      required: true,
      defaultValue: 0,
      min: 0,
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'totalAmount',
      type: 'number',
      required: true,
      defaultValue: 0,
      min: 0,
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'paidAmount',
      type: 'number',
      min: 0,
      admin: {
        description: 'Actual amount collected prior to any cancellation/refund.',
      },
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'refundAmount',
      type: 'number',
      defaultValue: 0,
      min: 0,
      admin: {
        position: 'sidebar',
      },
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'refundMethod',
      type: 'select',
      defaultValue: 'NONE',
      options: [
        { label: 'None', value: 'NONE' },
        { label: 'Razorpay API', value: 'RAZORPAY_API' },
        { label: 'Offline — Cash', value: 'OFFLINE_CASH' },
        { label: 'Offline — UPI / Bank', value: 'OFFLINE_UPI' },
      ],
      admin: {
        position: 'sidebar',
      },
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'refundReference',
      type: 'text',
      admin: {
        position: 'sidebar',
        description: 'Razorpay rfnd_... ID or offline refund note.',
      },
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'refundedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
      },
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'refundedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        position: 'sidebar',
      },
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'pendingUpgradeTables',
      type: 'json',
      admin: {
        hidden: true,
      },
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'confirmed',
      options: [
        { label: 'Confirmed', value: 'confirmed' },
        { label: 'Pay at Door', value: 'pay_at_door' },
        { label: 'Pending Payment', value: 'pending_payment' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
      admin: {
        position: 'sidebar',
      },
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'notes',
      type: 'textarea',
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'qrSignature',
      type: 'text',
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'paymentMode',
      type: 'select',
      required: false,
      options: [
        { label: 'Razorpay', value: 'RAZORPAY' },
        { label: 'Cash', value: 'CASH' },
        { label: 'Officer UPI', value: 'OFFICER_UPI' },
        { label: 'Complimentary', value: 'COMPLIMENTARY' },
      ],
      validate: (value: unknown, { siblingData }: { siblingData?: Record<string, unknown> }) => {
        if (siblingData?.paymentStatus === 'paid' && !value) {
          return 'Payment mode is required when payment status is Paid.'
        }
        return true
      },
      admin: {
        position: 'sidebar',
        description: 'Empty while booking is Pay at Door; populated once payment is collected.',
      },
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'paymentStatus',
      type: 'select',
      required: true,
      defaultValue: 'paid',
      options: [
        { label: 'Paid', value: 'paid' },
        { label: 'Pending', value: 'pending' },
        { label: 'Refunded', value: 'refunded' },
      ],
      admin: {
        position: 'sidebar',
      },
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'collectedByOfficer',
      type: 'relationship',
      relationTo: 'users',
      index: true,
      admin: {
        position: 'sidebar',
      },
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    // Officer -> Treasurer 2-step fund handover tracking
    {
      name: 'settlementStatus',
      type: 'select',
      required: true,
      defaultValue: 'with_officer',
      index: true,
      options: [
        { label: 'With Officer', value: 'with_officer' },
        { label: 'Transferred to Treasurer', value: 'transferred_to_treasurer' },
        { label: 'Received by Treasurer', value: 'received_by_treasurer' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'transferredAt',
      type: 'date',
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'transferredBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'transferReference',
      type: 'text',
      admin: {
        position: 'sidebar',
        description: 'Optional UPI Ref # or cash handover note when transferred to Treasurer.',
      },
    },
    // Treasurer-only receipt confirmation fields
    {
      name: 'treasurerVerified',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: {
        position: 'sidebar',
      },
      access: {
        create: fieldTreasurerOrAdminUpdate,
        update: fieldTreasurerOrAdminUpdate,
      },
    },
    {
      name: 'treasurerVerifiedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
      },
      access: {
        create: fieldTreasurerOrAdminUpdate,
        update: fieldTreasurerOrAdminUpdate,
      },
    },
    {
      name: 'treasurerVerifiedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        position: 'sidebar',
      },
      access: {
        create: fieldTreasurerOrAdminUpdate,
        update: fieldTreasurerOrAdminUpdate,
      },
    },
    // Pre-wired gateway fields for Razorpay / Cashfree
    {
      name: 'gatewayProvider',
      type: 'text',
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'gatewayRefId',
      type: 'text',
      index: true,
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'paymentLinkUrl',
      type: 'text',
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
    {
      name: 'paymentExpiresAt',
      type: 'date',
      index: true,
      access: {
        update: fieldBookingOfficerOrAdminUpdate,
      },
    },
  ],
}
