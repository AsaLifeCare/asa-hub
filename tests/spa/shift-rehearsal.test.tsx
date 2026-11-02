/**
 * The rehearsal tab on Requests (Rehearsal.tsx): it offers exactly what the server answers,
 * through exactly the doors that lane has, says what a shift stands at before it is picked,
 * and says plainly that everything it plays stays inside its own sandbox.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ACTS, APPROVAL_ACTS, CLOCK_ACTS, SWAP_ACTS, approverChoices, clockBounds, deciderChoices,
  directorChoices, doorsFor, giveChoices, giverChoices, instantOf, latestOnly, localInput,
  numberNote, owedLine, owedSplit, receiverChoices, roleNote, seatChoices, shiftLabel, swapLabel,
  type OwedMessage, type RehearsalBoard, type RehearsalShift, type RehearsalSwap,
} from '@/pages/features/shifts/rehearsalLogic'
import { useRehearsalBoard } from '@/pages/features/shifts/useRehearsalBoard'
import { drawsRehearsal, type Feed } from '@/pages/features/shifts/requestsLogic'
import { mountHook } from './react-host'

const ROOT = resolve(process.cwd())
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const RELAY = read('server/shift_rehearsal.py')
const ACTS_PY = read('server/shift_rehearsal_acts.py')
const SCREEN = read('src/pages/features/shifts/Rehearsal.tsx')

const boardOf = (over: Partial<RehearsalBoard> = {}): RehearsalBoard => ({
  may: true, driver: 'Dana Drive', run: 'RUN1', line: '3305550000', at: '',
  sandbox: { schema: 'asa_rehearsal', filled_at: '', filled_by: '', since: '', counts: {} },
  houses: [{ location: 'CAN - BM - BM4060', house: 'BM' }], not_houses: [], shifts: [],
  people: { 'CAN - BM - BM4060': ['Ann Roe', 'Cy Far'] },
  textable: ['Ann Roe'], textable_readable: true, textable_why: '',
  deciders: { 'CAN - BM - BM4060': ['Hana Manager'] }, deciders_readable: true, deciders_why: '',
  swaps: [], made: [], owed: [], ...over,
})

const swapOf = (over: Partial<RehearsalSwap> = {}): RehearsalSwap => ({
  id: 'HO0123456789', location: 'CAN - BM - BM4060', house: 'BM', col_iso: '2026-09-27',
  value: '8A-4P', from_staff: 'Ann Roe', to_staff: 'Cy Far', house_manager: 'Hana Manager',
  staff_state: 'accepted', manager_state: 'pending', approval: 'house_manager', rehearsed: true,
  approvers: ['Hana Manager'], approval_why: 'the house manager Hana Manager approves',
  directors: ['Dora Desk'], director_state: 'pending', ...over,
})

const shift = (over: Partial<RehearsalShift> = {}): RehearsalShift => ({
  ref: 'SP3F9A2B1C4D', location: 'CAN - BM - BM4060', house: 'BM', open_row: 'OPEN',
  col_iso: '2026-09-25', value: '8A-4P', kind: 'open_shift', state: 'open',
  shift_start: '2026-09-25T12:00:00Z', filled_by: '',
  window: { state: 'open', why: 'reserved for this house’s own staff' },
  clock: { from: '2026-09-25T11:00:00Z', to: '2026-09-25T20:00:00Z' },
  applicants: [], rehearsal_only: false, ...over,
})

/**
 * A NEW PAGE INSIDE A RELEASED APP SHIPS MASTER-ONLY. The relay's doors open to the master's own
 * session alone and the feed carries that same yes; the tab is drawn on it and on nothing else.
 */
