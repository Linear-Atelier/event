export type EventColorKey =
  | 'sky'
  | 'emerald'
  | 'red'
  | 'amber'
  | 'indigo'
  | 'violet'
  | 'teal'
  | 'slate'

export interface EventColorTheme {
  key: EventColorKey
  label: string
  hex: string
  cardBg: string
  cardBorder: string
  badgeBg: string
  badgeText: string
  accentText: string
  iconText: string
  dotBg: string
  glassGlow: string
  glassAccentText: string
}

export const EVENT_COLOR_THEMES: Record<EventColorKey, EventColorTheme> = {
  sky: {
    key: 'sky',
    label: 'Ocean Sky',
    hex: '#0284c7',
    cardBg: 'bg-sky-50/60',
    cardBorder: 'border-sky-200/80',
    badgeBg: 'bg-sky-100',
    badgeText: 'text-sky-800',
    accentText: 'text-sky-700',
    iconText: 'text-sky-600',
    dotBg: 'bg-sky-500',
    glassGlow: 'bg-sky-500/20',
    glassAccentText: 'text-sky-300',
  },
  emerald: {
    key: 'emerald',
    label: 'Emerald Green',
    hex: '#059669',
    cardBg: 'bg-emerald-50/60',
    cardBorder: 'border-emerald-200/80',
    badgeBg: 'bg-emerald-100',
    badgeText: 'text-emerald-800',
    accentText: 'text-emerald-700',
    iconText: 'text-emerald-600',
    dotBg: 'bg-emerald-500',
    glassGlow: 'bg-emerald-500/20',
    glassAccentText: 'text-emerald-300',
  },
  red: {
    key: 'red',
    label: 'Crimson Red',
    hex: '#e11d1dff',
    cardBg: 'bg-red-50/60',
    cardBorder: 'border-red-200/80',
    badgeBg: 'bg-red-100',
    badgeText: 'text-red-800',
    accentText: 'text-red-700',
    iconText: 'text-red-600',
    dotBg: 'bg-red-500',
    glassGlow: 'bg-red-500/20',
    glassAccentText: 'text-red-300',
  },
  amber: {
    key: 'amber',
    label: 'Royal Gold',
    hex: '#d97706',
    cardBg: 'bg-amber-50/60',
    cardBorder: 'border-amber-200/80',
    badgeBg: 'bg-amber-100',
    badgeText: 'text-amber-900',
    accentText: 'text-amber-800',
    iconText: 'text-amber-600',
    dotBg: 'bg-amber-500',
    glassGlow: 'bg-amber-500/20',
    glassAccentText: 'text-amber-300',
  },
  indigo: {
    key: 'indigo',
    label: 'Midnight Indigo',
    hex: '#4f46e5',
    cardBg: 'bg-indigo-50/60',
    cardBorder: 'border-indigo-200/80',
    badgeBg: 'bg-indigo-100',
    badgeText: 'text-indigo-800',
    accentText: 'text-indigo-700',
    iconText: 'text-indigo-600',
    dotBg: 'bg-indigo-500',
    glassGlow: 'bg-indigo-500/20',
    glassAccentText: 'text-indigo-300',
  },
  violet: {
    key: 'violet',
    label: 'Amethyst Violet',
    hex: '#7c3aed',
    cardBg: 'bg-violet-50/60',
    cardBorder: 'border-violet-200/80',
    badgeBg: 'bg-violet-100',
    badgeText: 'text-violet-800',
    accentText: 'text-violet-700',
    iconText: 'text-violet-600',
    dotBg: 'bg-violet-500',
    glassGlow: 'bg-violet-500/20',
    glassAccentText: 'text-violet-300',
  },
  teal: {
    key: 'teal',
    label: 'Coastal Teal',
    hex: '#0d9488',
    cardBg: 'bg-teal-50/60',
    cardBorder: 'border-teal-200/80',
    badgeBg: 'bg-teal-100',
    badgeText: 'text-teal-800',
    accentText: 'text-teal-700',
    iconText: 'text-teal-600',
    dotBg: 'bg-teal-500',
    glassGlow: 'bg-teal-500/20',
    glassAccentText: 'text-teal-300',
  },
  slate: {
    key: 'slate',
    label: 'Classic Charcoal',
    hex: '#334155',
    cardBg: 'bg-neutral-50',
    cardBorder: 'border-neutral-200',
    badgeBg: 'bg-slate-200/80',
    badgeText: 'text-slate-800',
    accentText: 'text-slate-900',
    iconText: 'text-slate-600',
    dotBg: 'bg-slate-500',
    glassGlow: 'bg-slate-400/20',
    glassAccentText: 'text-slate-300',
  },
}

export const EVENT_COLOR_OPTIONS = Object.values(EVENT_COLOR_THEMES).map((t) => ({
  label: t.label,
  value: t.key,
}))

export function getEventColorTheme(color?: string | null): EventColorTheme {
  if (color === 'rose') return EVENT_COLOR_THEMES.red
  if (color && color in EVENT_COLOR_THEMES) {
    return EVENT_COLOR_THEMES[color as EventColorKey]
  }
  return EVENT_COLOR_THEMES.sky
}
