// Person Focus Mode helpers (context-mode wave) — the ONE place to build Focus objects and (de)serialize drag…
// Contract documented in src/stores/useContextStore.ts.
import type { Focus, FocusType } from '@/stores/useContextStore'
import type { Person } from '@/engine/types'
import type { Client } from '@/lib/seed-care'
import type { Director } from '@/lib/seed-directors'
import { findPersonKey, isPersonName } from '@/lib/personNames'

/** HTML5 drag-and-drop MIME carrying a JSON-serialized Focus. */
export const PERSON_DRAG_MIME = 'application/x-asa-person'

/** Sheet-page config shape enabling draggable rows + focus actions (see store docs). */
export type FocusDragConfig = {
  type: FocusType
  idKey: string
  nameKey: string
  avatarKey?: string
  subtitleKey?: string
}

export function focusFromPerson(p: Person): Focus {
  return { type: 'staff', id: p.id, name: p.name, avatar: p.avatar, subtitle: p.role }
}

export function focusFromClient(c: Client): Focus {
  // clients have no photo — Avatar falls back to tinted initials
  return { type: 'client', id: c.id, name: c.name, subtitle: c.houseName }
}

export function focusFromDirector(d: Director): Focus {
  return { type: 'director', id: d.id, name: d.name, avatar: d.photo, subtitle: d.title }
}

// A FORM in the tracker (2026-09-07) — the first non-person focus.
export function focusFromForm(f: { slug: string; title: string; status?: string; field_count?: number; submissions?: number }): Focus {
  const bits = [f.status, f.field_count != null ? `${f.field_count} questions` : '', f.submissions != null ? `${f.submissions} answers` : '']
    .filter(Boolean)
  return { type: 'form', id: f.slug, name: f.title, subtitle: bits.join(' · ') || undefined }
}

/** Build a Focus from an arbitrary sheet row using its focusDrag config. */
export function focusFromRow(row: any, cfg: FocusDragConfig): Focus {
  return {
    type: cfg.type,
    id: String(row[cfg.idKey] ?? row.id ?? ''),
    name: String(row[cfg.nameKey] ?? row[cfg.idKey] ?? ''),
    avatar: cfg.avatarKey ? (row[cfg.avatarKey] as string | undefined) : undefined,
    subtitle: cfg.subtitleKey ? (row[cfg.subtitleKey] as string | undefined) : undefined,
  }
}

/** onDragStart: stash the Focus payload on the native DataTransfer. */
export function writePersonDrag(dt: DataTransfer, focus: Focus) {
  dt.setData(PERSON_DRAG_MIME, JSON.stringify(focus))
  dt.effectAllowed = 'copy'
}

/** onDrop: parse the payload back (null when it isn't a person drag). */
export function readPersonDrag(dt: DataTransfer): Focus | null {
  const raw = dt.getData(PERSON_DRAG_MIME)
  if (!raw) return null
  try {
    const f = JSON.parse(raw) as Focus
    return f && typeof f.id === 'string' && typeof f.name === 'string' ? f : null
  } catch {
    return null
  }
}

/** True while a drag in flight carries a person payload (onDragOver gating). */
export function dragHasPerson(dt: DataTransfer): boolean {
  return Array.from(dt.types ?? []).includes(PERSON_DRAG_MIME)
}

/** "Danny Whitaker" → "D.W." (expansion datasets) and "DW" (care datasets). */
function nameInitialForms(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const dotted = parts.map((w) => w[0]).join('.') + '.'
  const plain = parts.map((w) => w[0]).join('')
  return [dotted.toLowerCase(), plain.toLowerCase()]
}

// HOW SURE IS THIS MATCH?
export function recordFocusTier(value: unknown, focus: Focus): 0 | 1 | 2 | 3 {
  if (value == null) return 0
  if (Array.isArray(value)) {
    let best: 0 | 1 | 2 | 3 = 0
    for (const v of value) {
      const t = recordFocusTier(v, focus)
      if (t === 1) return 1
      if (t !== 0 && (best === 0 || t < best)) best = t
    }
    return best
  }
  const v = String(value).trim().toLowerCase()
  if (!v) return 0
  const name = focus.name.trim().toLowerCase()
  const id = focus.id.trim().toLowerCase()
  if (v === name || v === id) return 1
  // initials forms so datasets keyed by client initials ("J.M.") match a full-name focus ("James Morris"); id…
  if (nameInitialForms(focus.name).includes(v)) return 2
  if (id.length > 2 && v.includes(id)) return 2
  // loose containment both ways ("maya chen" vs "Maya Chen (Float)")
  if (v.includes(name) || (name.length > 3 && name.includes(v))) return 3
  return 0
}

