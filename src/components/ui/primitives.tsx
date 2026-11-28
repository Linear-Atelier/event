'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, X } from 'lucide-react'

/* -------------------------------------------------------------------------- */
/*  Layout & Containers                                                       */
/* -------------------------------------------------------------------------- */

export function PageContainer({
  children,
  size = 'narrow',
  className = '',
}: {
  children: React.ReactNode
  size?: 'narrow' | 'wide'
  className?: string
}) {
  const widthClass = size === 'wide' ? 'max-w-2xl lg:max-w-5xl' : 'max-w-2xl'
  return (
    <main className={`mx-auto w-full px-4 py-5 sm:px-6 ${widthClass} ${className}`}>
      {children}
    </main>
  )
}

export function PageHeader({
  title,
  subtitle,
  badge,
  backHref,
  backLabel = 'Back',
  actions,
}: {
  title: string
  subtitle?: React.ReactNode
  badge?: React.ReactNode
  backHref?: string
  backLabel?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {backHref && (
          <Link
            href={backHref}
            className="mb-2 inline-flex mb-4 items-center gap-1.5 rounded-xl px-2 -ml-2 text-sm font-bold text-neutral-700 transition hover:bg-neutral-200/70 hover:text-neutral-950"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-extrabold tracking-tight text-neutral-950 sm:text-2xl">
            {title}
          </h1>
          {badge}
        </div>
        {subtitle && (
          <div className="mt-1 text-sm text-neutral-600">{subtitle}</div>
        )}
      </div>
      {actions && (
        <div className="no-print flex flex-wrap items-center gap-2.5">{actions}</div>
      )}
    </div>
  )
}

export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5 ${className}`}
    >
      {children}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Stat Grid                                                                 */
/* -------------------------------------------------------------------------- */

export interface StatItem {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'default' | 'emerald' | 'amber' | 'rose'
  progressPct?: number
}

const STAT_VALUE_TONE: Record<NonNullable<StatItem['tone']>, string> = {
  default: 'text-neutral-950',
  emerald: 'text-emerald-700',
  amber: 'text-amber-700',
  rose: 'text-rose-700',
}

export function StatGrid({
  items,
  className = '',
}: {
  items: StatItem[]
  className?: string
}) {
  return (
    <div
      className={`grid grid-cols-2 overflow-hidden rounded-2xl border border-neutral-200 bg-white lg:grid-cols-4 ${className}`}
    >
      {items.map((item, idx) => (
        <div
          key={idx}
          className={`px-3.5 py-2.5 sm:px-4 sm:py-3 ${idx % 2 === 1 ? 'border-l border-neutral-200' : ''
            } ${idx >= 2 ? 'border-t border-neutral-200 lg:border-l lg:border-t-0' : ''}`}
        >
          <div className="text-xs font-bold uppercase tracking-wide text-neutral-600">
            {item.label}
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
            <span
              className={`text-lg font-extrabold tracking-tight sm:text-xl ${STAT_VALUE_TONE[item.tone || 'default']
                }`}
            >
              {item.value}
            </span>
            {item.sub && (
              <span className="truncate text-xs font-medium text-neutral-600">
                {item.sub}
              </span>
            )}
          </div>
          {typeof item.progressPct === 'number' && (
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full rounded-full bg-emerald-600 transition-all"
                style={{ width: `${Math.min(100, Math.max(0, item.progressPct))}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Buttons                                                                   */
/* -------------------------------------------------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'ghost'
export type ButtonSize = 'md' | 'lg' | 'sm'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-neutral-900 text-white hover:bg-neutral-800 active:bg-neutral-950 border border-neutral-900',
  secondary:
    'bg-white text-neutral-900 hover:bg-neutral-100 active:bg-neutral-200/70 border border-neutral-300',
  success:
    'bg-emerald-700 text-white hover:bg-emerald-800 active:bg-emerald-900 border border-emerald-700',
  danger:
    'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 border border-rose-600',
  ghost:
    'bg-transparent text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 border border-transparent',
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3.5 text-sm',
  md: 'min-h-12 px-4 text-base sm:text-sm',
  lg: 'min-h-14 px-5 text-base',
}

export function buttonClasses({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  className?: string
} = {}) {
  return `inline-flex items-center justify-center gap-2 rounded-xl font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${fullWidth ? 'w-full' : ''} ${className}`
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  fullWidth?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
      {children}
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/*  Form Inputs (Always 16px / text-base to prevent iOS Safari auto-zoom)     */
/* -------------------------------------------------------------------------- */

export function FieldLabel({
  children,
  htmlFor,
  tone = 'light',
  className = '',
}: {
  children: React.ReactNode
  htmlFor?: string
  tone?: 'light' | 'dark'
  className?: string
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={`mb-1.5 block text-sm font-bold ${tone === 'dark' ? 'text-neutral-200' : 'text-neutral-800'
        } ${className}`}
    >
      {children}
    </label>
  )
}

export const inputBaseClasses =
  'w-full min-h-12 rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-base text-neutral-950 placeholder:text-neutral-400 transition focus:border-neutral-950 focus:outline-none focus:ring-2 focus:ring-neutral-950/15 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500'

export function TextInput({
  className = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputBaseClasses} ${className}`} {...props} />
}

export function SelectInput({
  className = '',
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${inputBaseClasses} font-semibold ${className}`} {...props}>
      {children}
    </select>
  )
}

