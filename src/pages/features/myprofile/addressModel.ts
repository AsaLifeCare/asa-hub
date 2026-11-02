// MY PROFILE · the Address on My Info — what staffProfileAddress answers (StaffProfiles.gs) and the pure decisions…
// The Employee Database Master keeps the street, city, state and zip; the relay's card carries the staff roster's…
import type { EditChange } from '@/lib/recordEdit'
import { isClientView, isGuardianView, sentence, type Field, type MyProfileView } from './myProfileModel'

export const ADDRESS_FIELDS = ['address', 'city', 'state', 'zip'] as const
export type AddressKey = (typeof ADDRESS_FIELDS)[number]
export type AddressParts = Record<AddressKey, string>

export const ADDRESS_LABEL: Record<AddressKey, string> = { address: 'Street address', city: 'City', state: 'State', zip: 'Zip' }
export const ADDRESS_MAX: Record<AddressKey, number> = { address: 120, city: 60, state: 2, zip: 10 }

/** The door's own words for a value it does not take (StaffProfiles.gs SP_ADDRESS_WORDS). */
export const ADDRESS_WORDS = {
  blank: 'A blank value is not saved here — HR clears it.',
  address: 'A street address: up to 120 characters, with a letter in it.',
  city: 'A city name: letters, spaces, periods, apostrophes and hyphens.',
  state: 'A two-letter US state, such as OH.',
  zip: 'A 5-digit zip, or ZIP+4 (12345-6789).',
} as const

/** The states the door takes (StaffProfiles.gs SP_US_STATES). */
export const US_STATES = ('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM ' +
  'NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP').split(' ')

export type AddressView = {
  /** the staff key the door settled */
  staff_key: string
  name: string
  own: boolean
  /** a Master row was read for the person */
  read: boolean
  /** each part as the Master keeps it */
  address: AddressParts
  /** the raw cell each editable part is witnessed by */
  edit: Partial<AddressParts>
  /** why a part may not be changed */
  locked: Partial<Record<AddressKey, string>>
  allowed: boolean
  why: string
}

export type AddressState = {
  status: 'idle' | 'loading' | 'ready' | 'failed' | 'refused'
  data: AddressView | null
  error: string
}

export const ADDRESS_IDLE: AddressState = { status: 'idle', data: null, error: '' }

const str = (v: unknown): string => (v == null || typeof v === 'object' ? '' : String(v))
const rec = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})

function partsOf(v: unknown, keep: (x: unknown) => boolean): Partial<AddressParts> {
  const o = rec(v)
  const out: Partial<AddressParts> = {}
  for (const k of ADDRESS_FIELDS) if (keep(o[k])) out[k] = str(o[k])
  return out
}

/** The door's answer, tolerant; null when it carries no address at all. */
export function addressOf(raw: unknown): AddressView | null {
  const o = rec(raw)
  if (!o.address || typeof o.address !== 'object') return null
  const shown = partsOf(o.address, () => true) as AddressParts
  return {
    staff_key: str(o.staff_key), name: str(o.name), own: o.own === true, read: o.read === true, address: shown,
    edit: partsOf(o.edit, (x) => typeof x === 'string' || typeof x === 'number'),
    locked: partsOf(o.locked, (x) => typeof x === 'string' && !!x),
    allowed: o.allowed === true, why: str(o.why),
  }
}

/** "12 Maple St, Canton, OH 44709" — the parts the Master holds, in that order. */
export function addressLine(a: Partial<AddressParts>): string {
  const tail = [a.state, a.zip].map((x) => str(x).trim()).filter(Boolean).join(' ')
  return [a.address, a.city].map((x) => str(x).trim()).concat(tail).filter(Boolean).join(', ')
}

/** The whole address as the panel's inputs show it now — what is typed over what the Master keeps. */
export function addressDraftLine(v: AddressView, draft: Partial<AddressParts>): string {
  const parts: Partial<AddressParts> = {}
  for (const k of ADDRESS_FIELDS) parts[k] = v.locked[k] ? v.address[k] : (draft[k] ?? v.address[k])
  return addressLine(parts)
}

