// The directory as the page holds it: the lanes in order, each lane's contacts, and whether this viewer changes them.
// Python keeps it in the Hub's database (app/emergency_contacts.py); without its answer the compiled one is drawn.
import type { EditChange, EditField } from '@/lib/recordEdit'
import { DEFAULT_GROUPS } from '@/pages/features/suggestions/HelpfulContacts'

export type DirContact = { id: string; name: string; note: string; phone: string; order: number }
export type DirGroup = { id: string; label: string; icon: string; chip: string; order: number; contacts: DirContact[] }
export type Directory = { source: 'python' | 'compiled'; groups: DirGroup[]; canEdit: boolean }

/** The compiled directory, exactly as the page drew it before the Hub's database kept one. */
export const COMPILED: Directory = {
  source: 'compiled',
  canEdit: false,
  groups: DEFAULT_GROUPS.map((g, i) => ({
    id: g.id, label: g.label, icon: g.icon, chip: g.chip, order: i + 1,
    contacts: g.contacts.map((c, j) => ({ id: `${g.id}-${j + 1}`, name: c.name, note: c.note ?? '', phone: c.phone, order: j + 1 })),
  })),
}

/** The lane colours (app/emergency_contacts.py CHIPS), each class written whole so the stylesheet keeps it. */
export const CHIP_CHOICES: readonly { chip: string; label: string }[] = [
  { chip: 'bg-tint-pink text-tint-fg-pink', label: 'Pink' },
  { chip: 'bg-tint-blue text-tint-fg-blue', label: 'Blue' },
  { chip: 'bg-tint-amber text-tint-fg-amber', label: 'Amber' },
  { chip: 'bg-tint-mint text-tint-fg-mint', label: 'Mint' },
  { chip: 'bg-tint-lavender text-tint-fg-lavender', label: 'Lavender' },
  { chip: 'bg-tint-peach text-tint-fg-peach', label: 'Peach' },
  { chip: 'bg-tint-violet text-tint-fg-violet', label: 'Violet' },
  { chip: 'bg-tint-slate text-tint-fg-slate', label: 'Slate' },
]
export const DEFAULT_CHIP = 'bg-tint-slate text-tint-fg-slate'

/** The icons a lane picks from (any platform icon name is kept; these are offered). */
export const ICON_CHOICES: readonly string[] = [
  'siren', 'hospital', 'building-2', 'users', 'phone', 'phone-call', 'shield', 'heart-pulse', 'ambulance',
  'stethoscope', 'flame', 'life-buoy', 'house', 'briefcase', 'landmark', 'scale', 'map-pin', 'pill', 'car', 'user',
]
export const DEFAULT_ICON = 'phone'

export const NAME_MAX = 120
export const NOTE_MAX = 120
export const LABEL_MAX = 60
export const PHONE_MAX = 40
export const PHONE_HINT = 'A 10-digit US number (an extension may follow, like x12) or a short code like 911.'

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const str = (v: unknown): string => (v == null || typeof v === 'object' ? '' : String(v))
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** emergencyContactsRead's data (or a save's `directory`): the Python directory, else the compiled one. */
export function directoryFrom(raw: unknown): Directory {
  const o = obj(raw)
  if (o.source !== 'python' || !Array.isArray(o.groups)) return COMPILED
  const groups: DirGroup[] = []
  for (const [i, g] of o.groups.entries()) {
    const x = obj(g)
    const id = str(x.id).trim()
    if (!id || groups.some((y) => y.id === id)) continue
    const contacts: DirContact[] = []
    for (const [j, c] of (Array.isArray(x.contacts) ? x.contacts : []).entries()) {
      const y = obj(c)
      const cid = str(y.id).trim()
      if (!cid || !str(y.phone).trim()) continue
      contacts.push({ id: cid, name: str(y.name), note: str(y.note), phone: str(y.phone), order: num(y.order, j + 1) })
    }
    groups.push({ id, label: str(x.label) || id, icon: str(x.icon) || DEFAULT_ICON, chip: str(x.chip) || DEFAULT_CHIP,
      order: num(x.order, i + 1), contacts })
  }
  return { source: 'python', groups, canEdit: o.can_edit === true }
}

/** A save's answer: the directory it left, or null when it carries none. */
export function directoryOfAnswer(raw: unknown): Directory | null {
  const d = obj(raw).directory
  return d && typeof d === 'object' ? directoryFrom(d) : null
}

