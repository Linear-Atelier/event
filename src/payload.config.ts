import { postgresAdapter } from '@payloadcms/db-postgres'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { sharpTransformer } from '@payloadcms/transformer-sharp'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { Bookings } from './collections/Bookings'
import { BookingTables } from './collections/BookingTables'
import { BookingTickets } from './collections/BookingTickets'
import { Events } from './collections/Events'
import { TableTypes } from './collections/TableTypes'
import { Media } from './collections/Media'
import { Members } from './collections/Members'
import { NotificationLogs } from './collections/NotificationLogs'
import { TicketCheckinSlots } from './collections/TicketCheckinSlots'
import { TicketTypes } from './collections/TicketTypes'
import { Users } from './collections/Users'
import { plunkEmailAdapter } from './lib/plunk-email-adapter'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    meta: {
      titleSuffix: ' — AIAIA Cochin Ticketing',
    },
  },
  collections: [
    Users,
    Members,
    Events,
    TicketTypes,
    TableTypes,
    Bookings,
    BookingTickets,
    BookingTables,
    TicketCheckinSlots,
    NotificationLogs,
    Media,
  ],
  editor: lexicalEditor(),
  email: plunkEmailAdapter({
    apiKey: process.env.PLUNK_API_KEY,
    apiUrl: process.env.PLUNK_API_URL,
    defaultFromAddress: process.env.PLUNK_FROM_EMAIL || 'tickets@linearatelier.com',
    defaultFromName: process.env.PLUNK_FROM_NAME || 'AIAIA Cochin Branch',
  }),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
    beforeSchemaInit: [
      ({ schema }) => ({
        ...schema,
        tables: {},
        relations: {},
        enums: {},
      }),
    ],
  }),
  plugins: [mcpPlugin({})],
  upload: {
    transformers: [sharpTransformer()],
  },
})

// Force in-memory Payload singleton in Next.js dev server to reload Drizzle schema on config change
const globalWithPayload = globalThis as unknown as {
  _payload?: Map<string, { reload?: boolean | Promise<void> }>
}
const cachedPayload = globalWithPayload._payload?.get('default')
if (cachedPayload && cachedPayload.reload !== true && !(cachedPayload.reload instanceof Promise)) {
  cachedPayload.reload = true
}

