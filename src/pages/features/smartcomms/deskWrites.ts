// WHAT A SAVE ON THE DESK SENDS, AND WHICH LINE A TEXT MAY LEAVE FROM.
// A SAVE SENDS THE CELLS IT CHANGES, AND NOTHING ELSE.

export type DeskRow = Record<string, string> & { id: string }
export type RowPatch = Record<string, string> & { id: string }

/** The id, and every cell whose text differs from the row the edit started from; a cleared cell is ''. */
export function rowPatch(before: DeskRow, after: DeskRow): RowPatch {
  const patch: RowPatch = { id: before.id }
  for (const k of Object.keys(after)) {
    if (k === 'id') continue
    const now = String(after[k] ?? '')
    if (String(before[k] ?? '') !== now) patch[k] = now
  }
  return patch
}

/** The cells a patch writes, without its id. */
export const patchCells = (patch: RowPatch): string[] => Object.keys(patch).filter((k) => k !== 'id')

/** The relay's 409 on a save: the platform wrote it and only the answer was lost on the way back — sent, not refused. */
export const confirmationLost = (err: unknown): boolean => (err as { status?: number } | null)?.status === 409

/** A row with a patch written over it — what the tab holds once the platform accepted it. */
export function withPatch<T extends DeskRow>(row: T, patch: RowPatch): T {
  return row.id === patch.id ? { ...row, ...patch } : row
}

/* ---------- the line a text leaves from ---------- */

/** One of our lines as `lineDirectory` hands it (only what the rule reads). */
export type DeskLine = { id?: string; digits?: string; e164?: string; number?: string; name?: string; role?: string }

/** Digits, last ten — the key every reader of a phone number computes (`hubLineKey_`). */
export function lineKey(v: unknown): string {
  let d = String(v ?? '').replace(/\D+/g, '')
  if (d.length >= 11 && d.charAt(0) === '1') d = d.slice(1)
  d = d.slice(-10)
  return d.length === 10 ? d : ''
}

const isProviderId = (v: string): boolean => /^PN[A-Za-z0-9]{6,}$/.test(v.trim())

type Listed = { line: DeskLine; id: string; digits: string; name: string; role: string }

const listed = (lines: DeskLine[]): Listed[] =>
  (lines || []).filter(Boolean).map((l) => ({
    line: l,
    id: String(l.id ?? ''),
    digits: lineKey(l.number || l.digits || l.e164 || ''),
    name: String(l.name ?? '').trim(),
    role: String(l.role ?? '').trim(),
  }))

export type SenderReading =
  | { ok: true; via: 'blank' | 'id' | 'number' | 'name' | 'role'; line: DeskLine | null }
  | { ok: false; why: string }

// Whether a `from_line` cell may hold this word, by the door's rule: id, number, name, then role; two lines sharing…
export function readSenderLine(word: unknown, lines: DeskLine[]): SenderReading {
  const w = String(word ?? '').trim()
  if (!w) return { ok: true, via: 'blank', line: null }
  const list = listed(lines)
  const pick = (test: (l: Listed) => boolean): Listed | 'many' | null => {
    const hits = list.filter(test)
    return hits.length === 1 ? hits[0] : hits.length > 1 ? 'many' : null
  }
  if (isProviderId(w)) {
    const byId = pick((l) => l.id === w)
    if (byId && byId !== 'many') return { ok: true, via: 'id', line: byId.line }
  }
  const key = lineKey(w)
  if (key) {
    const byNum = pick((l) => l.digits === key)
    if (byNum && byNum !== 'many') return { ok: true, via: 'number', line: byNum.line }
    return { ok: false, why: `no line of ours has the number ${w}` }
  }
  const lower = w.toLowerCase()
  const byName = pick((l) => !!l.name && l.name.toLowerCase() === lower)
  if (byName === 'many') return { ok: false, why: `more than one of our lines is called “${w}”` }
  if (byName) return { ok: true, via: 'name', line: byName.line }
  const byRole = pick((l) => !!l.role && l.role.toLowerCase() === lower)
  if (byRole === 'many') {
    return { ok: false, why: `“${w}” is the role of more than one of our lines — name the line by its number instead` }
  }
  if (byRole) return { ok: true, via: 'role', line: byRole.line }
  return {
    ok: false,
    why: w.indexOf('@') !== -1
      ? `“${w}” is an e-mail address, and this cell names a phone line — texts leave from a line, never from an address`
      : `no line of ours answers to “${w}”`,
  }
}

export type SenderOption = { value: string; label: string }

// One choice per line, each written as the shortest word that names that line alone: its role, else its name, else…
export function senderOptions(lines: DeskLine[]): SenderOption[] {
  const list = listed(lines).filter((l) => l.digits || l.id)
  const count = (pick: (l: Listed) => string, v: string) =>
    list.filter((l) => pick(l).toLowerCase() === v.toLowerCase()).length
  const out: SenderOption[] = []
  for (const l of list) {
    const value = l.role && count((x) => x.role, l.role) === 1 && count((x) => x.name, l.role) === 0 ? l.role
      : l.name && count((x) => x.name, l.name) === 1 ? l.name
        : l.digits ? `+1${l.digits}` : l.id
    if (out.some((o) => o.value === value)) continue
    const said = [l.role, l.name && l.name !== l.role ? l.name : ''].filter(Boolean).join(' — ')
    const number = l.digits ? `(${l.digits.slice(0, 3)}) ${l.digits.slice(3, 6)}-${l.digits.slice(6)}` : ''
    out.push({ value, label: [said || 'a line of ours', number].filter(Boolean).join(' · ') })
  }
  return out
}

/** The choice a stored word stands for: '' for blank, the option of the line it names, null when it names none. */
export function senderChoice(word: unknown, lines: DeskLine[]): string | null {
  const read = readSenderLine(word, lines)
  if (!read.ok) return null
  if (!read.line) return ''
  for (const o of senderOptions(lines)) {
    const same = readSenderLine(o.value, lines)
    if (same.ok && same.line === read.line) return o.value
  }
  return null
}

/** The words the door lists when it refuses (`hubLineSenderKnown_`): each line's role, else its name, once. */
export function senderNames(lines: DeskLine[]): string[] {
  const out: string[] = []
  for (const l of listed(lines)) {
    const label = l.role || l.name
    if (label && out.indexOf(label) === -1) out.push(label)
  }
  return out
}
