// Phones have two spellings.
// The SCREEN reads the US number the way people say it; links, inputs, search keys, payloads and stored cells keep…

const EXT_RE = /\s*(?:x|ext\.?|extension|#)\s*(\d{1,6})\s*$/i

/** The ten national digits of a US number, or ''. A leading '+' must be +1. */
function usTen(body: string): string {
  if (!/^\+?[\d\s().-]+$/.test(body)) return ''
  const d = body.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) return d.slice(1)
  if (d.length === 10 && !body.startsWith('+')) return d
  return ''
}

/** "(xxx) xxx-xxxx" for a US number, an extension kept as " x123"; anything else unchanged. */
export function formatPhoneDisplay(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) return s
  const ext = EXT_RE.exec(s)
  const ten = usTen(ext ? s.slice(0, ext.index).trim() : s)
  if (!ten) return s
  const out = `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
  return ext ? `${out} x${ext[1]}` : out
}

// A cell of several entries split by commas or semicolons: each US number formatted, the rest — separators too — as…
export function formatPhoneList(raw: unknown): string {
  return String(raw ?? '').trim().split(/(\s*[,;]\s*)/).map((part, i) => (i % 2 ? part : formatPhoneDisplay(part))).join('')
}

/** The machine spelling: E.164 for a US number, anything else unchanged. */
export function formatPhoneE164(raw: string): string {
  const s = String(raw ?? '').trim()
  if (!s) return s
  const digits = s.replace(/\D/g, '')
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  return s
}