/** Boolean view kept for the callers that want generosity (FocusRelations). */
export function recordMatchesFocus(value: unknown, focus: Focus): boolean {
  return recordFocusTier(value, focus) !== 0
}

/** The best tier a ROW reaches across the given keys (0 = no match). */
export function rowFocusTier(row: any, keys: string[], focus: Focus): 0 | 1 | 2 | 3 {
  let best: 0 | 1 | 2 | 3 = 0
  for (const k of keys) {
    const t = recordFocusTier(row?.[k], focus)
    if (t === 1) return 1
    if (t !== 0 && (best === 0 || t < best)) best = t
  }
  return best
}

// ------------------------------------------------------------------ * Recognising a person without being told…

/** Row keys that hold somebody's name, best first. */
const PERSON_NAME_KEYS = [
  'name', 'full_name', 'fullName', 'person', 'person_name', 'personName',
  'client_name', 'clientName', 'candidate', 'candidate_name', 'candidateName',
  'employee', 'employee_name', 'staff', 'staff_name', 'display_name', 'displayName',
]

/** Row keys that hold a picture of them. */
const PERSON_AVATAR_KEYS = ['avatar', 'photo', 'image', 'picture', 'headshot', 'src']

/** Row keys worth showing under the name on the focus chip. */
const PERSON_SUBTITLE_KEYS = [
  'role', 'title', 'job_title', 'position', 'houseName', 'house', 'stage', 'department', 'team', 'diagnosis',
]

/** Resources whose people are clients, and whose are directors. */
const CLIENT_RESOURCES = /(client|resident|isp|referral|lead|prospect|potential)/i
const DIRECTOR_RESOURCES = /(director|executive|board)/i

// Things that have names but are not people.
const NOT_PEOPLE_RESOURCES =
  /(project|work_item|task|invoice|expense|purchase|inventory|supply|medication|asset|vehicle|fleet|policy|document|doc|video|photo|image|log|event|app|collection|house|repair|shift)/i

const firstKeyPresent = (keys: string[], rows: any[]) =>
  keys.find((k) => rows.some((r) => String(r?.[k] ?? '').trim() !== ''))

// Work out how to drag the people on THIS page onto the focus slot.
export function inferFocusDrag(
  resource: string,
  rows: any[],
  primaryKey?: string,
): FocusDragConfig | undefined {
  if (!rows.length) return undefined
  if (NOT_PEOPLE_RESOURCES.test(resource)) return undefined
  // The column is found by looking at the VALUES, not at the column name: a value the roster recognises is a person…
  const nameKey =
    findPersonKey(rows, primaryKey && PERSON_NAME_KEYS.includes(primaryKey) ? primaryKey : undefined) ??
    (primaryKey && PERSON_NAME_KEYS.includes(primaryKey) ? primaryKey : undefined) ??
    firstKeyPresent(PERSON_NAME_KEYS, rows)
  if (!nameKey) return undefined
  // Final guard for the key-name fallback: a column of single words is a label.
  const looksLikePeople = rows.slice(0, 20).some((r) => isPersonName(r?.[nameKey]))
  if (!looksLikePeople) return undefined

  const type: FocusType = DIRECTOR_RESOURCES.test(resource)
    ? 'director'
    : CLIENT_RESOURCES.test(resource)
      ? 'client'
      : 'staff'

  return {
    type,
    idKey: 'id',
    nameKey,
    avatarKey: firstKeyPresent(PERSON_AVATAR_KEYS, rows),
    subtitleKey: firstKeyPresent(PERSON_SUBTITLE_KEYS, rows),
  }
}

// Which fields on THIS page might point at the focused person.
const FOCUS_LINK_KEYS = [
  ...PERSON_NAME_KEYS,
  'assignedTo', 'assigned_to', 'owner', 'personId', 'person_id', 'clientId', 'client_id',
  'clientIds', 'candidate_id', 'candidateId', 'employee_id', 'staffId', 'staff_id', 'client',
]

export function inferScopeKeys(rows: any[]): string[] {
  if (!rows.length) return []
  return FOCUS_LINK_KEYS.filter((k) => rows.some((r) => String(r?.[k] ?? '').trim() !== ''))
}
