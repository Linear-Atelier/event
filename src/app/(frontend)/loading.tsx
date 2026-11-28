import React from 'react'
import { Loader2 } from 'lucide-react'

export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading page"
      className="flex h-[calc(100vh-8rem)] w-full flex-col items-center justify-center px-4"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900 text-white">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
        <div className="text-center">
          <p className="text-base font-bold text-neutral-950">Loading…</p>
          <p className="mt-0.5 text-sm text-neutral-600">Fetching latest event data</p>
        </div>
      </div>
    </div>
  )
}
