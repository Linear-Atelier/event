import QRCode from 'qrcode'
import sharp from 'sharp'

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function wrapLines(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const w of words) {
    if (!current) {
      current = w
    } else if ((current + ' ' + w).length <= maxChars) {
      current += ' ' + w
    } else {
      lines.push(current)
      current = w
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, 2)
}

function isFinderModule(r: number, c: number, size: number): boolean {
  const inTopLeft = r < 7 && c < 7
  const inTopRight = r < 7 && c >= size - 7
  const inBottomLeft = r >= size - 7 && c < 7
  return inTopLeft || inTopRight || inBottomLeft
}

const QR_ALPHANUMERIC_RE = /^[0-9A-Z $%*+\-./:]+$/

function buildWhiteDotQrSvgElements(
  qrContent: string,
  offsetX: number,
  offsetY: number,
  qrPixelSize: number,
): string {
  const input = QR_ALPHANUMERIC_RE.test(qrContent)
    ? [{ data: qrContent, mode: 'alphanumeric' as const }]
    : qrContent
  const qr = QRCode.create(input, { errorCorrectionLevel: 'M' })
  const count = qr.modules.size
  const cell = qrPixelSize / count
  const dotRadius = cell * 0.38

  const parts: string[] = []

  // 3 circular concentric finder eyes (top-left, top-right, bottom-left)
  const finders = [
    { cx: offsetX + 3.5 * cell, cy: offsetY + 3.5 * cell },
    { cx: offsetX + (count - 3.5) * cell, cy: offsetY + 3.5 * cell },
    { cx: offsetX + 3.5 * cell, cy: offsetY + (count - 3.5) * cell },
  ]

  for (const f of finders) {
    parts.push(
      `<circle cx="${f.cx.toFixed(2)}" cy="${f.cy.toFixed(2)}" r="${(3.0 * cell).toFixed(2)}" fill="none" stroke="#ffffff" stroke-width="${cell.toFixed(2)}" />`,
    )
    parts.push(
      `<circle cx="${f.cx.toFixed(2)}" cy="${f.cy.toFixed(2)}" r="${(1.5 * cell).toFixed(2)}" fill="#ffffff" />`,
    )
  }

  // Circular white dots for all data modules
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (isFinderModule(r, c, count)) continue
      if (qr.modules.get(r, c)) {
        const cx = offsetX + (c + 0.5) * cell
        const cy = offsetY + (r + 0.5) * cell
        parts.push(
          `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${dotRadius.toFixed(2)}" fill="#ffffff" />`,
        )
      }
    }
  }

  return parts.join('')
}

