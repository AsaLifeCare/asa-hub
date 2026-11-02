/**
 * Shift transfers, screen side: the picker, a waiting transfer with this reader's buttons, Transfer on the panel.
 * The server side is tools/test-shift-transfer.py.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import ShiftCellPanel from '@/pages/features/shifts/ShiftCellPanel'
import TransferPicker from '@/pages/features/shifts/TransferPicker'
import { CANDIDATES_PATH, candidatesUrl } from '@/pages/features/shifts/handoffActions'
import HandoffCard from '@/pages/features/shifts/HandoffCard'
import { handoffAt, type CellFact, type Computed } from '@/pages/features/shifts/houseCalTypes'
import {
  askLine, candidateTags, splitCandidates, waitingLine, type HandoffView, type TransferCandidate,
  type TransferList,
} from '@/pages/features/shifts/requestsLogic'

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

const cand = (over: Partial<TransferCandidate>): TransferCandidate => ({
  name: 'Ben Left', here: true, houses: ['BM'], regular: true, reachable: true, ok: true, code: 'ok',
  why: '', ist: 'ok', needs_training: false, ...over,
})
const LIST: TransferList = {
  location: BM, house: 'BM', col_iso: D1, value: '8A-4P', giver: 'Ann Roe',
  shift_start: '2026-10-01T08:00:00-04:00',
  approval: { readable: true, mode: 'house_manager', names: ['Hana Boss'],
              why: 'the house manager Hana Boss approves' },
  candidates: [
    cand({}),
    cand({ name: 'Cy Far', here: false, houses: ['JH'], regular: false }),
    cand({ name: 'Zoe New', here: false, houses: ['JH'], regular: false, needs_training: true, ist: 'missing',
           training: { state: 'free', may_approve: true, code: 'ok', trains: 'Hana Boss', managers: ['Hana Boss'],
                       busy: [], why: 'the house manager Hana Boss is free then and trains' } }),
    cand({ name: 'Dee Busy', here: false, houses: ['JH'], regular: false, ok: false, code: 'overlap',
           why: 'Dee Busy is already working something that overlaps the 9A-5P shift at JH on 2026-10-01' }),
    cand({ name: 'Pat Nophone', ok: false, code: 'no_contact', reachable: false,
           why: 'Pat Nophone has no phone on the staff roster or on an account, so they could not be asked' }),
  ],
  reachable_known: true, reachable_why: '', ist: { readable: true, why: '' },
}
const ask = (state: string, reached = false) => ({ state, why: state === 'no_contact' ? 'nobody by that name' : '',
                                                  at: '2026-09-30T14:00:00Z', reached })
const H: HandoffView = {
  id: 'HO0000000001', location: BM, house: 'BM', col_iso: D1, value: '8A-4P',
  from_staff: 'Ann Roe', to_staff: 'Ben Left', house_manager: 'Hana Boss', state: 'pending', why: '',
  staff_state: 'pending', staff_via: '', staff_at: '', staff_by: '',
  manager_state: 'pending', manager_via: '', manager_at: '', manager_by: '',
  director_state: 'pending', director_via: '', director_at: '', director_by: '',
  directors: ['Ty Bond', 'Lisa B. Bright'],
  created_at: '2026-09-30T13:00:00Z', closed_at: '', offered_by: 'Ann Roe', closed_by: '',
  shift_start: '2026-10-01T08:00:00-04:00',
  approval: { mode: 'house_manager', names: ['Hana Boss'], why: 'the house manager Hana Boss approves' },
  first_shift: { needed: false },
  asks: { staff: ask('told', true), manager: ask('recorded') },
  may_accept: false, may_approve: false, may_withdraw: false, mine: false,
}

describe('the names, as the relay sent them', () => {
  it('splits the ones who may take it from the ones who cannot, keeping the relay\'s order', () => {
    const { free, blocked } = splitCandidates(LIST.candidates)
    assert.deepEqual(free.map((c) => c.name), ['Ben Left', 'Cy Far', 'Zoe New'])
    assert.deepEqual(blocked.map((c) => c.name), ['Dee Busy', 'Pat Nophone'])
  })
  it('finds a name by what was typed, on both sides', () => {
    assert.deepEqual(splitCandidates(LIST.candidates, 'dee').blocked.map((c) => c.name), ['Dee Busy'])
    assert.deepEqual(splitCandidates(LIST.candidates, 'dee').free, [])
  })
  it('says where each works, and a first shift here', () => {
    assert.deepEqual(candidateTags(LIST.candidates[0], 'BM'), ['works BM'])
    assert.deepEqual(candidateTags(LIST.candidates[1], 'BM'), ['from JH'])
    assert.deepEqual(candidateTags(LIST.candidates[2], 'BM'),
                     ['from JH', 'first shift here — needs training approval'])
  })
  it('asks the candidates door for one shift, naming the giver only for somebody else\'s', () => {
    assert.equal(candidatesUrl(BM, D1), `${CANDIDATES_PATH}?location=CAN+-+BM+-+BM4060&col_iso=${D1}`)
    assert.match(candidatesUrl(BM, D1, 'Ann Roe'), /&from_staff=Ann\+Roe$/)
  })
})

describe('the picker', () => {
  const html = clean(renderToString(
    <TransferPicker location={BM} colIso={D1} dayLabel="Thu 10/1" initial={LIST}
      onOffered={noop} onCancel={noop} />))
  it('says who approves before anybody presses', () => {
    assert.match(html, /They accept, and the house manager Hana Boss approves\./)
  })
  it('draws the people who may take it as faces — buttons — and nobody who cannot', () => {
    assert.match(html, /role="option"[^>]*>.*Ben Left/)
    assert.match(html, /Cy Far/)
    assert.match(html, /first shift here — needs training approval/)
    assert.doesNotMatch(html, /role="option"[^>]*aria-selected="false"[^>]*>(?:(?!<\/button>).)*Dee Busy/)
  })
  it('keeps the ones who cannot one click away, never silently dropped', () => {
    assert.match(html, /Show the 2 who cannot take it/)
  })
  it('offers no Transfer until a name is picked', () => {
    assert.doesNotMatch(html, /Transfer to /)
  })
  it('says when who can be reached, or the IST record, could not be read', () => {
    const blind = clean(renderToString(
      <TransferPicker location={BM} colIso={D1} initial={{
        ...LIST, reachable_known: false, reachable_why: 'who can be reached could not be read (OSError)',
        ist: { readable: false, why: 'down' } }} onOffered={noop} onCancel={noop} />))
    assert.match(blind, /could not be read \(OSError\) — nobody was left out for it/)
    assert.match(blind, /every name counts as a first shift here/)
  })
  it('names whose shift it is when the house\'s editor transfers somebody else\'s', () => {
    const other = clean(renderToString(
      <TransferPicker location={BM} colIso={D1} fromStaff="Ann Roe" initial={LIST}
        onOffered={noop} onCancel={noop} />))
    assert.match(other, /Ann Roe's shift/)
  })
})

describe('a waiting transfer, with this reader\'s buttons and no others', () => {
  const card = (over: Partial<HandoffView>) => clean(renderToString(
    <HandoffCard h={{ ...H, ...over }} busy={false} onAnswer={noop} onWithdraw={noop} />))
  it('the one offered it: Accept and Pass', () => {
    const html = card({ may_accept: true })
    assert.match(html, />Accept</)
    assert.match(html, /Pass<\/button>/)
    assert.doesNotMatch(html, /Approve</)
    assert.doesNotMatch(html, /Withdraw/)
  })
  it('the approver: Approve and Not approve', () => {
    const html = card({ may_approve: true, may_withdraw: true })
    assert.match(html, />Approve</)
    assert.match(html, /Not approve/)
    assert.match(html, /Withdraw/)
    assert.doesNotMatch(html, />Accept</)
  })
  it('THE DIRECTOR: Approve and Not approve — the seat that blocks the swap has its buttons', () => {
    const html = card({ may_approve_director: true })
    assert.match(html, />Approve</)
    assert.match(html, /Not approve/)
    assert.doesNotMatch(html, />Accept</)
    assert.doesNotMatch(html, /Withdraw/)
  })
  it('the director\'s own ask is said with the others', () => {
    const html = card({ asks: { staff: ask('told', true), manager: ask('recorded'), director: ask('told', true) } })
    assert.match(html, /Ty Bond or Lisa B\. Bright was asked by text/)
    assert.doesNotMatch(card({}), /Lisa B\. Bright was asked/)
  })
  it('the giver: Withdraw only', () => {
    const html = card({ may_withdraw: true })
    assert.match(html, /Withdraw/)
    assert.doesNotMatch(html, />Accept<|>Approve</)
  })
  it('anybody else: nothing to press', () => {
    assert.doesNotMatch(card({}), /<button/)
  })
  it('says who it waits on and who approves, and what became of each text', () => {
    const html = card({})
    assert.match(html, /Waiting on Ben Left to accept and Hana Boss to approve/)
    assert.match(html, /The house manager Hana Boss approves\./)
    assert.match(html, /Ben Left was asked by text/)
    assert.match(html, /Hana Boss' text went only into the rehearsal book \(test mode\)/)
    assert.match(html, /Ref HO0000000001/)
  })
  it('a first shift there says the approval takes the training on, with who would train', () => {
    const html = card({ may_approve: true, first_shift: {
      needed: true, state: 'missing', why: 'no IST for BM',
      trainer: { state: 'busy', may_approve: false, trains: '',
                 why: 'the house manager Hana Boss is working 7A-3P at BM then (2026-10-01)' },
      request: 'SR1', request_state: 'needs_training_approval' } })
    assert.match(html, /Ben's first shift here — the house manager's training\. Approving the transfer takes it on\./)
    assert.match(html, /Hana Boss is working 7A-3P at BM then/)
  })
  it('an approval asked above says so', () => {
    const html = card({ house_manager: '', approval: { mode: 'above', names: [],
      why: 'Hana Boss manages BM and is part of this swap — nobody approves their own swap, so a director, supervisor or administrator approves' } })
    assert.match(html, /and a director, supervisor or administrator to approve/)
    assert.ok(!/team lead/.test(html), 'a team lead approves as a house manager, never as the badges above the house')
    assert.match(html, /nobody approves their own swap/)
  })
})

describe('the words for what a text came to', () => {
  it('only a text that reached them is "asked"', () => {
    assert.equal(askLine(ask('told', true), 'Ben'), 'Ben was asked by text')
    assert.match(askLine(ask('recorded'), 'Ben'), /rehearsal book/)
    assert.match(askLine(ask('dial_off'), 'Ben'), /sending is off/)
    assert.match(askLine(ask('no_contact'), 'Ben'), /could not be texted yet \(nobody by that name\) — it is tried again/)
    assert.match(askLine(ask('opted_out'), 'Ben'), /opted out of texts/)
    assert.equal(askLine({ state: '', why: '', at: '', reached: false }, 'Ben'), '')
  })
  it('who it waits on, side by side, and how it ended — all three, each from its own field', () => {
    assert.equal(waitingLine({ ...H, staff_state: 'accepted' }),
                 'Waiting on Hana Boss to approve and Ty Bond or Lisa B. Bright to approve')
    assert.equal(waitingLine({ ...H, manager_state: 'approved' }),
                 'Waiting on Ben Left to accept and Ty Bond or Lisa B. Bright to approve')
    assert.equal(waitingLine({ ...H, staff_state: 'accepted', manager_state: 'approved' }),
                 'Waiting on Ty Bond or Lisa B. Bright to approve')
    assert.equal(waitingLine({ ...H, staff_state: 'accepted', manager_state: 'approved',
                               director_state: 'approved',
                               why: 'the IST record could not be read - the swap waits' }),
                 'All three agreed — the IST record could not be read - the swap waits')
    // a swap opened while the directors list named nobody says what its director seat waits for
    assert.equal(waitingLine({ ...H, staff_state: 'accepted', manager_state: 'approved', directors: [],
                               why: 'no director has been asked to approve this swap yet: Settings -> Time Off\'s ' +
                                    'directors list names nobody' }),
                 'Waiting on the director to approve — no director has been asked to approve this swap yet: ' +
                 'Settings -> Time Off\'s directors list names nobody')
    assert.equal(waitingLine({ ...H, state: 'done' }), 'Done — Ben Left has the shift')
    assert.equal(waitingLine({ ...H, state: 'dead', why: 'withdrawn by Ann Roe' }), 'Ended — withdrawn by Ann Roe')
  })
  it('the waiting transfer on a cell is the giver\'s, that day, still pending', () => {
    assert.equal(handoffAt([H], 'ann  roe', D1)?.id, 'HO0000000001')
    assert.equal(handoffAt([H], 'Ben Left', D1), undefined)
    assert.equal(handoffAt([{ ...H, state: 'dead' }], 'Ann Roe', D1), undefined)
  })
})

describe('the House Calendars panel', () => {
  const fact = (over: Partial<CellFact> = {}): CellFact => ({
    employee: 'Ann Roe', col_iso: D1, raw: '8A-4P', kind: 'day', code: '8A-4P', start: 8, end: 16,
    token: null, hours: 8, overnight: false, edited: false, state: 'upcoming', ...over,
  })
  const computed: Computed = {
    cells: {}, people: [], days: [], conflicts: [], open_shifts: [],
    window: { first: '2026-09-26', last: '2026-10-09', days: 14, covers_today: true, today: '2026-09-30' },
    weekly_ot_hours: 40, totals: { hours: 8, shifts: 1, people: 1, open: 0 },
  }
  const panel = (over: Partial<Parameters<typeof ShiftCellPanel>[0]> = {}) => clean(renderToString(
    <ShiftCellPanel target={{ employee: 'Ann Roe', colIso: D1, label: 'Thu 10/1' }} house={BM}
      text="8A-4P" fact={fact()} computed={computed} saving={false} staff={['Ann Roe', 'Ben Left']}
      mayEdit={false} openRow={false} me="Ann Roe" onClaim={noop} onOpenRequests={noop}
      onClose={noop} {...over} />))
  it('a person\'s own upcoming shift offers Transfer — one click opens the names', () => {
    const html = panel()
    assert.match(html, /Transfer this shift/)
    assert.match(html, /Pick who takes it/)
  })
  it('never a shift that has started or passed', () => {
    assert.doesNotMatch(panel({ fact: fact({ state: 'in_progress' }) }), /Transfer this shift/)
    assert.doesNotMatch(panel({ fact: fact({ state: 'past' }) }), /Transfer this shift/)
  })
  it('never somebody else\'s — unless the reader edits the house, and then it says whose', () => {
    const other = { target: { employee: 'Ben Left', colIso: D1, label: 'Thu 10/1' } }
    assert.doesNotMatch(panel(other), /Transfer this shift/)
    assert.match(panel({ ...other, mayEdit: true, me: 'Hana Boss' }), /Pick who takes Ben's shift/)
  })
  it('a transfer already waiting on the cell is drawn instead of a new one, with the reader\'s buttons', () => {
    const html = panel({ handoffs: [{ ...H, may_withdraw: true }] })
    assert.doesNotMatch(html, /Transfer this shift/)
    assert.match(html, /Ann Roe<\/span> is giving the/)
    assert.match(html, /Withdraw/)
    assert.doesNotMatch(html, />Approve</)
  })
  it('the Builder offers no transfer', () => {
    assert.doesNotMatch(panel({ mode: 'builder', editor: <p>EDITOR</p> }), /Transfer this shift/)
  })
})

describe('as source — no screen sends a side, a giver it may not, or a house manager', () => {
  const root = process.env.SPA_ROOT ?? process.cwd()
  const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
  const picker = read('src/pages/features/shifts/TransferPicker.tsx')
  const waiting = read('src/pages/features/shifts/HandoffWaiting.tsx')
  const requests = read('src/pages/features/shifts/ShiftRequestsPage.tsx')
  const page = read('src/pages/features/calendarbuilder/LiveView.tsx')
  const logic = read('src/pages/features/shifts/requestsLogic.ts')
  const actions = read('src/pages/features/shifts/handoffActions.ts')
  it('the offer posts the shift and the name picked — the giver only for somebody else\'s', () => {
    assert.match(picker, /location, col_iso: colIso, to_staff: picked\.name, \.\.\.\(fromStaff \? \{ from_staff: fromStaff \} : \{\}\)/)
    assert.doesNotMatch(picker + waiting + actions, /house_manager/)
    assert.doesNotMatch(requests + page, /'\/erp-lanes\/shift-handoff[^']*',\s*\{[^}]*house_manager/)
  })
  it('no answer carries a side — the relay works it out from the session', () => {
    assert.doesNotMatch(requests + waiting + page + actions, /side: can\.answerSwap|side,\s*word|, side:/)
    assert.match(actions, /post<HandoffView>\(ANSWER_PATH, \{ handoff_id: h\.id, word: act \}\)/)
    assert.match(actions, /post<HandoffView>\(WITHDRAW_PATH, \{ handoff_id: h\.id \}\)/)
    assert.match(actions, /ANSWER_PATH = '\/erp-lanes\/shift-handoff\/answer'/)
    assert.match(actions, /WITHDRAW_PATH = '\/erp-lanes\/shift-handoff\/withdraw'/)
  })
  it('the swap buttons follow the relay\'s flags, never a name compared on the screen', () => {
    assert.match(logic, /if \(row\.may_accept\) answerSwap = 'staff'/)
    assert.match(logic, /else if \(row\.may_approve\) answerSwap = 'manager'/)
    assert.doesNotMatch(logic, /row\.house_manager\?\.toLowerCase\(\) === me/)
  })
  it('ONLY THE ONE TAKING THE SHIFT ACCEPTS IT: a director is offered Approve, never Accept', () => {
    assert.match(requests, /can\.answerSwap === 'staff' \? 'Accept' : 'Approve'/)
    assert.match(requests, /can\.answerSwap === 'staff' \? 'Shift accepted' : 'Transfer approved'/)
    assert.doesNotMatch(requests, /can\.answerSwap === 'manager' \? 'Approve' : 'Accept'/)
  })
  it('every line that says who a swap waits on is handed the DIRECTOR\'s field too', () => {
    const detail = read('src/pages/features/shifts/requestDetail.ts')
    for (const src of [requests, detail]) {
      const calls = src.match(/waitingLine\(\{[\s\S]*?\}\)/g) ?? []
      assert.ok(calls.length)
      for (const call of calls) {
        assert.match(call, /director_state/)
        assert.match(call, /directors: /)
      }
    }
  })
  it('an answer the relay did not record is never toasted as done, on any of the three screens', () => {
    const swaps = read('src/pages/features/shifts/ShiftSwapsPage.tsx')
    for (const src of [requests, swaps]) {
      assert.match(src, /got\.changed === false/)
      assert.match(src, /Nothing was recorded/)
    }
    assert.match(actions, /res\.changed === false/)
    assert.match(actions, /Nothing was recorded/)
  })
  it('Requests carries Transfer on the reader\'s own shifts, and Withdraw on their transfers', () => {
    assert.match(requests, /id: 'shifts', label:/)
    assert.match(requests, /<TransferPicker location=\{s\.location\}/)
    assert.match(requests, /can\.withdrawSwap/)
    assert.match(requests, /act\(r\.id, WITHDRAW_PATH,/)
  })
  it('House Calendars hands the panel the transfers the relay sent for this house', () => {
    assert.match(page, /handoffs=\{grid\?\.handoffs\}/)
    assert.match(page, /grid\.handoffs_why/)
  })
  it('THE CARD ON CALENDAR BUILDER → LIVE draws the director\'s buttons from the relay\'s flag', () => {
    const handoffCard = read('src/pages/features/shifts/HandoffCard.tsx')
    assert.match(handoffCard, /h\.may_accept \|\| h\.may_approve \|\| h\.may_approve_director \|\| h\.may_withdraw/)
    assert.match(handoffCard, /h\.may_accept \|\| h\.may_approve \|\| h\.may_approve_director\) && \(/)
    assert.match(handoffCard, /askLine\(h\.asks\?\.director,/)
  })
  it('no browser dialog anywhere on this road', () => {
    for (const src of [picker, waiting, requests, page, actions, read('src/pages/features/shifts/HandoffCard.tsx')]) {
      assert.doesNotMatch(src, /window\.(confirm|alert|prompt)/)
    }
  })
})