// Whose address the screen asks for: '' for the caller's own (the door decides who from the session), the staff key…
export function addressAsk(view: MyProfileView | null): string | null {
  if (!view || isClientView(view) || isGuardianView(view)) return null
  if (view.person.own) return ''
  return view.scope.mode === 'mass' && view.person.key ? view.person.key : null
}

/** The relay's Address field, or the Master's whole address once the door answered one. */
export function addressField(field: Field, got: AddressState | undefined): Field {
  const d = got?.data
  if (!d || !d.read) return field
  const line = addressLine(d.address)
  return line ? { ...field, value: line, why: '', note: '' } : field
}

export type Pencil = { show: boolean; allowed: boolean; why: string }

export const ADDRESS_READING = 'Reading the address…'

/** The pencil on the Address: offered on a staff profile, open where the door says a part may be changed. */
export function addressPencil(view: MyProfileView, got: AddressState | undefined): Pencil {
  if (isClientView(view) || isGuardianView(view)) return { show: false, allowed: false, why: '' }
  if (addressAsk(view) === null) {
    if (view.scope.mode !== 'mass') return { show: false, allowed: false, why: '' }
    return { show: true, allowed: false,
      why: sentence(view.person.key_why) || 'No roster name that is this person’s alone is on file, so the address is not changed here.' }
  }
  const s = got ?? ADDRESS_IDLE
  if (s.data) return { show: true, allowed: s.data.allowed, why: s.data.allowed ? '' : sentence(s.data.why) }
  if (s.status === 'refused') return { show: true, allowed: false, why: sentence(s.error) }
  if (s.status === 'failed') {
    return { show: true, allowed: false, why: `The address could not be read just now: ${s.error || 'no answer'} — try again in a minute.` }
  }
  return { show: true, allowed: false, why: ADDRESS_READING }
}

/** What an input opens on: the raw cell the save is witnessed by, else the part as shown. */
export function addressBase(v: AddressView, k: AddressKey): string {
  return v.edit[k] ?? v.address[k] ?? ''
}

/** A part as it is sent: trimmed, the state in capitals. */
export const addressValue = (k: AddressKey, value: string): string => (k === 'state' ? value.trim().toUpperCase() : value.trim())

/** Why a value is not taken ('' when it is), in the door's own words (StaffProfiles.gs spAddressBad_). */
export function addressBad(k: AddressKey, value: string): string {
  const v = addressValue(k, value)
  if (!v) return ADDRESS_WORDS.blank
  if (k === 'address') return v.length <= ADDRESS_MAX.address && /[A-Za-z]/.test(v) && !/[\r\n\t]/.test(v) ? '' : ADDRESS_WORDS.address
  if (k === 'city') return /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ .'’-]{0,59}$/.test(v) ? '' : ADDRESS_WORDS.city
  if (k === 'state') return US_STATES.includes(v) ? '' : ADDRESS_WORDS.state
  return /^\d{5}(-\d{4})?$/.test(v) ? '' : ADDRESS_WORDS.zip
}

/** The parts whose input no longer shows what it opened on, each with its raw cell as the witness. */
export function addressChanges(v: AddressView, draft: Partial<AddressParts>): EditChange[] {
  const out: EditChange[] = []
  for (const k of ADDRESS_FIELDS) {
    if (v.locked[k] || !(k in v.edit) || draft[k] === undefined) continue
    const now = addressValue(k, draft[k] ?? '')
    if (now !== addressBase(v, k).trim()) out.push({ field: k, value: now, expected: v.edit[k] ?? '' })
  }
  return out
}

/** The answer once the door wrote `written`: those parts read as sent, at once, until the next read lands. */
export function addressAfter(v: AddressView, sent: EditChange[], written: string[]): AddressView {
  const address = { ...v.address }
  const edit = { ...v.edit }
  for (const c of sent) {
    if (!written.includes(c.field) || !(ADDRESS_FIELDS as readonly string[]).includes(c.field)) continue
    address[c.field as AddressKey] = c.value
    edit[c.field as AddressKey] = c.value
  }
  return { ...v, read: true, address, edit }
}
