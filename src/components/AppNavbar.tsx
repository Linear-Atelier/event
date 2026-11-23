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
  const hideTopHeader = pathname === '/scan' || pathname.startsWith('/scan/')

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

  return (
    <>
      {/* Minimal White Top App Header (hidden on /scan for full-bleed scanner) */}
      {!hideTopHeader && (
        <header className="no-print sticky top-0 z-30 border-b border-slate-100 bg-white/85 backdrop-blur-md">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-950 text-xs font-extrabold tracking-tight text-white shadow-sm">
                AI
              </div>
              <div className="leading-tight">
                <div className="text-sm font-bold tracking-tight text-slate-900">
                  AIAIA Cochin
                </div>
                <div className="text-[10px] font-medium text-slate-400">
                  Linear Atelier · Ticketing Partner
                </div>
              </div>
            </Link>

            <div className="flex items-center gap-2">
              {/* {isSuperAdmin && (
              <Link
                href="/admin"
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-200"
                title="Payload Admin"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-slate-600" />
                <span className="hidden sm:inline">Admin</span>
              </Link>
            )} */}

              <div className="text-right sm:block">
                <div className="text-xs font-semibold text-slate-800">
                  {user.name?.split(' ')[0] || user.email?.[0]}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-slate-400">
                  {(roles[0] || 'committee').replace('_', ' ')}
                </div>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-rose-50 hover:text-rose-600"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Fixed Dark App Bottom Navigation Bar */}
      <nav
        aria-label="Primary Navigation"
        className="no-print fixed inset-x-0 bottom-0 z-40 bg-slate-950/95 backdrop-blur-xl"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5 px-2 py-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
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
                className={`flex flex-col items-center justify-center gap-1 rounded-2xl py-1.5 text-[10px] font-semibold transition ${active
                    ? 'text-white'
                    : 'text-slate-400 hover:text-slate-200'
                  }`}
              >
                <span
                  className={`flex h-8 w-12 items-center justify-center rounded-full transition ${active ? 'bg-white text-slate-950 shadow-sm' : 'bg-transparent'
                    }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span>{item.label}</span>
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
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
      <LayoutDashboard className="h-3 w-3 text-slate-400" />
      {role.replace('_', ' ')}
    </span>
  )
}
