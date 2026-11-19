import React from 'react'
import type { Metadata, Viewport } from 'next'
import './styles.css'

export const metadata: Metadata = {
  title: 'AIAIA Cochin Branch — Event Ticketing & Gate Management',
  description:
    'Event Ticketing, Smart Seating, Treasurer Reconciliation & Offline Gate Check-In System. Ticketing Partner: Linear Atelier.',
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  )
}
