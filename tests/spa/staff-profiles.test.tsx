/**
 * STAFF · the screen: the app and who may open it, the seven sections drawn whole, the one right panel in every
 * mode, documents in the platform's centred viewer, and the Apps Script doors each read and write goes through
 * (answered here at `fetch`, with the door's envelope).
 *
 * The app is the master's until it is released: no App Control row ships, and the page is mounted only through
 * CUSTOM_PAGES, behind the resolver's badge check. Nothing in it is a dialog — the switcher is a listbox, Actions a
 * menu, and every form, transcript, share and account door is the SidePanel aside.
 */
import { after, afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
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
import { useBookmarksStore } from '@/stores/useBookmarksStore'
import { useFileViewerStore } from '@/stores/useFileViewerStore'
import { useToastStore } from '@/stores/useToastStore'
import { appManifests } from '@/registry/apps'
import { staffProfilesManifests } from '@/registry/apps-staff-profiles'
import AppRoutePage, { CUSTOM_PAGES } from '@/pages/AppRoutePage'
import StaffProfilesPage, { StaffScreen } from '@/pages/features/staffprofiles/StaffProfilesPage'
import StaffPanel from '@/pages/features/staffprofiles/StaffPanel'
import { ActionsMenu } from '@/pages/features/staffprofiles/StaffActions'
import { SwitcherList } from '@/pages/features/staffprofiles/StaffSwitcher'
import { BasicProfileView, ProfileView } from '@/pages/features/staffprofiles/sections/Profile'
import { RelatedClientsView } from '@/pages/features/staffprofiles/sections/RelatedClients'
import { RelatedLocationsView } from '@/pages/features/staffprofiles/sections/RelatedLocations'
import { StaffViewerContext } from '@/pages/features/staffprofiles/staffViewer'
import { EmploymentView } from '@/pages/features/staffprofiles/sections/Employment'
import { DocumentsView } from '@/pages/features/staffprofiles/sections/Documents'
import { ComplianceView } from '@/pages/features/staffprofiles/sections/Compliance'
import { HrAdminView } from '@/pages/features/staffprofiles/sections/HrAdmin'
import { ActionsView } from '@/pages/features/staffprofiles/sections/Actions'
import { ShiftsView, TextsView, TimelineView, TranscriptsView, VisitsView } from '@/pages/features/staffprofiles/sections/Activity'
import { ReadLine } from '@/pages/features/staffprofiles/StaffParts'
import {
  ACTION_GROUPS, NOT_PUBLISHED, actionsOf, activityOf, askFor, complianceOf, documentsOf, employmentOf, favoriteFor, hrOf, notesOf, overviewOf,
  panelOf, panelParam, rosterOf, sharePayloadFor, shiftsOf, tabOf, textsOf, transcriptsOf, viewerOf, type StaffAsk, type StaffViewer,
} from '@/pages/features/staffprofiles/staffModel'
import {
  addNote, assignTraining, editStaff, forgetStaffReads, readActions, readActivity, readCompliance, readDocuments, readEmployment, readHr, readKey,
  readNotes, readOverview, readReleaseStatus, readRoster, readShifts, readTexts, readTranscript, readTranscripts, recordVisit,
  resetPassword, sendInvite, setAccountActive, setNoteState, useStaffDoc, useStaffRead, type ReadState, type StaffDocOpener,
} from '@/pages/features/staffprofiles/useStaffRead'
import { mountHook } from './react-host'
import { SHELL_SHOWN, primeShellHides } from '@/lib/myWorkHides'
import { houseWords, shiftWeeks } from '@/pages/features/staffprofiles/sections/Calendar'
import type { StaffShift } from '@/pages/features/scheduling/schedulingLane'

// the parts Settings › My Work can hide are drawn as the master's own session sees them
primeShellHides(SHELL_SHOWN)

// motion mounts its projection nodes against the window; a screen drawn whole reaches them
for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const FEATURE = 'src/pages/features/staffprofiles'
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))
const noop = () => {}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;')
const noModal = (html: string, what: string) => {
  assert.ok(!html.includes('aria-modal'), `${what}: no aria-modal`)
  assert.ok(!html.includes('role="dialog"') && !html.includes('role="alertdialog"'), `${what}: no dialog role`)
}
const ready = <T,>(data: T): ReadState<T> => ({ status: 'ready', data, error: '', refreshing: false })
const failed = <T,>(error: string): ReadState<T> => ({ status: 'failed', data: null, error, refreshing: false })
const IDLE_DOC: StaffDocOpener = { opening: '', open: noop }

function walk(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n)
    return statSync(resolve(ROOT, p)).isDirectory() ? walk(p) : [p]
  })
}

const ROSTER = rosterOf({ staff: [
  { key: 'adamlaurent', name: 'Adam Laurent', first_name: 'Adam', last_name: 'Laurent', status: 'active', role: 'Chief of Staff', employee_id: 'ASA-1060' },
  { key: 'bealee', name: 'Bea Lee', status: 'active', role: 'DSP' },
  { key: 'carlreyes', name: 'Carl Reyes', status: 'inactive', role: 'DSP' },
  { key: 'danaoak', name: 'Dana Oak', status: 'active', ambiguous: true },
] })
const ROW = ROSTER.staff[0]
const SHARE = sharePayloadFor(ROW, 'profile')

const OVERVIEW = overviewOf({
  person: {
    key: 'adamlaurent', name: 'Adam Laurent', first_name: 'Adam', last_name: 'Laurent', employee_id: 'ASA-1060', employee_id_source: 'master',
    role: 'Chief of Staff', status: 'active', start_date: '2026-09-01',
    phones: [{ label: 'Mobile', value: '5550101160' }, { label: 'Master', value: '5550102222' }],
    emails: [{ label: 'Account', value: 'adam.laurent@example.invalid' }, { label: 'Roster', value: 'adam@example.invalid' }],
  },
  clients: [{ client_key: 'dannywhitaker', client_id: 'C1', name: 'Danny Whitaker', via: ['punches', 'house'], house: 'NW4045',
    first_day: '2025-02-03', last_day: '2026-09-20' },
    { client_key: 'sampetrakis', name: 'Sam Petrakis', via: ['punches'] }],
  houses: [
    { code: 'NW4045', home_name: 'Meadowlane', address: '908 Arlington Ave NW, Canton, OH 44708', current: true, days: 40, first_day: '2025-01-06', last_day: '2026-09-23', hm: true },
    { code: 'BW1001', home_name: 'Briarwood', address: '12 Briar Rd, Canton, OH', current: false, days: 3, first_day: '2025-03-01', last_day: '2025-03-09' },
  ],
  ist: [{ id: 'I1', client_key: 'dannywhitaker', client_name: 'Danny Whitaker', house: 'NW4045', status: 'done', trained_at: '2026-02-01' },
    { id: 'I2', client_name: 'Sam Petrakis', house: 'BW1001', status: 'owed', due: '2026-10-01' }],
  notes_open: 1,
})
const NOTES = notesOf({ notes: [
  { id: 'n1', category: 'training', priority: 'urgent', details: 'Needs MANDT refresher', state: 'open', by: 'Boss', at: '2026-09-25T10:00:00Z' },
  { id: 'n2', details: 'Old', state: 'resolved', at: '2026-01-01' },
] })

const MASTER = { id: 'u-boss', name: 'Boss', email: 'boss@example.org', role: 'admin', types: [], isMaster: true }
const DIRECTOR = { id: 'u-dir', name: 'Dee Rector', email: 'dee@example.org', role: 'admin', types: ['DIRECTOR'], isMaster: false }
const signIn = (user: unknown) => useAuthStore.setState({ user } as never)

/* ---------- the app ---------- */

