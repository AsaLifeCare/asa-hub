/**
 * LOCATIONS · the screen: the app and who may open it, the sections drawn whole, the one right panel in every mode,
 * and the Apps Script doors each read and write goes through (answered here at `fetch`, with the door's envelope).
 *
 * The app is the master's until it is released: no App Control row ships, and the page is mounted only through
 * CUSTOM_PAGES, behind the resolver's badge check. Nothing in it is a dialog — the switcher is a listbox, Actions a
 * menu, and every form, detail and share is the SidePanel aside. A document opens centred, large, in the platform's
 * own viewer, from its bytes.
 */
import { after, afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveObjectURL } from 'node:buffer'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { badgeAllowsApp, useBadgeAccessStore } from '@/lib/badgeAccess'
import { isAllowedWith } from '@/lib/appAccess'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { appManifests } from '@/registry/apps'
import { locationsManifests } from '@/registry/apps-locations'
import AppRoutePage, { CUSTOM_PAGES } from '@/pages/AppRoutePage'
import SidePanel from '@/components/shared/SidePanel'
import type { HouseRow } from '@/pages/features/houses/houseModel'
import LocationsPage, { LocationsScreen } from '@/pages/features/locations/LocationsPage'
import LocationPanel from '@/pages/features/locations/LocationPanel'
import { ActionsMenu } from '@/pages/features/locations/LocationActions'
import { SwitcherList } from '@/pages/features/locations/HouseSwitcher'
import { OverviewView } from '@/pages/features/locations/tabs/Overview'
import { StaffView } from '@/pages/features/locations/tabs/Staff'
import Calendar from '@/pages/features/locations/tabs/Calendar'
import { SuppliesView } from '@/pages/features/locations/tabs/Supplies'
import { RepairsView } from '@/pages/features/locations/tabs/Repairs'
import { IncidentsView } from '@/pages/features/locations/tabs/Incidents'
import { DocumentsView } from '@/pages/features/locations/tabs/Documents'
import {
  ACTION_GROUPS, NOT_MEASURED, NOT_OPEN, documentsOf, incidentsOf, notesOf,
  overviewOf, panelOf, repairsOf, sharePayloadFor, staffOf, suppliesOf, tabsFor,
  type PanelAsk,
} from '@/pages/features/locations/locationModel'
import {
  IDLE, LocationViewerContext, addNote, addSupplyEntry, fileIstPaper, forgetLocationReads, locationWritten,
  readDocuments, readIncidents, readKey, readLocationScope, readNotes, readOverview, readRepairs, readStaff,
  readSupplies, setNoteState, useLocationDoc, useLocationRead, useLocationScope, type LocationDocOpener, type LocationViewer,
  type ReadState,
} from '@/pages/features/locations/useLocation'
import { holdToHouses } from '@/pages/features/locations/locationReads'
import { DOC_FAILED_TITLE } from '@/lib/platformDoc'
import { useFileViewerStore } from '@/stores/useFileViewerStore'
import { useToastStore } from '@/stores/useToastStore'
import { mountHook } from './react-host'
import { SHELL_HIDDEN, SHELL_SHOWN, primeShellHides, shellHidesOf } from '@/lib/myWorkHides'

// the sections Settings › My Work can hide are drawn as a session it shows them to sees them
primeShellHides(SHELL_SHOWN)

// motion mounts its projection nodes against the window; a screen drawn whole reaches them
for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const FEATURE = 'src/pages/features/locations'
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))
const noop = () => {}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;')
const noModal = (html: string, what: string) => {
  assert.ok(!html.includes('aria-modal'), `${what}: no aria-modal`)
  assert.ok(!html.includes('role="dialog"') && !html.includes('role="alertdialog"'), `${what}: no dialog role`)
}
const idleDoc: LocationDocOpener = { opening: '', open: noop }
const ready = <T,>(data: T): ReadState<T> => ({ status: 'ready', data, error: '', refreshing: false })
const failed = <T,>(error: string): ReadState<T> => ({ status: 'failed', data: null, error, refreshing: false })

type El = { type: unknown; props: Record<string, unknown> }

/** Every element of a tree as a component returned it, without drawing any. */
function elements(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) elements(n, out)
    return out
  }
  if (!node || typeof node !== 'object' || !('props' in node)) return out
  const el = node as El
  out.push(el)
  elements(el.props.children, out)
  return out
}

function walk(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n)
    return statSync(resolve(ROOT, p)).isDirectory() ? walk(p) : [p]
  })
}

const POLICIES = ['Company Policies', 'Medical Policies and Procedures', 'Med Del Cat 1', 'Med Del Cat 2', 'Med Del Cat 3 Part 1',
  'Med Del Cat 3 Part 2', 'Bill of Rights - ER', 'MUI Handbook'].map((title, i) => ({ title, url: `https://drive.google.com/file/d/policy${i}xxxxx/view`, audience: 'all' }))

function house(over: Partial<HouseRow> = {}): HouseRow {
  return {
    id: 'NW4045', code: 'NW4045', label: 'CAN - NW - NW4045', title: 'Arlington', city: 'Canton', active: true,
    address: '908 Arlington Ave NW, Canton, OH 44708', photo: { src: '', source: '' }, managers: [], leads: [],
    clients: [{ name: 'Kenny Marsh', client_id: 'C1', client_key: 'kennymarsh' }, { name: 'Lia Gomez', client_id: 'C2' }],
    client_count: 2, staff: [], staff_source: '', week_notes: [], policies: POLICIES, sources: [], ...over,
  }
}
const HOUSES = [house(), house({ id: 'BW1', code: 'BW1001', title: 'Briarwood' }), house({ id: 'OL', code: 'OL2002', title: 'Oldfield', active: false })]
const H = HOUSES[0]
const SHARE = sharePayloadFor(H, 'overview', null)

const MASTER = { id: 'u-boss', name: 'Boss', email: 'boss@example.org', role: 'admin', types: [], isMaster: true }
const DIRECTOR = { id: 'u-dir', name: 'Dee Rector', email: 'dee@example.org', role: 'admin', types: ['DIRECTOR'], isMaster: false }
const signIn = (user: unknown) => useAuthStore.setState({ user } as never)

/* ---------- the app ---------- */

