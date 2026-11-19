import type { CollectionConfig } from 'payload'
import { fieldNeverReadable, isAuthenticated, isSuperAdmin } from '../access/roles'
import { generateEventKeyPair } from '../lib/crypto'

export const Events: CollectionConfig = {
  slug: 'events',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['code', 'name', 'date', 'venue'],
  },
  access: {
    read: isAuthenticated,
    create: isSuperAdmin,
    update: isSuperAdmin,
    delete: isSuperAdmin,
  },
  hooks: {
    beforeChange: [
      async ({ data, operation }) => {
        if (operation === 'create' && (!data.publicKey || !data.privateKeyEnc)) {
          const { publicKeyHex, privateKeyEnc } = await generateEventKeyPair()
          data.publicKey = publicKeyHex
          data.privateKeyEnc = privateKeyEnc
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'code',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'date',
      type: 'date',
      required: true,
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      name: 'venue',
      type: 'text',
      required: true,
    },
    {
      name: 'phases',
      type: 'array',
      label: 'Ticket Phases & Pricing',
      admin: {
        description:
          'Define each pricing phase (e.g. Early-Bird, Phase 1, Door Sales) with optional auto-start/end dates, and select reusable Ticket Types from the dropdown.',
      },
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'phaseName',
              type: 'text',
              required: true,
              admin: {
                placeholder: 'e.g. Early-Bird, Phase 1, Door Sales / Walk-In',
              },
            },
            {
              name: 'overrideStatus',
              type: 'select',
              required: true,
              defaultValue: 'auto',
              options: [
                { label: 'Auto (by Start/End Dates)', value: 'auto' },
                { label: 'Force Active', value: 'force_active' },
                { label: 'Force Inactive', value: 'force_inactive' },
              ],
            },
          ],
        },
        {
          type: 'row',
          fields: [
            {
              name: 'startsAt',
              type: 'date',
              admin: {
                date: {
                  pickerAppearance: 'dayAndTime',
                },
                description: 'Optional auto-start date/time',
              },
            },
            {
              name: 'endsAt',
              type: 'date',
              admin: {
                date: {
                  pickerAppearance: 'dayAndTime',
                },
                description: 'Optional auto-end date/time',
              },
            },
          ],
        },
        {
          name: 'tickets',
          type: 'array',
          label: 'Tickets Offered in this Phase',
          required: true,
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'ticketType',
                  type: 'relationship',
                  relationTo: 'ticket-types',
                  required: true,
                },
                {
                  name: 'price',
                  type: 'number',
                  required: true,
                  min: 0,
                },
                {
                  name: 'maxQty',
                  type: 'number',
                  min: 1,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'tables',
      type: 'array',
      label: 'Event Tables (By Table Type & Quantity)',
      admin: {
        description:
          'Select reusable Table Types and specify how many tables of each type exist for this event. Individual non-sharing table numbers (e.g. T-01 to T-30) are generated automatically.',
      },
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'tableType',
              type: 'relationship',
              relationTo: 'table-types',
              required: true,
            },
            {
              name: 'quantity',
              type: 'number',
              required: true,
              defaultValue: 10,
              min: 1,
              admin: {
                description: 'Number of tables of this type',
              },
            },
            {
              name: 'prefixOverride',
              type: 'text',
              admin: {
                placeholder: 'Optional prefix (e.g. VIP, T)',
              },
            },
          ],
        },
      ],
    },
    {
      name: 'publicKey',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'Auto-generated Ed25519 public key (hex) for offline QR verification.',
      },
    },
    {
      name: 'privateKeyEnc',
      type: 'text',
      access: {
        read: fieldNeverReadable,
      },
      admin: {
        hidden: true,
      },
    },
  ],
}
