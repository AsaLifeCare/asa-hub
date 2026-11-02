/**
 * Support Requests · the app, the rename of the old one, and the screen drawn whole: the off-white header (no black
 * hero), the toolbar (search, Show completed, Clear, the figures), the table (status icon, date, requestor with a
 * round avatar, the type pill, the description, the chevron, the row a button), a source that could not be read said
 * above the table, and the right side panel with the buttons the server offered — pressed twice, never a dialog.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { appManifests } from '@/registry/apps'
import { requestsManifests } from '@/registry/apps-requests'
import { SUPPORT_DESK_APP_ID, supportDeskManifests } from '@/registry/apps-support-desk'
import { CUSTOM_PAGES } from '@/pages/AppRoutePage'
import { badgeAllowsApp } from '@/lib/badgeAccess'
import { featureAllowsWith } from '@/lib/featureAccess'
import SupportDeskPage, { PAGE_SUB, STALE_LINE, SupportDeskView } from '@/pages/features/supportdesk/SupportDeskPage'
import SupportIncidentsPage from '@/pages/features/supportdesk/SupportIncidentsPage'
import { supportSwitchItems } from '@/pages/features/supportdesk/SupportPageSwitch'
import PageSwitchMenu, { type SwitchItem } from '@/components/shared/PageSwitchMenu'
import { DecisionBlock, PanelBody, RedirectPicker, useTwoPress } from '@/pages/features/supportdesk/RequestPanel'
import { SeatView } from '@/pages/features/supportdesk/SeatPanel'
import { SUPPORT_DESK_ACTIONS, type DeskState } from '@/pages/features/supportdesk/supportDeskLane'
import { TEST_MODE_PILL, boardFrom, seatFrom, type Row } from '@/pages/features/supportdesk/supportDeskModel'
import { PEOPLE, rawBoard, rawRow } from './fixtures/supportDesk'
import { mountHook } from './react-host'
import { SHELL_HIDDEN, primeShellHides } from '@/lib/myWorkHides'

// the screens below draw their test mode warnings, as Settings › My Work shows them when the switch says so
primeShellHides({ ...SHELL_HIDDEN, test_mode_warnings: false, support_desk_subtitle: false })

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const noop = () => {}
const FEATURE = 'src/pages/features/supportdesk'

const ready = (raw: Record<string, unknown>, over: Partial<DeskState> = {}): DeskState =>
  ({ status: 'ready', board: boardFrom(raw), error: '', refreshing: false, ...over })

const draw = (state: DeskState, opened = '', completed = false, initialQuery = '') => flat(renderToString(createElement(MemoryRouter,
  { initialEntries: ['/app/support-desk/requests'] },
  createElement(SupportDeskView, {
    state, completed, opened, busy: '', initialQuery, onCompleted: noop, onOpen: noop, onReload: noop, onDecide: noop, onAdp: noop,
  }))))

const ROWS = [
  rawRow(),
  rawRow({ ref: 'SE00AA11BB22', source: 'event', kind: 'late_show', status: { word: 'Directors, are you aware?', tone: 'warning' },
    date: '2026-09-30T12:10:00Z', requestor: { name: 'Maria Lopez', uid: '' },
    type: { raw: '', area: 'Attendance', label: 'Late Show', display: 'Attendance · Late Show' }, description: 'BM4060 · 8A-4P · Wed Sep 30',
    may: { approve: false, deny: false, resolve: false, aware: true, why: '' } }),
  rawRow({ ref: 'HQ82D0D7C86E', date: '2026-09-18', requestor: { name: '', uid: '' }, type: { raw: 'Other - General Requests' },
    description: 'Caller reached voicemail and left no details.', route: 'general' }),
]

describe('support desk — the app', () => {
  it('is one new app with two pages, registered once, right after Scheduling', () => {
    assert.equal(supportDeskManifests.length, 1)
    const m = supportDeskManifests[0]
    assert.equal(m.id, SUPPORT_DESK_APP_ID)
    assert.equal(m.id, 'support-desk')
    assert.equal(m.name, 'Support Requests')
    assert.equal(m.icon, 'life-buoy')
    assert.equal(m.accent, 'blue')
    assert.equal(m.category, 'Operations')
    assert.deepEqual(m.audience, ['admin', 'manager', 'staff'])
    assert.deepEqual(m.focusAudience, [])
    assert.deepEqual(m.pages.map((p) => p.id), ['requests', 'incidents'])
    assert.deepEqual(m.pages[0].dataSource, { resource: 'houses' }, 'a nominal source, never the supportQueue resource')
    // the Incident Log's rows, behind App Control's own control
    assert.deepEqual(m.pages[1].dataSource, { resource: 'uiIncidents' })
    assert.equal(m.pages[1].feature, 'support-desk.incidents')
    assert.equal(appManifests.filter((a) => a.id === SUPPORT_DESK_APP_ID).length, 1)
    const ids = appManifests.map((a) => a.id)
    assert.equal(ids.indexOf('support-desk'), ids.indexOf('scheduling') + 1)
  })

  it('its CUSTOM_PAGES route resolves to the page', async () => {
    assert.equal(await CUSTOM_PAGES['support-desk/requests'].load(), SupportDeskPage)
    assert.equal(await CUSTOM_PAGES['support-desk/incidents'].load(), SupportIncidentsPage)
  })

  it('Incidents is the master’s until App Control names badges on support-desk.incidents', () => {
    for (const types of [['STAFF'], ['HM', 'STAFF'], ['DIRECTOR'], ['ADMINISTRATOR']]) {
      assert.equal(featureAllowsWith('support-desk.incidents', { types, role: 'admin' }, {}), false, types.join(','))
    }
    assert.equal(featureAllowsWith('support-desk.incidents', { isMaster: true }, {}), true)
    const released = { 'support-desk.incidents': ['DIRECTOR'] }
    assert.equal(featureAllowsWith('support-desk.incidents', { types: ['DIRECTOR'], role: 'admin' }, released), true)
    assert.equal(featureAllowsWith('support-desk.incidents', { types: ['STAFF'], role: 'staff' }, released), false)
  })

  it('the page switch beside Refresh names only the pages the checker allows, and none when one is left', () => {
    const m = supportDeskManifests[0]
    const all = supportSwitchItems(m, 'admin', () => true)
    assert.deepEqual(all, [{ id: 'requests', title: 'Support Requests' }, { id: 'incidents', title: 'Incidents' }])
    const refused = supportSwitchItems(m, 'admin', (_app, page) => page !== 'incidents')
    assert.deepEqual(refused.map((p) => p.id), ['requests'])
    const drawn = (items: SwitchItem[]) => renderToString(createElement(MemoryRouter, null,
      createElement(PageSwitchMenu, { items, current: 'requests', onPick: () => {} })))
    assert.match(drawn(all), /aria-label="Go to another page of this app"/)
    assert.equal(drawn(refused), '')
    assert.deepEqual(supportSwitchItems(undefined, 'admin', () => true), [])
  })

  it('ships master-only: no badge opens it until a row is written in App Control', () => {
    for (const types of [['STAFF'], ['HM', 'STAFF'], ['DIRECTOR'], ['ADMINISTRATOR']]) {
      assert.equal(badgeAllowsApp(SUPPORT_DESK_APP_ID, { types, role: 'admin' }, {}), false, types.join(','))
    }
    assert.equal(badgeAllowsApp(SUPPORT_DESK_APP_ID, { isMaster: true }, {}), true)
    assert.equal(badgeAllowsApp(SUPPORT_DESK_APP_ID, { types: ['HM', 'STAFF'], role: 'staff' }, { [SUPPORT_DESK_APP_ID]: ['HM'] }), true)
  })

  it('calls only its own actions, each by its literal name', () => {
    assert.deepEqual([...SUPPORT_DESK_ACTIONS], ['supportDeskList', 'supportDeskDecide', 'supportDeskAdp', 'supportDeskSeat'])
    const lane = read(`${FEATURE}/supportDeskLane.ts`)
    for (const a of SUPPORT_DESK_ACTIONS) assert.ok(lane.includes(`'${a}'`), a)
    for (const f of readdirSync(resolve(ROOT, FEATURE))) {
      const src = read(join(FEATURE, f))
      for (const banned of ['commCallOffRecorded_', 'rpcCall_', 'schedulingAnswer']) assert.ok(!src.includes(banned), `${f}: ${banned}`)
    }
  })
})

describe('support desk — the old app is the Support Requests Queue', () => {
  it('keeps its id, its page and its route; only the name changes', () => {
    assert.equal(requestsManifests[0].id, 'support-requests')
    assert.equal(requestsManifests[0].name, 'Support Requests Queue')
    assert.deepEqual(requestsManifests[0].pages.map((p) => p.id), ['queue'])
    assert.ok('support-requests/queue' in CUSTOM_PAGES)
    assert.match(read('src/pages/features/requests/RequestsPage.tsx'), /title="Support Requests Queue"/)
    const profile = read('src/pages/features/users/ProfilePage.tsx')
    assert.ok(profile.includes('The Support Requests Queue owns these rows'))
    assert.ok(profile.includes('Open Support Requests Queue'))
    assert.ok(profile.includes("navigate('/app/support-requests/queue')"))
  })
})

describe('support desk — the screen', () => {
  it('an off-white header with its sentence, no black hero; the test-mode pill when texts are rehearsed', () => {
    const html = draw(ready(rawBoard(ROWS)))
    assert.ok(html.includes('>Support Requests</h1>') && html.includes(PAGE_SUB))
    // Settings › My Work keeps the line under the title to the master
    primeShellHides({ ...SHELL_HIDDEN, test_mode_warnings: false })
    assert.ok(!draw(ready(rawBoard(ROWS))).includes(PAGE_SUB))
    primeShellHides({ ...SHELL_HIDDEN, test_mode_warnings: false, support_desk_subtitle: false })
    assert.ok(html.includes(TEST_MODE_PILL))
    assert.ok(!/bg-black|bg-\[#0|AppHero|data-hero/.test(html))
    assert.ok(!draw(ready(rawBoard(ROWS, { test_mode: { on: false, readable: true, why: '' } }))).includes(TEST_MODE_PILL))
    for (const f of readdirSync(resolve(ROOT, FEATURE))) assert.ok(!/AppHero|bg-black/.test(read(join(FEATURE, f))), f)
  })

  it('the toolbar: the search, Show completed, Clear and the server\'s figures', () => {
    const html = draw(ready(rawBoard(ROWS, { counts: { open: 3, waiting_on_me: 2, warnings: 1, completed: 5 } })))
    assert.ok(html.includes('placeholder="Search ID, requestor, type or description"'))
    assert.ok(html.includes('aria-label="Show completed"') && html.includes('Show completed'))
    assert.ok(html.includes('data-act="clear"'))
    assert.match(html, /data-count="open"[^>]*>Open <span[^>]*>3</)
    assert.match(html, /data-count="waiting_on_me"[^>]*>Waiting on you <span[^>]*>2</)
    assert.match(html, /data-count="warnings"[^>]*>Warnings <span[^>]*>1</)
  })

  it('the table: Status, Date (sortable), Requestor, Request Type, Description; each row a button, newest first', () => {
    const html = draw(ready(rawBoard(ROWS)))
    for (const h of ['Status', 'Requestor', 'Request Type', 'Description']) assert.ok(html.includes(`>${h}</span>`), h)
    assert.ok(html.includes('data-sort="desc"') && html.includes('Date, newest first'))
    const order = [...html.matchAll(/data-row="([^"]+)"/g)].map((m) => m[1])
    assert.deepEqual(order, ['SE00AA11BB22', 'HQ82D0D7C86E', 'HQ5EF1CB5F25'])
    assert.match(html, /<button type="button" data-row="HQ5EF1CB5F25"/)
    assert.ok(html.includes('aria-label="New"') && html.includes('data-status-icon="dot"'))
    assert.ok(html.includes('aria-label="Directors, are you aware?"') && html.includes('data-status-icon="triangle-alert"'))
    assert.match(html, /data-type-pill="amber"[^>]*>Operations · Vehicle Issue</)
    assert.match(html, /data-type-pill="danger"[^>]*>Attendance · Late Show</)
    assert.match(html, /data-type-pill="slate"[^>]*>Other · General Requests</)
    assert.ok(html.includes('Jan 27, 2026 10:04 AM'), 'Ohio words')
    assert.ok(html.includes('Unknown caller'))
    assert.ok(html.includes('rounded-full'), 'round avatars')
    assert.ok(!/<button[^>]*data-verdict/.test(html), 'nothing is decided in a row')
  })

  it('the search drawn: only the matching rows', () => {
    const html = draw(ready(rawBoard(ROWS)), '', false, 'voicemail')
    assert.deepEqual([...html.matchAll(/data-row="([^"]+)"/g)].map((m) => m[1]), ['HQ82D0D7C86E'])
    assert.ok(draw(ready(rawBoard(ROWS)), '', false, 'zzz').includes('Nothing matches the search.'))
  })

  it('a source that could not be read is said above the table, never as "no requests"', () => {
    const html = draw(ready(rawBoard([], { sources: [{ key: 'queue', state: 'ready', why: '', count: 0 },
      { key: 'scheduling', state: 'unreadable', why: "Scheduling's houses are not set up yet" }] })))
    assert.ok(html.includes('data-source-why="scheduling"'))
    assert.ok(html.includes('Scheduling could not be read'))
    assert.ok(!html.includes('No open requests.'))
  })

  it('reading draws the table\'s shape; a failed first read says so; a failed refresh keeps the last answer', () => {
    assert.ok(draw({ status: 'loading', board: null, error: '', refreshing: true }).includes('data-skeleton=""'))
    const failed = draw({ status: 'failed', board: null, error: 'timeout', refreshing: false })
    assert.ok(failed.includes('Support Requests could not be read: Timeout.') && failed.includes('Nothing is listed rather than an empty list.'))
    const stale = draw(ready(rawBoard(ROWS), { error: 'timeout' }))
    assert.ok(stale.includes(STALE_LINE) && stale.includes('data-row="HQ5EF1CB5F25"'))
  })

  it('an address naming a request not on the list says so once the completed ones are shown', () => {
    const html = draw(ready(rawBoard(ROWS)), 'HQ0000000000', true)
    assert.ok(html.includes('data-missing="HQ0000000000"') && html.includes('is not on the list any more'))
    assert.ok(!draw(ready(rawBoard(ROWS)), 'HQ5EF1CB5F25', true).includes('data-missing'))
  })

  it('a row the answer carried in a shape this screen cannot read is said', () => {
    const html = draw(ready(rawBoard([rawRow(), { nope: true }])))
    assert.ok(html.includes('One request came back in a shape this screen cannot read'))
  })
})

describe('support desk — the side panel', () => {
  const viewer = boardFrom(rawBoard()).viewer
  const NONE = { approve: false, deny: false, resolve: false, aware: false, redirect: false, why: '' }
  const rowOf = (over: Record<string, unknown> = {}): Row => boardFrom(rawBoard([rawRow(over)])).rows[0]
  const body = (r: Row, v = viewer) => flat(renderToString(createElement(MemoryRouter, null,
    createElement(PanelBody, { row: r, viewer: v, busy: '', onAdp: noop }))))
  const decision = (r: Row, picking = false) => flat(renderToString(createElement(DecisionBlock,
    { row: r, people: PEOPLE, peopleWhy: '', busy: '', onDecide: noop, initiallyPicking: picking })))
  const verdictsIn = (html: string) => [...html.matchAll(/data-verdict="([a-z]+)"/g)].map((m) => m[1])
  const panelSrc = () => read(`${FEATURE}/RequestPanel.tsx`)

  it('is the standard 384px panel — never the wide one — with the decision right under the request, never a footer', () => {
    const src = panelSrc()
    const opening = /<SidePanel [^>]*>/.exec(src)?.[0] ?? ''
    assert.ok(opening && !/\bwide\b/.test(opening) && !/footer=/.test(opening), opening)
    assert.ok(!/\bwide\b/.test(read(`${FEATURE}/SeatPanel.tsx`).replace(/\/\*[\s\S]*?\*\//, '')), 'My Work\'s panel is the standard one too')
    const html = draw(ready(rawBoard(ROWS)), 'HQ5EF1CB5F25')
    const panel = html.slice(html.indexOf('data-panel="HQ5EF1CB5F25"'))
    assert.ok(panel.includes('data-history=""') && panel.includes('data-decision=""'))
    assert.ok(panel.indexOf('data-history=""') < panel.indexOf('data-decision=""'), 'history, then the decision')
    assert.ok(html.includes('sm:w-[384px]') && !html.includes('xl:w-['), 'the standard width, never a wider panel')
  })

  it('compact: the status, type and urgency chips, the requestor\'s round avatar, the description, the facts two by two, the history', () => {
    const r = rowOf({ history: [{ at: '2026-09-18T18:24:00Z', by: 'Ty Bond', verdict: 'approved', note: 'Van swapped', via: 'support-desk' }],
      details: [{ label: 'Urgency', value: 'High' }, { label: 'Call ID', value: 'AC123' }, { label: 'Received', value: 'Jan 27, 2026 10:04 AM' },
        { label: 'Notes', value: 'A long note about the van that will not fit into one of the two columns at all.' }] })
    const html = body(r)
    assert.ok(!html.includes('>Urgency</dt>'), 'the urgency is a chip, never said twice')
    const chips = html.slice(html.indexOf('data-chips=""'), html.indexOf('data-requestor=""'))
    assert.ok(chips.includes('data-status-word=""') && chips.includes('>New<'))
    assert.ok(chips.includes('data-type-pill=') && chips.includes('Operations · Vehicle Issue'))
    assert.ok(chips.includes('data-urgency=""') && chips.includes('>High<'))
    assert.ok(/data-requestor=""[\s\S]*>TB<\/span>[\s\S]*>Ty Bond</.test(html), 'the avatar (the platform\'s, initials when no photo) before the name')
    assert.ok(html.includes('Waiting on Ty Bond, Brittany Anderson'))
    assert.ok(html.includes('Van broke down on Route 62, stranded with client'))
    assert.ok(/data-details=""[^>]*grid-cols-2/.test(html) || /grid-cols-2[^"]*"[^>]*data-details=""/.test(html), 'facts two by two')
    assert.ok(html.includes('Call ID') && html.includes('AC123'))
    assert.match(html, /class="min-w-0 col-span-2"><dt[^>]*>Notes</, 'a long fact spans both columns')
    assert.ok(html.includes('Approved</span> by Ty Bond') && html.includes('Van swapped') && html.includes('Support Requests'))
    assert.ok(!html.includes('>Requestor<') && !html.includes('>Description<'), 'no heading where the thing speaks for itself')
  })

  it('a redirect in the history: "Redirected to Ann Roe by Ty Bond · the note"', () => {
    const html = body(rowOf({ history: [{ at: '2026-10-01T15:00:00Z', by: 'Ty Bond', verdict: 'redirected', note: 'Please call her back',
      via: 'support-desk', to: 'Ann Roe' }] }))
    assert.match(html, /<span class="font-semibold">Redirected to Ann Roe<\/span> by Ty Bond<span[^>]*> · Please call her back<\/span>/)
    assert.ok(html.includes('data-history-line="redirected"'))
  })

  it('a director\'s request: the note and four answers — Approve, Deny, Resolved, Redirect — each pressed twice', () => {
    const html = decision(rowOf())
    assert.deepEqual(verdictsIn(html), ['approve', 'deny', 'resolve', 'redirect'])
    for (const w of ['>Approve<', '>Deny<', '>Resolved<', '>Redirect<']) assert.ok(html.includes(w), w)
    assert.ok(html.includes('data-note=""') && html.includes('maxLength="500"'))
    assert.ok(/data-verdicts=""[^>]*grid-cols-2|grid-cols-2[^"]*"[^>]*data-verdicts=""/.test(html), 'two by two')
    assert.ok(!html.includes('disabled=""') && !html.includes('data-why') && !html.includes('data-picker'))
    const src = panelSrc()
    assert.ok(src.includes('export const ARM_MS = 4000'))
    assert.match(src, /onClick=\{\(\) => two\.press\(v, \(\) => onDecide\(row, v, note\)\)\}/, 'Approve, Deny and Resolved: the two presses')
    assert.match(src, /two\.press\(sendId, \(\) => onDecide\(row, 'redirect', note, to\.uid\)\)/, 'Redirect to a person: the two presses')
    assert.ok(read(`${FEATURE}/supportDeskModel.ts`).includes("armed: 'Press again to approve'"))
  })

  it('the master\'s request: all four drawn, Approve and Deny greyed with the reason; Resolved and Redirect pressable', () => {
    const why = 'Only the directors approve or deny.'
    const html = decision(rowOf({ may: { ...NONE, resolve: true, redirect: true, why } }))
    assert.deepEqual(verdictsIn(html), ['approve', 'deny', 'resolve', 'redirect'])
    assert.match(html, /data-verdict="approve"[^>]*disabled=""/)
    assert.match(html, /data-verdict="deny"[^>]*disabled=""/)
    assert.doesNotMatch(html, /data-verdict="resolve"[^>]*disabled=""/)
    assert.doesNotMatch(html, /data-verdict="redirect"[^>]*disabled=""/)
    assert.ok(html.includes(why) && html.includes('data-note=""'))
  })

  it('Redirect opens the people to hand it to — searchable, each with a round avatar — and sends only once one is chosen', () => {
    const closed = decision(rowOf())
    assert.match(closed, /data-verdict="redirect" aria-expanded="false"/)
    const html = decision(rowOf(), true)
    assert.match(html, /data-verdict="redirect" aria-expanded="true"/)
    assert.ok(html.includes('data-picker=""') && html.includes('placeholder="Search people"'))
    assert.deepEqual([...html.matchAll(/data-person="([^"]+)"/g)].map((m) => m[1]), PEOPLE.map((p) => p.uid))
    const picker = html.slice(html.indexOf('data-picker=""'))
    for (const ini of ['RB', 'AR', 'BA']) assert.match(picker, new RegExp(`>${ini}</span>`), `an avatar before ${ini}`)
    assert.match(html, /data-redirect-send=""[^>]*disabled=""[^>]*>Choose who to redirect it to</)
    const filtered = flat(renderToString(createElement(RedirectPicker, { people: PEOPLE, why: 'One name is worn by two live accounts.',
      chosen: PEOPLE[1], onChoose: noop, initialQuery: 'roe' })))
    assert.deepEqual([...filtered.matchAll(/data-person="([^"]+)"/g)].map((m) => m[1]), ['USR_AN'])
    assert.match(filtered, /data-person="USR_AN" aria-pressed="true"/)
    assert.ok(filtered.includes('data-people-why=""') && filtered.includes('One name is worn by two live accounts.'))
    const none = flat(renderToString(createElement(RedirectPicker, { people: PEOPLE, why: '', chosen: null, onChoose: noop, initialQuery: 'zz' })))
    assert.ok(none.includes('Nobody matches the search.'))
  })

  it('a warning offers I\'m aware alone', () => {
    const html = decision(rowOf({ ref: 'SE00AA11BB22', source: 'event', kind: 'late_show', may: { ...NONE, aware: true } }))
    assert.deepEqual(verdictsIn(html), ['aware'])
    assert.ok(html.includes('I’m aware') && html.includes('col-span-2'))
  })

  it('nothing offered: the row\'s own buttons greyed with the server\'s reason (the master on a Scheduling row)', () => {
    const why = 'Waiting on Ty Bond, Brittany Anderson — the first answer decides'
    const html = decision(rowOf({ ref: 'SF0123456789', source: 'scheduling', kind: 'time_off', may: { ...NONE, why } }))
    assert.deepEqual(verdictsIn(html), ['approve', 'deny'])
    assert.equal((html.match(/disabled=""/g) ?? []).length, 2)
    assert.ok(html.includes(`${why}.`))
    assert.ok(!html.includes('data-note'))
  })

  it('a closed request says so, with no button', () => {
    const html = decision(rowOf({ completed: true, may: NONE }))
    assert.ok(html.includes('data-closed=""') && html.includes('This request is closed.') && !html.includes('data-verdict'))
  })

  it('the first press arms, the second does it, and an armed press undoes itself', async () => {
    const h = mountHook(() => useTwoPress(), {})
    let done = 0
    h.run(() => h.current.press('approve', () => { done++ }))
    assert.deepEqual([h.current.armed, done], ['approve', 0])
    h.run(() => h.current.press('deny', () => { done++ }))
    assert.deepEqual([h.current.armed, done], ['deny', 0], 'another press arms that one instead')
    h.run(() => h.current.press('deny', () => { done++ }))
    assert.deepEqual([h.current.armed, done], ['', 1])
    h.run(() => h.current.press('resolve', () => { done++ }))
    h.run(() => h.current.disarm())
    assert.deepEqual([h.current.armed, done], ['', 1])
    h.unmount()
  })

  it('the ADP block: a director approves a ready change; the master only reads it', () => {
    const r = rowOf({ adp: { state: 'ready', field: 'email', words: 'Add abc123@gmail.com to Joan Cheruiyot’s e-mails', proof: 'ABCDEF0123', why: '' } })
    const html = body(r)
    assert.ok(html.includes('data-adp="ready"') && html.includes('Ready to approve') && html.includes('Joan Cheruiyot’s e-mails'))
    assert.ok(html.includes('data-adp-press="approve"'))
    const master = body(r, { ...viewer, is_master: true, is_director: false, can_decide: false })
    assert.ok(!master.includes('data-adp-press') && master.includes('Only the directors approve or undo this change.'))
    const applied = body(rowOf({ adp: { state: 'applied', field: 'address', words: '', proof: 'P', why: '' } }))
    assert.ok(applied.includes('data-adp-press="undo"') && applied.includes('ADP still needs the change'))
  })

  it('Scheduling\'s seats are drawn', () => {
    const html = body(rowOf({ ref: 'SF0123456789', source: 'scheduling', kind: 'swap',
      sched: { flow_id: 'SF0123456789', state: 'waiting_manager', item_id: '', words: [], seats: [{ seat: 'house_manager', state: 'waiting', to: ['Mia Manager'], by: '', at: '', note: '' }] } }))
    assert.ok(html.includes('data-seats=""') && html.includes('house manager') && html.includes('Mia Manager'))
  })

  it('no dialog anywhere in the app: no window.confirm, askPrompt, ConfirmDialog, Dialog import or aria-modal', () => {
    for (const f of readdirSync(resolve(ROOT, FEATURE))) {
      const src = read(join(FEATURE, f))
      assert.doesNotMatch(src, /window\.(confirm|alert|prompt)\(|askPrompt|askConfirm|ConfirmDialog|aria-modal|role="dialog"/, f)
      assert.doesNotMatch(src, /import[^;]*\b\w*Dialog\b[^;]*from/, f)
    }
    assert.ok(read(`${FEATURE}/RequestPanel.tsx`).includes("import SidePanel from '@/components/shared/SidePanel'"))
    assert.ok(read(`${FEATURE}/SeatPanel.tsx`).includes("import SidePanel from '@/components/shared/SidePanel'"))
  })
})

describe('support desk — a request redirected to you, opened from My Work', () => {
  const seatOf = (over: Record<string, unknown> = {}) => seatFrom({
    ok: true, people: PEOPLE, people_why: '',
    row: rawRow({ ref: 'HQ6EEF063DEE', type: { raw: 'Payroll' }, requestor: { name: 'Angel Fiber', uid: '' }, route: 'payroll',
      description: 'Missing paycheck for last week', status: { word: 'Redirected to Ann Roe', tone: 'waiting' }, waiting_on: ['Ann Roe'],
      history: [{ at: '2026-10-01T15:00:00Z', by: 'Ty Bond', verdict: 'redirected', note: 'Please call her back', via: 'support-desk', to: 'Ann Roe' }],
      ...over }),
    viewer: { uid: 'USR_AN', name: 'Ann Roe', is_master: false, is_director: false, is_lead: false, can_decide: false },
  })
  const seatDraw = (state: Parameters<typeof SeatView>[0]['state']) => flat(renderToString(createElement(MemoryRouter, null,
    createElement(SeatView, { open: true, requestRef: 'HQ6EEF063DEE', title: 'Payroll from Angel Fiber', state, busy: '',
      onClose: noop, onDecide: noop, onReload: noop }))))

  it('the same standard panel: the request whole, who redirected it, and its four answers with the people to pass it on to', () => {
    const html = seatDraw({ status: 'ready', seat: seatOf(), error: '' })
    assert.ok(html.includes('aria-label="HQ6EEF063DEE"') && html.includes('>Payroll<'))
    assert.ok(html.includes('Redirected to Ann Roe') && html.includes('Missing paycheck for last week') && html.includes('Angel Fiber'))
    assert.match(html, /Redirected to Ann Roe<\/span> by Ty Bond<span[^>]*> · Please call her back/)
    assert.deepEqual([...html.matchAll(/data-verdict="([a-z]+)"/g)].map((m) => m[1]), ['approve', 'deny', 'resolve', 'redirect'])
    assert.ok(!html.includes('disabled=""') && html.includes('sm:w-[384px]') && !html.includes('xl:w-['))
    assert.ok(!html.includes('data-decision-panel'), 'never the Approve / Decline panel of Scheduling')
  })

  it('while it is read the row\'s own words are the title; a read that fails says why and offers to read again', () => {
    const loading = seatDraw({ status: 'loading', seat: null, error: '' })
    assert.ok(loading.includes('Payroll from Angel Fiber') && loading.includes('data-seat-loading=""') && !loading.includes('data-verdict'))
    const failed = seatDraw({ status: 'failed', seat: null, error: 'that request is not waiting on you any more' })
    assert.ok(failed.includes('data-seat-failed=""') && failed.includes('That request is not waiting on you any more.') && failed.includes('Try again'))
  })
})
