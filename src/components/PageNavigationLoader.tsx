'use client'

import React, { useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

export function PageNavigationLoader() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentUrl = `${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ''}`

  const [navState, setNavState] = useState<{ active: boolean; fromUrl: string }>({
    active: false,
    fromUrl: currentUrl,
  })

  // Listen for clicks on internal navigation links so the top loader responds instantaneously
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return
      }
      const target = e.target as HTMLElement | null
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return

      const href = anchor.getAttribute('href') || ''
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        return
      }

      try {
        const dest = new URL(anchor.href, window.location.origin)
        if (dest.origin !== window.location.origin) return
        if (dest.pathname.startsWith('/api/')) return
        const destUrl = `${dest.pathname}${dest.search}`
        if (destUrl === currentUrl) return
        setNavState({ active: true, fromUrl: currentUrl })
      } catch {
        // Ignore invalid URLs
      }
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [currentUrl])

  // Safety timeout in case a navigation is aborted
  useEffect(() => {
    if (!navState.active || navState.fromUrl !== currentUrl) return
    const timer = setTimeout(() => {
      setNavState({ active: false, fromUrl: currentUrl })
    }, 10_000)
    return () => clearTimeout(timer)
  }, [navState, currentUrl])

  const isNavigating = navState.active && navState.fromUrl === currentUrl

  if (!isNavigating) return null

  return (
    <div
      aria-hidden="true"
      className="no-print pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden bg-neutral-200/70"
    >
      <div className="h-full w-2/5 animate-[pageLoaderSlide_1.1s_ease-in-out_infinite] rounded-r-full bg-neutral-950" />
    </div>
  )
}
