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

function buildWhiteDotQrSvgElements(
  qrContent: string,
  offsetX: number,
  offsetY: number,
  qrPixelSize: number,
): string {
  const qr = QRCode.create(qrContent, { errorCorrectionLevel: 'M' })
  const count = qr.modules.size
  const cell = qrPixelSize / count
  const dotRadius = cell * 0.45

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

function buildGlassPassCardSvg(params: {
  qrContent: string
  eventName: string
  bookingCode: string
}): string {
  const width = 640
  const height = 920
  const titleLines = wrapLines(params.eventName, 22)
  const titleStartY = titleLines.length > 1 ? 150 : 178
  const subtitleY = titleStartY + titleLines.length * 52 + 12
  const ticketY = subtitleY + 46
  const qrSize = 440
  const qrX = (width - qrSize) / 2
  const qrY = ticketY + 62

  const titleSvg = titleLines
    .map(
      (line, idx) =>
        `<text x="${width / 2}" y="${titleStartY + idx * 52}" text-anchor="middle" fill="#ffffff" font-family="Nunito Sans, Segoe UI, Arial, sans-serif" font-size="42" font-weight="800" letter-spacing="-0.5">${escapeXml(line)}</text>`,
    )
    .join('')

  const qrElements = buildWhiteDotQrSvgElements(params.qrContent, qrX, qrY, qrSize)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#22262e" />
        <stop offset="50%" stop-color="#1b2029" />
        <stop offset="100%" stop-color="#141820" />
      </linearGradient>
      <radialGradient id="glow1" cx="15%" cy="48%" r="55%">
        <stop offset="0%" stop-color="#9a7b66" stop-opacity="0.22" />
        <stop offset="100%" stop-color="#1b2029" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="glow2" cx="85%" cy="35%" r="50%">
        <stop offset="0%" stop-color="#64748b" stop-opacity="0.20" />
        <stop offset="100%" stop-color="#141820" stop-opacity="0" />
      </radialGradient>
    </defs>

    <rect x="0" y="0" width="${width}" height="${height}" rx="42" fill="url(#bg)" />
    <rect x="0" y="0" width="${width}" height="${height}" rx="42" fill="url(#glow1)" />
    <rect x="0" y="0" width="${width}" height="${height}" rx="42" fill="url(#glow2)" />
    <rect x="1.5" y="1.5" width="${width - 3}" height="${height - 3}" rx="40.5" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="2" />

    ${titleSvg}
    <text x="${width / 2}" y="${subtitleY}" text-anchor="middle" fill="rgba(255,255,255,0.75)" font-family="Nunito Sans, Segoe UI, Arial, sans-serif" font-size="22" font-weight="400">Show this QR code at the event entrance</text>
    <text x="${width / 2}" y="${ticketY}" text-anchor="middle" fill="rgba(255,255,255,0.85)" font-family="Nunito Sans, Segoe UI, Arial, sans-serif" font-size="22" font-weight="600">Ticket: ${escapeXml(params.bookingCode)}</text>

    ${qrElements}
  </svg>`
}

export async function generateStyledQrPng(params: {
  qrContent: string
  eventName: string
  bookingCode: string
  style?: 'card' | 'qr' | 'square'
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
          })

  return sharp(Buffer.from(svg)).png().toBuffer()
}