describe('the app', () => {
  after(() => useAuthStore.setState({ user: null, token: null } as never))

  it('is "Staff", one page "profile", for admins and managers, declaring the non-clinical houses slice, in the registry once', () => {
    const app = staffProfilesManifests[0]
    assert.equal(app.id, 'staff-profiles')
    assert.equal(app.name, 'Staff')
    assert.deepEqual(app.pages.map((p) => [p.id, p.title]), [['profile', 'Staff Profile']])
    assert.deepEqual([app.audience, app.focusAudience], [['admin', 'manager', 'client'], []])
    assert.equal(app.pages[0].dataSource?.resource, 'houses')
    assert.equal(appManifests.filter((m) => m.id === 'staff-profiles').length, 1)
  })

  it('is mounted only through CUSTOM_PAGES, never on a static route', async () => {
    // a lazy chunk (lib/lazyPage): the entry resolves to the screen itself
    assert.equal(await CUSTOM_PAGES['staff-profiles/profile'].load(), StaffProfilesPage)
    assert.ok(!readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8').includes('staff-profiles'), 'no static route in App.tsx')
  })

  it('ships no App Control row: a non-master admin is refused, the master passes', () => {
    assert.equal(badgeAllowsApp('staff-profiles', DIRECTOR, {}), false)
    assert.equal(badgeAllowsApp('staff-profiles', { ...DIRECTOR, role: 'manager' }, { houses: ['DIRECTOR'] }), false)
    assert.equal(badgeAllowsApp('staff-profiles', MASTER, {}), true)
    const hits: string[] = []
    for (const dir of ['apps-script', 'tools', 'server']) {
      for (const name of readdirSync(resolve(ROOT, dir))) {
        if (!/\.(gs|py|mjs|js|json)$/.test(name)) continue
        const text = readFileSync(join(resolve(ROOT, dir), name), 'utf8')
        if (/app_badge_access[^\n]{0,200}['"]staff-profiles['"]|['"]staff-profiles['"][^\n]{0,200}app_badge_access/.test(text)) hits.push(name)
      }
    }
    assert.deepEqual(hits, [])
  })

  it('a non-master is refused through CUSTOM_PAGES; nothing of the screen is drawn. The master gets the screen', async () => {
    // the screen's chunk is in before the render, so the master's render draws it rather than a fallback
    await CUSTOM_PAGES['staff-profiles/profile'].load()
    useRegistryStore.setState({ apps: appManifests })
    useBadgeAccessStore.setState({ rules: {}, tenantRules: {}, configRules: {} } as never)
    useMemberStore.setState({ currentMemberId: '' } as never)
    const open = () => flat(renderToString(createElement(MemoryRouter, { initialEntries: ['/app/staff-profiles/profile?staff=adamlaurent'] },
      createElement(Routes, null, createElement(Route, { path: '/app/:appId/:pageId', element: createElement(AppRoutePage) })))))
    signIn(DIRECTOR)
    assert.equal(isAllowedWith(appManifests, 'admin', 'staff-profiles'), false)
    assert.ok(!open().includes('data-staff-profiles'), 'a director sees nothing of it')
    signIn(MASTER)
    assert.equal(isAllowedWith(appManifests, 'admin', 'staff-profiles'), true)
    assert.ok(open().includes('data-staff-profiles'), 'the master gets the screen')
  })
})

describe('no modal anywhere', () => {
  it('no browser dialog, no Dialog or Sheet, no modal form, no delete, no password field', () => {
    for (const file of walk(FEATURE)) {
      const text = readFileSync(resolve(ROOT, file), 'utf8')
      assert.doesNotMatch(text, /window\.(confirm|alert|prompt)\(/, file)
      assert.doesNotMatch(text, /import[^;]*\b\w*(Dialog|Sheet)\b[^;]*from/, file)
      assert.doesNotMatch(text, /from '[^']*(ui\/dialog|ui\/sheet)'/, file)
      assert.doesNotMatch(text, /<OpsRecordModal|<ConfirmDialog|askConfirm|ImageLightbox|components\/shared\/FileViewer/, file)
      assert.doesNotMatch(text, /aria-modal|role="dialog"/, file)
      assert.doesNotMatch(text, /api\.(remove|delete)\(|'delete'/, file)
      assert.doesNotMatch(text, /type="password"|pass_hash|\bsalt\b/, file)
    }
  })

  it('every Actions item, Share, a transcript and the account doors open the aside — never a dialog, always the standard width', () => {
    const asks: StaffAsk[] = [
      ...ACTION_GROUPS.flatMap((g) => g.items.flatMap((i) => ('ask' in i ? [i.ask] : []))),
      { kind: 'share' }, { kind: 'assign', house: 'NW4045' }, { kind: 'transcript', id: 'AC1' }, { kind: 'invite' }, { kind: 'access' }, { kind: 'reset' },
      { kind: 'edit', section: 'profile' }, { kind: 'edit', section: 'hr' },
    ]
    assert.deepEqual(ACTION_GROUPS.flatMap((g) => g.items.map((i) => i.label)),
      ['New HR Issue', 'Add Note', 'Assign Training', 'File training document', 'New Incident', 'New Employee Loan', 'Add Payment',
        'Add to favorites'])
    for (const ask of asks) {
      const html = draw(<StaffPanel ask={ask} row={ROW} share={SHARE} houses={[]} onClose={noop} />)
      assert.match(html, /<aside aria-label="/, ask.kind)
      noModal(html, ask.kind)
      assert.ok(html.includes('sm:w-[384px]') && !html.includes('xl:w-['), `${ask.kind}: the standard width, a transcript too`)
    }
    assert.equal(draw(<StaffPanel ask={null} row={ROW} share={SHARE} onClose={noop} />), '')
  })

  it('the Actions menu is a menu in three groups; the favorite is a bookmark, not a panel', () => {
    const menu = draw(<ActionsMenu favorite={false} onPick={noop} onFavorite={noop} />)
    assert.match(menu, /role="menu"/)
    assert.equal((menu.match(/role="menuitem"/g) ?? []).length, 8)
    for (const g of ['Performance', 'Staff actions', 'Navigation &amp; preferences']) assert.ok(menu.includes(`data-group="${g}"`), g)
    for (const kind of ['hrissue', 'note', 'assign', 'filedoc', 'incident', 'loan', 'payment']) {
      assert.ok(menu.includes(`data-action="${kind}"`), kind)
    }
    assert.ok(menu.includes('data-action="favorite"') && menu.includes('Add to favorites'))
    assert.ok(draw(<ActionsMenu favorite onPick={noop} onFavorite={noop} />).includes('Remove from favorites'))
    noModal(menu, 'actions')
    useBookmarksStore.setState({ bookmarks: [] })
    useBookmarksStore.getState().toggle(favoriteFor(ROW))
    assert.equal(useBookmarksStore.getState().isBookmarked('person', 'staff:adamlaurent'), true)
    assert.equal(useBookmarksStore.getState().bookmarks[0].href, '/app/staff-profiles/profile?staff=adamlaurent')
    useBookmarksStore.getState().toggle(favoriteFor(ROW))
    assert.equal(useBookmarksStore.getState().isBookmarked('person', 'staff:adamlaurent'), false)
  })

  it('the forms file on the second press of "Review draft"; the incident names this person among the employees', () => {
    for (const ask of [{ kind: 'assign', house: '' }, { kind: 'incident' }, { kind: 'note' }] as StaffAsk[]) {
      const html = draw(<StaffPanel ask={ask} row={ROW} share={SHARE} houses={[]} onClose={noop} />)
      assert.ok(html.includes('data-press="review"') && html.includes('Review draft'), ask.kind)
    }
    const incident = draw(<StaffPanel ask={{ kind: 'incident' }} row={ROW} share={SHARE} onClose={noop} />)
    assert.ok(incident.includes('value="Adam Laurent"'), 'the person is among the employees involved')
    const note = draw(<StaffPanel ask={{ kind: 'note' }} row={ROW} share={SHARE} onClose={noop} />)
    for (const c of ['General', 'Performance', 'Training', 'Scheduling', 'HR']) assert.ok(note.includes(`>${c}</option>`), c)
  })

  it('share: copy the link, copy text, download, print — the staff address, no HR value', () => {
    const html = draw(<StaffPanel ask={{ kind: 'share' }} row={ROW} share={SHARE} onClose={noop} />)
    assert.ok(html.includes('/app/staff-profiles/profile?staff=adamlaurent'))
    for (const w of ['Copy', 'Copy text', 'Download', 'Print']) assert.match(html, new RegExp(`>\\s?${w}<`), w)
  })
})

/* ---------- the shell ---------- */

describe('the shell', () => {
  const inactive = { on: false, reading: false, why: '' }
  const screen = (over: Partial<Parameters<typeof StaffScreen>[0]> = {}) => draw(<StaffScreen roster={ready(ROSTER)} onRetry={noop}
    staff={ROSTER.staff} wanted="adamlaurent" row={ROW} tab="actions" view="timeline" inactive={inactive} onInactive={noop} actionsCount={3}
    favorite={false} onFavorite={noop} onStaff={noop} onTab={noop} onView={noop} onAsk={noop} {...over} />)

  it('the off-white top card with the switcher, Share and Actions; the photo card; the seven sections, Actions counted', () => {
    const html = screen()
    assert.match(html, /border border-border bg-surface[^"]*" data-top-bar=""/)
    assert.ok(!html.includes('bg-detail-hero'), 'the platform surface, never the black band')
    assert.ok(html.includes('data-switcher=""') && html.includes('data-share=""') && html.includes('data-actions=""'))
    assert.ok(html.includes('data-photo-card=""') && html.includes('>Adam Laurent</p>'))
    const order = ['Staff Profile', 'Related Clients', 'Related Locations', 'Actions', 'Calendar', 'Preferences', 'Driving', 'Compliance',
      'Documents', 'Performance', 'HR Admin', 'Employee Pay', 'Activity']
    const nav = html.slice(html.indexOf('aria-label="Staff sections"'), html.indexOf('</nav>'))
    const at = order.map((t) => nav.indexOf(`>${t}</span>`))
    assert.ok(at.every((x, i) => x !== -1 && (i === 0 || x > at[i - 1])), `the sections in order: ${JSON.stringify(at)}`)
    assert.ok(!nav.includes('>Employment</span>'), 'Employment is no section of its own')
    assert.equal(tabOf('employment'), 'profile', 'an address that names Employment opens Staff Profile')
    assert.ok(html.includes('data-actions-count="">3<'))
    assert.ok(html.includes('aria-current="page" data-tab="actions"') && html.includes('data-section="actions"'))
    noModal(html, 'shell')
  })

  it('a name two records share opens nothing and says why; an unknown address and a failed roster say so', () => {
    const amb = screen({ row: ROSTER.staff[3], wanted: 'danaoak' })
    assert.ok(amb.includes('data-ambiguous-row') && amb.includes('Two records share this name'))
    assert.ok(!amb.includes('data-section='), 'no section is drawn for a guess')
    assert.ok(screen({ row: null, wanted: 'zz' }).includes('No staff member zz in the staff the platform reads.'))
    assert.ok(screen({ row: null, wanted: '', roster: failed('Unknown action.') }).includes(esc(NOT_PUBLISHED)))
  })
})

describe('the switcher', () => {
  const list = (query: string, on: boolean) => draw(<SwitcherList staff={ROSTER.staff} current="adamlaurent" query={query} onQuery={noop}
    inactive={{ on, reading: false, why: '' }} onInactive={noop} onPick={noop} />)

  it('the active staff with their pill, the current one checked; Show Inactive adds the inactive; a shared name cannot be picked', () => {
    const html = list('', false)
    assert.match(html, /role="listbox"/)
    assert.ok(html.includes('aria-selected="true" data-staff="adamlaurent"'))
    assert.ok(html.includes('data-staff="bealee"') && !html.includes('data-staff="carlreyes"'))
    assert.ok(html.includes('Show Inactive') && html.includes('placeholder="Search staff…"'))
    assert.ok(list('', true).includes('data-staff="carlreyes"') && list('', true).includes('>Inactive<'))
    const dana = html.slice(html.indexOf('data-staff="danaoak"'))
    assert.ok(dana.includes('disabled=""') && dana.includes('two records share this name'))
    assert.ok(list('zzz', true).includes('No staff member matches.'))
    noModal(html, 'switcher')
  })
})

/* ---------- the sections ---------- */

describe('staff profile', () => {
  const view = () => draw(<ProfileView row={ROW} overview={ready(OVERVIEW)} notes={ready(NOTES)} onAsk={noop} onRetryOverview={noop} onRetryNotes={noop} />)

  it('Staff Details: every phone and every e-mail on its own line; the Driver card is the Driving tab\'s', () => {
    const html = view()
    assert.ok(!html.includes('data-driver-card') && html.includes('data-mais-card'))
    assert.ok(html.includes('>First name<') && html.includes('>Adam<') && html.includes('>ASA-1060'))
    assert.equal((html.match(/data-phone="/g) ?? []).length, 2)
    assert.ok(html.includes('href="tel:5550101160"') && html.includes('href="tel:5550102222"') && html.includes('>Phones<'))
    assert.equal((html.match(/data-email="/g) ?? []).length, 2)
    assert.ok(html.includes('>Emails<') && html.includes('Sep 01, 2026'))
    assert.ok(html.includes('data-edit-section="profile"'), 'the master\'s pencil on Staff Details')
  })

  const related = () => draw(<><RelatedClientsView overview={ready(OVERVIEW)} onRetry={noop} />
    <RelatedLocationsView overview={ready(OVERVIEW)} onRetry={noop} /></>)

  it('Staff Profile holds Employment, and the clients and houses are their own tabs, as tables', () => {
    const html = view()
    assert.ok(html.includes('data-employment=""') || html.includes('the employment record'), 'Employment sits on Staff Profile')
    assert.ok(!html.includes('Associated clients') && !html.includes('Associated locations') && !html.includes('data-map=""'))
    const tabs = related()
    for (const h of ['Client Name', 'First Date', 'Last Date', 'IST', 'Location Name']) assert.ok(tabs.includes(`>${h}</th>`), h)
    const danny = tabs.slice(tabs.indexOf('data-client="dannywhitaker"'), tabs.indexOf('data-client="sampetrakis"'))
    assert.ok(danny.includes('Feb 03, 2025') && danny.includes('Sep 20, 2026') && danny.includes('Feb 01, 2026'),
      'the first and the last day worked with the client, and the latest IST')
    const meadow = tabs.slice(tabs.indexOf('data-house="NW4045"'), tabs.indexOf('data-house="BW1001"'))
    assert.ok(meadow.includes('Jan 06, 2025') && meadow.includes('Sep 23, 2026'), 'the first and the last day worked there')
  })

  it('Related Clients: the IST column edits the record it shows, or records one where none is held, for staff.ist alone', () => {
    const plain = draw(<RelatedClientsView overview={ready(OVERVIEW)} onRetry={noop} />)
    assert.ok(!plain.includes('data-edit-section="ist"') && !plain.includes('data-ist-add='), 'no door without the edition')
    const html = draw(<RelatedClientsView overview={ready(OVERVIEW)} onRetry={noop} onAsk={noop} />)
    const danny = html.slice(html.indexOf('data-client="dannywhitaker"'), html.indexOf('data-client="sampetrakis"'))
    assert.ok(danny.includes('Feb 01, 2026') && danny.includes('data-edit-section="ist"') && danny.includes('data-edit-id="I1"')
      && !danny.includes('data-ist-add='), 'the trained record, edited in place')
    const sam = html.slice(html.indexOf('data-client="sampetrakis"'))
    assert.ok(sam.includes('data-ist-add="sampetrakis"') && sam.includes('aria-label="Record IST for Sam Petrakis"'),
      'no record keyed to the client: Record IST')
    const owed = { ...OVERVIEW, ist: OVERVIEW.ist.map((r) => (r.id === 'I2' ? { ...r, client_key: 'sampetrakis' } : r)) }
    const owing = draw(<RelatedClientsView overview={ready(owed)} onRetry={noop} onAsk={noop} />)
    const sam2 = owing.slice(owing.indexOf('data-client="sampetrakis"'))
    assert.ok(sam2.includes('data-pill="Owed"') && sam2.includes('due Oct 01, 2026') && sam2.includes('data-edit-id="I2"')
      && !sam2.includes('data-ist-add='), 'an owed record shows owed, and is the one edited')
    const ask: StaffAsk = { kind: 'istadd', client: 'sampetrakis' }
    assert.deepEqual(panelOf(panelParam(ask)), ask)
    assert.equal(panelOf('istadd'), null)
    assert.equal(askFor(ask, viewerOf(false, 'full'), 'adamlaurent'), null, 'a reader without the edition opens no form')
    assert.deepEqual(askFor(ask, viewerOf(false, 'full', undefined, ['staff.ist']), 'adamlaurent'), ask, 'a staff.ist holder does')
  })

  it('clients open the Clients app; houses open Locations, with a map of the one chosen and a chip per house', () => {
    const html = related()
    assert.ok(html.includes('href="/app/client-profiles/profile?client=dannywhitaker"') && html.includes('>Danny Whitaker<'))
    assert.ok(html.includes('href="/app/locations/overview?house=NW4045"') && html.includes('>Meadowlane<'))
    assert.ok(html.includes('data-map-chip="NW4045"') && html.includes('data-map-chip="BW1001"'))
    assert.ok(html.includes(`src="https://www.google.com/maps?q=${encodeURIComponent('908 Arlington Ave NW, Canton, OH 44708')}&amp;output=embed"`),
      'the current house is mapped first')
    assert.ok(html.includes('Open larger'))
  })

  it('Settings › My Work keeps the houses’ map to the master; a shift names its house by its location', () => {
    primeShellHides({ ...SHELL_SHOWN, staff_profile_map: true })
    try {
      const html = related()
      assert.ok(!html.includes('data-map=""') && !html.includes('data-map-chip') && html.includes('>Meadowlane<'))
    } finally {
      primeShellHides(SHELL_SHOWN)
    }
    assert.equal(houseWords({ short: '48TH (B)', location: 'CAN - 48TH (B) - ABD1711' }, 'ABD1711'), '48TH (B) - ABD1711')
    assert.equal(houseWords({ short: '49TH', location: 'CAN - 49TH - ABD1305' }, 'ABD1305'), '49TH - ABD1305')
    assert.equal(houseWords({ short: 'PRN', location: 'CAN - PRN' }, 'PRN1'), 'CAN - PRN')
    assert.equal(houseWords(undefined, 'BM4060'), 'BM4060')
  })

  it('Calendar: from today on, and only the cells that carry a time — never a past day, another house\'s abbreviation or a word', () => {
    const cell = (date: string, text: string, start?: number, end?: number): StaffShift => ({
      period_id: 'P1', house_code: 'ABD1305', row_id: 'r1', date, text, kind: start === undefined ? 'alias' : 'afternoon',
      state: 'scheduled', ...(start === undefined || end === undefined ? {} : { start, end, hours: end - start }),
    })
    const weeks = shiftWeeks([cell('2026-10-26', '2:30P-10P', 14.5, 22), cell('2026-10-27', '2P-10P', 14, 22),
      cell('2026-10-28', 'MS'), cell('2026-10-29', '48th (A)'), cell('2026-10-29', 'OFF'), cell('2026-10-29', '2:30P-10P', 14.5, 22),
      cell('2026-11-02', '2:30P-10P', 14.5, 22)], '2026-10-28')
    assert.deepEqual(weeks.flatMap((w) => w.shifts.map((s) => [s.date, s.text])), [['2026-10-29', '2:30P-10P'], ['2026-11-02', '2:30P-10P']])
    assert.deepEqual(weeks.map((w) => [w.week, w.hours]), [['2026-10-24', 7.5], ['2026-10-31', 7.5]], 'a week counts what it shows')
  })

  it('the ISTs, where they worked, and the open notes only', () => {
    const html = view()
    assert.ok(html.includes('data-ist-row="I1"') && html.includes('Trained Feb 01, 2026') && html.includes('Due Oct 01, 2026'))
    assert.ok(html.includes('data-worked-house="NW4045"') && html.includes('Jan 06, 2025 – Sep 23, 2026 · 40 days') && html.includes('>HM<'))
    assert.ok(html.includes('data-note="n1"') && !html.includes('data-note="n2"') && html.includes('Needs MANDT refresher'))
    assert.ok(html.includes('data-add-note=""'))
  })

  it('a read refused to this session says so plainly, never an empty profile', () => {
    const html = draw(<ProfileView row={ROW} overview={failed('Unknown action.')} notes={failed('Unknown action.')} onAsk={noop}
      onRetryOverview={noop} onRetryNotes={noop} />)
    assert.ok(html.includes(esc(NOT_PUBLISHED)))
    assert.ok(!html.includes('No client is tied'), 'a failed read is never drawn as no clients')
  })
})

describe('employment', () => {
  it('pure data; the resume opens in the platform when a file is on record, and a flag alone says so', () => {
    const e = employmentOf({ hiring: { referral: 'Maya Chen', referral_paid: '2026-09-18', referral_paid_flag: 'yes', job_app_date: '2026-07-28',
      resume: { flag: 'yes', doc_id: null }, attestation_date: '2026-08-24' }, dates: { start_doc: '2026-08-24', start_first_day: '2026-09-01', end_last_day: '' },
    qualifications: { hs_diploma: { flag: '1', doc_id: 'hsfilexxxxxx', doc_date: '2026-08-26' }, driver: { value: 'Yes', approved: true } }, on_master: true })
    const html = draw(<EmploymentView row={ROW} employment={ready(e)} doc={IDLE_DOC} onRetry={noop} />)
    for (const t of ['Hiring', 'Employment Dates', 'Qualifications']) assert.ok(html.includes(`>${t}</h2>`), t)
    assert.ok(html.includes('Yes · Sep 18, 2026') && html.includes('Jul 28, 2026') && html.includes('Aug 24, 2026'))
    assert.ok(html.includes('Flag: Yes · ') && html.includes('no resume file in the documents read for this person'))
    assert.ok(!html.includes('on the platform'), 'a file not found where it was looked for is never "not on the platform"')
    assert.ok(html.includes('data-open-doc="hsfilexxxxxx"') && html.includes('Verified · Aug 26, 2026'))
    assert.ok(html.includes('Not applicable · Active') && html.includes('Approved driver'))
    const withFile = employmentOf({ hiring: { resume: { flag: 'yes', doc_id: 'resumexxxxxx' } }, on_master: true })
    assert.ok(draw(<EmploymentView row={ROW} employment={ready(withFile)} doc={IDLE_DOC} onRetry={noop} />).includes('data-open-doc="resumexxxxxx"'))
    const off = draw(<EmploymentView row={ROW} employment={ready(employmentOf({ on_master: false, why: 'no Master row names Adam Laurent' }))}
      doc={IDLE_DOC} onRetry={noop} />)
    assert.ok(off.includes('No Employee Master row is read for this person — no Master row names Adam Laurent'))
  })
})

describe('documents', () => {
  const docs = documentsOf({ docs: [
    { id: 'jobappxxxxxx', file_id: 'jobappxxxxxx', title: 'Job application', category: 'hiring', date: '2026-07-28', status: 'on_file' },
    { id: 'i9xxxxxxxxxx', file_id: 'i9xxxxxxxxxx', title: 'Form I-9', category: 'work_authorization', date: '2026-08-24', expires: '2032-03-18', status: 'verified' },
    { id: 'master:hipaa', file_id: null, title: 'HIPAA form', category: 'hiring', date: '2026-08-25', status: 'missing' },
  ], counts: { total: 3, with_file: 2, missing: 1 } })

  after(() => useAuthStore.setState({ user: null } as never))

  it('a table — View, Doc Name, Status, Upload Date, Upload; a missing one has no View and opens nothing', () => {
    signIn(MASTER)
    const html = draw(<DocumentsView name="Adam Laurent" docs={ready(docs)} doc={IDLE_DOC} onRetry={noop} onUpload={noop} />)
    const heads = [...html.matchAll(/<th class="[^"]*">([^<]*)<\/th>/g)].map((m) => m[1])
    assert.deepEqual(heads, ['View', 'Doc Name', 'Status', 'Upload Date', 'Upload'])
    assert.ok(html.includes('3 documents · 2 with a file · 1 missing'), 'the master sees the count line')
    assert.ok(html.includes('Work authorization · expires Mar 18, 2032') && html.includes('>Aug 24, 2026<'))
    assert.ok(html.includes('>Verified<') && html.includes('>On File<'))
    assert.equal((html.match(/data-open-doc="/g) ?? []).length, 2)
    assert.ok(html.includes('aria-label="View Form I-9"') && !html.includes('data-open-doc="master:hipaa"'))
    const hipaa = html.slice(html.indexOf('data-doc="master:hipaa"'))
    assert.ok(hipaa.includes('>Missing<') && !hipaa.includes('data-open-doc'))
    assert.equal((html.match(/data-upload-doc="/g) ?? []).length, 3)
    assert.ok(html.includes('aria-label="Upload HIPAA form"'))
    assert.ok(!html.includes('drive.google.com') && !html.includes('target="_blank"') && !html.includes('panel='), 'no link, no panel')
    const reader = draw(<DocumentsView name="Adam Laurent" docs={ready(docs)} doc={IDLE_DOC} onRetry={noop} />)
    assert.ok(!reader.includes('data-upload-doc='), 'no Upload without the door')
  })

  it('the count line is the master\'s alone while Settings › My Work hides it', () => {
    const line = '3 documents · 2 with a file · 1 missing'
    signIn({ ...DIRECTOR })
    assert.ok(!draw(<DocumentsView name="Adam Laurent" docs={ready(docs)} doc={IDLE_DOC} onRetry={noop} />).includes(line))
    signIn({ ...DIRECTOR, staffDocCountsHidden: false })
    assert.ok(draw(<DocumentsView name="Adam Laurent" docs={ready(docs)} doc={IDLE_DOC} onRetry={noop} />).includes(line))
    signIn({ ...MASTER, staffDocCountsHidden: true })
    assert.ok(draw(<DocumentsView name="Adam Laurent" docs={ready(docs)} doc={IDLE_DOC} onRetry={noop} />).includes(line))
    assert.deepEqual(panelOf(panelParam({ kind: 'docupload', doc: 'Form I-9' })), { kind: 'docupload', doc: 'Form I-9' })
    assert.equal(panelOf('docupload'), null)
  })
})

describe('compliance', () => {
  it('every course with its expiry and pill; no date is never Current; credentials and the screening summary', () => {
    const c = complianceOf({
      training: [{ id: 'dodd', label: 'DODD 8-Hour', expires: '2026-10-15', state: 'due_soon', tracker_word: 'Renewal assigned' },
        { id: 'mandt', label: 'MANDT', expires: '', state: 'current' },
        { id: 'cpr', label: 'CPR / First Aid', expires: '2028-09-16', state: 'current' },
        { id: 'med1', label: 'Medication Delivery 1', expires: '2025-01-01', state: 'expired',
          renewal: { phase: '3', phase_label: 'Relias training', level: 'Med 1' } },
        { id: 'med2', label: 'Medication Delivery 2', expires: '', state: 'renewal_assigned',
          renewal: { phase: '2', phase_label: 'Application received', level: 'Med 2' } }],
      credentials: [{ id: 'driver_license', label: "Driver's license", expires: '2030-03-18', state: 'current' },
        { id: 'nurse_aide', label: 'Nurse Aide / STNA', state: 'na', note: 'No STNA licence source; the Nurse Aide columns are the registry check' }],
      screening: [{ id: 'federal', label: 'Federal exclusions (SAM + OIG)', state: 'clear', date: '2026-08-27' },
        { id: 'bci_fbi', label: 'BCI / FBI', state: 'clear', date: '2026-08-28', rapback_date: '2026-08-30' }],
      window_days: 60,
    })
    const html = draw(<ComplianceView compliance={ready(c)} onRetry={noop} />)
    for (const t of ['Training', 'Credentials', 'Screening Summary']) assert.ok(html.includes(`>${t}</h2>`), t)
    const mandt = html.slice(html.indexOf('data-row="mandt"'), html.indexOf('data-row="cpr"'))
    assert.ok(mandt.includes('No date on file') && !mandt.includes('>Current<'))
    assert.ok(html.includes('>Due Soon<') && html.includes('>Expired<') && html.includes('>Not Applicable<'))
    const row = (id: string, next: string) => html.slice(html.indexOf(`data-row="${id}"`), next ? html.indexOf(`data-row="${next}"`) : undefined)
    const dodd = row('dodd', 'mandt')
    assert.ok(dodd.includes('>Renewal assigned<') && dodd.includes('>Due Soon<'), 'the tracker\'s own word under the course, its date pill kept')
    const med1 = row('med1', 'med2')
    assert.ok(med1.includes('Renewal assigned · Phase 3 · Relias training') && med1.includes('>Expired<'))
    const med2 = row('med2', 'driver_license')
    assert.ok(med2.includes('>Renewal assigned<') && med2.includes('>Phase 2 · Application received<') && !med2.includes('No date on file'),
      'a renewal running for a course with no date is its pill, the phase its sub-line')
    assert.ok(html.includes('Federal exclusions (SAM + OIG)') && html.includes('Rapback enrolled · Aug 30, 2026'))
    assert.ok(html.includes('Clear') && html.includes('Aug 27, 2026'))
    const partial = draw(<ComplianceView compliance={ready(complianceOf({ training: [], degraded: true, why: 'the uploads ledger could not be read' }))}
      onRetry={noop} />)
    assert.ok(partial.includes('data-degraded') && partial.includes('the uploads ledger could not be read'))
  })
})

describe('HR admin', () => {
  const hr = hrOf({
    personal: { ssn_masked: '•••-••-1842', dob: '1992-03-18', address: '160 Oak Street', city: 'Columbus', state: 'OH', zip: '43215', w4_date: '2026-08-24' },
    work_auth: { i9_date: '2026-08-24', i9_completed: 'Yes · verified', i9_type_1: 'U.S. Passport', i9_type_1_exp: '2032-03-18', i9_type_2: 'Not required',
      i9_type_2_exp: 'n/a' },
    driver: { driver: 'Yes', approved: true, license_masked: 'OH •••• 7731', license_exp: '2030-03-18' },
    screening: [{ id: 'sam', label: 'SAM database', state: 'clear', date: '2026-08-27' }, { id: 'nurse_aide', label: 'Nurse aide', state: 'na' },
      { id: 'bci_fbi', label: 'BCI / FBI', state: 'clear', ref_masked: 'BMT•••••789' }],
    bci_check_date: '2026-08-28', rapback_entry_date: '2026-08-30',
    account: { user_id: 'u-adam', login: 'adam.laurent@example.invalid', role: 'staff', active: true, last_login: '' },
  })

  it('the restricted banner, the masked values as sent, the screening, and Account Access with its three doors', () => {
    const html = draw(<HrAdminView hr={ready(hr)} onAsk={noop} onRetry={noop} />)
    assert.ok(html.includes('Restricted HR record') && html.includes('Views and changes belong in the audit history.'))
    assert.ok(html.includes('•••-••-1842') && html.includes('OH •••• 7731') && html.includes('BMT•••••789'))
    assert.ok(html.includes('Mar 18, 1992') && html.includes('U.S. Passport') && html.includes('Yes · approved'))
    assert.ok(html.includes('Clear · Aug 27, 2026') && html.includes('Not applicable'))
    const typeTwo = html.slice(html.indexOf('data-cell="I-9 type 2 expiration"'))
    assert.ok(typeTwo.slice(0, 300).includes('Not applicable'), 'n/a is said in words')
    for (const t of ['Personal &amp; Tax', 'Work Authorization', 'Driver Details', 'Screening', 'Account Access']) assert.ok(html.includes(`>${t}</h2>`), t)
    assert.ok(html.includes('Passwords are never displayed or exported.') && html.includes('Never signed in'))
    for (const a of ['invite', 'access', 'reset']) assert.ok(html.includes(`data-account="${a}"`), a)
    assert.ok(html.includes('Send Invite') && html.includes('Disable Access') && html.includes('Reset Password'))
    assert.ok(!html.includes('type="password"') && !/>Password</.test(html), 'no password field ever renders')
  })

  it('a raw number the answer failed to mask is never drawn; no account says why', () => {
    const raw = hrOf({ personal: { ssn_masked: '123-45-1842' }, driver: { license_masked: 'OH12345678' }, account: null, account_why: 'no account matches this name' })
    const html = draw(<HrAdminView hr={ready(raw)} onAsk={noop} onRetry={noop} />)
    assert.ok(!html.includes('123-45-1842') && !html.includes('OH12345678'))
    assert.ok(html.includes('data-no-account') && html.includes('no account matches this name'))
    assert.ok(!html.includes('data-account="invite"'))
  })
})

describe('actions', () => {
  it('STATUS | ITEM | FLOW | PHASE and the row\'s button, with a search', () => {
    const a = actionsOf({ items: [
      { id: 'u1', status: 'in_review', item: 'CPR certificate', date: '2026-09-20', flow: 'Certificate review', phase: 'In review', action: { kind: 'doc', doc_id: 'certxxxxxxxx' } },
      { id: 'r1', status: 'needs_attention', item: 'Medication Delivery 1', flow: 'Training renewal', phase: 'Expired', action: { kind: 'none' } },
      { id: 'i1', status: 'due_soon', item: 'IST · Sam Petrakis', flow: 'IST training', phase: 'Owed · due Oct 01, 2026', action: { kind: 'assign_training', house: 'BW1001' } },
    ] })
    const html = draw(<ActionsView name="Adam Laurent" actions={ready(a)} doc={IDLE_DOC} query="" onQuery={noop} onAsk={noop} onRetry={noop} />)
    for (const h of ['Status', 'Item', 'Flow', 'Phase']) assert.ok(html.includes(`>${h}</th>`), h)
    assert.ok(html.includes('>In Review<') && html.includes('>Needs Attention<') && html.includes('>Due Soon<'))
    assert.ok(html.includes('Review certificate') && html.includes('Assign training') && html.includes('placeholder="Search pendencies…"'))
    assert.ok(html.includes('data-row-action="doc"') && html.includes('data-row-action="assign_training"'))
    const filtered = draw(<ActionsView name="Adam Laurent" actions={ready(a)} doc={IDLE_DOC} query="ist" onQuery={noop} onAsk={noop} onRetry={noop} />)
    assert.ok(filtered.includes('data-action-row="i1"') && !filtered.includes('data-action-row="r1"'))
    assert.ok(draw(<ActionsView name="Adam Laurent" actions={ready(actionsOf({ items: [] }))} doc={IDLE_DOC} query="" onQuery={noop} onAsk={noop}
      onRetry={noop} />).includes('Nothing is pending for Adam Laurent.'))
  })
})

describe('activity', () => {
  it('the timeline and who visited', () => {
    const a = activityOf({
      events: [{ at: '2026-09-25T14:00:00Z', kind: 'scheduled', title: 'Scheduled — Meadowlane · Mon, Wed · 7a–3p' },
        { at: '2026-09-20T14:00:00Z', kind: 'upload', title: 'Training document added', by: 'Adam Laurent' }],
      visits: [{ at: '2026-09-27T14:00:00Z', visitor: 'Boss', section: 'hr' }], visits_total: 1,
    })
    const tl = draw(<TimelineView activity={ready(a)} onRetry={noop} />)
    assert.ok(tl.includes('data-event="scheduled"') && tl.includes('Training document added'))
    assert.ok(!tl.includes('confirmed'), 'no store of confirmations exists, so nothing says confirmed')
    const v = draw(<VisitsView activity={ready(a)} onRetry={noop} />)
    assert.ok(v.includes('data-visit="hr"') && v.includes('Opened HR Admin') && v.includes('1 visit on record.'))
  })

  it('shifts: what is scheduled, what was worked, and a stretch with no rows as a gap', () => {
    const s = shiftsOf({ houses: [{ code: 'NW4045', home_name: 'Meadowlane' }],
      days: [{ date: '2026-09-20', house: 'NW4045', start: '7a', end: '3p', designation: 'hm', source: 'archive' }],
      upcoming: [{ date: '2026-09-30', house: 'NW4045', start: '7a', end: '3p' }],
      patterns: [{ house: 'NW4045', weekdays: ['Mon', 'Wed'], start: '7a', end: '3p' }],
      sources: { archive: { readable: true }, punches: { readable: false, why: 'PSI did not answer' } },
      gaps: [{ from: '2025-10-01', to: '2025-12-31' }] })
    const html = draw(<ShiftsView shifts={ready(s)} onRetry={noop} />)
    assert.ok(html.includes('Scheduled — Meadowlane · Mon, Wed · 7a–3p') && html.includes('Sep 30, 2026'))
    assert.ok(html.includes('data-day="2026-09-20"') && html.includes('>HM<'))
    assert.ok(html.includes('Oct 01, 2025 – Dec 31, 2025') && html.includes('a gap in the record, not days off'))
    assert.ok(html.includes('PSI punches: PSI did not answer') && html.includes('data-degraded'))
  })

  it('texts: a horizontal switch between counterparts, a scrolling thread, the gap drawn, earlier pages on demand', () => {
    const t = textsOf({
      counterparts: [{ id: '+13305550100', label: 'Hotline', count: 2, last_at: '2026-08-25T10:00:00Z' }, { id: '+13305550200', label: 'Office', owner: 'Ann Lee', count: 5 }],
      with: '+13305550100',
      messages: [{ id: 'm2', at: '2026-08-25T14:00:00Z', dir: 'out', body: 'We have you Monday', by: 'Office' }, { id: 'm1', at: '2026-05-06T14:00:00Z', dir: 'in', body: 'Can I work Monday?' }],
      more: true, coverage: { from: '2026-01-01', to: '2026-09-28', gaps: [{ from: '2026-05-07', to: '2026-08-23' }] },
    })
    const html = draw(<TextsView texts={ready(t)} older={[]} more olderBusy={false} olderError="" onPick={noop} onOlder={noop} onRetry={noop} />)
    assert.match(html, /role="tablist" aria-label="Conversations"[^>]*overflow-x-auto/)
    assert.ok(html.includes('aria-selected="true" data-counterpart="+13305550100"') && html.includes('data-counterpart="+13305550200"'))
    assert.match(html, /max-h-\[520px\][^"]*overflow-y-auto[^"]*" data-thread="\+13305550100"/)
    assert.ok(html.indexOf('Can I work Monday?') < html.indexOf('We have you Monday'), 'oldest first, as a thread reads')
    assert.ok(html.includes('data-msg="in"') && html.includes('data-msg="out"') && html.includes('data-thread-gap'))
    assert.ok(html.includes('No text is on file in any store from May 07, 2026 – Aug 23, 2026'))
    assert.ok(html.includes('data-older=""') && html.includes('Load earlier'))
    const none = draw(<TextsView texts={ready(textsOf({ counterparts: [], phones_matched: 0 }))} older={[]} more={false} olderBusy={false} olderError=""
      onPick={noop} onOlder={noop} onRetry={noop} />)
    assert.ok(none.includes('no phone of theirs is on file to match'))
  })

  it('transcripts: a scrolling list by day, a category filter, each call opening its words in the panel', () => {
    const tr = transcriptsOf({
      calls: [{ call_id: 'AC1', at: '2026-09-20T14:00:00Z', secs: 61, direction: 'incoming', line: 'Hotline', categories: ['Call-off'] },
        { call_id: 'AC2', at: '2026-09-18T14:00:00Z', secs: 30, categories: ['Question'] }],
      categories: [{ name: 'Call-off', count: 1 }, { name: 'Question', count: 1 }], gaps: [{ from: '2026-06-01', to: '2026-06-30' }],
    })
    const html = draw(<TranscriptsView transcripts={ready(tr)} category="" onCategory={noop} onOpen={noop} onRetry={noop} />)
    assert.match(html, /max-h-\[520px\] overflow-y-auto[^"]*" data-calls=""/)
    assert.ok(html.includes('>Sep 20, 2026<') && html.includes('>Sep 18, 2026<'))
    assert.ok(html.includes('data-category="all"') && html.includes('data-category="Call-off"'))
    assert.ok(html.includes('data-call="AC1"') && html.includes('1m 01s'))
    assert.ok(html.includes('Jun 01, 2026 – Jun 30, 2026'))
    const only = draw(<TranscriptsView transcripts={ready(tr)} category="Question" onCategory={noop} onOpen={noop} onRetry={noop} />)
    assert.ok(only.includes('data-call="AC2"') && !only.includes('data-call="AC1"'))
  })
})

/* ---------- the viewer ---------- */

describe('the viewer', () => {
  const inactive = { on: false, reading: false, why: '' }
  const as = (viewer: StaffViewer, node: ReactNode) =>
    draw(<StaffViewerContext.Provider value={viewer}>{node}</StaffViewerContext.Provider>)
  const READER = viewerOf(false, 'full')
  const BASIC = viewerOf(false, 'basic')
  const screen = (viewer: StaffViewer, tab: 'hr' | 'profile') => as(viewer, <StaffScreen roster={ready(ROSTER)} onRetry={noop}
    staff={ROSTER.staff} wanted="adamlaurent" row={ROW} tab={tab} view="timeline" inactive={inactive} onInactive={noop} actionsCount={null}
    favorite={false} onFavorite={noop} onStaff={noop} onTab={noop} onView={noop} onAsk={noop} />)

  it('a basic viewer has the profile alone: no section list, and no other section even when the address names one', () => {
    const html = screen(BASIC, 'hr')
    assert.ok(html.includes('data-section="profile"') && !html.includes('data-section="hr"'))
    assert.ok(!html.includes('data-tab=') && !html.includes('aria-label="Staff sections"'), 'no section list')
    for (const t of ['Employment', 'Documents', 'HR Admin', 'Activity']) assert.ok(!html.includes(`>${t}</span>`), t)
    assert.ok(html.includes('data-basic-profile=""') && html.includes('data-share=""'))
    const whole = screen(READER, 'hr')
    assert.ok(whole.includes('data-section="hr"') && whole.includes('data-tab="activity"'))
  })

  it('the basic profile is who the person is and the ISTs on the viewer\'s client — never a contact, note, house, client or record', () => {
    const basic = overviewOf({
      person: { key: 'adamlaurent', name: 'Adam Laurent', first_name: 'Adam', last_name: 'Laurent', role: 'Chief of Staff', status: 'active' },
      ist: [{ id: 'I1', client_key: 'dannywhitaker', client_name: 'Danny Whitaker', house: 'NW4045', status: 'done', trained_at: '2026-02-01' }],
      view: 'basic',
    })
    const html = draw(<BasicProfileView row={ROW} overview={ready(basic)} onRetry={noop} />)
    assert.ok(html.includes('>Adam<') && html.includes('>Laurent<') && html.includes('Chief of Staff') && html.includes('>Active<'))
    assert.ok(html.includes('data-ist-row="I1"') && html.includes('Danny Whitaker') && html.includes('Trained Feb 01, 2026'))
    for (const gone of ['Employee ID', 'data-phone', 'data-email', 'Staff notes', 'data-add-note', 'Associated clients', 'Associated locations',
      'Where they worked', 'data-driver-card', 'data-mais-card', 'ASA-1060']) {
      assert.ok(!html.includes(gone), gone)
    }
    const none = draw(<BasicProfileView row={ROW} overview={ready(overviewOf({ person: basic.person, ist: [] }))} onRetry={noop} />)
    assert.ok(none.includes('No IST record trains this person on your client.'))
  })

  it('a viewer who writes nothing: no Add Note, the notes read-only, no account doors, no Assign Training, no HR issue or loan; the menu Add Payment, which its door judges, and the favorite', () => {
    const prof = as(READER, <ProfileView row={ROW} overview={ready(OVERVIEW)} notes={ready(NOTES)} onAsk={noop} onRetryOverview={noop}
      onRetryNotes={noop} />)
    assert.ok(!prof.includes('data-add-note') && prof.includes('data-note-read=""') && prof.includes('Needs MANDT refresher'))
    assert.ok(prof.includes('data-phone="') && prof.includes('>ASA-1060'), 'the whole record is still drawn')
    assert.ok(!prof.includes('data-edit-section'), 'no pencil')
    const hr = as(READER, <HrAdminView hr={ready(hrOf({ account: { user_id: 'u-adam', login: 'adam@example.invalid', role: 'staff', active: true } }))}
      onAsk={noop} onRetry={noop} />)
    assert.ok(hr.includes('adam@example.invalid') && !hr.includes('data-account-buttons') && !hr.includes('data-account="reset"'))
    assert.ok(!hr.includes('data-edit-section'), 'no pencil on HR')
    const menu = as(READER, <ActionsMenu favorite={false} onPick={noop} onFavorite={noop} />)
    assert.equal((menu.match(/role="menuitem"/g) ?? []).length, 2)
    assert.ok(menu.includes('data-action="favorite"') && menu.includes('data-action="payment"'))
    for (const kind of ['hrissue', 'note', 'assign', 'filedoc', 'incident', 'loan']) assert.ok(!menu.includes(`data-action="${kind}"`), kind)
    const a = actionsOf({ items: [
      { id: 'u1', status: 'in_review', item: 'CPR certificate', action: { kind: 'doc', doc_id: 'certxxxxxxxx' } },
      { id: 'i1', status: 'due_soon', item: 'IST · Sam Petrakis', action: { kind: 'assign_training', house: 'BW1001' } },
    ] })
    const acts = as(READER, <ActionsView name="Adam Laurent" actions={ready(a)} doc={IDLE_DOC} query="" onQuery={noop} onAsk={noop} onRetry={noop} />)
    assert.ok(acts.includes('data-row-action="doc"') && !acts.includes('data-row-action="assign_training"'))
  })

  it('a refused read is said plainly as not open to this session — no alert and no retry; any other failure keeps both', () => {
    const shut = draw(<ReadLine state={failed('Unknown action.')} what="the HR record" onRetry={noop} />)
    assert.ok(shut.includes('data-read="refused"') && shut.includes(esc(NOT_PUBLISHED)) && !shut.includes('role="alert"'))
    const denied = draw(<ReadLine state={failed('Requires an admin or manager account')} what="the transcript" onRetry={noop} />)
    assert.ok(denied.includes('data-read="refused"'))
    const broke = draw(<ReadLine state={failed('The HR record could not be read just now (x).')} what="the HR record" onRetry={noop} />)
    assert.ok(broke.includes('role="alert"') && broke.includes('data-read="failed"'))
  })
})

/* ---------- the doors ---------- */

describe('the Apps Script doors', () => {
  const realFetch = globalThis.fetch
  let calls: { action: string; payload: Record<string, unknown> }[] = []
  let answer: (action: string, payload: Record<string, unknown>) => unknown = () => ({})
  before(() => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload: Record<string, unknown> }
      calls.push({ action: env.action, payload: env.payload })
      const data = answer(env.action, env.payload)
      if (data instanceof Error) return new Response(JSON.stringify({ status: 404, message: data.message }))
      return new Response(JSON.stringify({ status: 200, data }))
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })
  afterEach(() => {
    calls = []
    answer = () => ({})
    forgetStaffReads()
    useFileViewerStore.getState().closeFile()
    useToastStore.setState({ toasts: [] })
  })

  it('each section reads its own action by name, with the staff key', async () => {
    await readRoster(false)
    await readRoster(true)
    for (const read of [readOverview, readShifts, readEmployment, readDocuments, readCompliance, readHr, readActions, readActivity, readNotes,
      readTranscripts]) await read('adamlaurent')
    await readTexts('adamlaurent')
    await readTexts('adamlaurent', '+13305550100', '2026-08-25T10:00:00Z')
    await readTranscript('adamlaurent', 'AC1')
    assert.deepEqual(calls.map((c) => [c.action, c.payload]), [
      ['staffProfileRoster', {}],
      ['staffProfileRoster', { show_inactive: true }],
      ['staffProfileOverview', { staff: 'adamlaurent' }],
      ['staffProfileShifts', { staff: 'adamlaurent' }],
      ['staffProfileEmployment', { staff: 'adamlaurent' }],
      ['staffProfileDocuments', { staff: 'adamlaurent' }],
      ['staffProfileCompliance', { staff: 'adamlaurent' }],
      ['staffProfileHr', { staff: 'adamlaurent' }],
      ['staffProfileActions', { staff: 'adamlaurent' }],
      ['staffProfileActivity', { staff: 'adamlaurent' }],
      ['staffProfileNotes', { staff: 'adamlaurent' }],
      ['staffProfileTranscripts', { staff: 'adamlaurent' }],
      ['staffProfileTexts', { staff: 'adamlaurent' }],
      ['staffProfileTexts', { staff: 'adamlaurent', with: '+13305550100', before: '2026-08-25T10:00:00Z' }],
      ['staffProfileTranscript', { staff: 'adamlaurent', call_id: 'AC1' }],
    ])
  })

  it('the writes carry the plan\'s parameters; the account doors are the Users and Release Users ones', async () => {
    await addNote({ staff: 'adamlaurent', category: 'training', priority: 'high', details: 'Needs MANDT' })
    await setNoteState('n1', 'resolved', 'adamlaurent')
    await assignTraining({ staff: 'adamlaurent', house: 'BW1001', due_date: '2026-10-15' })
    await sendInvite('u-adam')
    await setAccountActive('u-adam', false)
    await readReleaseStatus('u-adam')
    await resetPassword('u-adam')
    const [reset] = calls.slice(-1)
    assert.deepEqual(calls.slice(0, -1).map((c) => [c.action, c.payload]), [
      ['staffProfileNoteAdd', { staff: 'adamlaurent', category: 'training', priority: 'high', details: 'Needs MANDT' }],
      ['staffProfileNoteState', { id: 'n1', state: 'resolved', staff: 'adamlaurent' }],
      ['staffProfileAssignTraining', { staff: 'adamlaurent', house: 'BW1001', due_date: '2026-10-15' }],
      ['userInvite', { user_ids: ['u-adam'] }],
      ['userUpdate', { user_id: 'u-adam', active: false }],
      ['releaseUserStatus', { user_id: 'u-adam' }],
    ])
    assert.equal(reset.action, 'releaseUser')
    assert.equal(reset.payload.user_id, 'u-adam')
    assert.equal(typeof reset.payload.press_id, 'string')
    assert.ok(!('anyway' in reset.payload))
  })

  it('the record edit sends only the changed fields with their witness, and the sign-in email\'s confirmation only when ticked', async () => {
    const w4 = { field: 'w4_date', value: '2024-01-03', expected: '2023-12-22T05:00:00.000Z' }
    const login = { field: 'login_email', value: 'adam.new@example.invalid', expected: 'adam@example.invalid' }
    await editStaff('adamlaurent', [w4])
    await editStaff('adamlaurent', [login], true)
    assert.deepEqual(calls.map((c) => [c.action, c.payload]), [
      ['staffProfileEdit', { key: 'adamlaurent', changes: [w4] }],
      ['staffProfileEdit', { key: 'adamlaurent', changes: [login], confirm_login_email: true }],
    ])
  })

  it('a visit is recorded once per person and section, and never waited on', async () => {
    recordVisit('adamlaurent', 'hr')
    recordVisit('adamlaurent', 'hr')
    recordVisit('adamlaurent', 'documents')
    await new Promise((r) => setTimeout(r, 0))
    assert.deepEqual(calls.map((c) => [c.action, c.payload]), [
      ['staffProfileVisit', { staff: 'adamlaurent', section: 'hr' }],
      ['staffProfileVisit', { staff: 'adamlaurent', section: 'documents' }],
    ])
  })

  it('a document opens centred in the platform\'s viewer from its bytes as a blob URL — never in the panel', async () => {
    answer = (action) => action === 'staffProfileDocFile'
      ? { id: 'i9xxxxxxxxxx', name: 'Form I-9.pdf', mime: 'application/pdf', size: 4, exported: false, b64: 'JVBERg==' } : {}
    const h = mountHook(() => useStaffDoc('adamlaurent'), {})
    h.run(() => h.current.open('i9xxxxxxxxxx', { title: 'Form I-9', subtitle: 'Adam Laurent' }))
    assert.equal(h.current.opening, 'i9xxxxxxxxxx')
    await h.settle(() => !!useFileViewerStore.getState().file && h.current.opening === '')
    const f = useFileViewerStore.getState().file
    assert.match(f?.url ?? '', /^blob:/)
    assert.deepEqual([f?.title, f?.subtitle], ['Form I-9', 'Adam Laurent'])
    assert.deepEqual(calls.map((c) => [c.action, c.payload]), [['staffProfileDocFile', { staff: 'adamlaurent', id: 'i9xxxxxxxxxx' }]])
    useFileViewerStore.getState().closeFile()
    answer = () => new Error('Unknown action.')
    h.run(() => h.current.open('strangerxxxx', { title: 'x' }))
    await h.settle(() => h.current.opening === '')
    assert.equal(useFileViewerStore.getState().file, null)
    const [t] = useToastStore.getState().toasts
    assert.deepEqual([t?.type, t?.body], ['danger', NOT_PUBLISHED])
    h.unmount()
  })

  it('a read is held for the section and its panel; the account panel draws the account the HR read matched', async () => {
    answer = (action) => (action === 'staffProfileHr' ? { account: { user_id: 'u-adam', login: 'adam@example.invalid', active: false, last_login: '' } } : {})
    const key = readKey('staffProfileHr', 'adamlaurent')
    const a = mountHook(() => useStaffRead(key, () => readHr('adamlaurent'), hrOf), {})
    await a.settle(() => a.current.status === 'ready')
    const html = draw(<StaffPanel ask={{ kind: 'access' }} row={ROW} share={SHARE} onClose={noop} />)
    assert.ok(html.includes('>Enable Access</h2>') && html.includes('adam@example.invalid') && html.includes('Passwords are never displayed or exported.'))
    assert.ok(!html.includes('type="password"'))
    const invite = draw(<StaffPanel ask={{ kind: 'invite' }} row={ROW} share={SHARE} onClose={noop} />)
    assert.ok(invite.includes('a letter to the login address') && invite.includes('data-press="review"'))
    assert.equal(calls.length, 1, 'the panels drew the held answer')
    a.unmount()
  })

  it('a refusal keeps its sentence, said plainly as a part not open to this session', async () => {
    answer = () => new Error('Unknown action.')
    const h = mountHook(() => useStaffRead(readKey('staffProfileActions', 'adamlaurent'), () => readActions('adamlaurent'), actionsOf), {})
    await h.settle(() => h.current.status === 'failed')
    assert.equal(h.current.error, 'Unknown action.')
    assert.ok(draw(<ReadLine state={h.current} what="the pendencies" onRetry={noop} />).includes(esc(NOT_PUBLISHED)))
    h.unmount()
  })
})
