import type { CollectionConfig } from 'payload'
import { isAuthenticated, isSuperAdmin } from '../access/roles'

export const TableTypes: CollectionConfig = {
  slug: 'table-types',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'capacity', 'prefix',],
    description:
      'Reusable non-sharing table types (e.g. 10-Seater VIP, 8-Seater Table, 6-Seater Table) selectable across all events.',
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
        placeholder: 'e.g. 10-Seater VIP, 8-Seater Table, 6-Seater Table',
      },
    },
    {
      name: 'capacity',
      type: 'number',
      required: true,
      defaultValue: 8,
      min: 1,
      admin: {
        description: 'Number of seats on each table of this type.',
      },
    },
    {
      name: 'prefix',
      type: 'text',
      required: true,
      defaultValue: 'T',
      admin: {
        description: 'Default table label prefix when auto-generating table numbers (e.g. T -> T-01, T-02).',
      },
    },
  ],
}
