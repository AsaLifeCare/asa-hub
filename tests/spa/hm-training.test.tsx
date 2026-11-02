/**
 * The trainer-must-be-free rule, screen side: the TrainingNote line and Approve drawn disabled when refused.
 * The server side is tools/test-hm-training.py.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import ShiftCellPanel from '@/pages/features/shifts/ShiftCellPanel'
import TrainingNote from '@/pages/features/shifts/TrainingNote'
import type { Computed, OpenShift } from '@/pages/features/shifts/houseCalTypes'
import {
  actionsFor, approveBlockedBy, codeOf, trainingLine, trainingTone, type RequestRow, type Training,
} from '@/pages/features/shifts/requestsLogic'

const BM = 'CAN - BM - BM4060'
const D1 = '2026-10-01'

const busy: Training = {
  state: 'busy', may_approve: false, code: 'trainer_busy', trains: '', managers: ['Hana Boss'],
  busy: [{ name: 'Hana Boss', house: 'BM', col_iso: D1, value: '7A-3P', source: 'roster',
           line: 'Hana Boss is working 7A-3P at BM then (2026-10-01)' }],
  why: 'the house manager Hana Boss is working 7A-3P at BM then (2026-10-01) — a first shift in a house is the house manager\'s training, so it cannot be approved until they are free',
}
const free: Training = {
  state: 'free', may_approve: true, code: 'ok', trains: 'Hana Boss', managers: ['Hana Boss'],
  busy: [], why: 'the house manager Hana Boss is free then and trains',
}
const above: Training = {
  state: 'above', may_approve: false, code: 'trainer_unnamed', trains: '', managers: [], busy: [],
  why: 'no house manager is on file for MK, so a director, supervisor or administrator approves — and whoever approves trains, so they must be free then',
}
const aboveFree: Training = {
  state: 'above_free', may_approve: true, code: 'ok', trains: 'Dan Director', managers: [], busy: [],
  why: 'no house manager is on file for MK, so Dan Director trains — and is free then',
}
const unreadable: Training = {
  state: 'unreadable', may_approve: false, code: 'trainer_unreadable', trains: '', managers: [],
  busy: [], why: 'who manages BM could not be read (the mirror is down), so nobody can be shown to be free to train then — the training cannot be approved until it can',
}
const noHours: Training = { ...free, state: 'not_a_shift', why: 'the shift carries no hours, so there is no training time to weigh' }

describe('the relay\'s answer, as one line in its own tone', () => {
  it('the sentence starts with a capital and ends with a stop', () => {
    assert.equal(trainingLine(free), 'The house manager Hana Boss is free then and trains.')
    assert.match(trainingLine(busy), /^The house manager Hana Boss is working 7A-3P at BM then/)
    assert.match(trainingLine(busy), /until they are free\.$/)
  })
  it('a lead in front keeps the sentence in its own lower case', () => {
    assert.equal(trainingLine(free, 'A first shift here is a training:'),
      'A first shift here is a training: the house manager Hana Boss is free then and trains.')
  })
  it('free is green, refused is red, nobody named is amber, no hours is nothing', () => {
    assert.equal(trainingTone(free), 'ok')
    assert.equal(trainingTone(aboveFree), 'ok')
    assert.equal(trainingTone(busy), 'blocked')
    assert.equal(trainingTone(unreadable), 'blocked')
    assert.equal(trainingTone(above), 'open')
    assert.equal(trainingTone(noHours), '')
    assert.equal(trainingTone(undefined), '')
    assert.equal(trainingLine(undefined), '')
  })
  it('APPROVE is blocked exactly when the relay would refuse it — with its sentence', () => {
    assert.match(approveBlockedBy({ training: busy }), /Hana Boss is working 7A-3P at BM then/)
    assert.match(approveBlockedBy({ training: unreadable }), /could not be read/)
    assert.equal(approveBlockedBy({ training: free }), '')
    assert.equal(approveBlockedBy({ training: aboveFree }), '')
    assert.equal(approveBlockedBy({ training: above }), '', 'nobody named yet is not a refusal of THIS reader')
    assert.equal(approveBlockedBy({}), '')
  })
  it('the state words are the relay\'s own', () => {
    const root = process.env.SPA_ROOT ?? process.cwd()
    const server = readFileSync(resolve(root, 'server/shift_requests.py'), 'utf8')
    for (const [name, word] of [['TRAINING_FREE', 'free'], ['TRAINING_BUSY', 'busy'],
      ['TRAINING_ABOVE_FREE', 'above_free'], ['TRAINING_ABOVE_BUSY', 'above_busy'],
      ['TRAINING_ABOVE', 'above'], ['TRAINING_UNREADABLE', 'unreadable'],
      ['TRAINING_NO_HOURS', 'not_a_shift']]) {
      assert.match(server, new RegExp(`${name} = "${word}"`), name)
    }
  })
})

describe('the line, drawn', () => {
  const draw = (t?: Training, lead?: string) =>
    renderToString(<TrainingNote training={t} lead={lead} />).replace(/<!-- -->/g, '')
  it('a busy house manager is said in red', () => {
    const html = draw(busy)
    assert.match(html, /data-training="blocked"/)
    assert.match(html, /text-danger/)
    assert.match(html, /The house manager Hana Boss is working 7A-3P at BM then/)
  })
  it('a free one in green, naming who trains', () => {
    const html = draw(free)
    assert.match(html, /data-training="ok"/)
    assert.match(html, /Hana Boss is free then and trains/)
  })
  it('MK: whoever approves trains, said in amber to a reader who does not approve', () => {
    const html = draw(above)
    assert.match(html, /data-training="open"/)
    assert.match(html, /whoever approves trains/)
  })
  it('nothing at all when there is no training to speak of', () => {
    assert.equal(draw(undefined), '')
    assert.equal(draw(noHours), '')
  })
})

/* ── the House Calendars panel ──────────────────────────────────────────── */

