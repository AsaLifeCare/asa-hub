/**
 * Swaps, screen side: the four seats, the door each answer came through, the line of checks,
 * the company's history and the tab's place in Calendar Builder.
 * The server side is tools/test-shift-transfer.py.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import ShiftSwapsPage from '@/pages/features/shifts/ShiftSwapsPage'
import { calendarBuilderManifests } from '@/registry/apps-calendarbuilder'
import type { HandoffView, TransferCandidate } from '@/pages/features/shifts/requestsLogic'
import {
  EACH_DOOR_LINE, checksFor, directorSeat, directorsWarning, doorWords, filterSwaps, seatLine, seatsOf, stillOwed, swapCutsFrom,
  swapExportRows,
} from '@/pages/features/shifts/swapsLogic'

const BM = 'CAN - BM - BM4060'
const D1 = '2026-10-01'
const noop = () => {}
const clean = (html: string) => html.replace(/<!-- -->/g, '').replace(/&#x27;/g, "'")

// framer-motion needs window listeners
const g = globalThis as unknown as Record<string, unknown>
const hadListeners = typeof g.addEventListener === 'function'
before(() => {
  if (!hadListeners) {
    g.addEventListener = noop
    g.removeEventListener = noop
  }
})
after(() => {
  if (!hadListeners) {
    delete g.addEventListener
    delete g.removeEventListener
  }
})

const ask = (state: string, reached = false) =>
  ({ state, why: '', at: '2026-09-30T14:00:00Z', reached })

const H: HandoffView = {
  id: 'HO0000000001', location: BM, house: 'BM', col_iso: D1, value: '8A-4P',
  from_staff: 'Joan Cheruiyot', to_staff: 'Adrianna Williams', house_manager: 'Temeka Provens',
  state: 'pending', why: '',
  staff_state: 'accepted', staff_via: 'sms', staff_at: '2026-09-30T22:41:00Z', staff_by: 'Adrianna Williams',
  manager_state: 'approved', manager_via: 'app', manager_at: '', manager_by: 'Temeka Provens',
  director_state: 'pending', director_via: '', director_at: '', director_by: '',
  directors: ['Ty Bond', 'Lisa B. Bright'], director: 'Ty Bond',
  created_at: '2026-09-30T22:32:00Z', closed_at: '', offered_by: 'Joan Cheruiyot', closed_by: '',
  shift_start: '2026-10-01T21:30:00-04:00',
  approval: { mode: 'house_manager', names: ['Temeka Provens'],
              why: 'the house manager Temeka Provens approves' },
  first_shift: { needed: false },
  asks: { staff: ask('told', true), manager: ask('told', true), director: ask('told', true) },
  may_accept: false, may_approve: false, may_approve_director: false, may_withdraw: false,
  mine: true,
}

describe('the four seats of a swap', () => {
  it('names the one taking it, the house manager, the director and the one handing it over', () => {
    const seats = seatsOf(H)
    assert.deepEqual(seats.map((s) => [s.role, s.name, s.part]), [
      ['to', 'Adrianna Williams', 'takes the shift'],
      ['manager', 'Temeka Provens', 'house manager'],
      ['director', 'Ty Bond or Lisa B. Bright', 'director'],
      ['from', 'Joan Cheruiyot', 'hands it over'],
    ])
  })
  it('each seat says the DOOR its answer came through, and when', () => {
    const by = Object.fromEntries(seatsOf(H).map((s) => [s.role, s]))
    assert.equal(by.to.state, 'agreed')
    assert.match(by.to.line, /^agreed · by text · /)
    assert.equal(by.manager.state, 'agreed')
    assert.equal(by.manager.line, 'agreed · in the platform')
    assert.equal(by.director.state, 'waiting')
    assert.equal(by.director.line, 'waiting')
  })
  it('a door is named in words, whichever it was', () => {
    assert.equal(doorWords('sms'), 'by text')
    assert.equal(doorWords('app'), 'in the platform')
    assert.equal(doorWords('email'), 'by e-mail')
    assert.equal(doorWords(''), '')
  })
  it('a refusal is a refusal, not a silence', () => {
    assert.equal(seatLine('refused', 'sms', ''), 'said no · by text')
    const seats = seatsOf({ ...H, director_state: 'declined', director_via: 'sms',
                            director_by: 'Ty Bond' })
    assert.equal(seats[2].state, 'refused')
    assert.equal(seats[2].name, 'Ty Bond')
  })
  it('a swap closed before a director was asked says "not asked", never "waiting"', () => {
    const by = Object.fromEntries(seatsOf({ ...H, state: 'done', directors: [],
                                            director_state: 'not_asked' }).map((s) => [s.role, s]))
    assert.equal(by.director.state, 'none')
    assert.equal(by.director.line, 'not asked')
    assert.equal(seatLine('none', '', ''), 'not asked')
  })
  it('THE DIRECTOR BLOCKS: two yeses are not three', () => {
    assert.equal(stillOwed(H), 'Waiting on Ty Bond or Lisa B. Bright to approve')
    assert.equal(stillOwed({ ...H, director_state: 'approved' }), 'All three have answered')
    assert.equal(stillOwed({ ...H, manager_state: 'pending' }),
                 'Waiting on Temeka Provens to approve and Ty Bond or Lisa B. Bright to approve')
  })
  it('says once, in one place, that either door will do', () => {
    assert.match(EACH_DOOR_LINE, /answer by text or here/)
    assert.match(EACH_DOOR_LINE, /whichever comes first is the one recorded/)
  })
})

describe('the line of checks, from the relay\'s own verdict', () => {
  const cand = (over: Partial<TransferCandidate> = {}): TransferCandidate => ({
    name: 'Adrianna Williams', here: true, houses: ['BM'], regular: true, reachable: true,
    ok: true, code: 'ok', why: '', ist: 'ok', needs_training: false, ...over,
  })
  const readable = { readable: true, why: '' }
  it('nothing is ticked before somebody is picked', () => {
    assert.deepEqual(checksFor(null, readable).map((c) => c.ok), [null, null, null])
  })
  it('all three pass for a free, trained, rostered person', () => {
    assert.deepEqual(checksFor(cand(), readable).map((c) => c.ok), [true, true, true])
  })
  it('an overlap fails its own check and says the relay\'s sentence', () => {
    const [overlap] = checksFor(cand({ ok: false, code: 'overlap', why: 'it overlaps the 9A-5P shift' }),
                                readable)
    assert.equal(overlap.ok, false)
    assert.match(overlap.why, /overlaps the 9A-5P shift/)
  })
  it('a shift in the open pool fails the pool check — the relay\'s own word for it', () => {
    const called = checksFor(null, readable, 'called_off')
    assert.equal(called[1].ok, false)
    assert.match(called[1].why, /applied for, never handed over/)
    assert.equal(checksFor(null, readable, 'open_shift')[1].ok, false)
    // a shift refused for another reason is not called a pooled one
    assert.equal(checksFor(cand(), readable, 'started')[1].ok, true)
  })
  it('AN IST THAT CANNOT BE READ IS A MISSING ONE — never a tick nobody earned', () => {
    const unread = checksFor(cand(), { readable: false, why: 'the mirror is down' })
    assert.equal(unread[2].ok, null)
    assert.match(unread[2].why, /the mirror is down/)
    const first = checksFor(cand({ needs_training: true }), readable)
    assert.equal(first[2].ok, false)
    assert.match(first[2].why, /house manager approves the training/)
  })
})

describe('the company\'s swaps, as history', () => {
  const other: HandoffView = { ...H, id: 'HO0000000002', house: 'JH', from_staff: 'Kim Give',
                               to_staff: 'Zoe New', house_manager: 'Rita Lead', state: 'done',
                               director_state: 'approved', mine: false }
  it('cuts by house, person, state and words — narrowing only', () => {
    const rows = [H, other]
    assert.equal(filterSwaps(rows, { house: 'JH' }).length, 1)
    assert.equal(filterSwaps(rows, { person: 'Ty Bond' }).length, 2)
    assert.equal(filterSwaps(rows, { state: 'done' })[0].id, 'HO0000000002')
    assert.equal(filterSwaps(rows, { q: 'adrianna' })[0].id, 'HO0000000001')
    assert.equal(filterSwaps(rows, {}).length, 2)
  })
  it('the choices are read off the rows, directors included', () => {
    const cuts = swapCutsFrom([H, other])
    assert.deepEqual(cuts.houses, ['BM', 'JH'])
    assert.deepEqual(cuts.states, ['done', 'pending'])
    assert.ok(cuts.people.includes('Lisa B. Bright'))
    assert.ok(cuts.people.includes('Temeka Provens'))
  })
  it('the export carries each of the three answers with its door', () => {
    const [row] = swapExportRows([H]) as Record<string, string>[]
    assert.match(row.manager, /^Temeka Provens: agreed · in the platform$/)
    assert.match(row.staff, /^Adrianna Williams: agreed · by text/)
    assert.equal(row.director, 'Ty Bond or Lisa B. Bright: waiting')
  })

  /* the taker said no: the relay leaves the two approvals 'pending' on the row */
  const ended: HandoffView = { ...H, id: 'HO0000000003', state: 'dead', why: 'Adrianna Williams said no',
                               staff_state: 'declined', staff_via: 'sms',
                               manager_state: 'pending', manager_via: '', manager_at: '',
                               director_state: 'pending' }
  it('an ended swap is waiting on nobody — its unanswered seats say they never answered', () => {
    const by = Object.fromEntries(seatsOf(ended).map((s) => [s.role, s]))
    assert.equal(by.to.state, 'refused')
    assert.match(by.to.line, /^said no · by text/)
    assert.equal(by.manager.state, 'none')
    assert.equal(by.manager.line, 'never answered — the swap ended')
    assert.equal(by.director.state, 'none')
    assert.equal(by.director.line, 'never answered — the swap ended')
    assert.ok(seatsOf(ended).every((s) => s.state !== 'waiting'))
    // a closed swap that went through says "closed", not "ended"
    const done = seatsOf({ ...H, state: 'done', director_state: 'pending' })
    assert.equal(done[2].line, 'never answered — the swap closed')
    // and an open one is still waiting
    assert.equal(seatsOf(H)[2].line, 'waiting')
  })
  it('the export and the history say it too, beside the Ended pill', () => {
    const [row] = swapExportRows([ended]) as Record<string, string>[]
    assert.equal(row.manager, 'Temeka Provens: never answered — the swap ended')
    assert.equal(row.director, 'Ty Bond or Lisa B. Bright: never answered — the swap ended')
    // nothing is waiting, so the Waiting on card draws its empty state, which links out
    const page = clean(renderToString(<MemoryRouter><ShiftSwapsPage embedded initial={{
      me: 'Joan Cheruiyot', directors: { readable: true, names: ['Ty Bond'], why: '' },
      my_shifts: [], my_shifts_why: '', house_shifts: [], house_shifts_why: '', houses: [],
      history: [ended], whole_company: true, at: '2026-09-30T23:00:00Z',
    }} /></MemoryRouter>))
    const history = page.slice(page.indexOf('Every swap in the company'))
    assert.match(history, /Ended/)
    assert.match(history, /house manager · never answered — the swap ended/)
    assert.doesNotMatch(history, / · waiting</)
  })
})

