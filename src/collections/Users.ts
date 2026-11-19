import type { CollectionConfig } from 'payload'
import {
  fieldSuperAdminOnly,
  isAuthenticated,
  isSuperAdmin,
  isSuperAdminAdminAccess,
  USER_ROLE_OPTIONS,
} from '../access/roles'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'email', 'phone', 'roles'],
  },
  auth: true,
  access: {
    admin: isSuperAdminAdminAccess,
    read: isAuthenticated,
    create: isSuperAdmin,
    update: isSuperAdmin,
    delete: isSuperAdmin,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'phone',
      type: 'text',
      index: true,
    },
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      required: true,
      defaultValue: ['committee_member'],
      saveToJWT: true,
      options: USER_ROLE_OPTIONS,
      access: {
        create: fieldSuperAdminOnly,
        update: fieldSuperAdminOnly,
      },
    },
  ],
  versions: false,
}
