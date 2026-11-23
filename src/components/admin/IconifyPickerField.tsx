'use client'

import React, { useEffect, useState } from 'react'
import { FieldLabel, useField } from '@payloadcms/ui'
import type { TextFieldClientProps } from 'payload'

const PRESET_ICONS = [
  { id: 'mdi:pine-tree', label: 'Christmas Tree' },
  { id: 'ph:champagne-bold', label: 'Champagne' },
  { id: 'lucide:party-popper', label: 'Party' },
  { id: 'lucide:sparkles', label: 'Sparkles' },
  { id: 'lucide:music', label: 'Music' },
  { id: 'mdi:snowflake', label: 'Snowflake' },
  { id: 'lucide:utensils', label: 'Dining' },
  { id: 'lucide:crown', label: 'Gala' },
  { id: 'lucide:ticket', label: 'Ticket' },
  { id: 'lucide:calendar-heart', label: 'Special Day' },
]

function iconSvgUrl(iconId: string): string {
  const [prefix, name] = iconId.split(':')
  if (!prefix || !name) return ''
  return `https://api.iconify.design/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`
}

export const IconifyPickerField: React.FC<TextFieldClientProps> = ({ field, path }) => {
  const { value, setValue } = useField<string>({ path })
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<string[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return

    let cancelled = false
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(
          `https://api.iconify.design/search?query=${encodeURIComponent(q)}&limit=30`,
        )
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { icons?: string[] }
          setResults(Array.isArray(data.icons) ? data.icons : [])
        }
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 280)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const displayedResults = query.trim().length >= 2 ? results : []

  return (
    <div className="field-type text" style={{ marginBottom: '1.25rem' }}>
      <FieldLabel label={field.label || 'Event Icon (Iconify)'} path={path} />

      {/* Current selection preview */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          padding: '0.5rem 0.75rem',
          borderRadius: '8px',
          border: '1px solid var(--theme-elevation-200)',
          background: 'var(--theme-elevation-50)',
          marginBottom: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
          {value ? (
            <>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '28px',
                  height: '28px',
                  borderRadius: '6px',
                  background: '#ffffff',
                  border: '1px solid var(--theme-elevation-150)',
                  flexShrink: 0,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={iconSvgUrl(value)}
                  alt={value}
                  width={18}
                  height={18}
                />
              </span>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {value}
              </span>
            </>
          ) : (
            <span style={{ fontSize: '12px', opacity: 0.6 }}>No icon selected</span>
          )}
        </div>

        {value && (
          <button
            type="button"
            onClick={() => setValue('')}
            style={{
              fontSize: '11px',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: '6px',
              border: '1px solid var(--theme-elevation-250)',
              background: 'transparent',
              color: 'var(--theme-text)',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Search Iconify API */}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search Iconify (e.g. christmas, champagne, music)…"
        style={{
          width: '100%',
          padding: '0.5rem 0.75rem',
          fontSize: '13px',
          borderRadius: '6px',
          border: '1px solid var(--theme-elevation-200)',
          background: 'var(--theme-input-bg)',
          color: 'var(--theme-text)',
          marginBottom: '0.5rem',
        }}
      />

      {/* Search results or curated presets */}
      {searching && (
        <div style={{ fontSize: '11px', opacity: 0.65, marginBottom: '0.5rem' }}>
          Searching Iconify…
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: '6px',
          maxHeight: '190px',
          overflowY: 'auto',
          padding: '4px',
          borderRadius: '8px',
          border: '1px solid var(--theme-elevation-150)',
          background: 'var(--theme-elevation-50)',
        }}
      >
        {(displayedResults.length > 0
          ? displayedResults.map((id) => ({ id, label: id }))
          : PRESET_ICONS
        ).map((item) => {
          const isSelected = value === item.id
          return (
            <button
              key={item.id}
              type="button"
              title={item.id}
              onClick={() => setValue(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '38px',
                borderRadius: '8px',
                border: isSelected
                  ? '2px solid #0284c7'
                  : '1px solid var(--theme-elevation-150)',
                background: isSelected ? '#e0f2fe' : '#ffffff',
                cursor: 'pointer',
                padding: '4px',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={iconSvgUrl(item.id)}
                alt={item.label}
                width={20}
                height={20}
              />
            </button>
          )
        })}
      </div>

      <div style={{ fontSize: '11px', opacity: 0.6, marginTop: '0.35rem' }}>
        {displayedResults.length > 0
          ? `Showing ${displayedResults.length} Iconify matches`
          : 'Quick presets shown — type 2+ characters to search 200,000+ Iconify icons.'}
      </div>
    </div>
  )
}
