import type { CollectionConfig } from 'payload'
import { isAuthenticated, isSuperAdmin } from '../access/roles'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: isAuthenticated,
    create: isSuperAdmin,
    update: isSuperAdmin,
    delete: isSuperAdmin,
  },
  versions: false,
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
  ],
  upload: true,
}
