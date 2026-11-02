/** The house editor's own few decisions, pure; everything else is the relay's. */
import { nameKey, sameName, type DraftEntry, type Row } from '@/pages/features/shifts/houseCalTypes'
import type { EditorSave } from '@/pages/features/shifts/ShiftEditor'

type CellBody = {
  location: string; employee: string; col_iso: string; value?: string; start?: string; end?: string
  keep_star?: boolean; note?: string; via?: 'cell' | 'times' | 'delete' | 'add'
}
type MoveBody = {
  location: string; from: { employee: string; col_iso: string }; to: { employee: string; col_iso: string }
  value?: string; start?: string; end?: string; keep_star?: boolean; note?: string
}

/** A Save onto another person or day is one move (one Undo); anything else drafts the one cell. */
export function saveRequest(
  location: string, target: { employee: string; colIso: string }, hadShift: boolean, s: EditorSave,
): { door: 'cell'; body: CellBody } | { door: 'move'; body: MoveBody } {
  const moved = !sameName(s.employee, target.employee) || s.colIso !== target.colIso
  const times = s.start && s.end
    ? { start: s.start, end: s.end, ...(s.keepStar ? { keep_star: true } : {}) }
    : { value: s.value ?? '' }
  if (moved && hadShift) {
    return {
      door: 'move',
      body: { location, from: { employee: target.employee, col_iso: target.colIso },
              to: { employee: s.employee, col_iso: s.colIso }, ...times, note: s.note },
    }
  }
  return {
    door: 'cell',
    body: { location, employee: moved ? s.employee : target.employee,
            col_iso: moved ? s.colIso : target.colIso, ...times, note: s.note,
            via: !hadShift ? 'add' : s.start && s.end ? 'times' : 'cell' },
  }
}

/** This house's people first, then the directory; never an OPEN or call-off row, nobody twice. */
export function staffChoices(rows: Row[], directory: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (n: string) => {
    const k = nameKey(n)
    if (!k || seen.has(k)) return
    seen.add(k)
    out.push(n)
  }
  for (const r of rows) {
    if (!r.open_row && !r.call_off_row) add(r.employee)
  }
  for (const n of [...directory].sort((a, b) => a.localeCompare(b))) add(n)
  return out
}

/** What a publish is about to do. */
export function publishSummary(drafts: DraftEntry[], rows: Row[]): {
  cells: number; people: number; newPeople: string[]; trainings: number
} {
  const people = new Set(drafts.filter((d) => !/^\s*open(?![a-z])/i.test(d.employee)).map((d) => nameKey(d.employee)))
  const newPeople = [...new Set(drafts.map((d) => d.employee))]
    .filter((n) => rows.some((r) => r.draft_row && sameName(r.employee, n)))
  return { cells: drafts.length, people: people.size, newPeople,
           trainings: drafts.filter((d) => d.ist).length }
}

/** What a publish reaches; unrecorded cells are in the workbook only. */
export function publishedReach(recorded: boolean | undefined, testMode?: boolean): string {
  if (testMode) {
    return 'Test mode is on, so the workbook was NOT written: the cells are recorded on the platform, shown everywhere marked as test mode, and wait under "Published in test mode" until you publish them for real or discard them.'
  }
  if (recorded === false) {
    return 'The cells are in the workbook, but their record could not be written — the rest of the platform sees them only on the workbook\'s next copy, within half an hour.'
  }
  return 'Every screen and the reminders follow it within a minute; the workbook\'s own copy catches up within half an hour.'
}

/** THE PUBLISH TOAST'S TITLE — "written" only when the workbook was written. */
export function publishedTitle(r: { written: number; test_mode?: boolean }, location: string): string {
  const cells = `${r.written} cell${r.written === 1 ? '' : 's'}`
  return r.test_mode
    ? `Recorded in test mode — ${cells} at ${location}, not written to the workbook`
    : `Published — ${cells} written to ${location}`
}

/** What Mark Call-Off did, worded from the door's `road`: at the press the rest of the call-off is still owed. */
export function callOffReach(closesAt: string, road = 'owed'): string {
  const open = `It is a blood-red open shift on Live now, and the reminders stand down for them; applications close at ${closesAt}, then you decide.`
  if (road === 'told') {
    return `${open} It was filed as a full call-off; what the Call Off Tracker row, the URGENT OPEN SHIFT and the directors' text did is on Requests.`
  }
  return `${open} The rest of the full call-off is being filed: the Call Off Tracker row, the URGENT OPEN SHIFT to all staff (never the reason) and the reason to the directors' group alone follow within minutes (held in the mock outbox while test mode is on). What each one did is on Requests.`
}

/** Every effect of Mark Call-Off, named before it happens; an unreadable test mode is never promised as the mock outbox. */
export function callOffConfirmBody(employee: string, text: string,
                                   testMode?: boolean | 'on' | 'unreadable' | null): string {
  const held = testMode === true || testMode === 'on'
    ? 'Test mode is on, so every one of those goes to the mock outbox instead.'
    : testMode === 'unreadable'
      ? 'Whether test mode is on could not be read just now, so count on these going out for real: they are sent by the call-off road, which reads its own switch.'
      : 'While test mode is on, every one of those goes to the mock outbox instead.'
  return `${employee}'s ${text} opens at once as a blood-red call-off shift on Live — applications for five hours at most, then the house manager decides — and the reminders and the attendance check stand down for them. The cell stays as the workbook has it until somebody is given the shift. It is a full call-off, filed exactly as the hotline and the call-off form file one: a Call Off Tracker row, ${employee} told it was received, the URGENT OPEN SHIFT to all staff with no reason, and the note — the reason — to the directors' group alone. ${held}`
}

/** A held cell's one line in the Builder's "Published in test mode" list. */
export function heldLine(h: { employee: string; value: string; base: string }, day: string): string {
  return `${h.employee} · ${day}: ${h.value || 'empty'} (the workbook still says ${h.base || 'nothing'})`
}
