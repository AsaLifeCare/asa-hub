/**
 * A call-off on the calendar, screen side: the panel per reader, the links to one shift, the kept sign-in link,
 * and the shared open-shifts read. The server side is tools/test-calloff-open-shift.py.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import ShiftCellPanel from '@/pages/features/shifts/ShiftCellPanel'
import {
  HOUSECAL_LIVE_EVENT, callOffsAhead, followTarget, houseCalLink, houseCode, linkForCallOff,
  linkForShift, matchCallOff, nextWindowClose, openAction, resolveHouse, rowNamed,
  type Computed, type OpenShift, type Row,
} from '@/pages/features/shifts/houseCalTypes'
import { forgetReturn, isReturnPath, rememberReturn, returnPath } from '@/lib/returnTo'
import { useOpenShifts } from '@/pages/features/shifts/useOpenShifts'
import { useAuthStore } from '@/auth/useAuthStore'
import { mountHook } from './react-host'

const BM = 'CAN - BM - BM4060'
const LINE = 'OPEN · call-off'
const D1 = '2026-09-30'
const NOW = Date.parse('2026-09-29T16:00:00Z')

const win = { kind: 'call_off', opens_at: '2026-09-29T15:00:00Z', closes_at: '2026-09-29T20:00:00Z',
  state: 'open', seconds_left: 14400, reserved: false, why: 'open to all staff for 5 hours from the call-off' }

const callOff = (over: Partial<OpenShift> = {}): OpenShift => ({
  key: `${LINE}|${D1}`, location: BM, open_row: LINE, col_iso: D1, raw: '8P-8A', code: '8P-8A',
  start: 20, end: 32, hours: 12, kind: 'overnight', overnight: true,
  claimed_by: null, claimed_via: null, claimed_at: null, starts_at: '2026-09-30T20:00:00-04:00', started: false,
  window: win, pool_state: 'open', applicants: 1, kind_of_open: 'call_off', ref: 'SPCALLOFF01',
  address: '4060 Birch Mill Rd',
  mine: { may: true, code: 'ok', why: 'open to them', ist: { ok: true, state: 'ok', why: 'trained at BM' } },
  ...over,
})

const computedWith = (shifts: OpenShift[]): Computed => ({
  cells: {}, people: [], days: [], conflicts: [], open_shifts: shifts,
  window: { first: '2026-09-26', last: '2026-10-09', days: 14, covers_today: true, today: '2026-09-29' },
  weekly_ot_hours: 40, totals: { hours: 0, shifts: 0, people: 0, open: shifts.length },
})

describe('what the panel offers on an open shift — the relay\'s words, drawn', () => {
  it('a member of staff inside the window, eligible, may apply', () => {
    assert.deepEqual(openAction(callOff(), false), { kind: 'apply', training: '' })
  })
  it('without an IST, the apply still stands — and says it becomes a training approval', () => {
    const got = openAction(callOff({ mine: { may: true, code: 'ok', why: '', ist: { ok: false, why: 'no IST for BM' } } }), false)
    assert.deepEqual(got, { kind: 'apply', training: 'no IST for BM' })
  })
  it('once applied, the panel offers the withdrawal of THAT application', () => {
    const got = openAction(callOff({ mine: { may: false, code: 'applied', why: 'they applied', request_id: 'SR9' } }), false)
    assert.deepEqual(got, { kind: 'applied', requestId: 'SR9', why: 'they applied' })
  })
  it('a rule that says no says it in its own sentence', () => {
    const why = 'they are already working something that overlaps the 8P-8A shift at JH on 2026-09-30'
    assert.deepEqual(openAction(callOff({ mine: { may: false, code: 'overlap', why } }), false), { kind: 'blocked', why })
  })
  it('no answer about this reader is not "no" — it says why the button is missing', () => {
    const pooled = openAction(callOff({ mine: undefined }), false)
    const early = openAction(callOff({ mine: undefined, pool_state: undefined }), false)
    assert.equal(pooled.kind, 'blocked')
    assert.match(pooled.kind === 'blocked' ? pooled.why : '', /could not be worked out/)
    assert.match(early.kind === 'blocked' ? early.why : '', /not open for applications yet/)
  })
  it('the house\'s editor assigns; a taken or started shift is offered to nobody', () => {
    assert.deepEqual(openAction(callOff(), true), { kind: 'assign' })
    assert.deepEqual(openAction(callOff({ claimed_by: 'Cy Far', claimed_via: 'approved' }), true),
      { kind: 'taken', by: 'Cy Far', how: 'applied and approved' })
    assert.deepEqual(openAction(callOff({ started: true }), false), { kind: 'started' })
  })
})

describe('the roads to one shift', () => {
  it('a link names the house and the shift by its handle — the handle names nobody', () => {
    assert.equal(linkForShift(callOff()), '/app/calendarbuilder/house-cal?house=CAN%20-%20BM%20-%20BM4060&ref=SPCALLOFF01')
    assert.equal(linkForShift({ location: BM, key: `OPEN|${D1}` }),
      '/app/calendarbuilder/house-cal?house=CAN%20-%20BM%20-%20BM4060&open=OPEN%7C2026-09-30')
    assert.equal(houseCalLink('', { ref: 'SP1' }), '/app/calendarbuilder/house-cal?ref=SP1')
  })
  it('a house named by its code opens the house the rail spells', () => {
    const houses = [{ location: BM, staff: 5, updated_at: '' }, { location: 'CAN - 48TH (B) - ABD1711', staff: 7, updated_at: '' }]
    assert.equal(houseCode(BM), 'BM4060')
    assert.equal(resolveHouse(houses, 'bm4060'), BM)
    assert.equal(resolveHouse(houses, 'CAN - 48TH (B) - ABD1711'), 'CAN - 48TH (B) - ABD1711')
    assert.equal(resolveHouse(houses, 'ZZ0000'), '')
  })
  it('a person is found by the grid\'s own spelling, and never on a row that is nobody', () => {
    const rows: Row[] = [
      { employee: 'OPEN', cells: [], open_row: true },
      { employee: LINE, cells: [], open_row: true, call_off_row: true },
      { employee: 'Ann Roe', cells: [] },
    ]
    assert.equal(rowNamed(rows, 'ann  roe')?.employee, 'Ann Roe')
    assert.equal(rowNamed(rows, 'OPEN')?.employee, 'OPEN')
    assert.equal(rowNamed(rows, 'open · call off'), undefined)
  })
  it('the panel follows its shift when a re-read renumbers the line it is drawn on', () => {
    const target = { employee: `${LINE} 2`, colIso: D1, label: 'Wed', ref: 'SPCALLOFF01' }
    const moved = followTarget(target, computedWith([callOff()]))
    assert.deepEqual(moved, { ...target, employee: LINE })
    const plain = { employee: 'Ann Roe', colIso: D1, label: 'Wed' }
    assert.equal(followTarget(plain, computedWith([callOff()])), plain)
    assert.equal(followTarget(null, computedWith([])), null)
  })
  it('the grid re-reads when the first open window closes, and not for a taken one', () => {
    const later = callOff({ ref: 'SP2', window: { ...win, closes_at: '2026-09-29T21:00:00Z' } })
    const taken = callOff({ ref: 'SP3', claimed_by: 'Cy Far', window: { ...win, closes_at: '2026-09-29T16:30:00Z' } })
    assert.equal(nextWindowClose(computedWith([later, callOff(), taken]), NOW), 4 * 3600 * 1000)
    assert.equal(nextWindowClose(computedWith([taken]), NOW), null)
  })
  it('the Desk\'s "Call-offs today" row opens its red cell — or the caller\'s own cell before the pool has met it', () => {
    const shifts = [callOff({ called_off_by: 'Ann Roe' })]
    const row = { house: 'BM4060', day: D1, person: 'ann roe' }
    assert.equal(matchCallOff(shifts, row)?.ref, 'SPCALLOFF01')
    assert.equal(linkForCallOff(shifts, row), linkForShift(shifts[0]))
    assert.equal(linkForCallOff([callOff()], row),
      '/app/calendarbuilder/house-cal?house=BM4060&open=ann%20roe%7C2026-09-30')
  })
  it('the call-offs still ahead — tomorrow\'s and later, nearest first, and only call-offs', () => {
    const got = callOffsAhead([
      callOff({ ref: 'A', col_iso: '2026-10-02' }), callOff({ ref: 'B', col_iso: '2026-09-29' }),
      callOff({ ref: 'C', col_iso: '2026-09-30' }), callOff({ ref: 'D', col_iso: '2026-10-01', kind_of_open: 'open_shift' }),
    ], '2026-09-29')
    assert.deepEqual(got.map((s) => s.ref), ['C', 'A'])
  })
  it('the ring the screens listen for is the relay\'s name', () => {
    assert.equal(HOUSECAL_LIVE_EVENT, 'housecal')
  })
})

describe('a signed-out link survives the sign-in', () => {
  beforeEach(() => forgetReturn())
  it('only a platform page is ever kept or followed — the Shift Board\'s old address too, which redirects', () => {
    assert.equal(isReturnPath('/app/shiftboard/house-cal?ref=SP1'), true)
    assert.equal(isReturnPath('/app/calendarbuilder/house-cal?ref=SP1'), true)
    for (const bad of ['https://evil.test/app/x', '//evil.test/app', '/login', '', null, '/app\\x']) {
      assert.equal(isReturnPath(bad), false, String(bad))
    }
  })
  it('the router state is followed first', () => {
    rememberReturn('/app/overview/home')
    assert.equal(returnPath({ from: '/app/shiftboard/house-cal?ref=SP1' }), '/app/shiftboard/house-cal?ref=SP1')
  })
  it('what the guard kept carries a reload of the login page, for a while, and once', () => {
    rememberReturn('/app/shiftboard/house-cal?house=BM4060&ref=SP1')
    assert.equal(returnPath(null), '/app/shiftboard/house-cal?house=BM4060&ref=SP1')
    assert.equal(returnPath(null, Date.now() + 16 * 60 * 1000), null)
    forgetReturn()
    assert.equal(returnPath(null), null)
  })
  it('an outside address handed to the guard is not kept', () => {
    rememberReturn('https://evil.test/app/x')
    assert.equal(returnPath({ from: 'https://evil.test/app/x' }), null)
  })
})

/* ── the panel, drawn whole ─────────────────────────────────────────────── */

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