const noop = () => {}
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

const win = { kind: 'open_shift', opens_at: '2026-09-30T15:00:00Z', closes_at: '2026-09-30T15:10:00Z',
  state: 'closed', seconds_left: 0, reserved: true, why: 'reserved for this house\'s own staff for 10 minutes' }

const shiftOf = (over: Partial<OpenShift> = {}): OpenShift => ({
  key: `OPEN|${D1}`, location: BM, open_row: 'OPEN', col_iso: D1, raw: '8A-4P', code: '8A-4P',
  start: 8, end: 16, hours: 8, kind: 'day', overnight: false,
  claimed_by: null, claimed_via: null, claimed_at: null, starts_at: '2026-10-01T08:00:00-04:00',
  started: false, window: win, pool_state: 'closed', applicants: 1, kind_of_open: 'open_shift',
  ref: 'SPOPEN0001', ...over,
})

const computedWith = (shifts: OpenShift[]): Computed => ({
  cells: {}, people: [], days: [], conflicts: [], open_shifts: shifts,
  window: { first: '2026-09-26', last: '2026-10-09', days: 14, covers_today: true, today: '2026-09-30' },
  weekly_ot_hours: 40, totals: { hours: 0, shifts: 0, people: 0, open: shifts.length },
})

function panel(shift: OpenShift, mayEdit: boolean, me = 'Hana Boss'): string {
  return renderToString(
    <ShiftCellPanel
      target={{ employee: 'OPEN', colIso: D1, label: 'Thu 10/1', ref: shift.ref }}
      house={BM} text="8A-4P" fact={undefined} computed={computedWith([shift])} saving={false}
      openShift={shift} staff={['Ann Roe', 'Zoe New']} mayEdit={mayEdit} openRow me={me}
      onClaim={noop} onOpenRequests={noop} onClose={noop}
    />,
  ).replace(/<!-- -->/g, '')
}

const zoe = { id: 'SR1', person: 'Zoe New', state: 'needs_training_approval', why: '', via: 'app',
  at: '2026-09-30T15:02:00Z', week_hours: 0, ist_ok: false }

describe('the panel, for the house\'s editor', () => {
  it('an applicant with no IST is a training — and "Give it to" is disabled while the manager works', () => {
    const html = panel(shiftOf({ applicant_list: [{ ...zoe, training: busy }], training: busy }), true)
    assert.match(html, /No IST for this house — choosing them takes the training on/)
    assert.match(html, /The house manager Hana Boss is working 7A-3P at BM then/)
    assert.match(html, /<button[^>]*disabled=""[^>]*title="The house manager Hana Boss is working 7A-3P[^"]*"[^>]*>Give it to Zoe/)
  })
  it('once the manager is free, the same button is live and says who trains', () => {
    const html = panel(shiftOf({ applicant_list: [{ ...zoe, training: free }], training: free }), true)
    assert.match(html, /Hana Boss is free then and trains/)
    assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>Give it to Zoe/)
    assert.match(html, /Give it to Zoe/)
  })
  it('a trained applicant carries no training line at all', () => {
    const html = panel(shiftOf({ applicant_list: [{ ...zoe, state: 'applied', ist_ok: true }] }), true)
    assert.doesNotMatch(html, /No IST for this house/)
    assert.doesNotMatch(html, /data-training=/)
  })
  it('under the shift, for whoever they might assign, who would train a first shift here', () => {
    const html = panel(shiftOf({ applicant_list: [], training: busy }), true)
    assert.match(html, /Somebody with no IST for this house is a first shift here, which is a training: the house manager Hana Boss is working 7A-3P/)
  })
})

