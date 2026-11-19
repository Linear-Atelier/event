export interface TableAllocationItem {
  tableId: number | string
  tableLabel: string
  maxCapacity: number
  isShared?: boolean
  allocatedSeats: number
}

export interface TableAllocationSummary {
  recommendedTables: number
  referenceTableCapacity: number
  recommendationText: string
  totalAllocatedSeats: number
  isUnderAllocated: boolean
  shortfallSeats: number
  warningText: string | null
}

/**
 * Computes capacity recommendation (Math.ceil(totalPax / tableCap))
 * and validates sum(assignedTableSeats) >= totalPax with explicit warning if under-allocated.
 */
export function evaluateTableAllocation(
  totalPax: number,
  assignedTables: TableAllocationItem[],
  defaultTableCapacity = 8,
): TableAllocationSummary {
  const validPax = Math.max(0, totalPax)
  const referenceTableCapacity =
    assignedTables.length > 0
      ? Math.max(1, assignedTables[0].maxCapacity)
      : Math.max(1, defaultTableCapacity)

  const recommendedTables = validPax > 0 ? Math.ceil(validPax / referenceTableCapacity) : 0
  const recommendationText =
    recommendedTables === 1
      ? `1 table recommended for your booking (${validPax} pax @ ${referenceTableCapacity}/table)`
      : `${recommendedTables} tables recommended for your booking (${validPax} pax @ ${referenceTableCapacity}/table)`

  const totalAllocatedSeats = assignedTables.reduce(
    (sum, t) => sum + Math.max(0, Number(t.allocatedSeats) || 0),
    0,
  )

  const hasTables = assignedTables.length > 0
  const isUnderAllocated = hasTables && totalAllocatedSeats < validPax
  const shortfallSeats = isUnderAllocated ? validPax - totalAllocatedSeats : 0

  const warningText = isUnderAllocated
    ? `Under-allocated seating: ${totalAllocatedSeats} seats assigned for ${validPax} pax (${shortfallSeats} seat${shortfallSeats === 1 ? '' : 's'} short).`
    : null

  return {
    recommendedTables,
    referenceTableCapacity,
    recommendationText,
    totalAllocatedSeats,
    isUnderAllocated,
    shortfallSeats,
    warningText,
  }
}