function panel(shift: OpenShift, mayEdit: boolean, over: Partial<Parameters<typeof ShiftCellPanel>[0]> = {}): string {
  return renderToString(
    <ShiftCellPanel
      target={{ employee: LINE, colIso: D1, label: 'Wed 9/30', ref: shift.ref }}
      house={BM} text="8P-8A" fact={undefined} computed={computedWith([shift])} saving={false}
      openShift={shift} staff={['Ann Roe', 'Ben Left', 'Cy Far']} mayEdit={mayEdit} openRow me="Ben Left"
      onClaim={noop} onOpenRequests={noop} onClose={noop}
      {...over}
    />,
  ).replace(/<!-- -->/g, '')
}

describe('the red square\'s panel, for a member of staff', () => {
  // drawn inside each test, after the window's listeners are in place
  let html = ''
  before(() => { html = panel(callOff(), false) })
  it('says the shift — house, day, hours and street — and that somebody called off', () => {
    assert.match(html, /BM · Wed 9\/30/)
    assert.match(html, /8:00 PM – 8:00 AM/)
    assert.match(html, /12h · overnight/)
    assert.match(html, /4060 Birch Mill Rd/)
    assert.match(html, /A shift somebody called off/)
  })
  it('never says who called off, and never the reason', () => {
    assert.doesNotMatch(html, /Called off by/)
    assert.doesNotMatch(html, /Ann Roe called off/)
    assert.doesNotMatch(html, /reason/i)
  })
  it('APPLY is the button, with the window and the house manager\'s decision said', () => {
    assert.match(html, /Apply for this shift/)
    assert.match(html, /Applications close at/)
    assert.match(html, /the shift is not yours yet/)
    assert.doesNotMatch(html, /Assign this shift|Give it to/)
  })
  it('an application that needs an IST says so before it is pressed', () => {
    const t = panel(callOff({ mine: { may: true, code: 'ok', why: '', ist: { ok: false, why: 'no IST for BM — nothing on file' } } }), false)
    assert.match(t, /no IST for BM — nothing on file\. Your application becomes a training approval/)
  })
  it('once applied, it offers the withdrawal', () => {
    const a = panel(callOff({ mine: { may: false, code: 'applied', why: 'they applied', request_id: 'SR9', state: 'applied' } }), false)
    assert.match(a, /You applied\./)
    assert.match(a, /Withdraw my application/)
    assert.doesNotMatch(a, /Apply for this shift/)
  })
  it('a rule that says no is read, not pressed', () => {
    const b = panel(callOff({ mine: { may: false, code: 'window_closed', why: 'applications for this shift have closed' } }), false)
    assert.match(b, /Not open to you now/)
    assert.match(b, /applications for this shift have closed/)
    assert.doesNotMatch(b, /Apply for this shift/)
  })
})

