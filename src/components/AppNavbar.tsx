'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Calendar,
  CreditCard,
  LayoutDashboard,
  LogOut,
  QrCode,
  ShieldCheck,
  Ticket,
} from 'lucide-react'
import { isSuperAdmin, type UserRole } from '@/access/roles'

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
  const roles = user.roles || []
  const isSuperAdmin = roles.includes('super_admin')

  const navItems = [
    { href: '/', label: 'Events', icon: Calendar },
    { href: '/desk', label: 'Booking Desk', icon: Ticket },
    { href: '/finance', label: 'Finance', icon: CreditCard },
    { href: '/scan', label: 'Gate Scan', icon: QrCode },
  ]

  async function handleLogout() {
    await fetch('/api/users/logout', { method: 'POST', credentials: 'include' })
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-slate-900 text-white shadow-sm">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500 font-bold text-slate-950 shadow">
              AI
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight text-white">
                AIAIA Cochin Branch
              </div>
              <div className="text-[11px] text-slate-400">
                Ticketing Partner · Linear Atelier
              </div>
            </div>
          </Link>

          <nav className="flex flex-wrap items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const active =
                item.href === '/'
                  ? pathname === '/' || pathname.startsWith('/events')
                  : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <div className="text-xs font-medium text-white">
              {user.name || user.email}
            </div>
            <div className="flex justify-end gap-1">
              {roles.map((r) => (
                <span
                  key={r}
                  className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-300"
                >
                  {r.replace('_', ' ')}
                </span>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-rose-600 hover:text-white"
            title="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </div>
    </header>
  )
}

export function PageFooter() {
  return (
    <footer className="no-print border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
      AIAIA Cochin Branch · Event Ticketing &amp; Gate Management System · 
      <a
        href="https://linearatelier.com"
        target="_blank"
        rel="noreferrer"
        className="font-medium text-slate-700 underline decoration-slate-300 hover:text-sky-600"
      >{}
        Linear Atelier
      </a>{' '}
      (Ticketing Partner)

            {/* {isSuperAdmin && (
              <Link
                href="/admin"
                className="flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-slate-800"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Payload Admin
              </Link>
            )} */}
    </footer>
  )
}

export function RoleBadge({ role }: { role: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
      <LayoutDashboard className="h-3 w-3 text-slate-400" />
      {role.replace('_', ' ')}
    </span>
  )
}
