import type { CollectionConfig } from 'payload'
import { isAuthenticated, isBookingOfficerOrAdmin, isSuperAdmin } from '../access/roles'

export const Members: CollectionConfig = {
  slug: 'members',
  admin: {
    useAsTitle: 'fullName',
    defaultColumns: ['memberCode', 'fullName', 'phone', 'subsStatus', 'subsPaidUntil'],
  },
  access: {
    read: isAuthenticated,
    create: isBookingOfficerOrAdmin,
    update: isBookingOfficerOrAdmin,
    delete: isSuperAdmin,
  },
  versions: false,
  fields: [
    {
      name: 'memberCode',
      type: 'text',
      // required: true,
      unique: true,
      index: true,
    },
    {
      type: 'row',
      fields: [
        {
          name: 'fullName',
          type: 'text',
          required: true,
          index: true,
          admin: {
            width: '80%',
          }
        },
        {
          name: 'youth',
          type: 'checkbox',
          defaultValue: false,
          admin: {
            width: '20%',
            style: {
              alignSelf: 'flex-end',
            },
          }
        }
      ]
    },
    {
      name: 'phone',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'email',
      type: 'email',
    },
    {
      name: 'subsStatus',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Arrears', value: 'arrears' },
        { label: 'Inactive', value: 'inactive' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'subsPaidUntil',
      type: 'date',
      admin: {
        position: 'sidebar',
      },
    },
  ],
}