describe('the Rehearsal tab is drawn for the master alone', () => {
  const PAGE = read('src/pages/features/shifts/ShiftRequestsPage.tsx')
  const feedOf = (over: Partial<Feed>): Pick<Feed, 'rehearsal'> & Partial<Feed> => ({
    sees_reasons: true, whole_company: true, badges: ['ADMIN'], ...over,
  })

  it('only the relay’s own yes draws it', () => {
    assert.equal(drawsRehearsal(feedOf({ rehearsal: true, badges: ['ADMIN', 'MASTER'] })), true)
  })

  it('an administrator or a director — every house’s reasons, no master yes — does not get it', () => {
    assert.equal(drawsRehearsal(feedOf({ rehearsal: false })), false)
    assert.equal(drawsRehearsal(feedOf({ rehearsal: false, badges: ['DIRECTOR'] })), false)
  })

  it('a feed that does not carry the yes (an older relay, a failed read) does not get it', () => {
    assert.equal(drawsRehearsal(feedOf({})), false)
    assert.equal(drawsRehearsal(null), false)
    assert.equal(drawsRehearsal(undefined), false)
    assert.equal(drawsRehearsal({ rehearsal: 'true' as unknown as boolean }), false)
  })

  it('the tab list and the tab body both ask it, and badges no longer open it', () => {
    assert.match(PAGE, /if \(drawsRehearsal\(feed\)\) list\.push\(\{ id: 'rehearsal'/)
    assert.match(PAGE, /tab === 'rehearsal' && drawsRehearsal\(feed\) && <Rehearsal \/>/)
    assert.equal((PAGE.match(/<Rehearsal \/>/g) ?? []).length, 1)
    assert.doesNotMatch(PAGE, /sees_reasons\)\s*list\.push\(\{ id: 'rehearsal'/)
  })

  it('the relay puts the doors’ own gate on the feed', () => {
    const relay = read('server/snapshot_service.py')
    assert.match(relay, /data\["rehearsal"\] = _rehearsal_refusal\(authorization\) is None/)
    assert.match(RELAY, /return is_master is True and not acting/)
  })
})

describe('the screen offers what the lane answers, and nothing else', () => {
  it('every act on the screen is one the server knows', () => {
    const listed = RELAY.match(/^ACTS = \(([^)]*)\)/m)
    assert.ok(listed, 'server/shift_rehearsal.py declares no ACTS')
    const server = [...listed[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1])
    assert.deepEqual(ACTS.map((a) => a.id).sort(), [...server].sort())
  })

  it('the reply ear has no door for a withdrawal, a decision or an offer — the screen offers none', () => {
    for (const id of ['withdraw', 'decide', 'take', 'offer_swap']) {
      assert.deepEqual(doorsFor(id), ['app'], id)
    }
  })

  it('an application and all three consents of a swap can be answered either way', () => {
    for (const id of ['apply', 'swap_accept', 'swap_approve', 'swap_director']) {
      assert.deepEqual(doorsFor(id), ['app', 'text'], id)
    }
    assert.deepEqual(SWAP_ACTS, ['swap_accept', 'swap_approve', 'swap_director'])
    assert.deepEqual(APPROVAL_ACTS, ['swap_approve', 'swap_director'])
  })

  it('the swap picker names each of the three consents from its own field', () => {
    const label = swapLabel(swapOf({ director_state: 'approved' }))
    assert.match(label, /receiver accepted, house manager pending, director approved/)
    assert.match(swapLabel(swapOf({ directors: [] })), /no director asked/)
    assert.match(swapLabel(swapOf({ rehearsed: false })), /copied from the estate/)
  })

  it('an act the server does not know falls back to the platform door alone', () => {
    assert.deepEqual(doorsFor('something_else'), ['app'])
  })
})

describe('a shift says where it stands before anybody answers for it', () => {
  it('names the house, the day, the shift and the state of its window', () => {
    assert.match(shiftLabel(shift()), /BM · 2026-09-25 · 8A-4P · open shift · window open/)
  })

  it('a closed window and a taken shift each say so', () => {
    assert.match(shiftLabel(shift({ state: 'closed', window: { state: 'closed' } })), /window closed/)
    assert.match(shiftLabel(shift({ filled_by: 'Ann Roe' })), /taken by Ann Roe/)
  })

  it('counts the applicants a decision would have to decide between', () => {
    const two = shift({
      state: 'closed',
      window: { state: 'closed' },
      applicants: [
        { id: 'SR1', person: 'Ann Roe', state: 'applied', via: 'rehearsal:app', rehearsed: true },
        { id: 'SR2', person: 'Ben Left', state: 'applied', via: 'app', rehearsed: false },
      ],
    })
    assert.match(shiftLabel(two), /2 applicant\(s\)/)
  })

  it('a call-off is named as one', () => {
    assert.match(shiftLabel(shift({ kind: 'call_off' })), /call-off/)
  })
})

describe('the rehearsed clock — a window that closed this morning, rehearsed open', () => {
  it('is offered for exactly the acts an application window decides, and the lane says the same', () => {
    const listed = RELAY.match(/^CLOCK_ACTS = \(([^)]*)\)/m)
    assert.ok(listed, 'server/shift_rehearsal.py declares no CLOCK_ACTS')
    const server = [...listed[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1])
    assert.deepEqual([...CLOCK_ACTS].sort(), [...server].sort())
    for (const id of ['withdraw', 'offer_swap', 'swap_accept', 'swap_approve', 'swap_director']) {
      assert.ok(!CLOCK_ACTS.includes(id), id)
    }
  })

  it("the picker's bounds are the shift's own life in the input's OWN local time — read back, they are the same instants", () => {
    const b = clockBounds(shift())
    assert.equal(new Date(b.min).getTime(), Date.parse('2026-09-25T11:00:00Z'))
    assert.equal(new Date(b.max).getTime(), Date.parse('2026-09-25T20:00:00Z'))
    assert.match(b.min, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('a shift that names no span bounds nothing, and a spelling that is no instant bounds nothing', () => {
    assert.deepEqual(clockBounds(shift({ clock: { from: '', to: '' } })), { min: '', max: '' })
    assert.deepEqual(clockBounds(null), { min: '', max: '' })
    assert.equal(localInput('whenever'), '')
  })

  it('nothing in the estate is moved to make the clock true, and the lane compares instants, never strings', () => {
    assert.ok(ACTS_PY.includes('def _clock_for('))
    assert.ok(!/UPDATE asa_shift_pool SET opened_at/.test(ACTS_PY))
    assert.ok(!/_iso\(clock\) </.test(ACTS_PY))
  })
})

describe('the screen says the sandbox, and never pretends a message was sent', () => {
  it('it names the sandbox and when its copy of the estate was taken', () => {
    assert.match(SCREEN, /played in a sandbox/)
    assert.match(SCREEN, /box\.filled_at/)
  })

  it('there is no per-row undo any more: one Reset empties the sandbox, confirmed in the page, never by a browser dialog', () => {
    assert.ok(!/shift-rehearsal\/undo/.test(SCREEN))
    assert.match(SCREEN, /shift-rehearsal\/reset/)
    assert.match(SCREEN, /confirmReset/)
    assert.ok(!/window\.confirm|confirm\(/.test(SCREEN.replace(/setConfirmReset\(|confirmReset/g, '')))
  })

  it('what a lane owes is listed as what WOULD have been said, and to whom', () => {
    assert.equal(owedLine({ lane: 'text', key: 'text:1', kind: 'ack_applied', to: 'Ben Left',
      about: '48TH · 2026-09-26 · 8A-4P', words: '' }), 'ack applied to Ben Left — 48TH · 2026-09-26 · 8A-4P')
    assert.equal(owedLine({ lane: 'swap', key: 'swap:unreadable', kind: 'unreadable', to: '',
      about: 'this lane could not be read (OperationalError)', words: '' }),
    'swap: this lane could not be read (OperationalError)')
    assert.match(SCREEN, /would have been said, and to whom/)
    assert.match(SCREEN, /none of it is ever sent/)
  })

  it('a lane that could not be read is never counted as a message owed — it is said apart', () => {
    const owed: OwedMessage[] = [
      { lane: 'text', key: 'text:1', kind: 'ack_applied', to: 'Ben Left', about: '', words: '' },
      { lane: 'swap', key: 'swap:unreadable', kind: 'unreadable', to: '', about: 'this lane could not be read (OperationalError)', words: '' },
    ]
    const got = owedSplit(owed)
    assert.deepEqual(got.messages.map((o) => o.key), ['text:1'])
    assert.deepEqual(got.unreadable.map((o) => o.key), ['swap:unreadable'])
    assert.deepEqual(owedSplit([]), { messages: [], unreadable: [] })
    assert.ok(!/board\.owed\.length/.test(SCREEN), 'the header never counts board.owed whole')
    assert.match(SCREEN, /owed\.messages\.length/)
    assert.match(SCREEN, /could not be read — none of it is ever sent/)
    assert.match(SCREEN, /what it owes is not known/)
  })

  it("an answer's own list never names an unread lane among what would have been said", () => {
    const owedLines = SCREEN.slice(SCREEN.indexOf('function OwedLines'), SCREEN.indexOf('function Answer'))
    assert.match(owedLines, /const \{ messages, unreadable \} = owedSplit\(owed\)/)
    assert.match(owedLines, /would have been said, and to whom<\/span>\s*\{': '\}\{messages\.map\(owedLine\)/)
    assert.match(owedLines, /not known<\/span>\s*\{': '\}\{unreadable\.map\(owedLine\)/)
    assert.ok(!/\{owed\.map\(owedLine\)/.test(owedLines), 'the answer list never maps owed whole')
    // the relay builds that list as a diff that says an unread lane apart
    assert.match(ACTS_PY, /out\["owed"\] = owed_diff\(before, owed_now\(played\)\)/)
    assert.match(RELAY, /def owed_diff\(/)
  })

  it('a reach the sandbox stopped is shown, not hidden', () => {
    assert.match(SCREEN, /The sandbox stopped a reach outside it/)
  })

  it('a recipient the lane left blank is not known — never nobody, never the applicant', () => {
    const blank: OwedMessage = { lane: 'shift', key: 'shift:1', kind: 'open_shift_applicants', to: '',
      to_known: false, about: '48TH · 2026-09-26 · 8A-4P', words: '' }
    assert.equal(owedLine(blank), 'open shift applicants to a recipient not known — 48TH · 2026-09-26 · 8A-4P')
    assert.equal(owedLine({ ...blank, to_known: undefined }),
      'open shift applicants to a recipient not known — 48TH · 2026-09-26 · 8A-4P')
    assert.equal(owedLine({ ...blank, to: 'Hana Manager', to_known: true }),
      'open shift applicants to Hana Manager — 48TH · 2026-09-26 · 8A-4P')
    assert.ok(!/nobody named/.test(read('src/pages/features/shifts/rehearsalLogic.ts')))
    // the relay reads each lane's recipient from its own field and says when it is blank
    assert.match(RELAY, /def owed_entry\(/)
    assert.match(RELAY, /"to_known": bool\(to\)/)
  })

  it("the database role the worker connects as is said: a superuser's missing boundary, an ordinary role, or a role nobody could read", () => {
    assert.match(roleNote({ schema: 's', filled_at: '', filled_by: '', since: '', counts: {},
      role: { name: 'postgres', superuser: true } }), /postgres, a superuser: .*no privilege boundary/)
    assert.match(roleNote({ schema: 's', filled_at: '', filled_by: '', since: '', counts: {},
      role: { name: 'asa_rehearsal_worker', superuser: false } }), /asa_rehearsal_worker, which is not a superuser/)
    assert.match(roleNote({ schema: 's', filled_at: '', filled_by: '', since: '', counts: {},
      role: { name: 'x', superuser: null } }), /could not be read/)
    assert.equal(roleNote(undefined), '')
    assert.match(SCREEN, /roleNote\(box\)/)
  })
})

describe('an offer gives the giver\'s OWN shift, never an open shift of the pool', () => {
  const LOC = 'CAN - BM - BM4060'
  const b = boardOf({
    people: { [LOC]: ['Ann Roe', 'Cy Far', 'Gil Giver'] },
    giveable: { [LOC]: { 'Ann Roe': [{ col_iso: '2026-09-27', value: '8A-4P' }], 'Gil Giver': [] } },
    shifts: [shift({ col_iso: '2026-09-28' })],
  })

  it('only people with a shift of their own still ahead can give one, and each is offered only their own', () => {
    assert.deepEqual(giverChoices(b, LOC), ['Ann Roe'])
    assert.deepEqual(giveChoices(b, LOC, 'Ann Roe'), [{ col_iso: '2026-09-27', value: '8A-4P' }])
    assert.deepEqual(giveChoices(b, LOC, 'Cy Far'), [])
    assert.deepEqual(giveChoices(b, LOC, ''), [])
    assert.deepEqual(giverChoices(b, ''), [])
    assert.deepEqual(giverChoices(boardOf(), LOC), [], 'a board without the list offers nobody')
  })

  it('the receiver is anybody of the house but the giver — the door refuses the rest in its own words', () => {
    assert.deepEqual(receiverChoices(b, LOC, 'Ann Roe'), ['Cy Far', 'Gil Giver'])
    assert.deepEqual(receiverChoices(b, '', 'Ann Roe'), [])
  })

  it('the screen takes the house, the giver and the day from that list, and never from the pool picker', () => {
    assert.match(SCREEN, /const needsShift = act === 'apply' \|\| act === 'decide' \|\| act === 'take'\n/)
    assert.match(SCREEN, /giveChoices\(board, giveHouse, person\)/)
    assert.match(SCREEN, /receiverChoices\(board, giveHouse, person\)/)
    assert.match(SCREEN, /location: offers \? giveHouse :/)
    assert.match(SCREEN, /col_iso: offers \? giveDay :/)
    assert.ok(!/act === 'offer_swap' && \(\s*<select aria-label="Who is offered the shift"[\s\S]*?people\.map/.test(SCREEN),
      'the receiver list is never the pooled shift\'s house people')
    assert.match(ACTS_PY, /"giveable": _giveable\(view, houses, now\)/)
  })
})

describe('an approval and a decision are offered only as the people the real door lets make them', () => {
  it("the approver picker offers the transfer's own approvers and the driver — never the house's grid", () => {
    const got = approverChoices(swapOf(), 'Dana Drive')
    assert.deepEqual(got.map((c) => c.name), ['Hana Manager', 'Dana Drive'])
    assert.ok(!got.some((c) => c.name === 'Cy Far' || c.name === 'Ann Roe'), 'a grid name is never offered')
    assert.match(got[0].label, /the transfer's approver/)
    assert.match(got[1].label, /you, above the house/)
  })

  it('a transfer approved above the house offers only the driver, and nothing is offered before a swap is picked', () => {
    const above = approverChoices(swapOf({ approvers: [], house_manager: '', approval: 'above' }), 'Dana Drive')
    assert.deepEqual(above.map((c) => c.name), ['Dana Drive'])
    assert.deepEqual(approverChoices(null, 'Dana Drive'), [])
  })

  it("the director picker offers the transfer's own directors list and nobody else — never a badge, never the driver", () => {
    const got = directorChoices(swapOf({ directors: ['Dora Desk', 'Lisa B. Bright'] }))
    assert.deepEqual(got.map((c) => c.name), ['Dora Desk', 'Lisa B. Bright'])
    assert.match(got[0].label, /director on the list/)
    assert.deepEqual(directorChoices(swapOf({ directors: [] })), [])
    assert.deepEqual(directorChoices(null), [])
    assert.deepEqual(seatChoices('swap_director', swapOf(), 'Dana Drive').map((c) => c.name), ['Dora Desk'])
    assert.deepEqual(seatChoices('swap_approve', swapOf(), 'Dana Drive').map((c) => c.name),
      ['Hana Manager', 'Dana Drive'])
    assert.match(SCREEN, /Which director approves/)
    assert.match(SCREEN, /from the directors list on Settings → Time Off/)
  })

  it("a decision is offered as the house's own managers and the driver, once each", () => {
    const b = boardOf({ deciders: { 'CAN - BM - BM4060': ['Hana Manager', 'Dana Drive'] } })
    assert.deepEqual(deciderChoices(b, 'CAN - BM - BM4060').map((c) => c.name), ['Hana Manager', 'Dana Drive'])
    assert.deepEqual(deciderChoices(b, ''), [])
  })

  it('the relay weighs the name as the real door weighs that person, and the screen sends who decides', () => {
    assert.match(ACTS_PY, /seat = shift_handoff\.side_for\(reader, got\)/)
    assert.match(ACTS_PY, /if seat == side:/)
    assert.match(ACTS_PY, /"not_the_approver"/)
    assert.match(ACTS_PY, /"not_the_director"/)
    assert.match(ACTS_PY, /"another_seat"/)
    assert.match(ACTS_PY, /"not_a_decider"/)
    assert.match(SCREEN, /decider: decides \? decider : ''/)
    assert.match(SCREEN, /approvers\.map\(/)
    assert.ok(!/board\.people\[chosenSwap\.location\]/.test(SCREEN), 'the approver list is never the grid')
  })
})

describe('an unreadable contact index is said, never drawn as nobody having a number', () => {
  it('a readable index labels the names it holds no number for', () => {
    const b = boardOf()
    assert.equal(numberNote(b, 'Ann Roe'), '')
    assert.equal(numberNote(b, 'Cy Far'), ' (no number the ear knows)')
  })

  it('an unread index labels nobody — the screen says why once, instead', () => {
    const b = boardOf({ textable: [], textable_readable: false, textable_why: 'The staff roster could not be read (JSONDecodeError)' })
    assert.equal(numberNote(b, 'Ann Roe'), '')
    assert.equal(numberNote(b, 'Cy Far'), '')
    assert.match(SCREEN, /The contact index could not be read/)
    assert.match(SCREEN, /textable_readable === false/)
    assert.match(ACTS_PY, /code="contacts_unreadable"/)
  })
})

describe('the board is read once per clock, one read at a time, and the latest one wins', () => {
  type Pending = { key: string; resolve: (v: string) => void; reject: (e: unknown) => void }
  const harness = () => {
    const calls: Pending[] = []
    const seen: string[] = []
    const errors: string[] = []
    const busy: boolean[] = []
    const load = latestOnly<string>(
      (key) => new Promise<string>((res, rej) => { calls.push({ key, resolve: res, reject: rej }) }),
      { data: (d) => seen.push(d), error: (e) => errors.push(String(e)), busy: (b) => busy.push(b) })
    return { calls, seen, errors, busy, load }
  }
  const tick = () => new Promise((r) => setTimeout(r, 0))

  it('three clocks asked while one read runs start ONE more read, for the last of them', async () => {
    const h = harness()
    h.load('a')
    h.load('b')
    h.load('c')
    h.load('d')
    assert.deepEqual(h.calls.map((c) => c.key), ['a'])
    h.calls[0].resolve('board a')
    await tick()
    assert.deepEqual(h.calls.map((c) => c.key), ['a', 'd'])
    assert.deepEqual(h.seen, [], 'the overtaken answer is dropped, never drawn')
    h.calls[1].resolve('board d')
    await tick()
    assert.deepEqual(h.seen, ['board d'])
    assert.deepEqual(h.busy, [true, true, false])
  })

  it("an overtaken read's failure is dropped too; the latest read's failure is said", async () => {
    const h = harness()
    h.load('a')
    h.load('b')
    h.calls[0].reject(new Error('stale'))
    await tick()
    assert.deepEqual(h.errors, [])
    h.calls[1].reject(new Error('busy'))
    await tick()
    assert.deepEqual(h.errors, ['Error: busy'])
  })

  it('the datetime-local value is sent as the instant it names, and a value that names none is sent as none', () => {
    assert.equal(instantOf(''), '')
    assert.equal(instantOf('not a time'), '')
    assert.equal(new Date(instantOf('2026-09-25T08:30')).getTime(), new Date('2026-09-25T08:30').getTime())
  })

  it('the screen reads the clock through the debounce, never on every keystroke', () => {
    assert.match(SCREEN, /askClock\(instantOf\(e\.target\.value\)\)/)
    assert.ok(!/onChange=\{\(e\) => \{ setAt\(e\.target\.value\); load\(/.test(SCREEN))
  })

  it('a failed read keeps the board drawn and says so, with a way to read again', () => {
    assert.match(SCREEN, /could not be read again/)
    assert.match(SCREEN, /onClick=\{retry\}/)
  })
})

describe('the board hook, mounted: a clock scrolled through reads the board once', () => {
  const realFetch = globalThis.fetch
  const asked: string[] = []
  let failNext = false
  before(() => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      asked.push(url)
      if (failNext) {
        failNext = false
        return new Response(JSON.stringify({ status: 409, reason: 'busy', message: 'the sandbox is busy' }),
          { status: 200, headers: { 'content-type': 'application/json' } })
      }
      const at = new URL(url, 'http://relay.local').searchParams.get('at') ?? ''
      return new Response(JSON.stringify({ status: 200, data: boardOf({ at }) }),
        { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })

  it('mounts with one read, and five clocks in a row become one more read, for the last clock', async () => {
    const h = mountHook(() => useRehearsalBoard(5), {})
    await h.settle(() => h.current.board !== null)
    assert.equal(asked.length, 1, `mounted with ${asked.length} reads`)
    for (const iso of ['2026-09-25T10:00:00.000Z', '2026-09-25T10:01:00.000Z', '2026-09-25T10:02:00.000Z',
      '2026-09-25T10:03:00.000Z', '2026-09-25T10:04:00.000Z']) {
      h.run(() => h.current.askClock(iso))
    }
    await h.settle(() => h.current.board?.at === '2026-09-25T10:04:00.000Z' && !h.current.loading)
    assert.equal(asked.length, 2, asked.join(' | '))
    assert.match(asked[1], /at=2026-09-25T10%3A04%3A00.000Z/)

    // a failed read keeps the board and says why; Try again reads the same clock
    failNext = true
    h.run(() => h.current.retry())
    await h.settle(() => h.current.error !== '')
    assert.equal(h.current.board?.at, '2026-09-25T10:04:00.000Z')
    assert.match(h.current.error, /busy/)
    h.run(() => h.current.retry())
    await h.settle(() => h.current.error === '' && !h.current.loading)
    assert.match(asked[asked.length - 1], /at=2026-09-25T10%3A04%3A00.000Z/)
    h.unmount()
  })
})

/**
 * THE MARK is the second wall: the rehearsal plays in its own sandbox, so a real screen never
 * meets one of its rows — and if one ever did, the relay's flag is drawn wherever it could be acted on.
 */
describe('the mark is drawn wherever a real person could see or act on a rehearsed row', () => {
  it('the ordinary Requests row draws it — beside the state and in words', () => {
    const page = read('src/pages/features/shifts/ShiftRequestsPage.tsx')
    assert.match(page, /<RehearsalMark on=\{r\.rehearsal\}/)
    assert.match(page, /<RehearsalMark on=\{a\.rehearsal\}/)
  })

  it('the swap ask draws it', () => {
    assert.match(read('src/pages/features/shifts/HandoffCard.tsx'), /<RehearsalMark on=\{h\.rehearsal\}/)
  })

  it("Calendar Builder → Swaps draws it on a swap waiting and on the company's history", () => {
    const swaps = read('src/pages/features/shifts/ShiftSwapsPage.tsx')
    assert.equal((swaps.match(/<RehearsalMark on=\{h\.rehearsal\}/g) ?? []).length, 2)
  })

  it("a house manager's decision list draws it beside every applicant", () => {
    assert.match(read('src/pages/features/shifts/ShiftCellPanel.tsx'), /<RehearsalMark on=\{a\.rehearsal\}/)
    assert.match(read('src/pages/features/shifts/requestDetail.ts'), /a\.rehearsal \? \['PLAYED BY THE SHIFT REHEARSAL/)
  })

  it('the Texts panel draws it, and the live grid marks a played square', () => {
    assert.match(read('src/pages/features/shifts/TextReplies.tsx'), /<RehearsalMark on=\{r\.rehearsal\}/)
    const grid = read('src/pages/features/shifts/HouseGrid.tsx')
    assert.match(grid, /c\.rehearsal && 'rehearsal'/)
    assert.match(grid, /\{c\.rehearsal && \(/)
    assert.match(read('src/pages/features/shifts/houseCalTypes.ts'), /c\.rehearsal \? 'Played by the shift rehearsal/)
  })

  it('no screen works it out for itself: the relay puts it on the row it hands over', () => {
    const marks = read('src/pages/features/shifts/RehearsalMark.tsx')
    assert.ok(!/via|extra|startsWith|rehearsal:/.test(marks.replace(/^\s*\*.*$/gm, '')),
      'RehearsalMark must draw the relay\'s answer, never re-derive it')
    const lane = read('server/shift_requests.py')
    assert.match(lane, /def is_rehearsed\(/)
    assert.match(lane, /REHEARSAL: is_rehearsed\(row\)/)
    assert.match(read('server/shift_handoff.py'), /REHEARSAL_KEY: is_rehearsed\(row\)/)
    assert.match(read('server/sms_ears.py'), /"rehearsal": bool\(r\.get\("rehearsal"\)\)/)
  })
})