export function TextArea({
  className = '',
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-base text-neutral-950 placeholder:text-neutral-400 transition focus:border-neutral-950 focus:outline-none focus:ring-2 focus:ring-neutral-950/15 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 ${className}`}
      {...props}
    />
  )
}

/* -------------------------------------------------------------------------- */
/*  Segmented Tabs (2-col mobile grid prevents hidden horizontal scroll)      */
/* -------------------------------------------------------------------------- */

export interface SegmentedTabItem<T extends string> {
  key: T
  label: string
  icon?: React.ComponentType<{ className?: string }>
  tone?: 'default' | 'amber' | 'rose'
}

export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  compact = false,
  className = '',
}: {
  items: readonly SegmentedTabItem<T>[]
  value: T
  onChange: (next: T) => void
  compact?: boolean
  className?: string
}) {
  const containerLayout = compact
    ? 'flex items-center gap-1 rounded-2xl border border-neutral-200 bg-neutral-100 p-1'
    : `grid gap-1.5 rounded-2xl border border-neutral-200 bg-neutral-100 p-1.5 ${items.length === 2 ? 'grid-cols-2' : 'grid-cols-3 sm:flex'
    }`

  return (
    <div role="tablist" className={`${containerLayout} ${className}`}>
      {items.map((item) => {
        const Icon = item.icon
        const active = value === item.key
        const iconOnly = compact && !active && Boolean(Icon)
        let activeCls = 'bg-neutral-900 text-white shadow-xs'
        let inactiveCls = 'bg-transparent text-neutral-700 hover:bg-white/70 hover:text-neutral-950'

        if (item.tone === 'amber') {
          activeCls = 'bg-amber-600 text-white shadow-xs'
          inactiveCls = 'bg-amber-50/80 text-amber-900 hover:bg-amber-100'
        } else if (item.tone === 'rose') {
          activeCls = 'bg-rose-600 text-white shadow-xs'
          inactiveCls = 'bg-transparent text-rose-700 hover:bg-rose-50'
        }

        return (
          <button
            key={item.key}
            role="tab"
            type="button"
            aria-selected={active}
            aria-label={item.label}
            title={iconOnly ? item.label : undefined}
            onClick={() => onChange(item.key)}
            className={`group relative inline-flex items-center justify-center gap-2 rounded-xl text-sm font-bold transition ${compact
              ? iconOnly
                ? 'min-h-11 min-w-11 shrink-0 px-6'
                : 'min-h-11 flex-1 px-3.5'
              : 'min-h-12 flex-1 px-3'
              } ${active ? activeCls : inactiveCls}`}
          >
            {Icon && <Icon className="h-4 w-4 shrink-0" />}
            {!iconOnly && <span className="truncate">{item.label}</span>}
            {iconOnly && (
              <span
                role="tooltip"
                className="pointer-events-none absolute -top-9 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-lg bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                {item.label}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Status Badges & Empty State                                               */
/* -------------------------------------------------------------------------- */

export type BadgeTone = 'neutral' | 'emerald' | 'amber' | 'rose' | 'sky' | 'dark'

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-100 text-neutral-800 border border-neutral-200',
  emerald: 'bg-emerald-100 text-emerald-900 border border-emerald-200',
  amber: 'bg-amber-100 text-amber-900 border border-amber-200',
  rose: 'bg-rose-100 text-rose-900 border border-rose-200',
  sky: 'bg-sky-100 text-sky-900 border border-sky-200',
  dark: 'bg-neutral-900 text-white border border-neutral-900',
}

export function StatusBadge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: React.ReactNode
  tone?: BadgeTone
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold leading-none white-space-nowrap ${BADGE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-5 py-12 text-center">
      {Icon && <Icon className="mx-auto h-10 w-10 text-neutral-400" />}
      <p className="mt-3 text-base font-bold text-neutral-900">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-sm text-sm text-neutral-600">{description}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Modal Shell (Bottom sheet on mobile, centered dialog on desktop)          */
/* -------------------------------------------------------------------------- */

export function ModalShell({
  title,
  subtitle,
  badge,
  tone = 'light',
  onClose,
  disableClose = false,
  maxWidthClass = 'max-w-lg',
  footer,
  children,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  badge?: React.ReactNode
  tone?: 'light' | 'dark'
  onClose: () => void
  disableClose?: boolean
  maxWidthClass?: string
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  const isDark = tone === 'dark'

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !disableClose) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, disableClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-neutral-950/75 p-0 sm:items-center sm:p-4"
    >
      <div
        className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border shadow-2xl sm:rounded-3xl ${isDark
          ? 'border-neutral-800 bg-neutral-950 text-white'
          : 'border-neutral-200 bg-white text-neutral-950'
          } ${maxWidthClass}`}
      >
        {/* Sticky Header */}
        <div
          className={`flex shrink-0 items-start justify-between gap-3 border-b px-5 py-4 ${isDark ? 'border-neutral-800' : 'border-neutral-200'
            }`}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {badge}
              <h2
                className={`text-lg font-extrabold tracking-tight ${isDark ? 'text-white' : 'text-neutral-950'
                  }`}
              >
                {title}
              </h2>
            </div>
            {subtitle && (
              <div
                className={`mt-1 text-sm ${isDark ? 'text-neutral-300' : 'text-neutral-600'
                  }`}
              >
                {subtitle}
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={disableClose}
            onClick={onClose}
            aria-label="Close dialog"
            className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-bold transition disabled:opacity-45 ${isDark
              ? 'border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800'
              : 'border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100'
              }`}
          >
            <X className="h-4 w-4" />
            <span>Close</span>
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {/* Sticky Footer */}
        {footer && (
          <div
            className={`shrink-0 border-t px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] ${isDark
              ? 'border-neutral-800 bg-neutral-900/90'
              : 'border-neutral-200 bg-neutral-50'
              }`}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
