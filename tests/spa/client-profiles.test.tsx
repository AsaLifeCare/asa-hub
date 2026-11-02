/**
 * CLIENTS · the screen: the app and who may open it, the rename of the old one to Client Care, the sections drawn
 * whole — five from ClientProfiles.gs, six from the apps that hold them — the one right panel in every mode, a
 * document in the platform's centred viewer, and the Apps Script doors each read and write goes through (answered
 * here at `fetch`, with the door's envelope).
 *
 * The app is the master's until it is released: no App Control row ships, and the page is mounted only through
 * CUSTOM_PAGES, behind the resolver's badge check. Nothing in it is a dialog — the switcher is a listbox, Actions a
 * menu, every form, record and share is the SidePanel aside, and a document opens in the platform's own viewer.
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
import { useFileViewerStore } from '@/stores/useFileViewerStore'
import { appManifests } from '@/registry/apps'
import { clientProfilesManifests } from '@/registry/apps-client-profiles'
import AppRoutePage, { CUSTOM_PAGES } from '@/pages/AppRoutePage'
import ClientProfilesPage, { ClientsScreen } from '@/pages/features/clientprofiles/ClientProfilesPage'
import ClientPanel from '@/pages/features/clientprofiles/ClientPanel'
import { ActionsMenu } from '@/pages/features/clientprofiles/ClientActions'
import { SwitcherList } from '@/pages/features/clientprofiles/ClientSwitcher'
import { ProfileView } from '@/pages/features/clientprofiles/sections/Profile'
import { CareBody, careTeamHref } from '@/pages/features/clientprofiles/sections/Care'
import { recordDetails } from '@/pages/features/clientprofiles/sections/recordColumns'
import MedicationSection, { MedicationsBody } from '@/pages/features/clientprofiles/sections/Medication'
import { IncidentsBody } from '@/pages/features/clientprofiles/sections/Incidents'
import { ActivityBody } from '@/pages/features/clientprofiles/sections/Activity'
import {
  NOT_PUBLISHED, actionGroups, activityOf, careOf, clientIncidentsOf, medsOf, profileOf, sharePayloadFor,
  type ClientAsk, type ClientTab, type RosterRow,
} from '@/pages/features/clientprofiles/clientModel'
import {
  addMedication, clientWritten, createClient, createClientUser, forgetClientReads, guardiansToRoster,
  readActivity, readCare, readDetails, readIncidents, readKey, readMeds, readRoster,
  readThePlans, saveAppointment, editMedication, editProfile, removeMedication, setIncidentStatus, useClientDocs, useClientRead, usersFromClients,
  usersFromGuardians, type ReadState,
} from '@/pages/features/clientprofiles/useClientRead'
import { mountHook } from './react-host'
import { SHELL_SHOWN, primeShellHides } from '@/lib/myWorkHides'

// the sections Settings › My Work can hide are drawn as a session it shows them to sees them
primeShellHides(SHELL_SHOWN)

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const FEATURE = 'src/pages/features/clientprofiles'
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))
const noop = () => {}
const noModal = (html: string, what: string) => {
  assert.ok(!html.includes('aria-modal'), `${what}: no aria-modal`)
  assert.ok(!html.includes('role="dialog"') && !html.includes('role="alertdialog"'), `${what}: no dialog role`)
}
/** One table row's markup, from its data-row to its close. */
const rowHtml = (html: string, id: string) => {
  const at = html.indexOf(`data-row="${id}"`)
  assert.notEqual(at, -1, `row ${id} is drawn`)
  return html.slice(at, html.indexOf('</tr>', at))
}
const ready = <T,>(data: T): ReadState<T> => ({ status: 'ready', data, error: '', refreshing: false })
const failed = <T,>(error: string): ReadState<T> => ({ status: 'failed', data: null, error, refreshing: false })

function walk(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n)
    return statSync(resolve(ROOT, p)).isDirectory() ? walk(p) : [p]
  })
}

const client = (over: Partial<RosterRow> = {}): RosterRow => ({
  client_key: 'annettekowal', client_id: 'CLI_annettekowal', name: 'Annette Kowal', status: 'active', house: 'NW4045', avatar: '',
  isp_year: '2026', ...over,
})
const C = client()
const ROSTER = [C, client({ client_key: 'kennymarsh', client_id: 'CLI_kennymarsh', name: 'Kenny Marsh' }),
  client({ client_key: 'oldclient', client_id: '', name: 'Old Client', status: 'inactive' })]
const SHARE = sharePayloadFor(C, 'profile')
const INACTIVE_OFF = { on: false, reading: false, why: '' }

const MASTER = { id: 'u-boss', name: 'Boss', email: 'boss@example.org', role: 'admin', types: [], isMaster: true }
const DIRECTOR = { id: 'u-dir', name: 'Dee Rector', email: 'dee@example.org', role: 'admin', types: ['DIRECTOR'], isMaster: false }
const signIn = (user: unknown) => useAuthStore.setState({ user } as never)

/* ---------- the app, and the rename ---------- */

