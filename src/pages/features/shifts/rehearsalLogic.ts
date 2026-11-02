// What the rehearsal screen draws, and the little it decides for itself: which acts exist, which doors each one…
// Every rule, window and refusal belongs to server/shift_rehearsal.py and the lane doors behind it, played inside…

export type RehearsalShift = {
  ref: string; location: string; house: string; open_row: string; col_iso: string
  value: string; kind: string; state: string; shift_start: string; filled_by: string
  window: { state: string; closes_at?: string; why?: string }
  /** The span a rehearsed clock may name for this shift — its own life, per the relay. */
  clock: { from: string; to: string }
  applicants: { id: string; person: string; state: string; via: string; rehearsed: boolean }[]
  rehearsal_only: boolean
}

export type RehearsalSwap = {
  id: string; location: string; house: string; col_iso: string; value: string
  from_staff: string; to_staff: string; house_manager: string
  staff_state: string; manager_state: string; approval: string; rehearsed: boolean
  /** The transfer's own approvers, as the lane reads them — never the house's grid. */
  approvers: string[]
  /** The lane's own sentence for who approves it. */
  approval_why: string
  /** The third consent: the directors the transfer was asked of, from the settings list. */
  directors: string[]
  director_state: string
}

/** A message a lane owes inside the sandbox, read from that lane's own owed(). None is ever sent. */
export type OwedMessage = {
  lane: string; key: string; kind: string; to: string; about: string; words: string; when?: string
  /** False when the lane left the recipient blank (its managers could not be read, say). */
  to_known?: boolean
}

export type RehearsalRow = {
  id: string; run: string; at: string; driver: string; door: string; act: string
  person: string; location: string; house: string; open_row: string; col_iso: string
  value: string; ref: string; outcome: string; code: string; why: string; said: string
  lanes: Record<string, unknown>; made: Record<string, unknown>
  /** What the lanes owed after this answer that they did not owe before it. */
  owed: OwedMessage[]
  cleared: boolean; cleared_at: string; cleared_by: string
  /** Reaches outside the sandbox the worker stopped while playing it. */
  stopped?: string[]
}

export type RehearsalSandbox = {
  schema: string
  /** When the sandbox took its copy of the estate, and who asked for it. */
  filled_at: string; filled_by: string
  /** The first day the copy reaches back to. */
  since: string
  counts: Record<string, number>
  /** The database role the worker connects as; superuser null when that could not be read. */
  role?: { name?: string; superuser?: boolean | null }
}

/** One of a person's own shifts still ahead, which a swap can offer. */
export type GiveableShift = { col_iso: string; value: string }

export type RehearsalBoard = {
  may: boolean; driver: string; run: string; line: string
  /** The rehearsed clock this board was read at, or '' for now. */
  at: string
  sandbox: RehearsalSandbox
  houses: { location: string; house: string }[]
  /** Tabs with open rows in the pool that the platform holds no calendar for; named, never offered. */
  not_houses: string[]
  shifts: RehearsalShift[]
  people: Record<string, string[]>
  /** Per house, each person's own shifts still ahead: what a swap offers (never the pool). */
  giveable?: Record<string, Record<string, GiveableShift[]>>
  textable: string[]
  /** False when the reply ear's contact index could not be read: nobody's number is known. */
  textable_readable: boolean
  textable_why: string
  /** Each house's own managers, as the hotline calendar names them. */
  deciders: Record<string, string[]>
  deciders_readable: boolean
  deciders_why: string
  swaps: RehearsalSwap[]
  made: RehearsalRow[]
  /** Everything the sandbox's lanes owe right now. */
  owed: OwedMessage[]
  /** Reaches outside the sandbox the worker stopped while reading the board. */
  stopped?: string[]
}

/** Acts that meet an application window, so a rehearsed clock means something for them. */
export const CLOCK_ACTS = ['apply', 'decide', 'take']

