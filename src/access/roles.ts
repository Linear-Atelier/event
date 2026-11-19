import type { Access, FieldAccess } from 'payload'

export type UserRole =
  | 'super_admin'
  | 'treasurer'
  | 'booking_officer'
  | 'gate_staff'
  | 'committee_member'

export const USER_ROLE_OPTIONS: { label: string; value: UserRole }[] = [
  { label: 'Super Admin', value: 'super_admin' },
  { label: 'Treasurer', value: 'treasurer' },
  { label: 'Booking Officer', value: 'booking_officer' },
  { label: 'Gate Staff', value: 'gate_staff' },
  { label: 'Committee Member', value: 'committee_member' },
]

export interface RoleUser {
  id: number | string
  email?: string | null
  name?: string | null
  roles?: UserRole[] | null
}

export function getUserRoles(user: unknown): UserRole[] {
  if (!user || typeof user !== 'object') return []
  const roles = (user as RoleUser).roles
  return Array.isArray(roles) ? roles : []
}

export function hasAnyRole(user: unknown, allowed: UserRole[]): boolean {
  const roles = getUserRoles(user)
  return allowed.some((r) => roles.includes(r))
}

export function isSuperAdminUser(user: unknown): boolean {
  return hasAnyRole(user, ['super_admin'])
}

export const isAuthenticated: Access = ({ req }) => Boolean(req.user)

export const isSuperAdmin: Access = ({ req }) => isSuperAdminUser(req.user)

export const isSuperAdminAdminAccess = ({ req }: { req: { user?: unknown } }): boolean =>
  isSuperAdminUser(req.user)

export const isBookingOfficerOrAdmin: Access = ({ req }) =>
  hasAnyRole(req.user, ['booking_officer', 'super_admin'])

export const isBookingOrGateOrAdmin: Access = ({ req }) =>
  hasAnyRole(req.user, ['booking_officer', 'gate_staff', 'super_admin'])

export const isBookingOrTreasurerOrAdmin: Access = ({ req }) =>
  hasAnyRole(req.user, ['booking_officer', 'treasurer', 'super_admin'])

export const isTreasurerOrAdmin: Access = ({ req }) =>
  hasAnyRole(req.user, ['treasurer', 'super_admin'])

export const isGateOrAdmin: Access = ({ req }) =>
  hasAnyRole(req.user, ['gate_staff', 'super_admin'])

/**
 * Gate staff can only check in slots that are NOT already checked in.
 * Once checkedInAt is set, the slot locks permanently for gate staff.
 */
export const gateStaffUncheckedOnly: Access = ({ req }) => {
  if (!req.user) return false
  if (isSuperAdminUser(req.user)) return true
  if (hasAnyRole(req.user, ['gate_staff'])) {
    return {
      checkedInAt: {
        exists: false,
      },
    }
  }
  return false
}

// Field-level access helpers (always return boolean)
export const fieldNeverReadable: FieldAccess = () => false

export const fieldBookingOfficerOrAdminUpdate: FieldAccess = ({ req }) =>
  hasAnyRole(req.user, ['booking_officer', 'super_admin'])

export const fieldTreasurerOrAdminUpdate: FieldAccess = ({ req }) =>
  hasAnyRole(req.user, ['treasurer', 'super_admin'])

export const fieldSuperAdminOnly: FieldAccess = ({ req }) => isSuperAdminUser(req.user)