function buildTransparentQrSvg(qrContent: string, size = 520, pad = 28): string {
  const qrElements = buildWhiteDotQrSvgElements(qrContent, pad, pad, size - pad * 2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${qrElements}</svg>`
}

function buildSquareBlackRoundQrSvg(qrContent: string, size = 600, pad = 34): string {
  const qrElements = buildWhiteDotQrSvgElements(qrContent, pad, pad, size - pad * 2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect x="0" y="0" width="${size}" height="${size}" fill="#000000" />${qrElements}</svg>`
}

export interface PassTicketLine {
  ticketCode: string
  ticketTypeName?: string
  paxNames?: string
  paxCount?: number
}

function truncateText(text: string, maxLen: number): string {
  const clean = text.trim()
  if (clean.length <= maxLen) return clean
  return `${clean.slice(0, maxLen - 1)}…`
}

function buildGlassPassCardSvg(params: {
  qrContent: string
  eventName: string
  bookingCode: string
  holderName?: string
  totalPax?: number
  totalAmount?: number
  tablesSummary?: string
  tickets?: PassTicketLine[]
}): string {
  const width = 720
  const cardPadX = 48
  const titleLines = wrapLines(params.eventName, 24)

  const headerTopY = 66
  const titleStartY = 136
  const subtitleY = titleStartY + (titleLines.length - 1) * 48 + 38
  const ticketLineY = subtitleY + 34

  const qrSize = 400
  const qrX = (width - qrSize) / 2
  const qrY = ticketLineY + 42

  const ticketItems = (params.tickets || []).slice(0, 6)
  const extraCount = Math.max(0, (params.tickets || []).length - ticketItems.length)
  const hasInsetCard =
    Boolean(params.tablesSummary) ||
    params.totalAmount !== undefined ||
    ticketItems.length > 0

  const insetX = cardPadX
  const insetW = width - cardPadX * 2
  const insetY = qrY + qrSize + 44
  const rowHeight = 64
  const rowGap = 10
  const ticketsSectionH =
    ticketItems.length > 0
      ? 34 +
        ticketItems.length * rowHeight +
        Math.max(0, ticketItems.length - 1) * rowGap +
        (extraCount > 0 ? 26 : 0)
      : 0
  const insetH = hasInsetCard ? 104 + ticketsSectionH + (ticketItems.length > 0 ? 18 : 0) : 0

  const footerY = hasInsetCard ? insetY + insetH + 44 : qrY + qrSize + 56
  const height = footerY + 38

  const titleSvg = titleLines
    .map(
      (line, idx) =>
        `<text x="${width / 2}" y="${titleStartY + idx * 48}" text-anchor="middle" fill="#ffffff" font-family="Nunito Sans, Segoe UI, Arial, sans-serif" font-size="40" font-weight="800" letter-spacing="-0.5">${escapeXml(line)}</text>`,
    )
    .join('')

  const holderSummary = params.holderName
    ? `Ticket: ${params.bookingCode} · ${truncateText(params.holderName, 26)}${params.totalPax ? ` (${params.totalPax} Pax)` : ''}`
    : `Ticket: ${params.bookingCode}`

  const qrElements = buildWhiteDotQrSvgElements(params.qrContent, qrX, qrY, qrSize)

  let insetCardSvg = ''
  if (hasInsetCard) {
    const tablesText = truncateText(params.tablesSummary || 'Unassigned', 28)
    const amountText =
      params.totalAmount !== undefined
        ? `₹${Number(params.totalAmount).toLocaleString('en-IN')}`
        : ''

    const ticketRowsStartY = insetY + 114
    const ticketRowsSvg = ticketItems
      .map((t, idx) => {
        const ry = ticketRowsStartY + 26 + idx * (rowHeight + rowGap)
        const titleLine = t.ticketTypeName
          ? `${t.ticketCode} · ${t.ticketTypeName}`
          : t.ticketCode
        const guestLine = truncateText(
          t.paxNames && t.paxNames.trim().length > 0
            ? t.paxNames
            : t.paxCount
              ? `${t.paxCount} pax`
              : params.holderName || '',
          54,
        )
        return `
          <rect x="${insetX + 20}" y="${ry}" width="${insetW - 40}" height="${rowHeight}" rx="14" fill="#f5f5f5" />
          <text x="${insetX + 36}" y="${ry + 26}" fill="#171717" font-family="Consolas, Menlo, monospace" font-size="18" font-weight="700">${escapeXml(truncateText(titleLine, 44))}</text>
          <text x="${insetX + 36}" y="${ry + 49}" fill="#525252" font-family="Nunito Sans, Segoe UI, Arial, sans-serif" font-size="16" font-weight="500">${escapeXml(guestLine)}</text>
        `
      })
      .join('')

    const extraSvg =
      extraCount > 0
        ? `<text x="${width / 2}" y="${ticketRowsStartY + 26 + ticketItems.length * (rowHeight + rowGap) + 12}" text-anchor="middle" fill="#737373" font-family="Nunito Sans, Segoe UI, Arial, sans-serif" font-size="15" font-weight="600">+${extraCount} more ticket${extraCount === 1 ? '' : 's'}</text>`
        : ''

    insetCardSvg = `
      <rect x="${insetX}" y="${insetY}" width="${insetW}" height="${insetH}" rx="28" fill="#ffffff" />
      <text x="${insetX + 26}" y="${insetY + 34}" fill="#a3a3a3" font-family="Nunito Sans, Segoe UI, Arial, sans-serif" font-size="15" font-weight="600">Tables</text>
      <text x="${insetX + 26}" y="${insetY + 62}" fill="#171717" font-family="Nunito Sans, Segoe UI, Arial, sans-serif" font-size="22" font-weight="800">${escapeXml(tablesText)}</text>
      ${
        amountText
          ? `
        <text x="${insetX + insetW - 26}" y="${insetY + 34}" text-anchor="end" fill="#a3a3a3" font-family="Nunito Sans, Segoe UI, Arial, sans-serif" font-size="15" font-weight="600">Total</text>
        <text x="${insetX + insetW - 26}" y="${insetY + 64}" text-anchor="end" fill="#047857" font-family="Nunito Sans, Segoe UI, Arial, sans-serif" font-size="24" font-weight="800">${escapeXml(amountText)}</text>
      `
          : ''
      }
      ${
        ticketItems.length > 0
          ? `
        <line x1="${insetX + 24}" y1="${insetY + 84}" x2="${insetX + insetW - 24}" y2="${insetY + 84}" stroke="#e5e5e5" stroke-width="2" stroke-dasharray="6,6" />
        <text x="${insetX + 24}" y="${ticketRowsStartY + 10}" fill="#a3a3a3" font-family="Nunito Sans, Segoe UI, Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="1">TICKET IDS</text>
        ${ticketRowsSvg}
        ${extraSvg}
      `
          : ''
      }
    `
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#1c1c1e" />
        <stop offset="50%" stop-color="#141416" />
        <stop offset="100%" stop-color="#0d0d0f" />
      </linearGradient>
    </defs>

    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#bg)" />

    <text x="${cardPadX}" y="${headerTopY}" fill="#6ee7b7" font-family="Nunito Sans, Segoe UI, Arial, sans-serif" font-size="16" font-weight="800" letter-spacing="1.6">MASTER QR PASS</text>
    <text x="${width - cardPadX}" y="${headerTopY}" text-anchor="end" fill="rgba(255,255,255,0.55)" font-family="Nunito Sans, Segoe UI, Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="1.2">AIAIA COCHIN</text>

    ${titleSvg}
    <text x="${width / 2}" y="${subtitleY}" text-anchor="middle" fill="rgba(255,255,255,0.72)" font-family="Nunito Sans, Segoe UI, Arial, sans-serif" font-size="20" font-weight="400">Show this QR code at the event entrance</text>
    <text x="${width / 2}" y="${ticketLineY}" text-anchor="middle" fill="rgba(255,255,255,0.92)" font-family="Nunito Sans, Segoe UI, Arial, sans-serif" font-size="20" font-weight="700">${escapeXml(holderSummary)}</text>

    ${qrElements}
    ${insetCardSvg}

    <text x="${width / 2}" y="${footerY}" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-family="Nunito Sans, Segoe UI, Arial, sans-serif" font-size="15" font-weight="600">Linear Atelier · Ticketing Partner</text>
  </svg>`
}

export async function generateStyledQrPng(params: {
  qrContent: string
  eventName: string
  bookingCode: string
  style?: 'card' | 'qr' | 'square'
  holderName?: string
  totalPax?: number
  totalAmount?: number
  tablesSummary?: string
  tickets?: PassTicketLine[]
}): Promise<Buffer> {
  const svg =
    params.style === 'qr'
      ? buildTransparentQrSvg(params.qrContent)
      : params.style === 'square'
        ? buildSquareBlackRoundQrSvg(params.qrContent)
        : buildGlassPassCardSvg({
            qrContent: params.qrContent,
            eventName: params.eventName,
            bookingCode: params.bookingCode,
            holderName: params.holderName,
            totalPax: params.totalPax,
            totalAmount: params.totalAmount,
            tablesSummary: params.tablesSummary,
            tickets: params.tickets,
          })

  return sharp(Buffer.from(svg)).png().toBuffer()
}
