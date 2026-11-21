import type { EmailAdapter, SendEmailOptions } from 'payload'

export interface PlunkEmailAdapterArgs {
  apiKey?: string
  apiUrl?: string
  defaultFromAddress: string
  defaultFromName: string
}

export interface PlunkSendResult {
  success: boolean
  id: string
}

function normalizeRecipient(to: SendEmailOptions['to']): string {
  if (!to) return ''
  if (typeof to === 'string') return to
  if (Array.isArray(to)) {
    const first = to[0]
    if (!first) return ''
    return typeof first === 'string' ? first : first.address || ''
  }
  return to.address || ''
}

function normalizeFromAddress(
  from: SendEmailOptions['from'],
  fallback: string,
): string {
  if (!from) return fallback
  if (typeof from === 'string') return from
  return from.address || fallback
}

export function plunkEmailAdapter(
  args: PlunkEmailAdapterArgs,
): EmailAdapter<PlunkSendResult> {
  const { defaultFromAddress, defaultFromName } = args

  return () => ({
    name: 'plunk',
    defaultFromAddress,
    defaultFromName,
    sendEmail: async (message: SendEmailOptions): Promise<PlunkSendResult> => {
      const apiKey = args.apiKey || process.env.PLUNK_API_KEY
      if (!apiKey) {
        throw new Error('PLUNK_API_KEY not configured')
      }

      const to = normalizeRecipient(message.to)
      if (!to) {
        throw new Error('Email recipient (to) is required')
      }

      const body =
        typeof message.html === 'string'
          ? message.html
          : typeof message.text === 'string'
            ? message.text
            : ''

      const from = normalizeFromAddress(message.from, defaultFromAddress)
      const apiUrl = (
        args.apiUrl ||
        process.env.PLUNK_API_URL ||
        'https://next-api.useplunk.com'
      ).replace(/\/$/, '')

      const payloadBody: Record<string, string> = {
        to,
        subject: message.subject || '(No Subject)',
        body,
      }
      if (from) payloadBody.from = from
      if (defaultFromName) payloadBody.name = defaultFromName

      const res = await fetch(`${apiUrl}/v1/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payloadBody),
      })

      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean
        id?: string
        message?: string
        error?: string
      }

      if (!res.ok || json.success === false) {
        throw new Error(json.message || json.error || `Plunk HTTP ${res.status}`)
      }

      return {
        success: true,
        id: json.id || '',
      }
    },
  })
}
