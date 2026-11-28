'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Calendar,
  Home,
  LayoutDashboard,
  LogOut,
  QrCode,
  ShieldCheck,
  Ticket,
  Wallet,
} from 'lucide-react'
import type { UserRole } from '@/access/roles'
import Image from 'next/image'

interface AppNavbarProps {
  user: {
    id: number | string
    name?: string | null
    email?: string | null
    roles?: UserRole[] | null
  }
}

export function AppNavbar({ user }: AppNavbarProps) {
  const pathname = usePathname()
  const router = useRouter()

  if (pathname === '/login') {
    return null
  }

  const roles = user.roles || []
  const isSuperAdmin = roles.includes('super_admin')
  const isScanRoute = pathname === '/scan' || pathname.startsWith('/scan/')

  const bottomNavItems = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/events', label: 'Events', icon: Calendar },
    { href: '/desk', label: 'Booking', icon: Ticket },
    { href: '/scan', label: 'Gate', icon: QrCode },
    { href: '/finance', label: 'Finance', icon: Wallet },
  ]

  async function handleLogout() {
    await fetch('/api/users/logout', { method: 'POST', credentials: 'include' })
    router.push('/login')
    router.refresh()
  }

  const displayName = user.name?.split(' ')[0] || user.email?.split('@')[0] || 'Member'

  return (
    <>
      {/* Persistent Clean Top Header (hidden on /scan which has its own dark gate header) */}
      {!isScanRoute && (
        <header className="no-print sticky top-0 z-30 border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
            <Link
              href="/"
              className="flex min-h-11 items-center gap-2.5 rounded-xl pr-2 transition hover:opacity-85"
            >
              <Image
                src="/AIAIA Logo.png"
                alt="AIAIA Cochin logo"
                width={36}
                height={36}
                className="shrink-0"
              />
              <div className="leading-tight">
                <div className="text-base font-extrabold tracking-tight text-neutral-950">
                  AIAIA Cochin
                </div>
                <div className="text-xs font-medium text-neutral-600">
                  Linear Atelier · Ticketing
                </div>
              </div>
            </Link>

            <div className="flex items-center gap-2">
              {isSuperAdmin && (
                <Link
                  href="/admin"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-neutral-300 bg-neutral-50 px-3 text-sm font-bold text-neutral-900 transition hover:bg-neutral-100"
                  title="Open Payload Admin"
                >
                  <ShieldCheck className="h-4 w-4 text-neutral-700" />
                  <span className="hidden sm:inline">Admin</span>
                </Link>
              )}

              <div className="hidden text-right sm:block sm:px-1">
                <div className="text-sm font-bold leading-tight text-neutral-950">
                  {displayName}
                </div>
                <div className="text-xs font-semibold capitalize text-neutral-600">
                  {(roles[0] || 'committee').replace(/_/g, ' ')}
                </div>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-neutral-300 bg-white px-3 text-sm font-bold text-neutral-800 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
                title="Sign out"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Fixed Bottom Navigation Bar (High-contrast light on standard pages, dark on /scan) */}
      <nav
        aria-label="Primary Navigation"
        className={`no-print fixed inset-x-0 bottom-0 z-40 border-t ${isScanRoute
            ? 'border-neutral-800 bg-neutral-950'
            : 'border-neutral-200 bg-white'
          }`}
      >
        <div className="mx-auto grid max-w-xl grid-cols-5 px-1.5 py-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {bottomNavItems.map((item) => {
            const Icon = item.icon
            const active =
              item.href === '/'
                ? pathname === '/'
                : pathname === item.href || pathname.startsWith(`${item.href}/`)

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1 text-xs font-bold transition ${isScanRoute
                    ? active
                      ? 'text-white'
                      : 'text-neutral-400 hover:text-neutral-200'
                    : active
                      ? 'text-neutral-950'
                      : 'text-neutral-600 hover:text-neutral-950'
                  }`}
              >
                <span
                  className={`flex h-8 w-12 items-center justify-center rounded-full transition ${active
                      ? isScanRoute
                        ? 'bg-white text-neutral-950'
                        : 'bg-neutral-900 text-white'
                      : 'bg-transparent'
                    }`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className="leading-none">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}

export function RoleBadge({ role }: { role: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-100 px-3 py-1 text-xs font-bold capitalize text-neutral-800">
      <LayoutDashboard className="h-3.5 w-3.5 text-neutral-600" />
      {role.replace(/_/g, ' ')}
    </span>
  )
}
