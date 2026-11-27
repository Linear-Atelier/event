import React from 'react'
import { Loader2 } from 'lucide-react'

export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading page"
      className="flex h-[calc(100vh-5rem)] w-full flex-col items-center justify-center px-4"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-neutral-950 text-white shadow-xs">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
        <div className="text-center">
          <p className="text-xs font-bold tracking-tight text-neutral-900">Loading…</p>
          <p className="mt-0.5 text-[11px] text-neutral-400">Fetching latest event data</p>
        </div>
      </div>
    </div>
  )
}