describe('the red square\'s panel, for the house\'s manager', () => {
  const shift = callOff({
    called_off_by: 'Ann Roe',
    applicant_list: [
      { id: 'SR1', person: 'Cy Far', state: 'applied', why: '', via: 'app', at: '2026-09-29T15:05:00Z', week_hours: 12 },
      { id: 'SR2', person: 'Dee Way', state: 'needs_training_approval', why: 'no IST', via: 'app', at: '2026-09-29T15:07:00Z', week_hours: 36 },
    ],
  })
  let html = ''
  before(() => { html = panel(shift, true) })
  it('names who called off — to them', () => {
    assert.match(html, /Called off by <span[^>]*>Ann Roe<\/span>/)
  })
  it('while applications are open the decision waits: "Give it to" and Assign are drawn disabled, '
    + 'saying until when', () => {
    assert.match(html, /<button[^>]*disabled=""[^>]*title="Applications are open until [^"]*the decision is yours when they close"[^>]*>Give it to Cy/)
    assert.match(html, /the decision is yours when they close\./)
    assert.doesNotMatch(html, /you may decide now or wait/)
  })
  it('lists who applied, earliest first, each with a button that gives them the shift', () => {
    assert.ok(html.indexOf('Cy Far') < html.indexOf('Dee Way'))
    assert.match(html, /Give it to Cy/)
    assert.match(html, /12h that week/)
    assert.match(html, /choosing them takes the training on/)
  })
  it('and can assign somebody who did not apply — never the applicants twice, never an OPEN row', () => {
    assert.match(html, /Or assign somebody who did not apply/)
    assert.match(html, /Assign this shift/)
    assert.doesNotMatch(html, /<option value="Cy Far"/)
    assert.doesNotMatch(html, /<option value="OPEN/)
    assert.match(html, /Me — Ben Left/)
  })
  it('the caption says what the decision does, and promises nothing it does not do', () => {
    assert.match(html, /marks anybody else who applied as not chosen/)
    assert.doesNotMatch(html, /tells the people who applied/)
  })
  it('a call-off line cell with nothing on it any more is written by nobody — the line is a drawing', () => {
    const gone = panel(callOff(), true, { openShift: undefined, text: '', callOffLine: true })
    assert.match(gone, /no longer open here/)
    assert.doesNotMatch(gone, /placeholder="8A-8P/)
    assert.doesNotMatch(gone, /put up as an open shift/)
  })
  it('the caller\'s own C/O cell points at the red square', () => {
    const cell = renderToString(
      <ShiftCellPanel
        target={{ employee: 'Ann Roe', colIso: D1, label: 'Wed 9/30' }}
        house={BM} text="C/O" fact={undefined} computed={computedWith([shift])} saving={false}
        staff={['Ann Roe', 'Ben Left']} mayEdit openRow={false} me="Hana Boss"
        calledOff={{ ref: 'SPCALLOFF01', value: '8P-8A', state: 'open', filled_by: '' }}
        onClaim={noop} onOpenRequests={noop} onClose={noop}
      />,
    ).replace(/<!-- -->/g, '')
    assert.match(cell, /Ann Roe called off 8P-8A/)
    assert.match(cell, /Open the red cell/)
  })
})

/* ── the shared read the Desk's cards draw from ─────────────────────────── */

describe('the Desk\'s shared read of the open shifts', () => {
  const realFetch = globalThis.fetch
  let answer: () => Response = () => new Response('{}')
  before(() => {
    useAuthStore.setState({ token: 'test-token' } as never)
    globalThis.fetch = (async () => answer()) as typeof fetch
  })
  after(() => {
    globalThis.fetch = realFetch
  })
  it('a read that failed is never "no open shifts" — and a later failure keeps the last answer', async () => {
    answer = () => new Response(JSON.stringify({ status: 502, message: 'open shifts unreadable (OperationalError)' }))
    const h = mountHook(() => useOpenShifts(), {})
    // read through a function: every read is the hook's latest render
    const now = () => h.current
    await h.settle(() => now().failed !== '')
    assert.equal(now().shifts === null, true, 'nothing read is not an empty list')
    assert.match(now().failed, /unreadable/)

    answer = () => new Response(JSON.stringify({ status: 200, data: { shifts: [callOff()], open: 1, claimed: 0, pool: { readable: true, why: '' } } }))
    h.run(() => now().reload())
    await h.settle(() => (now().shifts?.length ?? 0) === 1)
    assert.equal(now().shifts?.[0]?.ref, 'SPCALLOFF01')
    assert.equal(now().failed, '')

    answer = () => new Response(JSON.stringify({ status: 502, message: 'relay down' }))
    h.run(() => now().reload())
    await h.settle(() => now().failed !== '')
    assert.equal(now().shifts?.length, 1, 'the last answer stays on screen')
    assert.match(now().failed, /relay down/)
    h.unmount()
  })
})

/* ── as source: the screens listen, and link ────────────────────────────── */

describe('as source — every screen that draws a shift listens for the ring', () => {
  const root = process.env.SPA_ROOT ?? process.cwd()
  const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
  const page = read('src/pages/features/calendarbuilder/LiveView.tsx')
  const requests = read('src/pages/features/shifts/ShiftRequestsPage.tsx')
  const hook = read('src/pages/features/shifts/useOpenShifts.ts')
  const card = read('src/pages/features/smartcomms/OpenShiftsCard.tsx')
  const desk = read('src/pages/features/smartcomms/SmartCommsPage.tsx')
  const app = read('src/App.tsx')
  const login = read('src/pages/LoginPage.tsx')
  it('House Calendars, Requests and the Desk\'s read re-read on `housecal`, and when the stream returns', () => {
    for (const src of [page, requests, hook]) {
      assert.match(src, /onLiveEvent\(HOUSECAL_LIVE_EVENT/)
      assert.match(src, /onLiveEvent\('open'/)
    }
  })
  it('the Desk\'s three cards follow the stream ONCE — one ring is one read, not three', () => {
    // one listener, shared by every mount
    assert.equal(hook.match(/onLiveEvent\(HOUSECAL_LIVE_EVENT/g)?.length, 1)
    assert.equal(hook.match(/onLiveEvent\('open'/g)?.length, 1)
    assert.match(hook, /if \(!unfollow\) \{\s*const offRing = onLiveEvent\(HOUSECAL_LIVE_EVENT/)
    assert.match(hook, /return followLive\(\)/)
  })
  it('a decision is absorbed WHOLE — the chosen person\'s row, not only the totals', () => {
    assert.match(page, /const whole = res\?\.grid/)
    assert.match(page, /absorb\(res\)/)
  })
  it('the red square is claimed by its handle and applied for from its panel', () => {
    assert.match(page, /shiftHandle\(\{ ref: shift\.ref/)
    assert.match(page, /'\/erp-lanes\/shift-requests\/apply'/)
    assert.match(page, /'\/erp-lanes\/shift-requests\/withdraw'/)
    assert.match(page, /\/erp-lanes\/housecal\/ref\//)
  })
  it('the Desk\'s card and its call-off rows are doors to the shift', () => {
    assert.match(card, /navigate\(linkForShift\(s\)\)/)
    assert.match(card, /useOpenShifts\(\)/)
    assert.match(desk, /linkOf=\{callOffLink\}/)
    assert.match(desk, /<CallOffsAhead today=\{today\} \/>/)
  })
  it('the guard keeps where a signed-out link was going, and the login goes there', () => {
    assert.match(app, /<Navigate to="\/login" replace state=\{\{ from \}\} \/>/)
    assert.match(login, /const \[back\] = useState\(\(\) => returnPath\(location\.state\)\)/)
    assert.match(login, /<Navigate to=\{back \?\? homeRouteFor\(user\.role\)\} replace \/>/)
  })
  it('no browser dialogs anywhere on these screens', () => {
    for (const src of [page, requests, card]) assert.doesNotMatch(src, /window\.(confirm|alert|prompt)/)
  })
})
