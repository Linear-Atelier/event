import { headers } from 'next/headers'
import { getPayload } from 'payload'
import config from '@payload-config'
import type { User } from '@/payload-types'
import { hasAnyRole, type UserRole } from '@/access/roles'

export async function getServerUser(): Promise<User | null> {
  const payload = await getPayload({ config })
  const hdrs = await headers()
  const { user } = await payload.auth({ headers: hdrs })
  return (user as User | null) ?? null
}

export async function getRequestUser(request: Request): Promise<User | null> {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  return (user as User | null) ?? null
}

export function userHasRole(user: User | null | undefined, roles: UserRole[]): boolean {
  return hasAnyRole(user, roles)
}