describe('the screen', () => {
  const FEED = {
    me: 'Joan Cheruiyot',
    directors: { readable: true, names: ['Ty Bond', 'Lisa B. Bright'], why: 'the director approves' },
    my_shifts: [{ location: BM, house: 'BM', employee: 'Joan Cheruiyot', col_iso: D1,
                  value: '48th (A)', start: '2026-10-01T21:30:00-04:00',
                  end: '2026-10-02T07:30:00-04:00', may_transfer: true, why: '', offer: null }],
    my_shifts_why: '', house_shifts: [], house_shifts_why: '', houses: [],
    history: [H], whole_company: true, at: '2026-09-30T23:00:00Z',
  }
  const html = clean(renderToString(<ShiftSwapsPage embedded initial={FEED} />))
  it('draws the two cards and the company\'s history', () => {
    assert.match(html, /Hand a shift to somebody else/)
    assert.match(html, /Waiting on/)
    assert.match(html, /Every swap in the company/)
  })
  it('the shift is picked first, and the house manager and the director follow from it', () => {
    assert.match(html, /Pick a shift…/)
    assert.match(html, /48th \(A\) · BM/)
    assert.match(html, /automatic · the house/)
    assert.match(html, /automatic · the list/)
    assert.match(html, /Ty Bond or Lisa B\. Bright/)
  })
  it('the four seats are drawn with the door each answer came through', () => {
    assert.match(html, /Adrianna Williams/)
    assert.match(html, /takes the shift/)
    assert.match(html, /house manager/)
    assert.match(html, /agreed · in the platform/)
    assert.match(html, /Ty Bond or Lisa B\. Bright<\/span> · director/)
    assert.match(html, /hands it over/)
    assert.match(html, /whichever comes first is the one recorded/)
  })
  it('the line of checks is drawn, and the button asks the three who answer', () => {
    assert.match(html, /no overlap/)
    assert.match(html, /not an open shift/)
    assert.match(html, /trained for this house/)
    assert.match(html, /Ask all three/)
    assert.doesNotMatch(html, /Ask all four/)
  })
  it('opening a swap never claims the asks were delivered — Smart Comms may hold them', () => {
    const src = readFileSync(resolve(process.env.SPA_ROOT ?? process.cwd(),
      'src/pages/features/shifts/ShiftSwapsPage.tsx'), 'utf8')
    assert.match(src, /The asks go out through Smart Comms/)
    assert.doesNotMatch(src, /have each been asked/)
  })
  it('the houses a manager could not be shown are said, not left blank', () => {
    const blind = clean(renderToString(<ShiftSwapsPage embedded initial={{ ...FEED,
      house_shifts_why: 'who manages which house could not be read (the mirror is down) — the houses you manage are not listed' }} />))
    assert.match(blind, /who manages which house could not be read \(the mirror is down\)/)
  })
  it('a screen that could not read says so rather than drawing an empty list', () => {
    const empty = clean(renderToString(<ShiftSwapsPage embedded
      initial={{ ...FEED, my_shifts: [],
                 my_shifts_why: 'your upcoming shifts could not be read (TimeoutError)' }} />))
    assert.match(empty, /could not be read \(TimeoutError\)/)
    assert.match(empty, /This is not saying you have none/)
  })
  it('a directors list that could not be read stops the swap and says why', () => {
    const blind = clean(renderToString(<ShiftSwapsPage embedded
      initial={{ ...FEED, directors: { readable: false, names: [],
                                       why: 'the Time Off house could not be read' } }} />))
    assert.match(blind, /the Time Off house could not be read/)
    assert.match(blind, /no swap can be opened until it can be read/)
  })
  it('a directors list that names nobody opens the swap, its director\'s approval waiting — said, never a stop', () => {
    const why = 'the Time Off house\'s settings name no director — the `directors` cell of its Settings tab is ' +
      'the only place a swap\'s director is read from'
    const waits = 'no director has been asked to approve this swap yet: Settings -> Time Off\'s directors list ' +
      'names nobody - the director\'s approval waits until a name is saved there'
    const blank = clean(renderToString(<ShiftSwapsPage embedded
      initial={{ ...FEED, directors: { readable: true, names: [], why },
                 history: [{ ...H, directors: [], director: '', why: waits }] }} />))
    assert.match(blank, /settings name no director/)
    assert.match(blank, /a swap still opens, and its director's approval waits until a name is saved there/)
    assert.doesNotMatch(blank, /no swap can be opened|until it can be read/)
    // the swap in flight says what its director seat waits for
    assert.match(blank, /No director has been asked to approve this swap yet: Settings -&gt; Time Off's directors list names nobody/)
    // and the form still asks: its button is not held for a list that names nobody
    assert.match(blank, /the swap still opens, and its director's approval waits until a name is saved on Settings → Time Off/)
  })
  it('the house manager and the director are drawn as automatic, never typed', () => {
    const src = readFileSync(resolve(process.env.SPA_ROOT ?? process.cwd(),
      'src/pages/features/shifts/ShiftSwapsPage.tsx'), 'utf8')
    assert.match(src, /pill="automatic · the house"/)
    assert.match(src, /pill="automatic · the list"/)
    // neither is an input, and neither is ever posted
    assert.doesNotMatch(src, /house_manager:/)
    assert.doesNotMatch(src, /director(s)?:/)
  })
  it('the offer posts only the shift and the name picked — and the giver for somebody else\'s', () => {
    const src = readFileSync(resolve(process.env.SPA_ROOT ?? process.cwd(),
      'src/pages/features/shifts/ShiftSwapsPage.tsx'), 'utf8')
    assert.match(src, /location: picked\.location, col_iso: picked\.col_iso, to_staff: taker\.name/)
    assert.match(src, /\.\.\.\(otherPersons \? \{ from_staff: picked\.employee \} : \{\}\)/)
  })
  it('no answer carries a side — the relay works it out from the session', () => {
    const src = readFileSync(resolve(process.env.SPA_ROOT ?? process.cwd(),
      'src/pages/features/shifts/ShiftSwapsPage.tsx'), 'utf8')
    assert.doesNotMatch(src, /side:/)
    assert.match(src, /\{ handoff_id: h\.id, word: 'yes' \}/)
    assert.match(src, /h\.may_accept \|\| h\.may_approve \|\| h\.may_approve_director/)
  })
  it('no browser dialog ever', () => {
    const src = readFileSync(resolve(process.env.SPA_ROOT ?? process.cwd(),
      'src/pages/features/shifts/ShiftSwapsPage.tsx'), 'utf8')
    assert.doesNotMatch(src, /window\.(confirm|alert|prompt)/)
  })
})

describe('the director seat, from the list and nothing else', () => {
  it('names from the list are askable; a blank list opens it waiting on a name; an unreadable one is not askable', () => {
    const named = directorSeat({ readable: true, names: ['A One', 'B Two'], why: '' })
    assert.deepEqual([named.askable, named.name], [true, 'A One or B Two'])
    assert.match(named.why, /never a name in the code/)
    const blank = directorSeat({ readable: true, names: [], why: 'the settings name no director' })
    assert.deepEqual([blank.askable, blank.name], [true, ''])
    assert.match(blank.why, /the swap still opens, and its director's approval waits until a name is saved on Settings → Time Off/)
    const unread = directorSeat({ readable: false, names: [], why: 'the list could not be read' })
    assert.deepEqual([unread.askable, unread.name], [false, ''])
    assert.match(unread.why, /until it can be read/)
  })
  it('the warning under "Waiting on": nothing while the list names somebody, a wait on a blank list, a stop on an unread one', () => {
    assert.equal(directorsWarning({ readable: true, names: ['A One'], why: '' }), '')
    const blank = directorsWarning({ readable: true, names: [], why: 'the settings name no director' })
    assert.match(blank, /^the settings name no director — a swap still opens, and its director's approval waits/)
    assert.doesNotMatch(blank, /no swap can be opened/)
    const unread = directorsWarning({ readable: false, names: [], why: 'the list could not be read' })
    assert.match(unread, /^the list could not be read — no swap can be opened until it can be read/)
  })
})

describe('where it lives', () => {
  it('Swaps is a page of Calendar Builder, beside Requests', () => {
    const app = calendarBuilderManifests.find((a) => a.id === 'calendarbuilder')
    const ids = (app?.pages ?? []).map((p) => p.id)
    assert.ok(ids.includes('swaps'))
    assert.ok(ids.indexOf('swaps') > ids.indexOf('requests'))
    const swaps = (app?.pages ?? []).find((p) => p.id === 'swaps')
    assert.equal(swaps?.title, 'Swaps')
    assert.equal(swaps?.gate, 'no-client')
    assert.equal((swaps?.config as { customFeature?: string }).customFeature,
                 'shifts/ShiftSwapsPage')
  })
  it('the app renders it at that address', () => {
    const page = readFileSync(resolve(process.env.SPA_ROOT ?? process.cwd(),
      'src/pages/features/calendarbuilder/CalendarBuilderPage.tsx'), 'utf8')
    assert.match(page, /case 'swaps':/)
    assert.match(page, /<ShiftSwapsPage embedded \/>/)
  })
})
