import 'dotenv/config'
import { getPayload } from 'payload'
import config from './payload.config'
import { createFullBooking } from './lib/booking-service'

async function seed() {
  const payload = await getPayload({ config })

  console.log('Seeding AIAIA Cochin Branch Ticketing data...')

  // 1. Users for each RBAC role
  const seedUsers = [
    {
      email: 'admin@aiaiacochin.org',
      password: 'Password123!',
      name: 'Super Admin',
      phone: '9847000001',
      roles: ['super_admin'] as const,
    },
    {
      email: 'treasurer@aiaiacochin.org',
      password: 'Password123!',
      name: 'Hon. Treasurer',
      phone: '9847000002',
      roles: ['treasurer', 'committee_member'] as const,
    },
    {
      email: 'desk@aiaiacochin.org',
      password: 'Password123!',
      name: 'Booking Officer Rajesh',
      phone: '9847000003',
      roles: ['booking_officer', 'committee_member'] as const,
    },
    {
      email: 'gate@aiaiacochin.org',
      password: 'Password123!',
      name: 'Gate Staff Anita',
      phone: '9847000004',
      roles: ['gate_staff'] as const,
    },
    {
      email: 'committee@aiaiacochin.org',
      password: 'Password123!',
      name: 'Committee Member',
      phone: '9847000005',
      roles: ['committee_member'] as const,
    },
  ]

  let officerUser = null
  for (const u of seedUsers) {
    const existing = await payload.find({
      collection: 'users',
      overrideAccess: true,
      where: { email: { equals: u.email } },
      limit: 1,
    })
    if (existing.docs.length === 0) {
      const created = await payload.create({
        collection: 'users',
        overrideAccess: true,
        data: {
          email: u.email,
          password: u.password,
          name: u.name,
          phone: u.phone,
          roles: [...u.roles],
        },
      })
      if (u.email === 'desk@aiaiacochin.org') officerUser = created
    } else if (u.email === 'desk@aiaiacochin.org') {
      officerUser = existing.docs[0]
    }
  }

  // 2. Sample Members with subscription statuses
  const seedMembers = [
    {
      memberCode: 'AIA-101',
      fullName: 'Capt. Joseph Mathew',
      phone: '9847111001',
      email: 'joseph.mathew@example.com',
      subsStatus: 'active' as const,
      subsPaidUntil: '2027-03-31T00:00:00.000Z',
    },
    {
      memberCode: 'AIA-102',
      fullName: 'Dr. Meera Nair',
      phone: '9847111002',
      email: 'meera.nair@example.com',
      subsStatus: 'active' as const,
      subsPaidUntil: '2027-03-31T00:00:00.000Z',
    },
    {
      memberCode: 'AIA-103',
      fullName: 'George Fernandez',
      phone: '9847111003',
      email: 'george.f@example.com',
      subsStatus: 'arrears' as const,
      subsPaidUntil: '2025-03-31T00:00:00.000Z',
    },
    {
      memberCode: 'AIA-104',
      fullName: 'Lakshmi Menon',
      phone: '9847111004',
      email: 'lakshmi.m@example.com',
      subsStatus: 'inactive' as const,
    },
  ]

  let firstMemberId: number | null = null
  for (const m of seedMembers) {
    const existing = await payload.find({
      collection: 'members',
      overrideAccess: true,
      where: { memberCode: { equals: m.memberCode } },
      limit: 1,
    })
    if (existing.docs.length === 0) {
      const created = await payload.create({
        collection: 'members',
        overrideAccess: true,
        data: m,
      })
      if (!firstMemberId) firstMemberId = created.id
    } else if (!firstMemberId) {
      firstMemberId = existing.docs[0].id
    }
  }

  // 3. Reusable Ticket Types Catalog (Couple, Stag, Lady, Kid)
  const standardTypes = [
    { name: 'Couple', paxMultiplier: 2, memberOnly: false },
    { name: 'Stag', paxMultiplier: 1, memberOnly: false },
    { name: 'Lady', paxMultiplier: 1, memberOnly: false },
    { name: 'Kid', paxMultiplier: 1, memberOnly: false },
  ]
  const typeIdByName = new Map<string, number>()

  for (const td of standardTypes) {
    const existing = await payload.find({
      collection: 'ticket-types',
      overrideAccess: true,
      where: { name: { equals: td.name } },
      limit: 1,
    })
    if (existing.docs.length === 0) {
      const created = await payload.create({
        collection: 'ticket-types',
        overrideAccess: true,
        data: td,
      })
      typeIdByName.set(td.name, created.id)
    } else {
      typeIdByName.set(td.name, existing.docs[0].id)
    }
  }

  // 4. Reusable Non-Sharing Table Types Catalog (10-Seater VIP, 8-Seater Table, 6-Seater Table)
  const standardTableTypes = [
    { name: '10-Seater VIP', capacity: 10, prefix: 'T' },
    { name: '8-Seater Table', capacity: 8, prefix: 'T' },
    { name: '6-Seater Table', capacity: 6, prefix: 'T' },
  ]
  const tableTypeIdByName = new Map<string, number>()

  for (const tt of standardTableTypes) {
    const existing = await payload.find({
      collection: 'table-types',
      overrideAccess: true,
      where: { name: { equals: tt.name } },
      limit: 1,
    })
    if (existing.docs.length === 0) {
      const created = await payload.create({
        collection: 'table-types',
        overrideAccess: true,
        data: tt,
      })
      tableTypeIdByName.set(tt.name, created.id)
    } else {
      tableTypeIdByName.set(tt.name, existing.docs[0].id)
    }
  }

  const coupleId = typeIdByName.get('Couple')!
  const stagId = typeIdByName.get('Stag')!
  const ladyId = typeIdByName.get('Lady')!
  const kidId = typeIdByName.get('Kid')!

  const table10Id = tableTypeIdByName.get('10-Seater VIP')!
  const table8Id = tableTypeIdByName.get('8-Seater Table')!
  const table6Id = tableTypeIdByName.get('6-Seater Table')!

  const defaultEventPhases = [
    {
      phaseName: 'Early-Bird',
      endsAt: '2026-12-05T23:59:59.000Z',
      overrideStatus: 'auto' as const,
      tickets: [
        { ticketType: coupleId, price: 2400 },
        { ticketType: stagId, price: 1400 },
        { ticketType: ladyId, price: 1200 },
        { ticketType: kidId, price: 600 },
      ],
    },
    {
      phaseName: 'Phase 1',
      startsAt: '2026-12-06T00:00:00.000Z',
      endsAt: '2026-12-19T23:59:59.000Z',
      overrideStatus: 'auto' as const,
      tickets: [
        { ticketType: coupleId, price: 2800 },
        { ticketType: stagId, price: 1600 },
        { ticketType: ladyId, price: 1400 },
        { ticketType: kidId, price: 600 },
      ],
    },
    {
      phaseName: 'Door Sales / Walk-In',
      startsAt: '2026-12-20T00:00:00.000Z',
      overrideStatus: 'auto' as const,
      tickets: [
        { ticketType: coupleId, price: 3200 },
        { ticketType: stagId, price: 1800 },
        { ticketType: ladyId, price: 1600 },
        { ticketType: kidId, price: 800 },
      ],
    },
  ]

  const defaultEventTables = [
    { tableType: table10Id, quantity: 4 },
    { tableType: table8Id, quantity: 10 },
    { tableType: table6Id, quantity: 6 },
  ]

  // 5. Sample Event (or attach default phases/tables to existing events that have empty phases/tables)
  const allEvents = await payload.find({
    collection: 'events',
    overrideAccess: true,
    limit: 50,
  })

  for (const ev of allEvents.docs) {
    const needsPhases = !ev.phases || ev.phases.length === 0
    const needsTables = !ev.tables || ev.tables.length === 0
    if (needsPhases || needsTables) {
      await payload.update({
        collection: 'events',
        id: ev.id,
        overrideAccess: true,
        data: {
          ...(needsPhases ? { phases: defaultEventPhases } : {}),
          ...(needsTables ? { tables: defaultEventTables } : {}),
        },
      })
    }
  }

  let event = allEvents.docs[0]
  if (!event) {
    event = await payload.create({
      collection: 'events',
      overrideAccess: true,
      data: {
        code: 'AIAIA-2026',
        name: 'AIAIA Cochin Annual Gala & Family Night 2026',
        date: '2026-12-20T18:30:00.000Z',
        venue: 'Grand Hyatt Bolgatty, Kochi',
        phases: defaultEventPhases,
        tables: defaultEventTables,
      },
    })
  } else {
    event = await payload.findByID({
      collection: 'events',
      id: event.id,
      overrideAccess: true,
      depth: 1,
    })
  }

  const earlyBirdPhase = (event.phases || [])[0]
  const coupleRowId = earlyBirdPhase?.tickets?.[0]?.id || null
  const kidRowId = earlyBirdPhase?.tickets?.[3]?.id || null

  // 6. Create 1 sample booking if none exist
  const existingBookings = await payload.find({
    collection: 'bookings',
    overrideAccess: true,
    limit: 1,
  })

  if (existingBookings.docs.length === 0 && officerUser && coupleRowId && kidRowId) {
    await createFullBooking({
      payload,
      user: officerUser,
      eventId: event.id,
      memberId: firstMemberId,
      holderName: 'Capt. Joseph Mathew',
      phone: '9847111001',
      email: 'joseph.mathew@example.com',
      paymentMode: 'CASH',
      tickets: [
        {
          ticketPhaseId: coupleRowId,
          quantity: 2,
          paxList: [
            { name: 'Capt. Joseph Mathew', memberId: firstMemberId },
            { name: 'Mrs. Ann Mathew' },
            { name: 'Mr. Thomas Mathew' },
            { name: 'Mrs. Sarah Mathew' },
          ],
        },
        {
          ticketPhaseId: kidRowId,
          quantity: 1,
          paxList: [{ name: 'Master David Mathew' }],
        },
      ],
      tables: ['T-01'],
    })
  }

  console.log('Seed completed! Reusable Ticket Types, Table Types & Event Layout are ready.')
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