describe('the app', () => {
  after(() => useAuthStore.setState({ user: null, token: null } as never))

  it('is "Locations", one page "overview", for admins and managers, in the registry once', () => {
    const app = locationsManifests[0]
    assert.equal(app.id, 'locations')
    assert.equal(app.name, 'Locations')
    assert.deepEqual(app.pages.map((p) => [p.id, p.title]), [['overview', 'Overview']])
    assert.deepEqual([app.audience, app.focusAudience], [['admin', 'manager', 'client'], []])
    assert.equal(appManifests.filter((m) => m.id === 'locations').length, 1)
  })

  it('is mounted only through CUSTOM_PAGES, never on a static route', async () => {
    // a lazy chunk (lib/lazyPage): the entry resolves to the screen itself
    assert.equal(await CUSTOM_PAGES['locations/overview'].load(), LocationsPage)
    assert.ok(!readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8').includes('locations'), 'no static route in App.tsx')
  })

  it('ships no App Control row: a non-master admin is refused, the master passes', () => {
    assert.equal(badgeAllowsApp('locations', DIRECTOR, {}), false)
    assert.equal(badgeAllowsApp('locations', { ...DIRECTOR, role: 'manager' }, { houses: ['DIRECTOR'] }), false)
    assert.equal(badgeAllowsApp('locations', MASTER, {}), true)
    const hits: string[] = []
    for (const dir of ['apps-script', 'tools', 'server']) {
      for (const name of readdirSync(resolve(ROOT, dir))) {
        if (!/\.(gs|py|mjs|js|json)$/.test(name)) continue
        const text = readFileSync(join(resolve(ROOT, dir), name), 'utf8')
        if (/app_badge_access[^\n]{0,200}['"]locations['"]|['"]locations['"][^\n]{0,200}app_badge_access/.test(text)) hits.push(name)
      }
    }
    assert.deepEqual(hits, [])
  })

  it('a non-master is refused through CUSTOM_PAGES; nothing of the screen is drawn. The master gets the screen', async () => {
    // the screen's chunk is in before the render, so the master's render draws it rather than a fallback
    await CUSTOM_PAGES['locations/overview'].load()
    useRegistryStore.setState({ apps: appManifests })
    useBadgeAccessStore.setState({ rules: {}, tenantRules: {}, configRules: {} } as never)
    useMemberStore.setState({ currentMemberId: '' } as never)
    const open = () => flat(renderToString(createElement(MemoryRouter, { initialEntries: ['/app/locations/overview?house=NW4045'] },
      createElement(Routes, null, createElement(Route, { path: '/app/:appId/:pageId', element: createElement(AppRoutePage) })))))
    signIn(DIRECTOR)
    assert.equal(isAllowedWith(appManifests, 'admin', 'locations'), false)
    assert.ok(!open().includes('data-locations'), 'a director sees nothing of it')
    signIn(MASTER)
    assert.equal(isAllowedWith(appManifests, 'admin', 'locations'), true)
    assert.ok(open().includes('data-locations'), 'the master gets the screen')
  })
})

describe('no modal anywhere', () => {
  it('no browser dialog, no Dialog or Sheet, no modal record form or lightbox, no delete; the viewer only through the platform\'s door', () => {
    for (const file of walk(FEATURE)) {
      const text = readFileSync(resolve(ROOT, file), 'utf8')
      assert.doesNotMatch(text, /window\.(confirm|alert|prompt)\(/, file)
      assert.doesNotMatch(text, /import[^;]*\b\w*(Dialog|Sheet)\b[^;]*from/, file)
      assert.doesNotMatch(text, /from '[^']*(ui\/dialog|ui\/sheet)'/, file)
      assert.doesNotMatch(text, /<OpsRecordModal|<ConfirmDialog|askConfirm|ImageLightbox|components\/shared\/FileViewer|openFile\(/, file)
      assert.doesNotMatch(text, /aria-modal|role="dialog"/, file)
      assert.doesNotMatch(text, /api\.(remove|delete)\(|'delete'|Delete/, file)
    }
    assert.match(readFileSync(resolve(ROOT, FEATURE, 'useLocation.ts'), 'utf8'), /usePlatformDoc\(readRefusal\)/)
  })

  it('the panel is the narrow SidePanel aside in every mode: nothing in it frames a document', () => {
    const asks: PanelAsk[] = [
      ...ACTION_GROUPS.flatMap((g) => g.items.map((i) => i.ask)),
      { kind: 'share' }, { kind: 'staff', name: 'Noah Reed' },
      { kind: 'ist', staff: 'Noah Reed', client: 'Kenny Marsh' }, { kind: 'repair-row', id: 'r1' }, { kind: 'incident-row', id: 'r1' },
      { kind: 'supply', entry: 'count', item: '' },
    ]
    assert.deepEqual(ACTION_GROUPS.flatMap((g) => g.items.map((i) => i.label)), ['House Notes', 'New Incident', 'New House Repair'])
    for (const ask of asks) {
      const html = draw(<LocationPanel ask={ask} house={H} share={SHARE} onAsk={noop} onClose={noop} />)
      assert.match(html, /<aside aria-label="/, ask.kind)
      assert.ok(html.includes('sm:w-[384px]') && !html.includes('xl:w-['), `${ask.kind}: the standard width`)
      assert.ok(!html.includes('<iframe') && !html.includes('<img'), `${ask.kind}: no document framed`)
      noModal(html, ask.kind)
    }
    assert.equal(draw(<LocationPanel ask={null} house={H} share={SHARE} onAsk={noop} onClose={noop} />), '')
    const narrow = draw(<SidePanel open onClose={noop} label="Staff" title="x"><p>child</p></SidePanel>)
    assert.match(narrow, /<aside aria-label="Staff"/)
    assert.ok(narrow.includes('sm:w-[384px]') && !narrow.includes('xl:w-['))
    const asked = draw(<SidePanel open onClose={noop} label="Staff" title="x" wide><p>child</p></SidePanel>)
    assert.ok(asked.includes('sm:w-[384px]') && !asked.includes('xl:w-['), 'asking for a wide panel still draws the standard one')
  })

  it('the Actions menu is a menu and the switcher a listbox', () => {
    const menu = draw(<ActionsMenu onPick={noop} />)
    assert.match(menu, /role="menu"/)
    assert.equal((menu.match(/role="menuitem"/g) ?? []).length, 3)
    noModal(menu, 'actions')
    const list = draw(<SwitcherList houses={HOUSES} current="NW4045" query="" onQuery={noop} inactive={false} onInactive={noop} onPick={noop} />)
    assert.match(list, /role="listbox"/)
    noModal(list, 'switcher')
  })

  it('a document is a button that opens it centred from its bytes — no Drive link, no public link, no new tab', () => {
    const html = draw(<DocumentsView house={H} docs={IDLE as ReadState<never>} doc={idleDoc} onRetry={noop} />)
    assert.equal((html.match(/data-open-doc="policy\dxxxxx"/g) ?? []).length, 8)
    assert.ok(!html.includes('drive.google.com') && !html.includes('target="_blank"') && !html.includes('href="blob:'))
    assert.equal(panelOf('doc~policy-policy3xxxxx'), null, 'a document never rides the panel')
    for (const file of walk(FEATURE)) {
      const code = readFileSync(resolve(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      assert.doesNotMatch(code, /\/preview|toEmbedUrl|webViewLink|anyoneWithLink/, file)
    }
  })

  it('the forms file on the second press of "Review draft"', () => {
    for (const ask of [{ kind: 'notes' }, { kind: 'incident' }, { kind: 'repair' }] as PanelAsk[]) {
      const html = draw(<LocationPanel ask={ask} house={H} share={SHARE} onAsk={noop} onClose={noop} />)
      assert.ok(html.includes('data-press="review"') && html.includes('Review draft'), ask.kind)
    }
    const notes = draw(<LocationPanel ask={{ kind: 'notes' }} house={H} share={SHARE} onAsk={noop} onClose={noop} />)
    assert.ok(notes.includes('>Choose client</option>') && notes.includes('>Kenny Marsh</option>') && notes.includes('value="Arlington"'))
    const incident = draw(<LocationPanel ask={{ kind: 'incident' }} house={H} share={SHARE} onAsk={noop} onClose={noop} />)
    assert.ok(incident.includes('>Lia Gomez</option>'), 'the client is one of the house\'s')
    assert.ok(incident.includes('>Medication related error</option>') && incident.includes('>Client Home</option>') &&
      incident.includes('>Other</option>'), 'category and location are picked')
    for (const said of ['Summary of Incident', 'Please describe the events before, during and directly after the incident.',
      'Immediate Action Taken', 'Cause and Contributing Factors', 'Prevention Plan']) assert.ok(incident.includes(said), said)
    for (const gone of ['Filed in the estate', 'the form’s own list', 'New Incident']) assert.ok(!incident.includes(gone), gone)
    const other = { ...H, code: 'NW9999', address: '1 Other St NW', active: true }
    const shut = { ...H, code: 'NW0000', address: '2 Closed St NW', active: false }
    const repair = draw(<LocationPanel ask={{ kind: 'repair' }} house={H} houses={[H, other, shut]} share={SHARE}
      onAsk={noop} onClose={noop} />)
    assert.ok(repair.includes(`value="${H.address}"`), 'the house prefilled')
    assert.ok(/<select[^>]*id="loc-select_address_vehicle"/.test(repair), 'the house is picked from the locations')
    assert.ok(repair.includes('value="1 Other St NW"') && !repair.includes('2 Closed St NW'), 'every active location')
    for (const gone of ['What needs fixing', 'Still needed', 'Filed in the estate', 'New House Repair']) {
      assert.ok(!repair.includes(gone), gone)
    }
  })

  it('share: copy the link, copy text, download, print — no e-mail composer', () => {
    const html = draw(<LocationPanel ask={{ kind: 'share' }} house={H} share={SHARE} onAsk={noop} onClose={noop} />)
    assert.ok(html.includes('/app/locations/overview?house=NW4045'))
    for (const w of ['Copy', 'Copy text', 'Download', 'Print']) assert.match(html, new RegExp(`>\\s?${w}<`), w)
    assert.ok(!/Email/i.test(html))
  })
})

/* ---------- the sections ---------- */

describe('the shell', () => {
  const houses = { rows: HOUSES, failed: '', loading: false, reload: noop }

  it('draws the top card on the platform\'s own surface with the switcher, Share and Actions, the photo and the seven sections', () => {
    const html = draw(<LocationsScreen houses={houses} wanted="NW4045" house={H} tab="staff"
      onHouse={noop} onTab={noop} onAsk={noop} />)
    assert.match(html, /rounded-\[16px\] border border-border bg-surface [^"]*shadow-1[^"]*" data-top-bar=""/)
    const bar = html.slice(html.indexOf('data-top-bar'), html.indexOf('data-rail'))
    assert.ok(bar.includes('data-switcher=""') && bar.includes('data-share=""') && bar.includes('data-actions=""'))
    assert.doesNotMatch(html, /bg-detail-hero/, 'not the dark band')
    assert.doesNotMatch(bar, /\b(text|bg|border)-(white|black)\b|white\/|black\/|#[0-9a-f]{3,6}\b/i, 'only the platform tokens, so dark mode follows')
    assert.ok(bar.includes('text-text-1'), 'the words are the platform\'s ink')
    for (const t of ['Overview', 'Staff', 'House Calendar', 'House Supplies', 'House Repairs', 'Incidents', 'Documents']) {
      assert.ok(html.includes(`> ${t}</button>`) || html.includes(`>${t}</button>`), t)
    }
    assert.ok(html.includes('aria-current="page" data-tab="staff"'))
    assert.ok(html.includes('data-section="staff"'))
    noModal(html, 'shell')
  })

  it('an address naming no house it knows says so; a failed read says why', () => {
    const none = draw(<LocationsScreen houses={houses} wanted="ZZ9999" house={null} tab="overview"
      onHouse={noop} onTab={noop} onAsk={noop} />)
    assert.ok(none.includes('No house ZZ9999 in the houses the platform reads.'))
    const bad = draw(<LocationsScreen houses={{ ...houses, rows: null, failed: 'slice down' }} wanted="" house={null} tab="overview"
      onHouse={noop} onTab={noop} onAsk={noop} />)
    assert.ok(bad.includes('The houses could not be read: slice down.'))
  })
})

describe('the switcher', () => {
  const list = (query: string, inactive: boolean) =>
    draw(<SwitcherList houses={HOUSES} current="NW4045" query={query} onQuery={noop} inactive={inactive} onInactive={noop} onPick={noop} />)

  it('shows the active houses with their pill, the current one checked', () => {
    const html = list('', false)
    assert.ok(html.includes('data-house="NW4045"') && html.includes('data-house="BW1001"') && !html.includes('data-house="OL2002"'))
    assert.ok(html.includes('aria-selected="true" data-house="NW4045"'))
    assert.ok(html.includes('Show Inactive') && html.includes('placeholder="Search locations…"'))
  })

  it('Show Inactive adds the inactive ones, marked; the search narrows', () => {
    const html = list('', true)
    assert.ok(html.includes('data-house="OL2002"') && html.includes('>Inactive<'))
    assert.ok(!list('briar', false).includes('data-house="NW4045"') && list('briar', false).includes('data-house="BW1001"'))
    assert.ok(list('zzz', true).includes('No house matches.'))
  })
})

describe('overview', () => {
  const notes = ready([] as never[])

  it('details: type "Not on file", the hotline\'s house manager, the address opening its map panel, the house phone', () => {
    const html = draw(<OverviewView house={H} overview={ready(overviewOf({ house: { type: null, phone: '5550102102' },
      manager: { name: 'Marcus Reed', phone: '5550101202' }, managers: [], registry_manager: { name: 'Older Name', phone: '' } }))}
      notes={notes} onAsk={noop} onRetryOverview={noop} onRetryNotes={noop} />)
    assert.ok(html.includes('>Not on file<'))
    assert.ok(html.includes('Marcus Reed'))
    assert.ok(/The house registry names <a[^>]*href="\/app\/staff-profiles\/[^"]*"[^>]*>Older Name<\/a>/.test(html), 'the registry\'s name beside, never instead, opening their profile')
    assert.ok(html.includes('href="tel:5550101202"') && html.includes('href="tel:5550102102"'))
    // the address opens the right panel with its map (AddressMapLink), never a new tab, and the roster's chips are gone
    assert.ok(/<button[^>]*data-address-link=""[^>]*>[^<]*<\/button>/.test(html) && html.includes(`>${H.address}</button>`))
    assert.ok(!html.includes('target="_blank"') && !html.includes('data-on-duty'))
    assert.ok(html.includes('No house notes.'))
    assert.ok(html.includes('href="/app/client-profiles/profile?client=kennymarsh"') && html.includes('>Kenny Marsh<'))
  })

  it('no ** row on the calendar says why, never a registry name in its place', () => {
    const html = draw(<OverviewView house={H} overview={ready(overviewOf({ manager: null, managers: [],
      manager_why: 'the Calendar Archive has no ** row for NW4045', house: {} }))} notes={notes}
      onAsk={noop} onRetryOverview={noop} onRetryNotes={noop} />)
    assert.ok(html.includes('Not on the hotline calendar — the Calendar Archive has no ** row for NW4045'))
  })

  it('open notes only; a read the gate refuses says so plainly', () => {
    const html = draw(<OverviewView house={H} overview={failed('Unknown action.')} notes={ready([
      { id: 'n1', clientKey: 'kennymarsh', clientName: '', priority: 'urgent', details: 'Back door sticks', state: 'open' as const, by: 'Boss', at: '2026-09-25T10:00:00Z' },
      { id: 'n2', clientKey: '', clientName: '', priority: 'normal', details: 'Old', state: 'resolved' as const, by: '', at: '' },
    ])} onAsk={noop} onRetryOverview={noop} onRetryNotes={noop} />)
    assert.ok(html.includes('data-note="n1"') && !html.includes('data-note="n2"'))
    assert.ok(html.includes('Kenny Marsh') && html.includes('Urgent'))
    assert.ok(html.includes(esc(NOT_OPEN)))
  })
})

describe('staff', () => {
  const cell = (client: string, over: Record<string, unknown> = {}) =>
    ({ client, client_key: '', id: 'I', status: 'owed', trainedAt: '', docUrl: '', docFileId: '', ...over })
  const staff = ready(staffOf({
    clients: [{ client_key: 'CK1', name: 'Kenny Marsh' }, { client_key: 'CK2', name: 'Lia Gomez' }],
    staff: [
      { name: 'Noah Reed', first_day: '2025-01-06', first_source: 'archive', last_day: '2026-09-23', last_source: 'punches', shifts: 40,
        sources: ['archive', 'punches'], hm: true,
        ist: [cell('Kenny Marsh', { status: 'done', trainedAt: '2025-02-01', docFileId: 'ist1xxxxxxxx' }), cell('Lia Gomez')] },
      { name: 'Ava Stone', first_day: '2026-06-07', first_source: 'punches', last_day: '2026-09-04', last_source: 'punches', sources: ['punches'],
        ist: [cell('Kenny Marsh', { id: '', status: null }), cell('Lia Gomez', { status: 'done', trainedAt: '2026-06-10' })] },
    ],
  }))

  it('first and latest shift, with no source under them; one IST column per current client', () => {
    const html = draw(<StaffView house={H} staff={staff} onAsk={noop} doc={idleDoc} onRetry={noop} />)
    assert.ok(html.includes('Jan 06, 2025') && html.includes('Sep 23, 2026'))
    assert.ok(!html.includes('data-source=') && !html.includes('Calendar Archive') && !html.includes('PSI punches'))
    assert.ok(!html.includes('Each date names where it was found'), 'no sources line above the table')
    assert.ok(html.includes('data-ist-col="Kenny Marsh"') && html.includes('data-ist-col="Lia Gomez"'))
    assert.ok(html.includes('Client 1 (IST)') && html.includes('Client 2 (IST)'))
    const noah = html.slice(html.indexOf('data-staff="Noah Reed"'), html.indexOf('data-staff="Ava Stone"'))
    assert.ok(noah.includes('data-ist="paper"') && noah.includes('IST document') && noah.includes('data-ist="upload"'))
    const ava = html.slice(html.indexOf('data-staff="Ava Stone"'))
    assert.ok(ava.includes('data-ist="trained"') && ava.includes('>Jun 10, 2026<') && ava.includes('title="Trained Jun 10, 2026"'))
    assert.ok(!ava.includes('>Trained Jun'), 'the green day alone says trained')
    assert.ok(html.includes('whitespace-nowrap font-semibold'), 'a name is never cut')
    assert.ok(ava.includes('data-ist="none"'), 'no IST record pairs them: nothing to upload against')
    assert.ok(html.includes('PDF, PNG or JPG · up to 15 MB.'))
  })

  it('a filed IST paper opens centred, with Update beside it for the training; the cell shows it is opening', () => {
    const idle = draw(<StaffView house={H} staff={staff} onAsk={noop} doc={idleDoc} onRetry={noop} />)
    const noah = idle.slice(idle.indexOf('data-staff="Noah Reed"'), idle.indexOf('data-staff="Ava Stone"'))
    assert.ok(noah.includes('data-ist="newer"') && noah.includes('aria-label="Update the IST training of Noah Reed with Kenny Marsh"'))
    assert.ok(!noah.includes('aria-busy'))
    const busy = draw(<StaffView house={H} staff={staff} onAsk={noop} doc={{ opening: 'ist1xxxxxxxx', open: noop }} onRetry={noop} />)
    assert.match(busy, /disabled="" aria-busy="true"/)
    assert.ok(busy.includes('animate-spin'))
  })

  it('the columns are the clients the answer names for the house', () => {
    const html = draw(<StaffView house={H} staff={ready(staffOf({ clients: [{ client_key: 'CK9', name: 'Only Client' }],
      staff: [{ name: 'Noah Reed', first_day: '2025-01-06', last_day: '2026-09-23', sources: ['archive'], ist: [cell('Only Client')] }] }))}
      onAsk={noop} doc={idleDoc} onRetry={noop} />)
    assert.ok(html.includes('data-ist-col="Only Client"') && !html.includes('data-ist-col="Kenny Marsh"'))
  })
})

describe('the house calendar', () => {
  it('is Scheduling\'s own screen locked to the house, never a calendar read from anywhere else', () => {
    const html = draw(<Calendar house={H} />)
    assert.ok(html.includes('data-house-calendar="NW4045"'))
    const src = readFileSync(resolve(ROOT, 'src/pages/features/locations/tabs/Calendar.tsx'), 'utf8')
    assert.ok(src.includes('houseOnly={house.code}') && src.includes('useSchedulingBoard'))
    assert.ok(!/housecal|shiftMatrix|readHouseCalendar/.test(src))
  })
})

describe('house supplies', () => {
  it('consumables with status and "Not measured yet"; the house\'s assets under them', () => {
    const html = draw(<SuppliesView supplies={ready(suppliesOf({
      ledger_ready: true,
      consumables: [
        { item: 'Nitrile gloves (M)', category: 'Care supplies', in_stock: 240, par: 200, status: 'in_stock', checked: '2026-09-24', consumption: 60,
          last_delivery: { at: '2026-09-01', qty: 300, on_hand_after: 300 } },
        { item: 'Hand soap refill', category: 'Household', in_stock: 4, par: 6, status: 'low', checked: '2026-09-24', consumption: null, last_delivery: null },
      ],
      assets: [{ id: 'r3', item: 'Fridge', address: '908 Arlington Ave NW', current_condition: 'Good', cost_to_replace: '900' }],
    }))} onAsk={noop} onRetry={noop} />)
    for (const h of ['Item', 'Category', 'In stock', 'Par level', 'Status', 'Checked', 'Used since delivery']) assert.ok(html.includes(`>${h}<`), h)
    assert.ok(html.includes(`>${NOT_MEASURED}<`) && html.includes('60 used since Sep 01, 2026'))
    assert.ok(html.includes('>Low<') && html.includes('>In stock<'))
    assert.ok(html.includes('>Fridge<') && html.includes('>Good<') && html.includes('>Current condition<'))
    assert.ok(!html.includes('908 Arlington Ave NW'), 'the address is the house, not a column')
    assert.ok(html.includes('Record count') && html.includes('Record delivery') && !html.includes('disabled=""'))
  })

  it('a ledger that is not set up says so, and nothing can be recorded', () => {
    const html = draw(<SuppliesView supplies={ready(suppliesOf({ ledger_ready: false, ledger_why: 'the houseSupplies house is not declared',
      consumables: [], assets: [] }))} onAsk={noop} onRetry={noop} />)
    assert.ok(html.includes('Not set up: the houseSupplies house is not declared.'))
    assert.equal((html.match(/disabled=""/g) ?? []).length, 3, 'count, delivery and par level')
  })
})

describe('house repairs', () => {
  const rows = repairsOf({ rows: [
    { id: 'r1', select_address_vehicle: '908 Arlington Ave NW', repair_type: 'Plumbing', urgency_level: '5', please_describe_the_issue: 'Leak', status: '', timestamp: '2026-09-20T12:00:00Z' },
    { id: 'r2', select_address_vehicle: '908 Arlington Ave NW', repair_type: 'Door', please_describe_the_issue: 'Hinge', status: 'Completed', timestamp: '2026-09-10T12:00:00Z' },
    { id: 'r3', select_address_vehicle: 'ALL', repair_type: 'Roof', please_describe_the_issue: 'Gutters', status: 'Cancelled', timestamp: '2026-09-11T12:00:00Z' },
    { id: 'r4', select_address_vehicle: 'ALL', repair_type: 'Roof', please_describe_the_issue: 'Paint', status: 'In Progress', timestamp: '2026-09-12T12:00:00Z' },
  ] })
  const view = (showResolved: boolean) =>
    draw(<RepairsView repairs={ready(rows)} showResolved={showResolved} onShowResolved={noop} onAsk={noop} onRetry={noop} />)

  it('the open list; Show resolved adds Completed and Cancelled beneath them, with no count and no band', () => {
    const open = view(false)
    assert.deepEqual([...open.matchAll(/data-repair="([^"]+)"/g)].map((m) => m[1]), ['r1', 'r4'])
    assert.ok(open.includes('Show resolved') && open.includes('New House Repair'))
    const all = view(true)
    assert.deepEqual([...all.matchAll(/data-repair="([^"]+)"/g)].map((m) => m[1]), ['r1', 'r4', 'r3', 'r2'])
    assert.ok(all.includes('aria-checked="true"'))
    for (const gone of ['Resolved · 2', '(2)', ' open · ', 'No open repair request for this house.', 'data-repairs-done']) {
      assert.ok(!all.includes(gone), gone)
    }
  })

  it('a table as Incidents draws its own: Reported, Issue, Urgency, Status, the urgency as its chip alone', () => {
    const html = view(true)
    assert.deepEqual([...html.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]), ['Reported', 'Issue', 'Urgency', 'Status'])
    assert.equal((html.match(/data-expand="/g) ?? []).length, 4)
    assert.ok(html.includes('Urgent') && html.includes('Completed') && html.includes('Cancelled'))
    assert.ok(!html.includes('5/5') && !html.includes('All types') && !html.includes('>Roof<') && !html.includes('Whole Estate'))
  })

  it('a request opens read only, with no way to delete it', () => {
    forgetLocationReads()
    const html = draw(<LocationPanel ask={{ kind: 'repair-row', id: 'r1' }} house={H} share={SHARE} onAsk={noop} onClose={noop} />)
    assert.ok(!/Delete|Remove|Cancel request/.test(html))
  })
})

describe('incidents', () => {
  const rows = incidentsOf({ rows: [
    { id: 'r1', your_name: 'Ann Lee', client_name: 'Kenny Marsh', incident_category: 'Fall', incident_location: 'Home', incident_date: '2026-09-20', incident_time: '14:05', summary_of_incident: 'Slipped in the hall' },
    { id: 'r2', your_name: 'Bo Diaz', client_name: 'Lia Gomez', incident_category: 'Medication error', incident_location: 'Day program', incident_date: '2026-09-24', incident_time: '09:30' },
  ] })
  const view = (client: string, category: string) => draw(<IncidentsView clients={H.clients} incidents={ready(rows)} client={client}
    category={category} onClient={noop} onCategory={noop} onAsk={noop} onRetry={noop} />)

  it('the four columns, newest first, filtered by All clients and All categories', () => {
    const html = view('', '')
    for (const h of ['Date', 'Client', 'Incident category', 'Incident summary']) {
      assert.ok(html.includes(`>${h}<`), h)
    }
    assert.ok(html.includes('>All clients</option>') && html.includes('>All categories</option>'))
    assert.ok(!html.includes('All statuses'))
    assert.deepEqual([...html.matchAll(/data-incident="([^"]+)"/g)].map((m) => m[1]), ['r2', 'r1'])
    assert.ok(html.includes('Sep 24, 2026') && html.includes('href="/app/client-profiles/profile?client=kennymarsh"'))
    assert.ok(html.includes('aria-expanded="false" data-expand="r1"'))
    assert.deepEqual([...view('Kenny Marsh', '').matchAll(/data-incident="([^"]+)"/g)].map((m) => m[1]), ['r1'])
    assert.deepEqual([...view('', 'Medication error').matchAll(/data-incident="([^"]+)"/g)].map((m) => m[1]), ['r2'])
    assert.ok(view('Kenny Marsh', 'Medication error').includes('No incident matches these filters.'))
  })
})

describe('documents', () => {
  it('DOCUMENT | TYPE | APPLIES TO: all locations, the client, the house guidebook — or none on file', () => {
    const docs = ready(documentsOf({ policies: [], isps: [{ client: 'Kenny Marsh', client_key: 'CK1', isp_doc_id: 'isp1xxxxxxxx',
      isp_doc_url: 'https://docs.google.com/document/d/isp1xxxxxxxx/edit', isp_doc_name: 'Kenny Marsh ISP', isp_year: '2026' }], guidebook: null }))
    const html = draw(<DocumentsView house={H} docs={docs} doc={idleDoc} onRetry={noop} />)
    for (const h of ['Document', 'Type', 'Applies to']) assert.ok(html.includes(`>${h}<`), h)
    assert.equal((html.match(/data-applies="all">All locations</g) ?? []).length, 8)
    assert.equal((html.match(/>Medication Delivery</g) ?? []).length, 4)
    const isp = html.slice(html.indexOf('data-applies="client"'))
    assert.ok(isp.startsWith('data-applies="client"><a ') && isp.slice(0, 200).includes('href="/app/client-profiles/profile?client=kennymarsh"'))
    assert.ok(!html.includes('No guidebook on file') && !html.includes('House guidebook') && !html.includes('data-guidebook-why'), 'no placeholder row and no guidebook warning')
    assert.ok(!html.includes('drive.google.com') && !html.includes('docs.google.com'), 'no document is a link')
    const withBook = draw(<DocumentsView house={H} docs={ready(documentsOf({ isps: [], guidebook: { folder_name: 'NW4045',
      files: [{ id: 'guide1xxxxxx', name: 'Arlington Guidebook', guide: true }] } }))} doc={idleDoc} onRetry={noop} />)
    assert.ok(withBook.includes('data-applies="house">Arlington') && withBook.includes('Arlington Guidebook'))
  })

  it('before the read lands the company documents are listed, and the read says what it waits for', () => {
    const html = draw(<DocumentsView house={H} docs={IDLE as ReadState<never>} doc={idleDoc} onRetry={noop} />)
    assert.equal((html.match(/data-applies="all"/g) ?? []).length, 8)
    assert.ok(html.includes('Reading the client ISPs and the house guidebook'))
  })

  it('the clicked row shows it is opening; the others stay as they are', () => {
    const html = draw(<DocumentsView house={H} docs={IDLE as ReadState<never>} doc={{ opening: 'policy3xxxxx', open: noop }} onRetry={noop} />)
    assert.equal((html.match(/aria-busy="true"/g) ?? []).length, 1)
    const from = html.indexOf('aria-busy="true"')
    const row = html.slice(from, html.indexOf('</tr>', from))
    assert.match(row, /^aria-busy="true"><td[^>]*><button[^>]*disabled=""[^>]*data-open-doc="policy3xxxxx"/)
    assert.ok(row.includes('Opening…') && row.includes('animate-spin'))
  })

  it('a click hands the row to the opener with the viewer\'s heading', () => {
    const asked: { fileId: string; title: string; subtitle?: string }[] = []
    const doc: LocationDocOpener = { opening: '', open: (fileId, meta) => asked.push({ fileId, title: meta.title, subtitle: meta.subtitle }) }
    const rows = elements(DocumentsView({ house: H, docs: IDLE as ReadState<never>, doc, onRetry: noop }))
      .filter((e) => typeof e.type === 'function' && e.props.d && e.props.doc)
    assert.equal(rows.length, 8)
    const drawn = elements((rows[3].type as (p: unknown) => unknown)(rows[3].props))
    const button = drawn.find((e) => e.props['data-open-doc'])
    ;(button?.props.onClick as () => void)()
    assert.deepEqual(asked, [{ fileId: 'policy3xxxxx', title: 'Med Del Cat 2', subtitle: 'Medication Delivery · All locations' }])
  })
})

/* ---------- the doors ---------- */

describe('a viewer App Control released it to', () => {
  const as = (viewer: LocationViewer, node: ReactNode) =>
    draw(<LocationViewerContext.Provider value={viewer}>{node}</LocationViewerContext.Provider>)
  const STAFF_VIEW: LocationViewer = { writes: false, cut: false }
  const CUT_VIEW: LocationViewer = { writes: false, cut: true }
  const houses = { rows: HOUSES, failed: '', loading: false, reload: noop }
  const cell = (client: string, over: Record<string, unknown> = {}) =>
    ({ client, client_key: '', id: 'I', status: 'owed', trainedAt: '', docUrl: '', docFileId: '', ...over })
  const staff = ready(staffOf({
    clients: [{ client_key: 'CK1', name: 'Kenny Marsh' }],
    staff: [{ name: 'Noah Reed', first_day: '2025-01-06', last_day: '2026-09-23', sources: ['archive'],
      ist: [cell('Kenny Marsh', { status: 'done', trainedAt: '2025-02-01', docFileId: 'ist1xxxxxxxx' })] },
    { name: 'Ava Stone', first_day: '2026-06-07', last_day: '2026-09-04', sources: ['punches'], ist: [cell('Kenny Marsh')] }],
  }))
  const supplies = ready(suppliesOf({ ledger_ready: true, consumables: [{ item: 'Gloves', in_stock: 4, par: 6, status: 'low' }], assets: [] }))
  const notes = ready(notesOf({ notes: [{ id: 'n1', priority: 'high', details: 'Back door sticks', state: 'open', by: 'Boss' }] }))

  it('STAFF reads everything and is offered no write: no Actions, no Add note, no Upload, no Record, no New buttons', () => {
    const shell = as(STAFF_VIEW, <LocationsScreen houses={houses} wanted="NW4045" house={H} tab="overview"
      onHouse={noop} onTab={noop} onAsk={noop} />)
    assert.ok(shell.includes('data-share=""') && !shell.includes('data-actions=""'), 'Share stays; Actions files, so it goes')
    assert.ok(shell.includes('data-tab="calendar"'), 'every section')
    const over = as(STAFF_VIEW, <OverviewView house={H} overview={ready(overviewOf({}))} notes={notes}
      onAsk={noop} onRetryOverview={noop} onRetryNotes={noop} />)
    assert.ok(over.includes('data-note="n1"') && !over.includes('Add note'), 'the notes are read, not added to')
    const people = as(STAFF_VIEW, <StaffView house={H} staff={staff} onAsk={noop} doc={idleDoc} onRetry={noop} />)
    assert.ok(people.includes('data-ist="paper"'), 'a filed paper still opens')
    assert.ok(!people.includes('data-ist="upload"') && !people.includes('data-ist="newer"') && people.includes('data-ist="owed"'))
    assert.ok(!people.includes('PDF, PNG or JPG'))
    const stock = as(STAFF_VIEW, <SuppliesView supplies={supplies} onAsk={noop} onRetry={noop} />)
    assert.ok(stock.includes('>Gloves<') && !stock.includes('Record count') && !stock.includes('Record delivery'))
    assert.ok(!stock.includes('cursor-pointer'), 'a row opens no form')
    const repairs = as(STAFF_VIEW, <RepairsView repairs={ready([])} showResolved={false} onShowResolved={noop} onAsk={noop} onRetry={noop} />)
    assert.ok(!repairs.includes('New House Repair'))
    const incidents = as(STAFF_VIEW, <IncidentsView clients={H.clients} incidents={ready([])} client="" category="" onClient={noop}
      onCategory={noop} onAsk={noop} onRetry={noop} />)
    assert.ok(!incidents.includes('New Incident'))
  })

  it('a form asked for by the address answers "not open"; the notes panel is the list alone', () => {
    for (const ask of [{ kind: 'incident' }, { kind: 'repair' }, { kind: 'supply', entry: 'count', item: '' }] as PanelAsk[]) {
      const html = as(STAFF_VIEW, <LocationPanel ask={ask} house={H} share={SHARE} onAsk={noop} onClose={noop} />)
      assert.ok(html.includes('data-not-open=""') && html.includes(esc(NOT_OPEN)) && !html.includes('data-press='), ask.kind)
    }
    const panel = as(STAFF_VIEW, <LocationPanel ask={{ kind: 'notes' }} house={H} share={SHARE} onAsk={noop} onClose={noop} />)
    assert.ok(panel.includes('data-notes-panel=""') && !panel.includes('data-press=') && !panel.includes('Choose client'))
    const ist = as(STAFF_VIEW, <LocationPanel ask={{ kind: 'ist', staff: 'Noah Reed', client: 'Kenny Marsh' }} house={H} share={SHARE}
      onAsk={noop} onClose={noop} />)
    assert.ok(!ist.includes('File a newer paper') && !ist.includes('data-press='))
  })

  it('a client\'s or a family member\'s view: no House Calendar, no house notes, no roster line; its own clients', () => {
    const shell = as(CUT_VIEW, <LocationsScreen houses={houses} wanted="NW4045" house={H} tab="overview"
      onHouse={noop} onTab={noop} onAsk={noop} />)
    assert.ok(!shell.includes('data-tab="calendar"') && !shell.includes('House Calendar') && shell.includes('data-tab="documents"'))
    const over = as(CUT_VIEW, <OverviewView house={house({ clients: [{ name: 'Kenny Marsh', client_key: 'kennymarsh' }] })}
      overview={ready(overviewOf({}))} notes={IDLE as ReadState<never>} onAsk={noop} onRetryOverview={noop}
      onRetryNotes={noop} />)
    assert.ok(!over.includes('House Notes') && !over.includes('data-on-duty') && !over.includes('Reading the house notes'))
    assert.ok(over.includes('Your clients here') && over.includes('Kenny Marsh') && !over.includes('Lia Gomez'))
    for (const ask of [{ kind: 'notes' }] as PanelAsk[]) {
      const html = as(CUT_VIEW, <LocationPanel ask={ask} house={H} share={SHARE} onAsk={noop} onClose={noop} />)
      assert.ok(html.includes('data-not-open=""'), ask.kind)
    }
  })

  it('a house the viewer holds none of says so; the master\'s screen is unchanged', () => {
    const none = as(CUT_VIEW, <LocationsScreen houses={{ ...houses, rows: [], empty: 'No house is open to you.' }} wanted="" house={null}
      tab="overview" onHouse={noop} onTab={noop} onAsk={noop} />)
    assert.ok(none.includes('No house is open to you.'))
    const outside = as(CUT_VIEW, <LocationsScreen houses={{ ...houses, rows: [H], empty: 'No house is open to you.' }} wanted="BW1001"
      house={null} tab="overview"
      onHouse={noop} onTab={noop} onAsk={noop} />)
    assert.ok(outside.includes('No house BW1001 among the houses open to you.'))
    const master = draw(<LocationsScreen houses={houses} wanted="NW4045" house={H} tab="overview"
      onHouse={noop} onTab={noop} onAsk={noop} />)
    assert.ok(master.includes('data-actions=""') && master.includes('data-tab="calendar"'), 'outside the page the view is the master\'s')
  })
})

describe('the Apps Script doors', () => {
  const realFetch = globalThis.fetch
  let calls: { action: string; payload: Record<string, unknown> }[] = []
  let answer: (action: string) => unknown = () => ({})
  before(() => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload: Record<string, unknown> }
      calls.push({ action: env.action, payload: env.payload })
      const data = answer(env.action)
      if (data instanceof Error) return new Response(JSON.stringify({ status: 404, message: data.message }))
      return new Response(JSON.stringify({ status: 200, data }))
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })
  afterEach(() => {
    calls = []
    answer = () => ({})
    forgetLocationReads()
  })

  it('the scope: the master is never asked; anyone else asks locationScope once, and is held to what it names', async () => {
    useMemberStore.setState({ currentMemberId: '' } as never)
    signIn(MASTER)
    const m = mountHook(() => useLocationScope(), {})
    assert.deepEqual([m.current.scope?.kind, m.current.scope?.writes, calls.length], ['master', true, 0])
    m.unmount()
    answer = (action) => action === 'locationScope' ? { kind: 'client', writes: false, cut: true, why: '',
      houses: [{ code: 'NW4045', home_name: 'Arlington', client_count: 2, clients: [{ client_key: 'kennymarsh', name: 'Kenny Marsh' }] }] } : {}
    signIn({ ...DIRECTOR, id: 'u-kay9', role: 'client', types: ['CLIENT'] })
    const h = mountHook(() => useLocationScope(), {})
    const now = () => h.current.scope
    assert.ok(now() === null, 'nothing is drawn before the server answers')
    await h.settle(() => !!h.current.scope)
    assert.deepEqual(calls.map((c) => [c.action, c.payload]), [['locationScope', {}]])
    assert.deepEqual([now()?.kind, now()?.cut, now()?.writes, now()?.houses?.map((x) => x.code)], ['client', true, false, ['NW4045']])
    h.unmount()
    // a narrowed viewer's sections read their own cut actions, never the pack
    calls = []
    await readOverview('NW4045')
    assert.deepEqual(calls.map((c) => c.action), ['locationOverview'])
    holdToHouses(false)
    answer = () => new Error('Unknown action.')
    signIn({ ...DIRECTOR, id: 'u-shut9', role: 'staff', types: ['STAFF'] })
    const shut = mountHook(() => useLocationScope(), {})
    await shut.settle(() => !!shut.current.failed)
    assert.deepEqual([shut.current.scope, shut.current.failed], [null, NOT_OPEN])
    shut.unmount()
    assert.deepEqual(await readLocationScope().then(() => 'answered', (e: Error) => e.message), 'Unknown action.')
    useAuthStore.setState({ user: null, token: null } as never)
  })

  it('each section reads its own action by name, with the house', async () => {
    await readOverview('NW4045')
    await readStaff('NW4045')
    await readRepairs('NW4045', true)
    await readIncidents('NW4045')
    await readDocuments('NW4045')
    await readSupplies('NW4045')
    await readNotes('NW4045')
    assert.deepEqual(calls.map((c) => [c.action, c.payload]), [
      ['locationOverview', { house: 'NW4045' }],
      ['locationStaff', { house: 'NW4045' }],
      ['locationRepairs', { house: 'NW4045', resolved: true }],
      ['locationIncidents', { house: 'NW4045' }],
      ['locationDocuments', { house: 'NW4045' }],
      ['locationSupplies', { house: 'NW4045' }],
      ['locationNotes', { house: 'NW4045' }],
    ])
  })

  it('a document click reads its bytes through its own door, with the house, and opens them centred as a blob URL', async () => {
    const viewer = useFileViewerStore.getState
    answer = (action) => action === 'locationDocFile'
      ? { id: 'policy3xxxxx', name: 'Med Del Cat 2', mime: 'application/pdf', size: 4, exported: true, b64: 'JVBERg==' } : {}
    const h = mountHook(() => useLocationDoc('NW4045'), {})
    h.run(() => h.current.open('policy3xxxxx', { title: 'Med Del Cat 2', subtitle: 'Medication Delivery · All locations' }))
    assert.equal(h.current.opening, 'policy3xxxxx', 'the row shows it is opening')
    await h.settle(() => h.current.opening === '')
    assert.deepEqual(calls.map((c) => [c.action, c.payload]), [['locationDocFile', { house: 'NW4045', id: 'policy3xxxxx' }]])
    const file = viewer().file
    assert.ok(file)
    assert.match(file.url, /^blob:/)
    assert.deepEqual([file.title, file.subtitle], ['Med Del Cat 2', 'Medication Delivery · All locations'])
    assert.equal(resolveObjectURL(file.url)?.type, 'application/pdf')
    viewer().closeFile()
    assert.equal(resolveObjectURL(file.url), undefined, 'closing the viewer lets the bytes go')

    useToastStore.setState({ toasts: [] })
    answer = () => new Error('This house names no such document.')
    h.run(() => h.current.open('strangerxxxx', { title: 'Stranger' }))
    await h.settle(() => h.current.opening === '')
    assert.equal(viewer().file, null, 'nothing opens for a refusal')
    assert.deepEqual(useToastStore.getState().toasts.map((t) => [t.type, t.title, t.body]),
      [['danger', DOC_FAILED_TITLE, 'This house names no such document.']])

    useToastStore.setState({ toasts: [] })
    answer = () => new Error('Unknown action.')
    // policy3's bytes are held for the tab now: another file asks the door
    h.run(() => h.current.open('policy4xxxxx', { title: 'Med Del Cat 3' }))
    await h.settle(() => h.current.opening === '')
    assert.equal(useToastStore.getState().toasts[0]?.body, NOT_OPEN, 'the refusal in the page\'s words')
    useToastStore.setState({ toasts: [] })
    h.unmount()
  })

  it('the writes carry the plan\'s parameters', async () => {
    await addNote({ house: 'NW4045', client_key: 'kennymarsh', priority: 'high', details: 'Back door sticks' })
    await setNoteState('n1', 'resolved', 'NW4045')
    await addSupplyEntry({ house: 'NW4045', item: 'Gloves', category: 'Care', kind: 'delivery', qty: 200, on_hand_after: 203 })
    await fileIstPaper({ house: 'NW4045', staff: 'Noah Reed', client: 'Kenny Marsh', file: { name: 'ist.pdf', mime: 'application/pdf', b64: 'JVBE' } })
    assert.deepEqual(calls.map((c) => [c.action, c.payload]), [
      ['locationNoteAdd', { house: 'NW4045', client_key: 'kennymarsh', priority: 'high', details: 'Back door sticks' }],
      ['locationNoteState', { id: 'n1', state: 'resolved', house: 'NW4045' }],
      ['locationSupplyEntry', { house: 'NW4045', item: 'Gloves', category: 'Care', kind: 'delivery', qty: 200, on_hand_after: 203 }],
      ['locationIstFile', { house: 'NW4045', staff: 'Noah Reed', client: 'Kenny Marsh', file: { name: 'ist.pdf', mime: 'application/pdf', b64: 'JVBE' } }],
    ])
  })

  it('a read is held for the section and its panel; a write for the house reads it again', async () => {
    answer = () => ({ notes: [{ id: 'n1', details: 'x', state: 'open', at: '2026-09-25' }] })
    const key = readKey('locationNotes', 'NW4045')
    const a = mountHook(() => useLocationRead(key, () => readNotes('NW4045'), (raw) => raw), {})
    await a.settle(() => a.current.status === 'ready')
    const b = mountHook(() => useLocationRead(key, () => readNotes('NW4045'), (raw) => raw), {})
    await b.settle(() => b.current.status === 'ready')
    assert.equal(calls.length, 1, `the panel drew the held answer ${JSON.stringify(calls)}`)
    answer = () => ({ notes: [] })
    a.run(() => locationWritten('NW4045'))
    await a.settle(() => JSON.stringify(a.current.data) === '{"notes":[]}' && JSON.stringify(b.current.data) === '{"notes":[]}')
    assert.equal(calls.length, 2, 'both re-read through one request')
    a.unmount()
    b.unmount()
  })

  it('a refusal keeps its sentence', async () => {
    answer = () => new Error('Unknown action.')
    const h = mountHook(() => useLocationRead(readKey('locationStaff', 'NW4045'), () => readStaff('NW4045'), (raw) => raw), {})
    await h.settle(() => h.current.status === 'failed')
    assert.equal(h.current.error, 'Unknown action.')
    h.unmount()
  })
})

describe('Settings › My Work keeps House Supplies to the master', () => {
  it('a hidden switch drops the tab; an answer that says nothing hides every part', () => {
    assert.ok(tabsFor(false).some((t) => t.id === 'supplies'))
    assert.ok(!tabsFor(false, true).some((t) => t.id === 'supplies'))
    assert.ok(!tabsFor(true, true).some((t) => t.id === 'calendar' || t.id === 'supplies'))
    assert.deepEqual(shellHidesOf({}), SHELL_HIDDEN)
    assert.equal(shellHidesOf({ ...SHELL_SHOWN, profile_docs: true }).profile_docs, true)
    assert.equal(shellHidesOf(SHELL_SHOWN).location_supplies, false)
  })
})