describe('the panel, for a member of staff whose application is a training', () => {
  it('before applying: the IST sentence and whether the manager is free then — Apply still offered', () => {
    const html = panel(shiftOf({
      pool_state: 'open', window: { ...win, state: 'open' },
      mine: { may: true, code: 'ok', why: '', ist: { ok: false, why: 'no IST for BM — nothing on file' } },
      training: busy,
    }), false, 'Zoe New')
    assert.match(html, /Your application becomes a training approval/)
    assert.match(html, /The house manager Hana Boss is working 7A-3P at BM then/)
    assert.match(html, /Apply for this shift/)
    assert.doesNotMatch(html, /Give it to/)
  })
  it('after applying: waiting on the training, and the same line', () => {
    const html = panel(shiftOf({
      mine: { may: false, code: 'applied', why: 'they applied', request_id: 'SR1', state: 'needs_training_approval' },
      training: free,
    }), false, 'Zoe New')
    assert.match(html, /It waits on the house manager to take the training on first/)
    assert.match(html, /Hana Boss is free then and trains/)
  })
})

/* ── Requests ───────────────────────────────────────────────────────────── */

describe('Requests — who may press Approve is still the badge; whether it is live is the trainer', () => {
  const hm = { me: 'Hana Boss', manages: ['BM4060'], badges: ['HM'] }
  const row = (over: Partial<RequestRow> = {}): RequestRow => ({
    id: 'SR1', kind: 'ist_approval', at: '', house: 'BM', location: BM, col_iso: D1, shift: '8A-4P',
    person: 'Zoe New', state: 'needs_training_approval', why: '', via: 'app', decided_by: '',
    decided_at: '', mine: false, visible: true, ...over,
  })
  it('the house manager is offered the training button, and it is blocked while they work', () => {
    const r = row({ training: busy, may_approve: false })
    assert.equal(actionsFor(r, hm, codeOf).training, true)
    assert.match(approveBlockedBy(r), /Hana Boss is working 7A-3P/)
  })
  it('an application with no IST: Approve drawn, and blocked on the same answer', () => {
    const r = row({ kind: 'open_shift', state: 'applied', training: busy, may_approve: false })
    assert.equal(actionsFor(r, hm, codeOf).decide, true)
    assert.notEqual(approveBlockedBy(r), '')
  })
  it('as source: every Approve on the screen asks it, and the line is drawn on every row', () => {
    const root = process.env.SPA_ROOT ?? process.cwd()
    const page = readFileSync(resolve(root, 'src/pages/features/shifts/ShiftRequestsPage.tsx'), 'utf8')
    assert.equal((page.match(/disabled=\{busy === (?:r|a)\.id \|\| Boolean\(blocked\)/g) ?? []).length, 3,
      'the decide and training buttons on a row, and the Approve beside each applicant')
    // …and the Approve beside an applicant also waits for the window to run out
    assert.match(page, /disabled=\{busy === a\.id \|\| Boolean\(blocked\) \|\| s\.state === 'open'\}/)
    assert.match(page, /const blocked = approveBlockedBy\(r\)/)
    assert.match(page, /const blocked = approveBlockedBy\(a\)/)
    assert.match(page, /<TrainingNote training=\{r\.training\}/)
    assert.match(page, /<TrainingNote training=\{a\.training\}/)
    assert.match(page, /<TrainingNote training=\{o\.training\}/)
    assert.match(page, /r\.trainer \? `\$\{r\.trainer\} trains`/)
    assert.doesNotMatch(page, /window\.(confirm|alert|prompt)\(/)
  })
  it('as source: the panel blocks "Give it to" on the same answer', () => {
    const root = process.env.SPA_ROOT ?? process.cwd()
    const src = readFileSync(resolve(root, 'src/pages/features/shifts/ShiftCellPanel.tsx'), 'utf8')
    assert.match(src, /disabled=\{saving \|\| Boolean\(blocked\) \|\| windowOpen\}\s*title=\{blocked \|\|/)
    assert.match(src, /<TrainingNote training=\{shift\.training\}/)
  })
  it('as source: House Calendars says who trains when it gives a first shift, and when one applies', () => {
    const root = process.env.SPA_ROOT ?? process.cwd()
    const page = readFileSync(resolve(root, 'src/pages/features/calendarbuilder/LiveView.tsx'), 'utf8')
    assert.match(page, /const trains = res\.trainer\?\.name \|\| res\.training\?\.trains/)
    assert.match(page, /it is a training: \$\{trains\} trains/)
    assert.match(page, /const who = trainingLine\(res\.training\)/)
  })
})
