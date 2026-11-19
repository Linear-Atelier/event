export interface VirtualEventTable {
  tableLabel: string
  tableTypeId: string
  tableTypeName: string
  capacity: number
}

export interface RawEventTableRow {
  tableType?:
    | number
    | string
    | {
        id: number | string
        name: string
        capacity: number
        prefix?: string | null
      }
    | null
  quantity?: number | null
  prefixOverride?: string | null
}

/**
 * Deterministically expands an Event's table type + quantity rows into
 * individual non-sharing table labels (e.g. T-01 .. T-30).
 */
export function expandEventTables(
  rows: RawEventTableRow[] | null | undefined,
  fallbackTypesById?: Map<number | string, { name: string; capacity: number; prefix?: string | null }>,
): VirtualEventTable[] {
  if (!Array.isArray(rows) || rows.length === 0) return []

  const counterByPrefix = new Map<string, number>()
  const result: VirtualEventTable[] = []

  for (const row of rows) {
    const qty = Math.max(0, Math.floor(Number(row.quantity) || 0))
    if (qty <= 0 || !row.tableType) continue

    let typeId = ''
    let typeName = 'Table'
    let capacity = 8
    let defaultPrefix = 'T'

    if (typeof row.tableType === 'object' && row.tableType !== null) {
      typeId = String(row.tableType.id)
      typeName = row.tableType.name || 'Table'
      capacity = Math.max(1, Number(row.tableType.capacity) || 8)
      defaultPrefix = (row.tableType.prefix || 'T').trim() || 'T'
    } else {
      typeId = String(row.tableType)
      const fb =
        fallbackTypesById?.get(row.tableType) ||
        fallbackTypesById?.get(Number(row.tableType)) ||
        fallbackTypesById?.get(String(row.tableType))
      if (fb) {
        typeName = fb.name
        capacity = Math.max(1, Number(fb.capacity) || 8)
        defaultPrefix = (fb.prefix || 'T').trim() || 'T'
      }
    }

    const prefix = ((row.prefixOverride || '').trim() || defaultPrefix).replace(/-+$/, '')

    for (let i = 0; i < qty; i++) {
      const nextNum = (counterByPrefix.get(prefix) || 0) + 1
      counterByPrefix.set(prefix, nextNum)
      const tableLabel = `${prefix}-${String(nextNum).padStart(2, '0')}`
      result.push({
        tableLabel,
        tableTypeId: typeId,
        tableTypeName: typeName,
        capacity,
      })
    }
  }

  return result
}
