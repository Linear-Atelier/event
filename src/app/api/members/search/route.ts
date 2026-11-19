import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getRequestUser } from '@/lib/auth'

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') || '').trim()

    const payload = await getPayload({ config })
    const res = await payload.find({
      collection: 'members',
      user,
      overrideAccess: false,
      where: q
        ? {
            or: [
              { fullName: { contains: q } },
              { phone: { contains: q } },
              { memberCode: { contains: q } },
            ],
          }
        : undefined,
      limit: 20,
      sort: 'fullName',
    })

    return NextResponse.json({ members: res.docs })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Member search failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