describe('the app', () => {
  after(() => useAuthStore.setState({ user: null, token: null } as never))

  it('is "Clients", id client-profiles, one page "profile", for admins and managers, in the registry once', () => {
    const app = clientProfilesManifests[0]
    assert.equal(app.id, 'client-profiles')
    assert.equal(app.name, 'Clients')
    assert.equal(app.icon, 'user-round')
    assert.equal(app.category, 'Care')
    assert.deepEqual(app.pages.map((p) => p.id), ['profile'])
    assert.deepEqual([app.audience, app.focusAudience], [['admin', 'manager', 'client'], []])
    assert.equal(appManifests.filter((m) => m.id === 'client-profiles').length, 1)
  })

  it('declares the non-clinical houses slice — never clients or isps', () => {
    for (const p of clientProfilesManifests[0].pages) {
      const res = (p as { dataSource?: { resource?: string } }).dataSource?.resource
      assert.ok(!['clients', 'isps'].includes(String(res)), String(res))
      assert.equal(res, 'houses')
    }
  })

  it('renames the old app Client Care — its id, pages and audience unchanged', () => {
    const old = appManifests.find((m) => m.id === 'clients')
    assert.equal(old?.name, 'Client Care')
    assert.deepEqual(old?.audience, ['client', 'staff'])
    assert.ok(old?.pages.length && old.pages.length >= 3)
    assert.equal(appManifests.filter((m) => m.name === 'Clients').map((m) => m.id).join(), 'client-profiles')
  })

  it('no screen links the old app\'s pages under the new app\'s name', () => {
    const stale: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) { walk(path); continue }
        if (!/\.tsx$/.test(name)) continue
        const text = readFileSync(path, 'utf8')
        for (const m of text.matchAll(/to="\/app\/clients\/[^"]*"[^>]*>\s*([^<]*)</g)) {
          if (/^\s*Clients\b/.test(m[1])) stale.push(`${path.slice(ROOT.length + 1)}: ${m[1].trim()}`)
        }
      }
    }
    walk(resolve(ROOT, 'src'))
    assert.deepEqual(stale, [])
    assert.match(readFileSync(resolve(ROOT, 'src/pages/features/family/FamilyHomePage.tsx'), 'utf8'), /Client Care → Record/)
  })

  it('is mounted only through CUSTOM_PAGES, never on a static route', async () => {
    // a lazy chunk (lib/lazyPage): the entry resolves to the screen itself
    assert.equal(await CUSTOM_PAGES['client-profiles/profile'].load(), ClientProfilesPage)
    assert.ok(!readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8').includes('client-profiles'), 'no static route in App.tsx')
  })

  it('ships no App Control row: a non-master admin is refused, the master passes', () => {
    assert.equal(badgeAllowsApp('client-profiles', DIRECTOR, {}), false)
    assert.equal(badgeAllowsApp('client-profiles', { ...DIRECTOR, role: 'manager' }, { houses: ['DIRECTOR'] }), false)
    assert.equal(badgeAllowsApp('client-profiles', MASTER, {}), true)
    const hits: string[] = []
    for (const dir of ['apps-script', 'tools', 'server']) {
      for (const name of readdirSync(resolve(ROOT, dir))) {
        if (!/\.(gs|py|mjs|js|json)$/.test(name)) continue
        const text = readFileSync(join(resolve(ROOT, dir), name), 'utf8')
        if (/app_badge_access[^\n]{0,200}['"]client-profiles['"]|['"]client-profiles['"][^\n]{0,200}app_badge_access/.test(text)) hits.push(name)
      }
    }
    assert.deepEqual(hits, [])
  })

  it('a non-master is refused through CUSTOM_PAGES; nothing of the screen is drawn. The master gets the screen', async () => {
    // the screen's chunk is in before the render, so the master's render draws it rather than a fallback
    await CUSTOM_PAGES['client-profiles/profile'].load()
    useRegistryStore.setState({ apps: appManifests })
    useBadgeAccessStore.setState({ rules: {}, tenantRules: {}, configRules: {} } as never)
    useMemberStore.setState({ currentMemberId: '' } as never)
    const open = () => flat(renderToString(createElement(MemoryRouter, { initialEntries: ['/app/client-profiles/profile?client=annettekowal'] },
      createElement(Routes, null, createElement(Route, { path: '/app/:appId/:pageId', element: createElement(AppRoutePage) })))))
    signIn(DIRECTOR)
    assert.equal(isAllowedWith(appManifests, 'admin', 'client-profiles'), false)
    assert.ok(!open().includes('data-client-profiles'), 'a director sees nothing of it')
    signIn(MASTER)
    assert.equal(isAllowedWith(appManifests, 'admin', 'client-profiles'), true)
    assert.ok(open().includes('data-client-profiles'), 'the master gets the screen')
  })
})

/* ---------- no modal anywhere ---------- */

const EVERY_ASK: ClientAsk[] = [
  { kind: 'share' }, { kind: 'edit-profile' }, { kind: 'add-client' }, { kind: 'create-user', who: 'client' }, { kind: 'create-user', who: 'guardian' },
  { kind: 'tool', tool: 'users-clients' }, { kind: 'tool', tool: 'users-guardians' }, { kind: 'tool', tool: 'guardians-roster' },
  { kind: 'tool', tool: 'read-plans' }, { kind: 'add-medication' }, { kind: 'add-authorization' }, { kind: 'new-incident' },
  { kind: 'record', section: 'care', view: 'daily', id: 'r1' }, { kind: 'record', section: 'medication', view: 'meds', id: 'm1' },
  { kind: 'activity', id: 'a1' }, { kind: 'incident', id: 'i1' },
]

describe('no modal anywhere', () => {
  it('no browser dialog, no Dialog or Sheet, no modal, lightbox or viewer of its own, no framed document, no delete but a ' +
     'chart row\'s removal (emarMedDelete, named in useClientRead.ts alone), no Drive link', () => {
    for (const file of walk(FEATURE)) {
      const text = readFileSync(resolve(ROOT, file), 'utf8')
      assert.doesNotMatch(text, /window\.(confirm|alert|prompt)\(/, file)
      assert.doesNotMatch(text, /import[^;]*\b\w*(Dialog|Sheet|Modal)\b[^;]*from/, file)
      assert.doesNotMatch(text, /from '[^']*(ui\/dialog|ui\/sheet)'/, file)
      assert.doesNotMatch(text, /<OpsRecordModal|<ConfirmDialog|askConfirm|ImageLightbox|components\/shared\/FileViewer|openFile\(|fixed inset-0/, file)
      assert.doesNotMatch(text, /aria-modal|role="dialog"/, file)
      assert.doesNotMatch(text, /<iframe|createObjectURL/, `${file}: a document is never framed in a panel; the platform's viewer shows it`)
      const removal = file.endsWith('useClientRead.ts') ? text.replace("gasAction<{ removed?: string }>('emarMedDelete'", '') : text
      assert.doesNotMatch(removal, /api\.(remove|delete)\(|'delete'|Delete\b|emarMedDelete/, file)
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      assert.doesNotMatch(code, /drive\.google\.com|docs\.google\.com|\/preview|webViewLink|anyoneWithLink|target="_blank"/, file)
    }
  })

  it('every document the app shows goes through the platform viewer\'s one opener', () => {
    const openers = walk(FEATURE).filter((f) => readFileSync(resolve(ROOT, f), 'utf8').includes("from '@/lib/platformDoc'"))
    for (const f of ['useClientRead.ts', 'sources/mar.ts', 'sources/FinanceTab.tsx']) {
      assert.ok(openers.some((o) => o.endsWith(f)), f)
    }
  })

  it('every mode of the panel is the SidePanel aside, the narrow one — a document is never in it', () => {
    for (const ask of EVERY_ASK) {
      const html = draw(<ClientPanel ask={ask} client={C} clients={ROSTER} share={SHARE} onAsk={noop} onClose={noop} />)
      assert.match(html, /<aside aria-label="/, ask.kind)
      noModal(html, ask.kind)
      assert.ok(html.includes('sm:w-[384px]') && !html.includes('xl:w-['), `${ask.kind}: the standard width`)
    }
    assert.equal(draw(<ClientPanel ask={null} client={C} clients={ROSTER} share={SHARE} onAsk={noop} onClose={noop} />), '')
  })

  it('every Actions item, in every section, opens a mode the panel draws', () => {
    const tabs: [ClientTab, string][] = [['profile', ''], ['medication', 'meds'], ['billing', 'authorizations'], ['incidents', ''], ['funds', 'balances'],
      ['appointments', ''], ['transportation', 'calendar'], ['medication', 'admin'], ['medication', 'refills'], ['activity', '']]
    for (const [tab, view] of tabs) {
      for (const g of actionGroups(tab, view)) {
        for (const it of g.items) {
          const html = draw(<ClientPanel ask={it.ask} client={C} clients={ROSTER} share={SHARE} onAsk={noop} onClose={noop} />)
          assert.match(html, /<aside aria-label="/, `${tab} · ${it.label}`)
        }
      }
    }
  })

  it('Add authorization says where one is filed — the books Billing reads — and never files one itself', () => {
    const html = draw(<ClientPanel ask={{ kind: 'add-authorization' }} client={C} clients={ROSTER} share={SHARE} onAsk={noop} onClose={noop} />)
    assert.ok(html.includes('data-add-authorization=""') && html.includes('PAWS Adjustments') && html.includes('Sheet6'))
    assert.ok(!/<input|<textarea|<select/.test(html), 'no form without a door behind it')
  })

  it('the plan is a button that opens the centred viewer — no link, no frame in the panel', () => {
    const html = draw(<ClientPanel ask={{ kind: 'record', section: 'care', view: 'plans', id: 'r1' }} client={C} clients={ROSTER} share={SHARE}
      onAsk={noop} onClose={noop} />)
    assert.ok(!html.includes('<iframe') && !html.includes('href="http'))
  })

  it('share: copy the link, copy text, download, print — the client\'s address, nothing clinical', () => {
    const html = draw(<ClientPanel ask={{ kind: 'share' }} client={C} clients={ROSTER} share={SHARE} onAsk={noop} onClose={noop} />)
    assert.ok(html.includes('/app/client-profiles/profile?client=annettekowal'))
    for (const w of ['Copy', 'Copy text', 'Download', 'Print']) assert.match(html, new RegExp(`>\\s?${w}<`), w)
  })

  it('the Actions menu is a menu with the section\'s group first, and the switcher a listbox', () => {
    const profile = draw(<ActionsMenu tab="profile" view="" onPick={noop} />)
    assert.match(profile, /role="menu"/)
    assert.ok(profile.indexOf('data-group="Client Profile"') < profile.indexOf('data-group="Client management"'))
    assert.equal((profile.match(/role="menuitem"/g) ?? []).length, 7)
    const billing = draw(<ActionsMenu tab="billing" view="authorizations" onPick={noop} />)
    assert.ok(billing.includes('>Billing · Authorizations<') && billing.includes('Add authorization'))
    for (const w of ['Add client', 'Create user', 'Create user guardian', 'Users for all clients', 'Users for all guardians', 'Guardians to roster', 'Read the plans']) {
      assert.ok(billing.includes(w), w)
    }
    const meds = draw(<ActionsMenu tab="medication" view="meds" onPick={noop} />)
    assert.ok(meds.includes('>Medication · Medications<') && meds.includes('Add medication'))
    noModal(billing, 'actions')
  })
})

/* ---------- the shell and the switcher ---------- */

describe('the shell', () => {
  const screen = (over: Partial<Parameters<typeof ClientsScreen>[0]> = {}) => draw(
    <ClientsScreen roster={ready({})} onRetry={noop} clients={ROSTER} wanted="annettekowal" client={C} tab="billing" view="authorizations"
      today="2026-09-28" inactive={INACTIVE_OFF} onInactive={noop} onClient={noop} onTab={noop} onView={noop} onAsk={noop} {...over} />)

  it('draws the top card on the platform\'s own surface with the switcher, Share and Actions, the round photo card and the nine sections', () => {
    const html = screen()
    assert.match(html, /class="[^"]*border border-border bg-surface[^"]*"\s*data-top-bar=""/)
    const bar = html.slice(html.indexOf('data-top-bar'), html.indexOf('data-rail'))
    assert.ok(!html.includes('bg-detail-hero') && !/text-white|bg-white\/|border-white\//.test(bar), 'never a black band, light or dark')
    assert.ok(html.includes('data-switcher=""') && html.includes('data-share=""') && html.includes('data-actions=""'))
    assert.ok(html.includes('data-photo-card=""') && html.includes('>Annette Kowal<'))
    for (const label of ['Client Profile', 'Care & Support', 'Medication', 'Appointments', 'Transportation', 'Incidents', 'Client Funds', 'Billing', 'Activity']) {
      const t = label.replace(/&/g, '&amp;')
      assert.ok(html.includes(`> ${t}</button>`) || html.includes(`>${t}</button>`), label)
    }
    assert.ok(html.includes('aria-current="page" data-tab="billing"'))
    assert.ok(html.includes('data-section="billing"'))
    noModal(html, 'shell')
  })

  it('the six sections read from their own apps are mounted whole: Appointments, Transportation, Administration, Refills, Client Funds, Billing', () => {
    const at = (tab: ClientTab, view: string) => screen({ tab, view })
    assert.ok(at('appointments', '').includes('placeholder="Search appointments…"'))
    const trips = at('transportation', 'history')
    assert.ok(trips.includes('data-transport="history"') && trips.includes('Reading the trips…'))
    for (const t of ['Calendar', 'History', 'Vehicles']) assert.ok(trips.includes(`data-view="${t.toLowerCase()}"`), t)
    assert.ok(!trips.includes('data-view="mileage"'), 'the three tabs of the mockup')
    assert.ok(at('medication', 'admin').includes('data-mar="papers"'))
    assert.ok(at('medication', 'refills').includes('data-refills=""'))
    assert.ok(at('funds', 'receipts').includes('data-finance="funds"'))
    assert.ok(at('billing', 'claims').includes('data-finance="billing"'))
    const meds = at('medication', 'meds')
    assert.ok(meds.includes('>Medications<') && meds.includes('>Administration<') && meds.includes('>Refills<') && meds.includes('Reading the medication record…'))
  })

  it("a section's own panel rides the page's address: one panel at a time, gone with the client", () => {
    const visit = screen({ tab: 'appointments', view: '', panel: 'visit~r12' })
    assert.ok(visit.includes('aria-label="Appointment"') && visit.includes('Reading the appointments…'))
    const trip = screen({ tab: 'transportation', view: 'history', panel: 'sources' })
    assert.ok(!trip.includes('aria-label="Sources"'), 'a panel waits for its answer')
    const none = screen({ tab: 'appointments', view: '', panel: null })
    assert.ok(!none.includes('<aside aria-label="Appointment"'))
  })

  it('an address naming no client it knows says so; a failed roster says why', () => {
    const none = screen({ wanted: 'nobody', client: null })
    assert.ok(none.includes('No client nobody in the clients the platform reads.'))
    const bad = screen({ roster: failed('Unknown action.'), client: null, clients: [] })
    assert.ok(bad.includes('The clients could not be read:') && bad.includes(NOT_PUBLISHED.replace(/'/g, '&#x27;')))
  })
})

describe('the switcher', () => {
  const list = (query: string, on: boolean, why = '') =>
    draw(<SwitcherList clients={ROSTER} current="annettekowal" query={query} onQuery={noop} inactive={{ on, reading: false, why }} onInactive={noop} onPick={noop} />)

  it('the active clients with round photos and their pill, the current one checked, the search and Show Inactive', () => {
    const html = list('', false)
    assert.match(html, /role="listbox"/)
    assert.ok(html.includes('data-client="annettekowal"') && html.includes('data-client="kennymarsh"') && !html.includes('data-client="oldclient"'))
    assert.ok(html.includes('aria-selected="true" data-client="annettekowal"'))
    assert.ok(html.includes('Show Inactive') && html.includes('placeholder="Search client profiles…"'))
    assert.ok(html.includes('>AK<') && html.includes('>KM<'), 'a face before every name')
  })

  it('Show Inactive adds the archived clients, marked; the search narrows; why the archive is short is said', () => {
    const html = list('', true, 'the archive holds 22 rows')
    assert.ok(html.includes('data-client="oldclient"') && html.includes('>Inactive<') && html.includes('the archive holds 22 rows'))
    assert.ok(!list('kenny', false).includes('data-client="annettekowal"'))
    assert.ok(list('zzz', true).includes('No client matches.'))
  })
})

/* ---------- the sections ---------- */

describe('client profile', () => {
  const profile = ready(profileOf({
    client: { client_key: 'annettekowal', name: 'Annette Kowal', status: 'active', client_number: 'CL-1204', dob: '1980-03-04' },
    identity: { ssn_last4: '4544', ssn_on_file: true, medicaid_id: 'MCD-77' },
    home: { house_code: 'NW4045', house_label: 'Arlington', home_address: '908 Arlington Ave NW', house_manager: 'Marcus Reed', house_manager_phone: '5550101202' },
    guardian: { name: 'Mary Kowal', person_id: 'PPL_guardian_marykowal', relationship: 'Mother', email: 'mary@example.org' },
    services: { isp_year: '2026', isp_file_id: 'isp1xxxxxxxx' },
    financial: { tl_card_last4: '4812', dc_exp_on_file: true, dc_security_code_on_file: true, dc_pin_on_file: true },
    family: [{ name: 'Mary Kowal', relationship: 'Mother', phone: '5550100200', person_id: 'PPL_guardian_marykowal' }],
  }))

  it('the titles over the groups are the master\'s; everyone else sees the fields without them until released', () => {
    const titles = /Identity &amp; eligibility|Financial &amp; benefits/
    const view = () => draw(<ProfileView client={C} profile={profile} today="2026-09-28" onAsk={noop} onRetry={noop} />)
    try {
      signIn({ ...DIRECTOR, clientGroupTitlesHidden: true })
      const bare = view()
      assert.doesNotMatch(bare, titles)
      assert.ok(bare.includes('data-group="identity"') && bare.includes('>46<'), 'the groups and their fields stay')
      signIn({ ...DIRECTOR, clientGroupTitlesHidden: false })
      assert.match(view(), titles, 'released, everyone sees them')
      signIn({ ...MASTER, clientGroupTitlesHidden: true })
      assert.match(view(), titles, 'the master always sees them')
    } finally {
      signIn(null)
    }
  })

  it('six groups; SSN and card by their last four, the codes and PIN as dots; links to the house, the guardian and the plan', () => {
    signIn(MASTER)
    let html: string
    try {
      html = draw(<ProfileView client={C} profile={profile} today="2026-09-28" onAsk={noop} onRetry={noop} />)
    } finally {
      signIn(null)
    }
    for (const g of ['Identity &amp; eligibility', 'Home &amp; house contacts', 'Guardian &amp; SSA', 'Services, plans &amp; consents',
      'Day services &amp; transportation', 'Financial &amp; benefits']) assert.ok(html.includes(g), g)
    assert.ok(html.includes('•••-••-4544') && html.includes('•••• •••• •••• 4812'))
    assert.ok(html.includes('>••/••<') && html.includes('>•••<') && html.includes('>••••<'))
    assert.ok(html.includes('href="/app/locations/overview?house=NW4045"') && html.includes('>Arlington<'))
    assert.ok(html.includes('href="/app/people/directory?record=PPL_guardian_marykowal"'))
    assert.ok(html.includes('data-isp=""') && html.includes('href="tel:5550101202"') && html.includes('href="mailto:mary@example.org"'))
    assert.ok(html.includes('>46<'), 'the age from the birthdate')
    assert.ok(html.includes('aria-label="Edit client details"'))
    assert.ok(html.includes('data-member="Mary Kowal"') && html.includes('href="tel:5550100200"'))
    assert.ok(html.includes('>Not on file<'))
    assert.doesNotMatch(html, /\d{3}-\d{2}-\d{4}|\d{13,19}/)
  })

  it('the house manager opens the Staff profile and the SSA the SSA profile; each address is a map link; a Self guardian reads the client\'s own e-mail and 0; n/a reads Not Applicable', () => {
    const self = ready(profileOf({
      client: { client_key: 'annettekowal', name: 'Annette Kowal', status: 'active', email: 'annette@example.org' },
      home: { home_address: '908 Arlington Ave NW', house_manager: 'Marcus Reed' },
      guardian: { name: 'Self', relationship: 'n/a', email: 'n/a', phone: 'n/a', address: '12 Oak St, Canton, OH', ssa_name: 'Holly Minarik' },
      day: { workshop: 'n/a', workshop_phone: 'N/A', workshop_address: 'n/a' },
    }))
    const html = draw(<ProfileView client={C} profile={self} today="2026-09-28" onAsk={noop} onRetry={noop} />)
    assert.ok(html.includes('href="/app/staff-profiles/profile?staff=Marcus+Reed"'), 'house manager → Staff profile')
    assert.ok(html.includes('href="/app/ssa-profiles/profile?ssa=Holly+Minarik"'), 'SSA → SSA profile')
    assert.match(html, /data-address-link=""[^>]*>908 Arlington Ave NW</, 'address → map link'); assert.match(html, /data-address-link=""[^>]*>12 Oak St, Canton, OH</, 'guardian address → map link')
    assert.ok(html.includes('href="mailto:annette@example.org"') && html.includes('data-self-phone="">0<'), 'Self → the client e-mail and 0')
    assert.doesNotMatch(html, /n\/a|N\/A|mailto:n|tel:n/i)
    assert.ok((html.match(/Not Applicable/g) ?? []).length >= 4, 'n/a → Not Applicable')
    const team = careTeamHref({ name: 'Holly Minarik', relationship: 'SSA', person_id: '', source: 'Client record' })
    assert.equal(team, '/app/ssa-profiles/profile?ssa=Holly+Minarik')
    assert.equal(careTeamHref({ name: 'Marcus Reed', relationship: 'House manager', person_id: '', source: 'Client record' }),
      '/app/staff-profiles/profile?staff=Marcus+Reed')
    const home = draw(<>{recordDetails({ id: 'home_a', record: 'Home', date: '', details: 'Arlington · 908 Arlington Ave NW', status: 'Current',
      source: 'Client record', text: '', file_id: '', address: '908 Arlington Ave NW' })}</>)
    assert.ok(home.startsWith('Arlington · '), home); assert.match(home, /data-address-link=""[^>]*>908 Arlington Ave NW</)
  })

  it('a read the deployment does not carry says so instead of an empty card', () => {
    const html = draw(<ProfileView client={C} profile={failed('Unknown action.')} today="2026-09-28" onAsk={noop} onRetry={noop} />)
    assert.ok(html.includes('could not be read') && html.includes('once its Apps Script is published'))
  })
})

describe('care & support', () => {
  const daily = ready(careOf({ tab: 'daily', rows: [
    { id: 'r1', record: 'Morning routine', date: '2026-01-10', details: 'Wakes at 7, showers', status: 'Current', source: 'ISP 2026' },
  ], statuses: ['Current', 'Past plan'], absent: ['afternoon', 'overnight'] }))

  it('six tabs; Daily care, Health & behavior and Personal goals read one chapter in the page; the routines the plan lacks named', () => {
    const html = draw(<CareBody view="daily" care={daily} onView={noop} onAsk={noop} onRetry={noop} />)
    for (const t of ['Care plans', 'Care team', 'Daily care', 'Health &amp; behavior', 'Personal goals', 'Home &amp; equipment']) assert.ok(html.includes(`>${t}<`), t)
    assert.ok(html.includes('data-chapter-select=""') && !html.includes('>Subject</th>') && !html.includes('>All statuses</option>'))
    assert.ok(html.includes('>Morning routine<') && html.includes('Jan 10, 2026') && html.includes('Wakes at 7'), 'the chapter reads in the page')
    assert.ok(!html.includes('>Source<'), 'no source line on the chapter')
    assert.ok(html.includes('Not in this ISP: Afternoon routine, Overnight routine.'))
    for (const view of ['health', 'goals'] as const) {
      const other = draw(<CareBody view={view} care={ready(careOf({ tab: view, rows: [{ id: 'g1', record: 'Walk daily', date: '2026-01-10', details: 'Thirty minutes', status: 'Current' }] }))}
        onView={noop} onAsk={noop} onRetry={noop} />)
      assert.ok(other.includes('data-chapter-select=""') && other.includes('Thirty minutes') && other.includes('>Walk daily<'), view)
    }
  })

  it('Care plans and Home & equipment keep RECORD | DATE | DETAILS | STATUS | ACTION and All statuses', () => {
    for (const view of ['plans', 'home'] as const) {
      const html = draw(<CareBody view={view} care={ready(careOf({ tab: view, rows: [{ id: 'p1', record: 'ISP 2026', date: '2026-01-10', details: 'Annual plan', status: 'Current' }], statuses: ['Current'] }))}
        onView={noop} onAsk={noop} onRetry={noop} />)
      for (const h of ['Record', 'Date', 'Details', 'Status', 'Action']) assert.ok(html.includes(`>${h}</th>`), `${view}: ${h}`)
      assert.ok(html.includes('>All statuses</option>'), view)
    }
  })

  it('Settings › My Work hiding Home & equipment drops its tab for everyone else', () => {
    primeShellHides({ ...SHELL_SHOWN, client_care_home: true })
    try {
      const html = draw(<CareBody view="daily" care={daily} onView={noop} onAsk={noop} onRetry={noop} />)
      assert.ok(!html.includes('>Home &amp; equipment<') && html.includes('>Personal goals<'))
    } finally {
      primeShellHides(SHELL_SHOWN)
    }
  })

  it('care team is the people the plan names: name, relationship, phone and e-mail links, no face before the name', () => {
    const team = ready(careOf({ tab: 'team', people: [{ name: 'Mary Kowal', relationship: 'Mother', phone: '5550100200', email: 'mary@example.org', person_id: 'P1' }] }))
    const html = draw(<CareBody view="team" care={team} onView={noop} onAsk={noop} onRetry={noop} />)
    for (const h of ['Name', 'Relationship', 'Phone', 'Email']) assert.ok(html.includes(`>${h}</th>`), h)
    assert.ok(html.includes('href="tel:5550100200"') && html.includes('href="mailto:mary@example.org"'))
    assert.ok(html.includes('Mary Kowal') && !html.includes('>MK<'), 'the name alone, without the initials')
  })

  it('an empty tab says what is missing', () => {
    const html = draw(<CareBody view="goals" care={ready(careOf({ tab: 'goals', rows: [] }))} onView={noop} onAsk={noop} onRetry={noop} />)
    assert.ok(html.includes('The plan holds no personal goal.'))
  })
})

describe('medication', () => {
  it('medications in the one table from the eMAR chart; Administration and Refills are the apps that hold them', () => {
    const meds = draw(<MedicationsBody meds={ready(medsOf({ rows: [{ id: 'm1', record: 'Gabapentin 300mg', date: '2026-09-24', details: 'Twice daily', status: 'Active' }] }))}
      onAsk={noop} onRetry={noop} />)
    assert.ok(meds.includes('>Gabapentin 300mg<') && meds.includes('Sep 24, 2026') && meds.includes('data-status="Active"'))
    const empty = draw(<MedicationsBody meds={ready(medsOf({ rows: [], why: 'The eMAR list names no medication for Annette Kowal.' }))} onAsk={noop} onRetry={noop} />)
    assert.ok(empty.includes('The eMAR list names no medication for Annette Kowal.'))
    const tabs = draw(<MedicationSection client={C} view="admin" today="2026-09-28" onView={noop} onAsk={noop} panel={null} onPanel={noop} />)
    assert.ok(tabs.includes('>Medications<') && tabs.includes('>Administration<') && tabs.includes('>Refills<'))
    assert.ok(tabs.includes('aria-selected="true" data-view="admin"') && tabs.includes('data-mar="papers"'))
  })

  it('every medication is drawn behind its photo — the Medications app\'s own copy, else the pill tile; a care record is not', () => {
    const html = draw(<MedicationsBody meds={ready(medsOf({ rows: [
      { id: 'm1', record: 'Gabapentin Tab 400mg', date: '2026-09-24', details: 'Twice daily', status: 'Active' },
      { id: 'm2', record: 'Zzqx Unknownium 5mg', date: '2026-09-24', details: 'Once daily', status: 'Active' },
    ] }))} onAsk={noop} onRetry={noop} />)
    const known = rowHtml(html, 'm1')
    assert.ok(known.includes('data-med-photo="photo"') && known.includes('src="med-images/gabapentin-tab-400mg.png"'), known)
    assert.ok(known.includes('loading="lazy"') && known.includes('width:32px;height:32px'), 'a 32px thumb, never blocking the row')
    assert.ok(known.includes('>Gabapentin Tab 400mg<'))
    const unknown = rowHtml(html, 'm2')
    assert.ok(unknown.includes('data-med-photo="pill"') && unknown.includes('lucide-pill') && !unknown.includes('<img'), unknown)
    assert.ok(unknown.includes('>Zzqx Unknownium 5mg<'))
    const care = draw(<CareBody view="daily" care={ready(careOf({ tab: 'daily', rows: [{ id: 'r1', record: 'Morning routine', details: 'Wakes at 7' }] }))}
      onView={noop} onAsk={noop} onRetry={noop} />)
    assert.ok(care.includes('>Morning routine<') && !care.includes('data-med-photo'))
  })
})

describe('incidents', () => {
  const rows = ready(clientIncidentsOf({ rows: [
    { incident_ts: '2026-09-20T10:00:00Z', your_name: 'Bo Diaz', client_name: 'Annette Kowal', client_key: 'annettekowal', incident_category: 'Fall',
      incident_location: 'Arlington', house_code: 'NW4045', incident_date: '2026-09-20', incident_time: '14:05', incident_reported_date: '2026-09-20',
      incident_reported_time: '15:00', employees_involved: ['Ann Lee'], summary_of_incident: 'Slipped in the hall', status: 'Under review' },
  ] }))

  it('laid out as Locations lays its incidents: New Incident in the card header, five columns and no pencil; the date opens the rest', () => {
    const html = draw(<IncidentsBody client={C} incidents={rows} onAsk={noop} onRetry={noop} />)
    for (const h of ['Date', 'Time', 'Incident category', 'Incident summary', 'Employees involved']) {
      assert.ok(html.includes(`>${h}</th>`), h)
    }
    assert.ok(!html.includes('>Edit</th>') && !html.includes('Open the incident'), 'a row opens the report; no pencil column')
    assert.ok(html.includes('>Incidents</') && html.includes('New Incident'), 'the card\'s title and its button')
    for (const h of ['Your name', 'Client name', 'Incident location']) assert.ok(!html.includes(`>${h}</th>`), h)
    assert.ok(html.includes('data-filter="category"') && html.includes('>All statuses</option>') && html.includes('>Under review</option>')
      && html.includes('data-new-incident=""'))
    assert.ok(html.includes('Sep 20, 2026') && html.includes('aria-expanded="false" data-expand="2026-09-20T10:00:00Z"'))
  })

  it('the report opens in the panel with its Status select — no delete', () => {
    const html = draw(<ClientPanel ask={{ kind: 'incident', id: '2026-09-20T10:00:00Z' }} client={C} clients={ROSTER} share={SHARE} onAsk={noop} onClose={noop} />)
    assert.ok(!/Delete|Remove/.test(html))
  })
})

describe('activity', () => {
  it('the timeline in the one table, newest first, with the type as its pill', () => {
    const html = draw(<ActivityBody activity={ready(activityOf({ rows: [
      { id: 'a1', date: '2026-09-01', kind: 'daily_note', record: 'Daily note', details: 'Went to the park', by: 'Noah Reed' },
      { id: 'a2', date: '2026-09-20', kind: 'incident', record: 'Fall', details: 'Slipped in the hall' },
    ] }))} onAsk={noop} onRetry={noop} />)
    for (const h of ['Record', 'Date', 'Details', 'Type', 'Action']) assert.ok(html.includes(`>${h}</th>`), h)
    assert.ok(html.indexOf('data-row="a2"') < html.indexOf('data-row="a1"'))
    assert.ok(html.includes('data-status="Daily note"') && html.includes('data-status="Incident"') && html.includes('>All types</option>'))
  })
})

/* ---------- the doors ---------- */

describe('the Apps Script doors', () => {
  const realFetch = globalThis.fetch
  let calls: { action: string; payload: Record<string, unknown> }[] = []
  let answer: (action: string) => unknown = () => ({})
  before(() => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      let env: { action?: string; payload: Record<string, unknown> } = { payload: {} }
      try { env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) } catch { /* not an action envelope */ }
      // a write's slice refresh is not a door call
      if (!env.action) return new Response(JSON.stringify({ status: 200, data: {} }))
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
    forgetClientReads()
  })

  it('each section this app owns reads its own action by name, with the client and its tab', async () => {
    await readRoster(false)
    await readRoster(true)
    await readDetails('annettekowal')
    await readCare('annettekowal', 'daily')
    await readMeds('annettekowal')
    await readIncidents('annettekowal')
    await readActivity('annettekowal')
    assert.deepEqual(calls.map((c) => [c.action, c.payload]), [
      ['clientProfileRoster', {}],
      ['clientProfileRoster', { show_inactive: true }],
      ['clientProfileDetails', { client: 'annettekowal' }],
      ['clientProfileCare', { client: 'annettekowal', tab: 'daily' }],
      ['clientProfileMeds', { client: 'annettekowal', tab: 'meds' }],
      ['clientProfileIncidents', { client: 'annettekowal' }],
      ['clientProfileActivity', { client: 'annettekowal' }],
    ])
  })

  it('a plan opens in the platform\'s centred viewer from its bytes, as a blob URL let go when the viewer closes', async () => {
    const revoked: string[] = []
    const realRevoke = URL.revokeObjectURL
    URL.revokeObjectURL = (u: string) => { revoked.push(u); realRevoke.call(URL, u) }
    try {
      answer = (action) => action === 'clientProfileDocFile' ? { name: 'ISP 2026', mime: 'application/pdf', b64: 'JVBERg==', exported: true } : {}
      const h = mountHook(() => useClientDocs(), {})
      h.run(() => h.current.open('annettekowal', 'isp1xxxxxxxx', 'ISP 2026'))
      await h.settle(() => !!useFileViewerStore.getState().file && h.current.opening === '')
      assert.deepEqual(calls.map((c) => [c.action, c.payload]), [['clientProfileDocFile', { client: 'annettekowal', file_id: 'isp1xxxxxxxx' }]])
      const shown = useFileViewerStore.getState().file
      assert.equal(shown?.title, 'ISP 2026')
      assert.match(shown?.url ?? '', /^blob:/)
      useFileViewerStore.getState().closeFile()
      assert.deepEqual(revoked, [shown?.url])
      h.unmount()
    } finally {
      URL.revokeObjectURL = realRevoke
      useFileViewerStore.getState().closeFile()
    }
  })

  it('the writes carry the plan\'s parameters, and Client management the Client Care app\'s own', async () => {
    await editProfile('annettekowal', [{ field: 'spending_limit', value: '$60', expected: '$50' }])
    await editMedication('annettekowal', '7', [{ field: 'dose', value: '10 mg', expected: '5 mg' }])
    await removeMedication('annettekowal', '8')
    await setIncidentStatus({ client: 'annettekowal', incident_ts: '2026-09-20T10:00:00Z', client_name: 'Annette Kowal', status: 'Closed' })
    await saveAppointment({ client: 'annettekowal', id: 'd1', witness: 'Annette Kowal', fields: { time: '11:00' } })
    await createClient({ name: 'New Person', clientNumber: 'CL-9', houseName: 'Arlington', guardianName: '' })
    answer = (action) => (action === 'clientUserCreate' ? { login: 'a@example.org' } : { created: 0, already: 0, skipped: 0 })
    await createClientUser('CLI_annettekowal', 'guardian')
    await usersFromClients()
    await usersFromGuardians()
    await guardiansToRoster()
    await readThePlans()
    await addMedication({ client: 'Annette Kowal', name: 'Gabapentin', dose: '300mg', times: '0800', route: 'Tablet', prn: 'false' })
    assert.deepEqual(calls.map((c) => [c.action, c.payload]), [
      ['clientProfileSave', { client: 'annettekowal', changes: [{ field: 'spending_limit', value: '$60', expected: '$50' }] }],
      ['emarMedUpdate', { client: 'annettekowal', id: '7', changes: [{ field: 'dose', value: '10 mg', expected: '5 mg' }] }],
      ['emarMedDelete', { client: 'annettekowal', id: '8' }],
      ['clientProfileIncidentStatus', { client: 'annettekowal', incident_ts: '2026-09-20T10:00:00Z', client_name: 'Annette Kowal', status: 'Closed' }],
      ['clientProfileApptSave', { client: 'annettekowal', id: 'd1', witness: 'Annette Kowal', fields: { time: '11:00' } }],
      ['clientCreate', { name: 'New Person', clientNumber: 'CL-9', houseName: 'Arlington', guardianName: '', status: 'active' }],
      ['clientUserCreate', { client_id: 'CLI_annettekowal', kind: 'guardian' }],
      ['usersFromClients', {}],
      ['usersFromGuardians', {}],
      ['guardiansToRoster', {}],
      ['ispContactsSweep', { redo: true }],
      ['emarMedAdd', { client: 'Annette Kowal', name: 'Gabapentin', dose: '300mg', times: '0800', route: 'Tablet', prn: 'false' }],
    ])
  })

  it('a read is held for the section and its panel; a write for the client reads it again', async () => {
    answer = () => ({ rows: [{ id: 'i1', incident_date: '2026-10-02' }] })
    const key = readKey('clientProfileIncidents', 'annettekowal')
    const a = mountHook(() => useClientRead(key, () => readIncidents('annettekowal'), (raw) => raw), {})
    await a.settle(() => a.current.status === 'ready')
    const b = mountHook(() => useClientRead(key, () => readIncidents('annettekowal'), (raw) => raw), {})
    await b.settle(() => b.current.status === 'ready')
    assert.equal(calls.length, 1, `the panel drew the held answer ${JSON.stringify(calls)}`)
    answer = () => ({ rows: [] })
    a.run(() => clientWritten('annettekowal'))
    await a.settle(() => JSON.stringify(a.current.data) === '{"rows":[]}' && JSON.stringify(b.current.data) === '{"rows":[]}')
    assert.equal(calls.length, 2, 'both re-read through one request')
    a.unmount()
    b.unmount()
  })

  it('a medication\'s panel opens under its photo, fetched at once; a care record\'s panel has none', async () => {
    answer = (action) => action === 'clientProfileMeds'
      ? { tab: 'meds', rows: [{ id: 'm1', record: 'Gabapentin Tab 400mg', date: '2026-09-24', details: 'Twice daily', status: 'Active',
          edit: { name: 'Gabapentin Tab 400mg', dose: '400mg', times: '08:00', route: 'Tablet', freq: 'Daily', discontinued: '' } }] }
      : action === 'clientProfileCare' ? { tab: 'daily', rows: [{ id: 'r1', record: 'Morning routine', details: 'Wakes at 7' }] } : {}
    const meds = mountHook(() => useClientRead(readKey('clientProfileMeds', 'annettekowal', 'meds'), () => readMeds('annettekowal'), medsOf), {})
    const care = mountHook(() => useClientRead(readKey('clientProfileCare', 'annettekowal', 'daily'), () => readCare('annettekowal', 'daily'), careOf), {})
    await meds.settle(() => meds.current.status === 'ready' && care.current.status === 'ready')
    const html = draw(<ClientPanel ask={{ kind: 'record', section: 'medication', view: 'meds', id: 'm1' }} client={C} clients={ROSTER} share={SHARE}
      onAsk={noop} onClose={noop} />)
    assert.ok(html.includes('data-record-panel="m1"') && html.includes('data-med-photo="photo"'), html)
    assert.ok(html.includes('src="med-images/gabapentin-tab-400mg.png"') && html.includes('loading="eager"') && html.includes('width:56px;height:56px'))
    assert.ok(html.includes('>Gabapentin Tab 400mg<') && html.includes('data-status="Active"'))
    assert.ok(html.includes('data-med-actions="m1"') && html.includes('data-med-edit=""') && html.includes('Remove from the chart'),
      'the master edits and removes a chart row from its panel')
    const plan = draw(<ClientPanel ask={{ kind: 'record', section: 'care', view: 'daily', id: 'r1' }} client={C} clients={ROSTER} share={SHARE}
      onAsk={noop} onClose={noop} />)
    assert.ok(plan.includes('data-record-panel="r1"') && !plan.includes('data-med-photo') && !plan.includes('data-med-actions'))
    meds.unmount()
    care.unmount()
  })

  it('a write for one client leaves another client\'s answers alone; a new client re-reads the roster', async () => {
    answer = () => ({ clients: [] })
    const roster = mountHook(() => useClientRead(readKey('clientProfileRoster', '*', false), () => readRoster(false), (raw) => raw), {})
    await roster.settle(() => roster.current.status === 'ready')
    const before = calls.length
    roster.run(() => clientWritten('*'))
    await roster.settle(() => calls.length === before + 1)
    roster.unmount()
  })

  it('a refusal keeps its sentence, and the screen says the deployment does not carry Clients', async () => {
    answer = () => new Error('Unknown action.')
    const h = mountHook(() => useClientRead(readKey('clientProfileIncidents', 'annettekowal'), () => readIncidents('annettekowal'), (raw) => raw), {})
    await h.settle(() => h.current.status === 'failed')
    assert.equal(h.current.error, 'Unknown action.')
    h.unmount()
    const html = draw(<IncidentsBody client={C} incidents={failed('Unknown action.')} onAsk={noop} onRetry={noop} />)
    assert.ok(html.includes('once its Apps Script is published'))
  })
})
