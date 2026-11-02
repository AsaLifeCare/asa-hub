// THE RECORD EDIT — what every app's edit panel shares (RecordEditBody) and what its door answers (RecordEdit.gs).
// One payload for every door, `{ key, changes: [{ field, value, expected }] }`, answered `{ written: [field]…
import { ohioDayOf } from '@/lib/ohio'

export type EditKind = 'text' | 'textarea' | 'date' | 'phone' | 'email' | 'url' | 'select'

/** Why a field is drawn read-only, and where it is edited instead; a panel that wants the lock alone says neither. */
export type EditLock = { why?: string; door?: string }

export type EditField = {
  key: string
  label: string
  kind: EditKind
  /** the value exactly as the server's witness reads it; it rides back as `expected` */
  raw: string
  options?: readonly string[]
  /** a select's words for an option value (a house code shown by its name) */
  optionLabels?: Readonly<Record<string, string>>
  hint?: string
  /** the longest value the door keeps (500 when unset) */
  max?: number
  /** set: drawn read-only with its reason */
  lockedBy?: EditLock
  /** set: the change files only with this box ticked */
  confirm?: string
}

export type EditChange = { field: string; value: string; expected: string }

export type EditRefusal = { field: string; why: string }

export type EditAnswer = { written: string[]; refused: EditRefusal[] }

const str = (v: unknown): string => (v == null || typeof v === 'object' ? '' : String(v))

/** The `edit` map a read carries: field → raw value; anything else is dropped. */
export function editRawOf(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') out[k] = String(x)
  }
  return out
}

/** A date cell's day: a sheet instant read on Ohio's calendar, 'M/D/YYYY' or 'yyyy-mm-dd'; '' when the cell is words. */
export function editDay(raw: string): string {
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return ohioDayOf(s)
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : ''
}

/** A date field shows a date input while its cell is a day or blank; a cell holding words keeps a text input. */
export const editAsDate = (f: Pick<EditField, 'kind' | 'raw'>): boolean => f.kind === 'date' && (!f.raw.trim() || !!editDay(f.raw))

/** What the input shows for the raw value. */
export function editShown(f: Pick<EditField, 'kind' | 'raw'>): string {
  return editAsDate(f) ? editDay(f.raw) : f.raw
}

/** The fields whose input no longer shows what it was opened on, each with its raw value as the witness. */
export function diffChanges(fields: readonly EditField[], draft: Record<string, string>): EditChange[] {
  const out: EditChange[] = []
  for (const f of fields) {
    if (f.lockedBy || !(f.key in draft)) continue
    const now = draft[f.key].trim()
    if (now !== editShown(f).trim()) out.push({ field: f.key, value: now, expected: f.raw })
  }
  return out
}

/** A door's answer, tolerant: what was written and each refusal with its reason. */
export function editAnswerOf(raw: unknown): EditAnswer {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const written = Array.isArray(o.written) ? o.written.map(str).filter(Boolean) : []
  const refused = (Array.isArray(o.refused) ? o.refused : []).map((r) => {
    const x = r && typeof r === 'object' ? (r as Record<string, unknown>) : {}
    return { field: str(x.field), why: str(x.why) }
  }).filter((r) => r.field)
  return { written, refused }
}
