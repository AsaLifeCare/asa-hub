/** Time Off on the SPA: the words, the tabs, the band, and both screens and the panel drawn from a ready feed. */
import { after, afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { NEVER_SNAPSHOT } from '@/lib/snapshot'
import { timeOffReach } from '@/lib/timeOffAccess'
import {
  STATUS_TINT, actionsFor, alertLine, askedLine, cutsFrom, directorsLine, filedLine, filterRows, focusedAction,
  heroFigures, legLine, mayFile, myRows, nextPress, openRefOf, prefillHouses, previewFor, scopeWords, spanWords,
  statusOf, stepsOf, tabFrom, tabsFor, unreadDirectorsLine,
  type Detail, type Me, type Preview, type TimeOffFeed, type TimeOffRowView,
} from '@/pages/features/timeoff/timeOffModel'
import { directorsNotice } from '@/pages/settings/TimeOffSection'
import { TIME_OFF_STATUS_TINT, timeOffLegLine } from '@/pages/features/shifts/requestsLogic'
import { timeOffTitle } from '@/pages/features/shifts/houseCalTypes'
import { ConflictsTab } from '@/pages/features/calendarbuilder/CalendarTables'
import { generateSummary } from '@/pages/features/calendarbuilder/useBuilderLane'
import TimeOffHero from '@/pages/features/timeoff/TimeOffHero'
import TimeOffForm from '@/pages/features/timeoff/TimeOffForm'
import { TimeOffPanelView } from '@/pages/features/timeoff/TimeOffPanel'
import { clockWords, longDate, shiftCells, type ApprovedFacts } from '@/pages/features/timeoff/approvedModel'
import TimeOffPage, { TimeOffBoardView } from '@/pages/features/timeoff/TimeOffPage'
import TimeOffRequestsPage, { TimeOffRequestsView } from '@/pages/features/timeoff/TimeOffRequestsPage'
import { RequestCard } from '@/pages/features/timeoff/TimeOffCards'
import { useTimeOff, type FeedState } from '@/pages/features/timeoff/useTimeOff'
import { timeOffManifests } from '@/registry/apps-timeoff'
import { mountHook } from './react-host'

// motion cards and the focus refresh listen on the window; node's global has no event hooks
for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const leg = (state: string, by = '', via = '') => ({ asked: [], state, by, via, at: '', note: '' })

function row(over: Partial<TimeOffRowView> = {}): TimeOffRowView {
  return {
    ref: 'TO1A2B3C4D5E', person: 'Ann Roe', start: '2026-09-30', end: '2026-10-02', days: 3,
    houses: [{ code: 'ABD1711', label: '48TH (B)' }], status: 'pending', status_why: '', past: false,
    filed_by: 'Ann Roe', filed_via: 'platform', created_at: '2026-09-24T12:00:00.000Z',
    updated_at: '2026-09-24T12:00:00.000Z', hm: { ...leg('waiting'), asked: ['Mia Manager'] }, dir: leg('waiting'),
    decided_at: '', closed: { by: '', at: '', note: '' }, test_mode: false, flags: [], calendar_name: '',
    source: 'platform', reason_given: false, unplaced: 0, mine: true, leg: '', waiting_on_me: false,
    ...over,
  }
}

const ME_STAFF: Me = { name: 'Ann Roe', scope: 'own', manages: [], may_file_for: 'self', is_director: false,
                       every_house: false, managers_readable: true }
const ME_HM: Me = { ...ME_STAFF, name: 'Mia Manager', scope: 'houses', manages: ['ABD1711'], may_file_for: 'houses' }
const ME_DIR: Me = { ...ME_STAFF, name: 'Ty Bond', scope: 'all', may_file_for: 'anybody', is_director: true }

function feed(over: Partial<TimeOffFeed> = {}): TimeOffFeed {
  return {
    readable: true, why: '', house: { minted: true, as_of: '' },
    hero: { off_now: [], upcoming: [{ ref: 'TO1A2B3C4D5E', person: 'Ann Roe', start: '2026-09-30', end: '2026-10-02',
                                      houses: [{ code: 'ABD1711', label: '48TH (B)' }] }],
            waiting: { count: 1, on_me: 0, soon_on_me: 0 }, month: { people: 1, days: 3, label: 'September' },
            bar: null },
    rows: [row()], me: ME_STAFF, directors: ['Ty Bond', 'Lisa B. Bright'],
    houses: [{ code: 'ABD1711', label: '48TH (B)' }, { code: 'ABD2704', label: 'JH' }], people: [],
    test_mode: false, ...over,
  }
}

const ready = (f: TimeOffFeed): FeedState => ({ status: 'ready', data: f, error: '', reason: '', refreshing: false })
const REACH_HM = timeOffReach({ role: 'staff', types: ['STAFF'], derivedTypes: ['HM'] })
// the server renderer marks where two text pieces meet; the words are read without the marks
const at = (path: string, node: ReturnType<typeof createElement>) =>
  renderToString(createElement(MemoryRouter, { initialEntries: [path] }, node)).replace(/<!-- -->/g, '')
const activeTab = (html: string) => /bg-surface shadow-1"[^>]*><\/span><span class="relative">([^<]*)</.exec(html)?.[1] ?? ''

describe('who is drawn Time Off — the relay decides again at every door', () => {
  it('staff read their own, a house manager their houses, the badges above all; client, SSA and family nothing', () => {
    assert.deepEqual(timeOffReach({ role: 'staff', types: ['STAFF'] }), { opens: true, scope: 'own', everyHouse: false, settings: false })
    assert.equal(REACH_HM.scope, 'houses')
    assert.equal(timeOffReach({ role: 'manager', types: [] }).scope, 'all')
    assert.equal(timeOffReach({ role: 'staff', types: ['DIRECTOR'] }).everyHouse, true)
    assert.equal(timeOffReach({ role: 'admin', types: [] }).settings, true)
    for (const role of ['client', 'guardian', 'onboarding', 'interviewer']) {
      assert.equal(timeOffReach({ role, types: [] }).opens, false, role)
    }
    // the FIX BADGES sheet (10-30): Time Off is shut to the SSA and the FAMILY columns
    assert.equal(timeOffReach({ role: 'family', types: ['FAMILY'] }).opens, false)
    assert.equal(timeOffReach({ role: 'family', types: ['SSA'] }).opens, false)
    // a client-role guardian account now wears SSA
    assert.equal(timeOffReach({ role: 'client', types: ['SSA'] }).opens, false)
    assert.equal(timeOffReach(null).opens, false)
  })
  it('an old GUARDIAN cell reads as FAMILY, and an SSA or a FAMILY on a staff role is refused — its role word never counts', () => {
    // scope.BADGE_RENAMED: a cell written before 10-30 says GUARDIAN for FAMILY until the data is migrated
    assert.equal(timeOffReach({ role: 'family', types: ['GUARDIAN'] }).opens, false, 'unmigrated GUARDIAN cell')
    // the 22 FAMILY accounts and Denise Hollenbach's SSA sit on role staff (server: time_off.refused_reader)
    assert.equal(timeOffReach({ role: 'staff', types: ['FAMILY'] }).opens, false, 'staff-role FAMILY')
    assert.equal(timeOffReach({ role: 'staff', types: ['SSA'] }).opens, false, 'staff-role SSA')
    assert.equal(timeOffReach({ role: 'staff', types: ['GUARDIAN'] }).opens, false, 'staff-role unmigrated GUARDIAN')
  })
  it('the manifest never names a client; both pages are the bespoke screens; the rows are never a slice', () => {
    const m = timeOffManifests[0]
    assert.deepEqual(m.audience, ['admin', 'manager', 'staff'])
    assert.deepEqual(m.pages.map((p) => [p.id, p.config?.customFeature]),
      [['board', 'timeoff/TimeOffPage'], ['requests', 'timeoff/TimeOffRequestsPage']])
    assert.ok(NEVER_SNAPSHOT.includes('timeOff'))
  })
})

describe('the black band', () => {
  it('staff read their own figures in their own words', () => {
    const f = heroFigures(feed())
    assert.equal(f[1].sub, 'Your next time off: Wed 9/30 – Fri 10/2')
    assert.equal(f[2].sub, 'Your requests waiting: 1')
  })
  it('an approver hears how many wait on them, and three days out it is a red line', () => {
    const f = feed({ me: ME_HM, hero: { ...feed().hero!, waiting: { count: 4, on_me: 2, soon_on_me: 1 } } })
    assert.equal(heroFigures(f)[2].sub, '2 waiting on you')
    assert.equal(alertLine(f, false), '1 request starts within 3 days and is still waiting on you.')
  })
  it('a directors list that did not land is "—" and its sentence on the band — never "none waiting on you"', () => {
    const why = 'the Time Off house\'s directors list could not be read (its Settings tab carries no `directors` row)'
    const f = feed({ me: ME_HM, directors: [], directors_readable: false, directors_why: why,
                     hero: { ...feed().hero!, waiting: { count: 2, on_me: null, soon_on_me: null } } })
    const sub = heroFigures(f)[2].sub
    assert.match(sub, /^Waiting on you: — the directors list could not be read/)
    assert.doesNotMatch(sub, /none waiting on you|\b0 waiting/)
    const red = alertLine(f, false)
    assert.equal(red, unreadDirectorsLine(why))
    assert.match(red, /could not be read \(its Settings tab carries no `directors` row\)\. Nothing is filed or decided/)
    assert.match(red, /not saying nothing waits on you/)
    // the band draws it as its red line
    const html = at('/', createElement(TimeOffHero, { feed: f, failed: '', isAdmin: false, onOpen: () => {},
                                                      onRetry: () => {} }))
    assert.match(html, /Nothing is filed or decided until it can be/)
    assert.doesNotMatch(html, /none waiting on you/)
  })
  it('a blank list names nobody, and the band still counts what waits on the house manager', () => {
    const f = feed({ me: ME_HM, directors: [], directors_readable: true, directors_why: 'names no director',
                     hero: { ...feed().hero!, waiting: { count: 2, on_me: 1, soon_on_me: 0 } } })
    assert.equal(heroFigures(f)[2].sub, '1 waiting on you')
    assert.equal(alertLine(f, false), '')
  })
  it('an unread feed is "—" and a red line — never a zero, and never the words "house" or "minted"', () => {
    const bad = feed({ readable: false, hero: null, rows: [] })
    assert.ok(heroFigures(bad).every((x) => x.value === '—'))
    assert.match(alertLine(bad, false), /could not be read — this screen is not saying nobody is off/)
    const unset = feed({ readable: false, hero: null, house: { minted: false, as_of: '' } })
    assert.equal(alertLine(unset, false), '')
    assert.equal(alertLine(unset, true), 'Time off is not set up on this server yet — nothing can be filed.')
    for (const f of [null, bad, unset]) {
      const words = heroFigures(f).map((x) => x.sub).join(' ')
      assert.equal(/house|minted/i.test(words), false, words)
    }
    assert.deepEqual(heroFigures(unset).map((x) => x.sub), ['Time off is not set up yet', '', '', ''])
  })
  it('before the feed answers, the band names the reader\'s own reach, and says it is still reading', () => {
    const html = at('/', createElement(TimeOffHero, { feed: null, failed: '', isAdmin: false, reachScope: 'own',
                                                      onOpen: () => {}, onRetry: () => {} }))
    assert.match(html, /Time off · your own/)
    assert.equal(/whole company/.test(html), false)
    assert.match(html, /<section[^>]*aria-label="Time off at a glance"[^>]*aria-busy="true"/)
    const failed = at('/', createElement(TimeOffHero, { feed: null, failed: 'the relay answered 503', isAdmin: false,
                                                        reachScope: 'houses', onOpen: () => {}, onRetry: () => {} }))
    assert.match(failed, /could not be read/)
    assert.match(failed, /Time off · your houses/)
    assert.equal(/>0</.test(failed), false)
  })
})

describe('one status map and one way to word a half, on every screen', () => {
  it('the Requests tab uses the Time Off app\'s own tints and words', () => {
    assert.equal(TIME_OFF_STATUS_TINT, STATUS_TINT)
    assert.equal(STATUS_TINT.denied, 'danger')
    assert.equal(timeOffLegLine('House manager', { state: 'approved', by: 'Mia Manager', via: 'sms', at: '' }),
      'House manager: Mia Manager · Approved · via Text')
    assert.equal(legLine('Director', leg('waiting')), 'Director: Waiting')
  })
  it('a grid cell\'s title says the end day as a day, never an ISO date', () => {
    const title = timeOffTitle({ state: 'scheduled', ref: 'TO1A2B3C4D5E', until: '2026-10-02' })
    assert.match(title, /until Fri 10\/2/)
    assert.equal(/2026-10-02/.test(title), false)
  })
})

describe('the step bar', () => {
  it('asked, then two independent halves, then scheduled — for every status', () => {
    const states = (r: TimeOffRowView) => stepsOf(r).map((s) => s.state).join(',')
    assert.equal(states(row()), 'done,waiting,waiting,waiting')
    assert.equal(states(row({ hm: leg('approved', 'Mia Manager') })), 'done,done,waiting,waiting')
    assert.equal(states(row({ dir: leg('approved', 'Ty Bond') })), 'done,waiting,done,waiting')
    assert.equal(states(row({ status: 'scheduled', hm: leg('approved', 'Mia'), dir: leg('approved', 'Ty') })), 'done,done,done,done')
    assert.equal(states(row({ status: 'denied', hm: leg('approved', 'Mia'), dir: leg('denied', 'Ty') })), 'done,done,refused,refused')
    assert.equal(states(row({ status: 'withdrawn' })), 'done,na,na,na')
    assert.equal(states(row({ status: 'history', hm: leg('migrated'), dir: leg('migrated') })), 'done,done,done,done')
    assert.equal(statusOf(row({ status: 'scheduled', past: true })), 'past')
  })
})

describe('the tabs and the cuts', () => {
  const rows = [
    row({ ref: 'TO0000000001', waiting_on_me: true, mine: false, person: 'Ben Left' }),
    row({ ref: 'TO0000000002', status: 'scheduled' }),
    row({ ref: 'TO0000000003', status: 'scheduled', past: true }),
    row({ ref: 'TO0000000004', status: 'denied' }),
    row({ ref: 'TO0000000005', status: 'needs_review', filed_via: 'migration' }),
  ]
  it('"Waiting on me" is only for a reader who decides somewhere, and it comes first', () => {
    assert.deepEqual(tabsFor(ME_STAFF), ['waiting', 'scheduled', 'history'])
    assert.deepEqual(tabsFor(ME_HM), ['mine', 'waiting', 'scheduled', 'history', 'review'])
    assert.deepEqual(tabsFor(ME_DIR), ['mine', 'waiting', 'scheduled', 'history', 'review'])
  })
  it('the tab is the address\'s own when this reader has it, else the reader\'s first', () => {
    assert.equal(tabFrom('review', tabsFor(ME_HM)), 'review')
    assert.equal(tabFrom(null, tabsFor(ME_HM)), 'mine')
    assert.equal(tabFrom('mine', tabsFor(ME_STAFF)), 'waiting')
    assert.equal(tabFrom('nonsense', tabsFor(ME_STAFF)), 'waiting')
  })
  it('each tab holds its own rows; history is what ended', () => {
    const refs = (t: Parameters<typeof filterRows>[1]) => filterRows(rows, t, {}).map((r) => r.ref)
    assert.deepEqual(refs('mine'), ['TO0000000001'])
    assert.deepEqual(refs('scheduled'), ['TO0000000002'])
    assert.deepEqual(refs('history'), ['TO0000000003', 'TO0000000004'])
    assert.deepEqual(refs('review'), ['TO0000000005'])
    assert.deepEqual(filterRows(rows, 'waiting', { q: 'ben' }).map((r) => r.ref), ['TO0000000001'])
    assert.deepEqual(filterRows(rows, 'review', { via: 'migration' }).map((r) => r.ref), ['TO0000000005'])
    assert.deepEqual(filterRows(rows, 'scheduled', { day: '2026-10-01' }).map((r) => r.ref), ['TO0000000002'])
    assert.deepEqual(cutsFrom(rows).statuses, ['denied', 'needs_review', 'past', 'pending', 'scheduled'])
  })
  it('my own strip leaves history out; the scope line names houses, never codes', () => {
    assert.deepEqual(myRows(feed({ rows: [row(), row({ ref: 'TO0000000009', status: 'history' })] })).map((r) => r.ref),
      ['TO1A2B3C4D5E'])
    assert.equal(scopeWords('houses', ['ABD1711', 'ABD2704'], feed().houses), 'your own, and the staff of 48TH (B), JH')
    assert.equal(scopeWords('all'), 'the whole company')
  })
})

describe('the form — Submit only on a clean check of what is on screen now', () => {
  const ok: Preview = { ok: true, refusals: [], person: 'Ann Roe', start: '2026-09-30', end: '2026-09-30' }
  it('a check counts only for the very inputs it checked', () => {
    const checked = { key: 'a', preview: ok }
    assert.equal(previewFor(checked, 'a'), ok)
    assert.equal(previewFor(checked, 'b'), null)
    assert.equal(previewFor(null, 'a'), null)
  })
  it('a failed or stale check, a running one, or a refusal never offers Submit', () => {
    assert.equal(mayFile(true, ok, false, false), true)
    assert.equal(mayFile(true, previewFor({ key: 'old', preview: ok }, 'new'), false, false), false)
    assert.equal(mayFile(true, null, false, false), false)
    assert.equal(mayFile(true, ok, true, false), false)
    assert.equal(mayFile(true, { ...ok, ok: false }, false, false), false)
  })
  it('?house= prefills the house, and the preview adds the houses the person is drawn on', () => {
    const known = feed().houses
    assert.deepEqual(prefillHouses('ABD2704', [], known), ['ABD2704'])
    assert.deepEqual(prefillHouses('CAN - JH - ABD2704', ['ABD1711'], known), ['ABD2704', 'ABD1711'])
    assert.deepEqual(prefillHouses('', ['XX0000'], known), [])
  })
  it('staff see their own name locked; a house manager a picker; Submit is not offered before a check', () => {
    const staff = at('/', createElement(TimeOffForm, { feed: feed(), askedHouse: 'ABD1711', onFiled: () => {} }))
    assert.match(staff, /Ann Roe/)
    assert.equal(/<input[^>]*list="timeoff-people"/.test(staff), false)
    assert.match(staff, /Only your house manager and the directors read this\./)
    assert.match(staff, /<button[^>]*disabled=""[^>]*>.*Submit/)
    const hm = at('/', createElement(TimeOffForm, { feed: feed({ me: ME_HM, people: [{ name: 'Ann Roe', houses: ['48TH (B)'] }] }),
                                                   onFiled: () => {} }))
    assert.match(hm, /list="timeoff-people"/)
  })
})

describe('the screens, drawn from a ready feed', () => {
  const hmFeed = feed({ me: ME_HM, rows: [
    row({ ref: 'TO0000000001', person: 'Ben Left', mine: false, waiting_on_me: true }),
    row({ ref: 'TO0000000005', status: 'needs_review', filed_via: 'migration', person: 'Cy Far', mine: false }),
  ] })
  it('a house manager lands on "Waiting on me", with the scope in house names', () => {
    const html = at('/app/timeoff/requests', createElement(TimeOffRequestsView,
      { reach: REACH_HM, state: ready(hmFeed), refresh: () => {} }))
    assert.equal(activeTab(html), 'Waiting on me · 1')
    // a card's name line; the person filter lists everybody
    assert.match(html, /text-text-1">Ben Left</)
    assert.equal(/text-text-1">Cy Far</.test(html), false)
    assert.match(html, /your own, and the staff of 48TH \(B\)</)
    assert.equal(/staff of ABD1711/.test(html), false)
  })
  it('with the directors list unread, "Waiting on me" is "—" and the sentence — never a count of 0 or an empty tab', () => {
    const why = 'the Time Off house\'s directors list could not be read (its Settings tab carries no `directors` row)'
    const blind = feed({ me: ME_HM, directors: [], directors_readable: false, directors_why: why, rows: [
      row({ ref: 'TO0000000001', person: 'Ben Left', mine: false, waiting_on_me: null }),
    ] })
    const html = at('/app/timeoff/requests?tab=mine', createElement(TimeOffRequestsView,
      { reach: REACH_HM, state: ready(blind), refresh: () => {} }))
    assert.equal(activeTab(html), 'Waiting on me · —')
    assert.match(html, /role="alert"[^>]*>The directors list could not be read — the Time Off house/)
    assert.match(html, /not saying nothing waits on you/)
    assert.doesNotMatch(html, /Waiting on me · 0/)
  })
  it('?tab=review opens that tab straight from the address', () => {
    const html = at('/app/timeoff/requests?tab=review', createElement(TimeOffRequestsView,
      { reach: REACH_HM, state: ready(hmFeed), refresh: () => {} }))
    assert.equal(activeTab(html), 'Needs review · 1')
    assert.match(html, /text-text-1">Cy Far</)
  })
  it('the board draws the band, the form directly below it, and the reader\'s own requests', () => {
    const html = at('/app/timeoff/board', createElement(TimeOffBoardView,
      { reach: timeOffReach({ role: 'staff', types: ['STAFF'] }), state: ready(feed()), refresh: () => {} }))
    const band = html.indexOf('Time off at a glance')
    const form = html.indexOf('Request time off')
    const mine = html.indexOf('My time off')
    assert.ok(band >= 0 && form > band && mine > form, `${band} ${form} ${mine}`)
    assert.match(html, /Time off · your own/)
  })
  it('an account the SPA cannot place is shown the refusal, never the app — on both screens', () => {
    useAuthStore.setState({ user: null } as never)
    for (const page of [TimeOffPage, TimeOffRequestsPage]) {
      const html = at('/', createElement(page))
      assert.match(html, /Time Off is the staff&#x27;s screen/)
      assert.equal(/Request time off/.test(html), false)
    }
  })
  it('a request card carries both halves, the ref, the step bar and the test-mode pill', () => {
    const html = at('/', createElement('ul', null,
      createElement(RequestCard, { row: row({ test_mode: true, hm: leg('approved', 'Mia Manager', 'sms') }), onOpen: () => {} })))
    assert.match(html, /House manager: Mia Manager · Approved · via Text/)
    assert.match(html, /Director: Waiting/)
    assert.match(html, /Filed in test mode/)
    assert.match(html, /TO1A2B3C4D5E/)
    assert.match(html, new RegExp(spanWords('2026-09-30', '2026-10-02')))
  })
})

describe('the panel — a dialog, actions from `may` only, two presses, a link only focuses', () => {
  const detail = (over: Partial<Detail> = {}): Detail => ({
    ...row({ status: 'pending', unplaced: 1 }),
    may: { approve: true, deny: true, withdraw: false, cancel: false, review: false, edit: true }, why_not: '', leg: 'hm',
    directors: ['Ty Bond', 'Lisa B. Bright'], effects: { released_claims: [
      { house: 'ABD1711', location: 'CAN - 48TH (B) - ABD1711', col_iso: '2026-09-30', value: '8A-4P', open_row: 'OPEN' }] },
    reason_visible: false, reason: '', reason_why: '', timeline: [],
    does: { shifts: [
      { house: 'ABD1711', label: '48TH (B)', location: 'L', col_iso: '2026-09-29', value: '11P-7A' },
      { house: 'ABD1711', label: '48TH (B)', location: 'L', col_iso: '2026-09-30', value: '8A-4P', claim: true },
    ], applications: [], handoffs: [], trainings: [] },
    ...over,
  })
  it('draws exactly what the server allows', () => {
    assert.deepEqual(actionsFor(undefined), [])
    assert.deepEqual(actionsFor({ approve: true, deny: true, withdraw: false, cancel: false, review: false }), ['approve', 'deny'])
    assert.deepEqual(actionsFor({ approve: false, deny: false, withdraw: true, cancel: false, review: false }), ['withdraw'])
    assert.deepEqual(actionsFor({ approve: false, deny: false, withdraw: false, cancel: false, review: true }),
      ['confirm', 'merge', 'discard'])
  })
  it('the first press arms, the second acts, and another button re-arms', () => {
    assert.deepEqual(nextPress('', 'approve'), { act: false, armed: 'approve' })
    assert.deepEqual(nextPress('approve', 'approve'), { act: true, armed: '' })
    assert.deepEqual(nextPress('approve', 'deny'), { act: false, armed: 'deny' })
  })
  it('an e-mail link\'s act only names approve or deny; ?ref= opens only a well-formed ref', () => {
    assert.equal(focusedAction('approve'), 'approve')
    assert.equal(focusedAction('cancel'), '')
    assert.equal(focusedAction(null), '')
    assert.equal(openRefOf(new URLSearchParams('ref=to1a2b3c4d5e&act=approve')), 'TO1A2B3C4D5E')
    assert.equal(openRefOf(new URLSearchParams('ref=SP0123456789')), '')
  })
  it('behind Edit, the record is the standard right panel (never a modal) with the server\'s actions, the claim given back, and the arrow copy', () => {
    const html = at('/', createElement(TimeOffPanelView, { refId: 'TO1A2B3C4D5E', d: detail(), failed: '',
                                                           focus: 'approve', edit: true, onClose: () => {}, onDone: () => {} }))
    assert.match(html, /<aside[^>]*aria-label="Time off request"/)
    assert.match(html, /data-time-off-record="TO1A2B3C4D5E"/)
    assert.match(html, /data-act="back"[^>]*>.*Back to the request/)
    assert.doesNotMatch(html, /aria-modal/)
    assert.match(html, />Approve</)
    assert.match(html, />Deny</)
    assert.equal(/Withdraw|Cancel scheduled/.test(html), false)
    assert.equal(/press again/.test(html), false)
    assert.match(html, /ring-2 ring-primary/)
    assert.match(html, /Calendar Builder → Builder/)
    assert.match(html, /Tue 9\/29 11P-7A at 48TH \(B\) becomes an open draft/)
    assert.match(html, /8A-4P at 48TH \(B\) is a shift they took: it is put back up as an open shift/)
    assert.match(html, /Given back: Wed 9\/30 8A-4P is open again/)
  })
  it('still reading, it says so; failed, it says why in the blood-red box', () => {
    const reading = at('/', createElement(TimeOffPanelView, { refId: 'TO1A2B3C4D5E', d: null, failed: '', focus: '',
                                                              onClose: () => {}, onDone: () => {} }))
    assert.match(reading, /Reading/)
    const failed = at('/', createElement(TimeOffPanelView, { refId: 'TO1A2B3C4D5E', d: null, failed: 'the relay answered 503',
                                                             focus: '', onClose: () => {}, onDone: () => {} }))
    assert.match(failed, /border-\[#8b0000\][^>]*>This request could not be read — the relay answered 503/)
  })
  it('the directors are the list\'s answer: the names, a blank cell that waits, or a list that did not land', () => {
    // the record, behind Edit
    const open = (d: Detail) => at('/', createElement(TimeOffPanelView, { refId: 'TO1A2B3C4D5E', d, failed: '',
                                                                           focus: '', edit: true, onClose: () => {}, onDone: () => {} }))
    assert.match(open(detail()), /Directors on the list: Ty Bond, Lisa B\. Bright/)
    const blank = open(detail({ directors: [], directors_readable: true, may: { approve: false, deny: false,
      withdraw: false, cancel: false, review: false, edit: true }, leg: '', why_not: 'names no director — the director half waits' }))
    assert.match(blank, /No director is named on Settings → Time Off yet — the director half waits until somebody is\./)
    assert.doesNotMatch(blank, /Directors on the list: none/)
    const unread = open(detail({ directors: [], directors_readable: false,
      directors_why: 'the Time Off house\'s directors list could not be read (its Settings tab carries no `directors` row)',
      may: { approve: false, deny: false, withdraw: false, cancel: false, review: false, edit: true }, leg: '' }))
    assert.match(unread, /The directors list could not be read — the Time Off house&#x27;s directors list could not be read/)
    assert.match(unread, /Nothing is decided until it can be\./)
    assert.doesNotMatch(unread, />Approve</)
  })
  it('the words: who was asked, and why the director half has nobody yet', () => {
    assert.equal(directorsLine({ directors: ['A One'] }), 'Directors on the list: A One')
    assert.match(directorsLine({ directors: [], directors_readable: false, directors_why: 'x' }), /could not be read — x/)
    assert.match(directorsLine({ directors: [], directors_readable: true }), /waits until somebody is/)
    assert.equal(filedLine({ house_manager: ['Mia Manager'], directors: ['A One'] }), 'Asked: Mia Manager, A One')
    // the toast repeats the relay's own sentence: a blank list, or a list whose every name is in the request
    const blank = 'the Time Off house\'s Settings tab names no director (Settings → Time Off → directors) — the ' +
      'director half waits until one is named there'
    assert.equal(filedLine({ house_manager: ['Mia Manager'], directors: [], directors_why: blank }),
      `Asked: Mia Manager. T${blank.slice(1)}.`)
    const inIt = 'every director on the Time Off list (Ann Roe) is part of this request, and nobody decides their ' +
      'own — the director half waits until another name is saved on Settings → Time Off'
    assert.equal(filedLine({ house_manager: ['Mia Manager'], directors: [], directors_why: inIt }),
      `Asked: Mia Manager. E${inIt.slice(1)}.`)
    assert.match(askedLine({ readable: true, hm_mode: 'house_manager', hm_names: ['Mia Manager'], hm_why: '',
                             dir_names: [], dir_why: '' }), /Director: nobody is named on Settings → Time Off yet/)
  })
  it('who approves: a list that names nobody is told apart from one whose every name is in the request', () => {
    const base = { readable: true, hm_mode: 'house_manager', hm_names: ['Mia Manager'], hm_why: '', dir_why: '' }
    const inIt = askedLine({ ...base, dir_listed: ['Ann Roe'], dir_names: [] })
    assert.match(inIt, /Director: every name on Settings → Time Off \(Ann Roe\) is part of this request/)
    assert.doesNotMatch(inIt, /nobody is named/)
    assert.match(askedLine({ ...base, dir_listed: [], dir_names: [] }), /Director: nobody is named on Settings → Time Off yet/)
    assert.equal(askedLine({ ...base, dir_listed: ['A One', 'B Two'], dir_names: ['B Two'] }),
      'House manager: Mia Manager · Director: one of B Two')
    // the house manager half above names a listed director only while one may answer
    assert.match(askedLine({ ...base, hm_mode: 'above', hm_names: [], dir_listed: [], dir_names: [] }),
      /^House manager half: an administrator ·/)
    assert.match(askedLine({ ...base, hm_mode: 'above', hm_names: [], dir_listed: ['B Two'], dir_names: ['B Two'] }),
      /^House manager half: a listed director or an administrator ·/)
  })
})

describe('an approved request — the operator\'s layout, Edit for its approvers only', () => {
  const NONE = { approve: false, deny: false, withdraw: false, cancel: false, review: false }
  const FACTS: ApprovedFacts = {
    year: 2026, year_days: 15, year_why: '',
    shifts: [
      { date: '2026-11-02', house_code: 'CH1', location: 'Cedar House', start_min: 1320, end_min: 1860, text: '10P-7A', state: 'scheduled' },
      { date: '2026-11-04', house_code: 'CH1', location: 'Cedar House', start_min: 420, end_min: 900, text: '7A-3P', state: 'scheduled' },
    ],
    shifts_why: '',
  }
  const approved = (over: Partial<Detail> = {}): Detail => ({
    ...row({ person: 'Jordan Lee', start: '2026-11-03', end: '2026-11-09', days: 7, status: 'scheduled',
             created_at: '2026-10-01T15:00:00.000Z', mine: false }),
    may: { ...NONE, cancel: true, edit: true }, why_not: '', leg: '', directors: ['Ty Bond'], effects: {},
    reason_visible: true, reason: 'Family trip. Requesting the full week off to travel and spend time with family.',
    reason_why: '', timeline: [{ at: '2026-10-02T15:00:00.000Z', what: 'scheduled', text: 'Scheduled' }],
    approved: FACTS, ...over,
  })
  const open = (d: Detail, edit = false) => at('/', createElement(TimeOffPanelView, {
    refId: 'TO1A2B3C4D5E', d, failed: '', focus: '', edit, onClose: () => {}, onDone: () => {} }))

  it('draws the layout in order: header pill, Employee, the facts grid, the reason, the year, the impacted shifts', () => {
    const html = open(approved())
    assert.match(html, /<aside[^>]*aria-label="Time off request"/)
    const order = ['data-status="Approved"', '>Employee<', '>Jordan Lee<', '>Start date<', '>Nov 03, 2026<', '>End date<',
      '>Nov 09, 2026<', '>Requested<', '>Oct 01, 2026<', '>Number of days<', '>7<', '>Reason<', 'Family trip. Requesting',
      '>Approved time off · 2026<', '>15 days<', '>Impacted shifts<', 'Scheduled shifts overlapping this request.',
      '>Date<', '>Location<', '>Start<', '>End<', '>Nov 02, 2026<', '>Cedar House<', '>10:00 PM<', '>7:00 AM<']
    let from = 0
    for (const w of order) {
      const i = html.indexOf(w, from)
      assert.ok(i >= 0, `${w} after position ${from}`)
      from = i
    }
    // the record and its actions are behind Edit
    assert.equal(/Cancel scheduled time off|Timeline/.test(html), false)
  })

  it('Edit is drawn for an approver and opens what they may do; never for the person or a reader', () => {
    assert.match(open(approved()), /data-act="edit"[^>]*>.*Edit<\/button>/)
    assert.doesNotMatch(open(approved()), /data-act="withdraw"/, 'an approver is handed no Withdraw')
    // the person keeps their own Withdraw under the layout while the server allows it (not started yet), never an edit
    const requester = open(approved({ mine: true, may: { ...NONE, withdraw: true } }))
    assert.match(requester, />Jordan Lee</)
    assert.doesNotMatch(requester, /data-act="edit"|Change dates/)
    assert.match(requester, /data-act="withdraw"[^>]*>Withdraw<\/button>/)
    assert.ok(requester.indexOf('data-act="withdraw"') > requester.indexOf('>Impacted shifts<'), 'under the layout')
    assert.doesNotMatch(open(approved({ mine: true, may: { ...NONE } })), /data-act="withdraw"/, 'started: no Withdraw')
    const reader = open(approved({ may: { ...NONE } }))
    assert.doesNotMatch(reader, /data-act="edit"/)
    // the server may let a house manager cancel while naming them no approver here: `edit` alone decides
    assert.doesNotMatch(open(approved({ may: { ...NONE, cancel: true } })), /data-act="edit"/)
    // opened by Edit (`?edit=1`), the approver has the record and the cancel; the address alone opens nothing
    const editing = open(approved(), true)
    assert.match(editing, /Cancel scheduled time off/)
    assert.match(editing, /data-act="back"/)
    const asked = open(approved({ may: { ...NONE, withdraw: true } }), true)
    assert.match(asked, />Employee</)
    assert.doesNotMatch(asked, /data-act="edit"|Cancel scheduled time off/)
  })

  it('a shift that ends on another day shows that day under its end time; a same-day shift does not', () => {
    const html = open(approved())
    assert.match(html, />7:00 AM<span[^>]*data-end-date="">Nov 03, 2026<\/span>/)
    assert.match(html, />3:00 PM<\/td>/)
    assert.deepEqual(shiftCells({ date: '2026-11-02', start_min: 1320, end_min: 1860 }),
      { date: 'Nov 02, 2026', start: '10:00 PM', end: '7:00 AM', endDate: 'Nov 03, 2026' })
    assert.deepEqual(shiftCells({ date: '2026-11-04', start_min: 420, end_min: 900 }),
      { date: 'Nov 04, 2026', start: '7:00 AM', end: '3:00 PM', endDate: '' })
    // a shift ending at midnight ends on the next day; one past the month and the year turns both
    assert.deepEqual(shiftCells({ date: '2026-12-31', start_min: 960, end_min: 1440 }),
      { date: 'Dec 31, 2026', start: '4:00 PM', end: '12:00 AM', endDate: 'Jan 01, 2027' })
    assert.equal(clockWords(0), '12:00 AM')
    assert.equal(clockWords(750), '12:30 PM')
  })

  it('a part that could not be read is said, never drawn as none; the reason stays its readers\'', () => {
    const html = open(approved({ reason_visible: false, reason: '', approved: {
      year: 2026, year_days: null, year_why: 'the approved time off could not be read (OperationalError)',
      shifts: null, shifts_why: 'the Scheduling calendars could not be read (OperationalError)' } }))
    assert.match(html, /Only the approvers and the person who asked read it\./)
    assert.match(html, /the approved time off could not be read \(OperationalError\)/)
    assert.match(html, /The shifts could not be read — the Scheduling calendars could not be read \(OperationalError\)\./)
    assert.doesNotMatch(html, />0 days</)
    assert.match(open(approved({ approved: { ...FACTS, shifts: [] } })), /No scheduled shift of theirs overlaps these days\./)
    assert.equal(longDate('2026-10-01T03:00:00.000Z'), 'Sep 30, 2026', 'a timestamp is the Ohio day it fell on')
  })

  it('a waiting request opens on the same layout: its approver answers in the footer, Edit opens the record', () => {
    const waiting = (over: Partial<Detail> = {}) => approved({ status: 'pending', leg: 'hm',
      may: { ...NONE, approve: true, deny: true, edit: true }, ...over })
    const html = open(waiting())
    const order = ['data-status="Waiting"', '>Employee<', '>Jordan Lee<', 'data-act="edit"', '>Start date<', '>Nov 03, 2026<',
      '>Number of days<', '>Reason<', '>Approved time off · 2026<', '>15 days<', '>Impacted shifts<', '>Nov 02, 2026<',
      'data-time-off-actions', 'data-act="approve"', 'data-act="deny"']
    let from = 0
    for (const w of order) {
      const i = html.indexOf(w, from)
      assert.ok(i >= 0, `${w} after position ${from}`)
      from = i
    }
    assert.doesNotMatch(html, /data-status="Approved"|Who may approve each half|Timeline/)
    assert.match(html, />7:00 AM<span[^>]*data-end-date="">Nov 03, 2026<\/span>/)
    // an e-mail link's answer is ready in the footer
    assert.match(at('/', createElement(TimeOffPanelView, { refId: 'TO1A2B3C4D5E', d: waiting(), failed: '', focus: 'approve',
      onClose: () => {}, onDone: () => {} })), /data-act="approve"[^>]*ring-2 ring-primary/)
    // the person on it: the same layout, their Withdraw, never an edit or an answer
    const own = open(waiting({ mine: true, leg: '', may: { ...NONE, withdraw: true } }))
    assert.match(own, /data-status="Waiting"/)
    assert.match(own, /data-act="withdraw"/)
    assert.doesNotMatch(own, /data-act="edit"|data-act="approve"|data-act="deny"/)
    // the record is the approver's, behind Edit; the address alone opens nothing
    assert.match(open(waiting(), true), /Who may approve each half, and why/)
    assert.doesNotMatch(open(waiting({ mine: true, leg: '', may: { ...NONE, withdraw: true } }), true), /Who may approve each half/)
  })

  it('every other status opens on the layout too, with its own pill and the server\'s actions', () => {
    const review = open(approved({ status: 'needs_review', may: { ...NONE, review: true, edit: true } }))
    assert.match(review, /data-status="Needs review"/)
    assert.match(review, />Employee</)
    assert.match(review, /data-act="confirm"/)
    assert.match(review, /data-act="edit"/)
    const denied = open(approved({ status: 'denied', may: { ...NONE } }))
    assert.match(denied, /data-status="Denied"/)
    assert.doesNotMatch(denied, /data-act=/)
  })
})

describe('Settings → Time Off says what the directors cell means now', () => {
  it('named: nothing to say; blank: requests still filed, the director half waits; not landed: nothing decided', () => {
    assert.equal(directorsNotice({ directors: ['A One'], directors_readable: true }), '')
    const blank = directorsNotice({ directors: [], directors_readable: true })
    assert.match(blank, /names nobody/)
    assert.match(blank, /Requests and swaps are still opened and their house manager still answers/)
    assert.match(blank, /director half of every request, and the director's approval of every swap, waits/)
    assert.doesNotMatch(blank, /live in the code|fall back|no swap can be opened/)
    const unread = directorsNotice({ directors: [], directors_readable: false, directors_why: 'its Settings tab carries no row' })
    assert.match(unread, /could not be read — its Settings tab carries no row\./)
    assert.match(unread, /No time off request is filed or decided, and no swap can be opened, until it can be/)
  })
})

describe('Calendar Builder speaks of time off in its own words', () => {
  it('Conflicts draws a time-off clash as approved time off, and the empty state names both kinds', () => {
    const html = at('/', createElement(ConflictsTab, { conflicts: [{
      staff: 'Ann Roe', date: '10/04/2026', houseA: '48TH (B)', startA: '23:00', endA: '07:00',
      houseB: 'Approved time off', startB: 'Mon 10/5', endB: 'Tue 10/6', kind: 'time_off', ref: 'TO1A2B3C4D5E',
      from: '2026-10-05', until: '2026-10-06' }] }))
    assert.match(html, /Approved time off/)
    assert.match(html, /Mon 10\/5 – Tue 10\/6 · TO1A2B3C4D5E/)
    assert.equal(/TIME OFF|2026-10-06/.test(html), false)
    assert.match(at('/', createElement(ConflictsTab, { conflicts: [] })), /none falls in approved time off/)
  })
  it('Auto-fill says how many days it left blank for time off still waiting', () => {
    const r = { staged: 4, skippedConflicts: 1, skippedFullWeeks: 0, period: '2026-09-26', note: '' }
    assert.equal(generateSummary(r), '1 conflicts avoided · 0 full-week skips. Review the grid, then Publish.')
    assert.match(generateSummary({ ...r, skippedTimeOffAsked: 2 }),
      /2 days left blank where time off is asked and still waiting/)
  })
})

describe('the feed, read at fetch', () => {
  const realFetch = globalThis.fetch
  let answers: { status: number; message?: string; data?: unknown }[] = []
  before(() => {
    useAuthStore.setState({ token: 't' } as never)
    globalThis.fetch = (async () => {
      const env = answers.shift() ?? { status: 503, message: 'no answer' }
      return { ok: true, status: 200, json: async () => env } as unknown as Response
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })
  afterEach(() => { answers = [] })
  it('a later failure keeps the last good answer beside the reason', async () => {
    answers = [{ status: 200, data: feed() }]
    const h = mountHook(() => useTimeOff(''), undefined)
    await h.settle(() => h.current.state.status === 'ready')
    assert.equal(h.current.state.data?.rows.length, 1)
    answers = [{ status: 503, message: 'the time off records could not be read (RuntimeError)' }]
    await h.current.refresh()
    await h.settle(() => h.current.state.status === 'failed')
    assert.equal(h.current.state.status, 'failed')
    assert.equal(h.current.state.data?.rows.length, 1)
    assert.match(h.current.state.error, /could not be read/)
    h.unmount()
  })
})
