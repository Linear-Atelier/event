export interface FinancialYearInfo {
  code: string
  label: string
  startYear: number
  endYear: number
  startIso: string
  endIso: string
}

function buildFinancialYearInfo(startYear: number): FinancialYearInfo {
  const endYear = startYear + 1
  const code = `FY${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`
  return {
    code,
    label: `${code} (Apr ${startYear} – Mar ${endYear})`,
    startYear,
    endYear,
    startIso: `${startYear}-04-01T00:00:00+05:30`,
    endIso: `${endYear}-03-31T23:59:59.999+05:30`,
  }
}

/**
 * Returns the Indian Financial Year (Apr 1 – Mar 31, IST) for a given date.
 * Example: 2026-12-26 -> FY26-27; 2027-04-01 -> FY27-28.
 */
export function getFinancialYearForDate(
  dateInput: Date | string = new Date(),
): FinancialYearInfo {
  const parsed = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(safeDate)

  const year = Number(parts.find((p) => p.type === 'year')?.value || safeDate.getFullYear())
  const month = Number(parts.find((p) => p.type === 'month')?.value || safeDate.getMonth() + 1)
  const startYear = month >= 4 ? year : year - 1

  return buildFinancialYearInfo(startYear)
}

/**
 * Parses a financial year code such as "FY26-27" or "2026-27" into its IST bounds.
 */
export function parseFinancialYearCode(code?: string | null): FinancialYearInfo | null {
  if (!code) return null
  const clean = code.trim().toUpperCase()

  const shortMatch = clean.match(/^FY(\d{2})-(\d{2})$/)
  if (shortMatch) {
    const startYear = 2000 + Number(shortMatch[1])
    const expectedEndTwo = (startYear + 1) % 100
    if (Number(shortMatch[2]) !== expectedEndTwo) return null
    return buildFinancialYearInfo(startYear)
  }

  const fullMatch = clean.match(/^(?:FY)?(\d{4})-(\d{2,4})$/)
  if (fullMatch) {
    const startYear = Number(fullMatch[1])
    const endRaw = Number(fullMatch[2])
    const endYear = endRaw < 100 ? Math.floor(startYear / 100) * 100 + endRaw : endRaw
    if (endYear !== startYear + 1) return null
    return buildFinancialYearInfo(startYear)
  }

  return null
}

export function compareFinancialYearCodesDesc(a: string, b: string): number {
  const fyA = parseFinancialYearCode(a)
  const fyB = parseFinancialYearCode(b)
  if (fyA && fyB) return fyB.startYear - fyA.startYear
  return b.localeCompare(a)
}
