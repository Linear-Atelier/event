import type { CollectionConfig } from 'payload'
import { isAuthenticated, isSuperAdmin } from '../access/roles'

export const TicketTypes: CollectionConfig = {
  slug: 'ticket-types',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'paxMultiplier', 'memberOnly'],
    description: 'Reusable ticket categories (e.g. Couple, Stag, Lady, Kid) selectable across all events.',
  },
  access: {
    read: isAuthenticated,
    create: isSuperAdmin,
    update: isSuperAdmin,
    delete: isSuperAdmin,
  },
  versions: false,
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        placeholder: 'e.g. Couple, Stag, Lady, Kid',
      },
    },
    {
      name: 'paxMultiplier',
      type: 'number',
      required: true,
      defaultValue: 1,
      min: 1,
      admin: {
        description: 'Number of guests admitted per ticket (e.g. 2 for Couple, 1 for Stag/Lady/Kid).',
      },
    },
    {
      name: 'memberOnly',
      type: 'checkbox',
      defaultValue: false,
    },
  ],
}