/** The directory a refused save carries in its envelope (a stale witness answers 409 with what is kept now). */
export function directoryOfRefusal(err: unknown): Directory | null {
  const env = obj(obj(err).envelope)
  return directoryOfAnswer(env.data)
}

/** '911' and short codes dial too, so this is not the ten-digit phoneHref of myProfileModel. */
export const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

/** The lanes and contacts a search keeps: the label, the name, the phone and a note the lane shows. */
export function filterDirectory(d: Directory, query: string): DirGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return d.groups
  return d.groups.map((group) => ({
    ...group,
    contacts: group.contacts.filter((contact) =>
      [group.label, contact.name, noteShown(d, group) ? contact.note : null, contact.phone]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    ),
  })).filter((group) => group.contacts.length > 0)
}

/** A note shows in the team lane alone, wherever the directory comes from. */
export const noteShown = (_d: Directory, group: Pick<DirGroup, 'id'>): boolean => group.id === 'team'

export const findContact = (d: Directory, id: string): { group: DirGroup; contact: DirContact } | null => {
  for (const group of d.groups) {
    const contact = group.contacts.find((c) => c.id === id)
    if (contact) return { group, contact }
  }
  return null
}

export const findGroup = (d: Directory, id: string): DirGroup | null => d.groups.find((g) => g.id === id) ?? null

const places = (n: number): string[] => Array.from({ length: Math.max(1, n) }, (_, i) => String(i + 1))

const chipLabels = Object.fromEntries(CHIP_CHOICES.map((c) => [c.chip, c.label]))

/** A contact's panel fields, each with the value the save is checked against. */
export function contactFields(d: Directory, group: DirGroup, c: DirContact): EditField[] {
  const longest = Math.max(group.contacts.length, ...d.groups.map((g) => g.contacts.length + (g.id === group.id ? 0 : 1)))
  return [
    { key: 'name', label: 'Name', kind: 'text', raw: c.name, max: NAME_MAX },
    { key: 'phone', label: 'Phone', kind: 'phone', raw: c.phone, max: PHONE_MAX, hint: PHONE_HINT },
    { key: 'note', label: 'Note', kind: 'text', raw: c.note, max: NOTE_MAX, hint: 'Shown under the name, like a role or "Non-Emergency".' },
    { key: 'group', label: 'Lane', kind: 'select', raw: group.id, options: d.groups.map((g) => g.id),
      optionLabels: Object.fromEntries(d.groups.map((g) => [g.id, g.label])) },
    { key: 'order', label: 'Place in the lane', kind: 'select', raw: String(c.order), options: places(longest),
      hint: '1 is the first. Moved to another lane, it goes last there unless a place is chosen.' },
  ]
}

/** A lane's panel fields, each with the value the save is checked against. */
export function groupFields(d: Directory, g: DirGroup): EditField[] {
  return [
    { key: 'label', label: 'Label', kind: 'text', raw: g.label, max: LABEL_MAX },
    { key: 'icon', label: 'Icon', kind: 'select', raw: g.icon, options: ICON_CHOICES },
    { key: 'chip', label: 'Colour', kind: 'select', raw: g.chip, options: CHIP_CHOICES.map((c) => c.chip), optionLabels: chipLabels },
    { key: 'order', label: 'Place among the lanes', kind: 'select', raw: String(g.order), options: places(d.groups.length) },
  ]
}

export const chipLabel = (chip: string): string => chipLabels[chip] ?? 'Slate'

/** One change to the directory, as emergencyContactsSave takes it. */
export type SavePayload =
  | { op: 'contact.add'; contact: { group: string; name: string; phone: string; note: string; order: number } }
  | { op: 'contact.edit'; id: string; changes: EditChange[] }
  | { op: 'contact.remove'; id: string; expected: Record<string, string> }
  | { op: 'group.add'; group: { label: string; icon: string; chip: string; order: number } }
  | { op: 'group.edit'; id: string; changes: EditChange[] }
  | { op: 'group.remove'; id: string; expected: Record<string, string>; with_contacts: boolean }

/** A contact's removal, witnessed by what the panel shows. */
export const contactRemoval = (group: DirGroup, c: DirContact): SavePayload => ({
  op: 'contact.remove', id: c.id,
  expected: { name: c.name, phone: c.phone, note: c.note, group: group.id, order: String(c.order) },
})

/** A lane's removal, witnessed by its label and how many contacts the panel saw go with it. */
export const groupRemoval = (g: DirGroup): SavePayload => ({
  op: 'group.remove', id: g.id, expected: { label: g.label, contacts: String(g.contacts.length) },
  with_contacts: g.contacts.length > 0,
})