/** An instant as an <input type="datetime-local"> value, in the viewer's own local time. */
export function localInput(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// A clock inside a shift's own life, as <input type="datetime-local"> bounds in local time (the input's own…
export function clockBounds(s: RehearsalShift | null): { min: string; max: string } {
  return { min: localInput(s?.clock?.from ?? ''), max: localInput(s?.clock?.to ?? '') }
}

/** An <input type="datetime-local"> value as the instant the relay is sent; '' when it names none. */
export function instantOf(local: string): string {
  if (!local) return ''
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/** How long a clock being typed or scrolled waits before the board is read for it. */
export const CLOCK_DEBOUNCE_MS = 450

export type Choice = { name: string; label: string }

function choices(names: string[], driver: string, own: string): Choice[] {
  const out: Choice[] = []
  const seen = new Set<string>()
  const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const n of names) {
    if (!n || seen.has(key(n))) continue
    seen.add(key(n))
    out.push({ name: n, label: `${n} (${own})` })
  }
  if (driver && !seen.has(key(driver))) out.push({ name: driver, label: `${driver} (you, above the house)` })
  return out
}

// Who may be named approving a swap: its own approvers, then the one driving the rehearsal.
export function approverChoices(swap: RehearsalSwap | null, driver: string): Choice[] {
  return swap ? choices(swap.approvers ?? [], driver, "the transfer's approver") : []
}

// Who may be named giving a swap's director approval: the directors the transfer was asked of, and nobody else…
export function directorChoices(swap: RehearsalSwap | null): Choice[] {
  return swap ? choices(swap.directors ?? [], '', 'director on the list') : []
}

/** The seat an approval act answers, and the choices it offers. */
export function seatChoices(act: string, swap: RehearsalSwap | null, driver: string): Choice[] {
  return act === 'swap_director' ? directorChoices(swap) : approverChoices(swap, driver)
}

/** Owed messages, and the lanes that could not be read — never counted as a message owed. */
export function owedSplit(owed: OwedMessage[]): { messages: OwedMessage[]; unreadable: OwedMessage[] } {
  const list = owed ?? []
  return { messages: list.filter((o) => o.kind !== 'unreadable'), unreadable: list.filter((o) => o.kind === 'unreadable') }
}

// What the screen says about the database role the worker connects as.
export function roleNote(box: RehearsalSandbox | null | undefined): string {
  const r = box?.role
  if (!r) return ''
  const name = r.name || 'a role whose name was not given'
  if (r.superuser === true) {
    return `The worker connects to the database as ${name}, a superuser: the sandbox's database wall is its own reading of every statement and the check at every commit, with no privilege boundary under them.`
  }
  if (r.superuser === false) return `The worker connects to the database as ${name}, which is not a superuser.`
  return `Whether the worker's database role (${name}) is a superuser could not be read.`
}

/** Who can give a shift away at a house: the people with a shift of their own still ahead there. */
export function giverChoices(board: RehearsalBoard | null, location: string): string[] {
  if (!board || !location) return []
  const own = board.giveable?.[location] ?? {}
  return (board.people?.[location] ?? []).filter((p) => (own[p] ?? []).length > 0)
}

// The giver's OWN shifts still ahead at that house — what the transfer door offers.
export function giveChoices(board: RehearsalBoard | null, location: string, giver: string): GiveableShift[] {
  if (!board || !location || !giver) return []
  return board.giveable?.[location]?.[giver] ?? []
}

// Who the shift can be offered to: the house's people other than the giver.
export function receiverChoices(board: RehearsalBoard | null, location: string, giver: string): string[] {
  if (!board || !location) return []
  return (board.people?.[location] ?? []).filter((p) => p !== giver)
}

/** Who a decision may be played as: the house's own managers, then the one driving it. */
export function deciderChoices(board: RehearsalBoard | null, location: string): Choice[] {
  if (!board || !location) return []
  return choices(board.deciders?.[location] ?? [], board.driver, 'house manager')
}

/** What a name's entry in a picker says about its number; an unread index says nothing per name. */
export function numberNote(board: RehearsalBoard, name: string): string {
  if (board.textable_readable === false) return ''
  return board.textable.includes(name) ? '' : ' (no number the ear knows)'
}

// Reads where only the latest one counts: while one is in flight a newer key waits (the newest replaces any older…
export function latestOnly<T>(
  fetchOne: (key: string) => Promise<T>,
  on: { data: (d: T) => void; error: (e: unknown) => void; busy: (b: boolean) => void },
): (key: string) => void {
  let inflight = false
  let waiting: string | null = null
  let seq = 0
  const load = (key: string) => {
    if (inflight) {
      waiting = key
      seq += 1
      return
    }
    inflight = true
    const mine = ++seq
    on.busy(true)
    fetchOne(key)
      .then((d) => { if (mine === seq) on.data(d) }, (e) => { if (mine === seq) on.error(e) })
      .finally(() => {
        inflight = false
        const next = waiting
        waiting = null
        if (next !== null) load(next)
        else on.busy(false)
      })
  }
  return load
}

export const OUTCOME_TINT: Record<string, string> = { done: 'mint', held: 'amber', refused: 'pink', playing: 'slate' }

/** What may be answered, and through which door; the server answers this same list. */
export const ACTS: { id: string; label: string; doors: string[] }[] = [
  { id: 'apply', label: 'Apply for the shift', doors: ['app', 'text'] },
  { id: 'withdraw', label: 'Take the name back off', doors: ['app'] },
  { id: 'decide', label: 'Give the shift to them (the house manager decides)', doors: ['app'] },
  { id: 'take', label: 'Assign the shift to them', doors: ['app'] },
  { id: 'offer_swap', label: 'Offer the shift to somebody (a swap)', doors: ['app'] },
  { id: 'swap_accept', label: 'The receiver agrees to the swap', doors: ['app', 'text'] },
  { id: 'swap_approve', label: 'The house manager approves the swap', doors: ['app', 'text'] },
  { id: 'swap_director', label: 'The director approves the swap', doors: ['app', 'text'] },
]

/** Acts that answer a swap already offered, and the approvals among them. */
export const SWAP_ACTS = ['swap_accept', 'swap_approve', 'swap_director']
export const APPROVAL_ACTS = ['swap_approve', 'swap_director']

/** A swap as the picker names it: its three consents, each read from its own field. */
export function swapLabel(s: RehearsalSwap): string {
  const director = (s.directors ?? []).length ? `director ${s.director_state || 'pending'}` : 'no director asked'
  return `${s.id} · ${s.house} · ${s.col_iso} · ${s.value} · ${s.from_staff} → ${s.to_staff}`
    + ` · receiver ${s.staff_state}, house manager ${s.manager_state}, ${director}`
    + (s.rehearsed ? '' : ' · copied from the estate')
}

export function doorsFor(act: string): string[] {
  return ACTS.find((a) => a.id === act)?.doors ?? ['app']
}

/** A shift as the picker names it: where it is, when, what it is, and where its window stands. */
export function shiftLabel(s: RehearsalShift): string {
  const window = s.filled_by ? `taken by ${s.filled_by}`
    : s.window.state === 'open' ? 'window open'
      : s.window.state === 'manager_only' ? 'manager only' : 'window closed'
  return `${s.house} · ${s.col_iso} · ${s.value || 'open'} · ${s.kind === 'call_off' ? 'call-off' : 'open shift'} · ${window}`
    + (s.applicants.length ? ` · ${s.applicants.length} applicant(s)` : '')
}

// One owed message in words: what it is, to whom, about what — or why the lane could not say.
export function owedLine(o: OwedMessage): string {
  if (o.kind === 'unreadable') return `${o.lane}: ${o.about}`
  const what = o.kind ? o.kind.replace(/_/g, ' ') : o.lane
  const to = o.to && o.to_known !== false ? o.to : 'a recipient not known'
  return `${what} to ${to}${o.about ? ` — ${o.about}` : ''}`
}
