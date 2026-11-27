import React, { Suspense } from 'react'
import type { Metadata, Viewport } from 'next'
import { Nunito_Sans } from 'next/font/google'
import { getServerUser } from '@/lib/auth'
import { AppNavbar } from '@/components/AppNavbar'
import { PageNavigationLoader } from '@/components/PageNavigationLoader'
import './styles.css'

const nunitoSans = Nunito_Sans({
  subsets: ['latin'],
  variable: '--font-nunito-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'AIAIA Cochin Branch — Event Ticketing & Gate Management',
  description:
    'Event Ticketing, Smart Seating, Treasurer Reconciliation & Offline Gate Check-In System. Ticketing Partner: Linear Atelier.',
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props
  const user = await getServerUser()

  return (
    <html lang="en" className={nunitoSans.variable}>
      <body className="min-h-screen bg-neutral-50 font-sans text-neutral-900 antialiased">
        <Suspense fallback={null}>
          <PageNavigationLoader />
        </Suspense>
        {user ? (
          <div className="flex min-h-screen flex-col">
            <AppNavbar user={user} />
            <div className="flex-1 pb-24">{children}</div>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  )
}
