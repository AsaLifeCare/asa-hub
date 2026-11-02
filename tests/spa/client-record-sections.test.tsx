/**
 * Clients › Record: the sections it shows beside its own six — Finances (Client Finances merged in), Sleep,
 * Hydration, Workout and Meals. The same five the Unique view shows, from the same declaration, behind the
 * same apps' doors, drawn by the same component against the same reads.
 *
 * What is held here: the order and the doors (asked of the effective person, narrowed by a visit); a section
 * the viewer's doors refuse is absent rather than empty, and a chosen one that disappears falls back to the
 * record's first tab; the section draws this client's rows and nobody else's; an unreadable lane says it
 * could not be read rather than reading as "nothing on file"; and NEITHER VIEW keeps a copy of the sections
 * — both mount ClientSections, which is what stops the two readings of one chart from drifting.
 *
 * The hooks run under real React (react-host) with every read answered at `fetch` with the door's own
 * envelope; the sections are drawn by react-dom/server.
 */
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { useAuthStore } from '@/auth/useAuthStore'
import { useBadgeAccessStore } from '@/lib/badgeAccess'
import { useMemberStore } from '@/stores/useMemberStore'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { wellbeingSuiteManifests } from '@/registry/apps-wellbeing'
import { financeManifests } from '@/registry/apps-finance'
import type { HydrationProfile, SleepProfile } from '@/lib/seed-wellbeing'
import type { AppManifest } from '@/engine/types'
import type { ClientRow } from '@/pages/features/clients/shared'
import { FIRST_RECORD_TAB, RECORD_TABS, recordTabs } from '@/pages/features/clients/recordTabs'
import ClientSections from '@/pages/features/clients/unique/ClientSections'
import ClientWellbeingTab from '@/pages/features/clients/unique/WellbeingTabs'
import {
  HydrationTabView, SleepTabView, WorkoutTabView,
} from '@/pages/features/clients/unique/WellbeingTabs'
import { ClientFinances, FinancesTab } from '@/pages/features/clients/unique/FinancesTab'
import { useClientSections } from '@/pages/features/clients/unique/useRecordTabs'
import { useClientWellbeing } from '@/pages/features/clients/unique/useClientWellbeing'
import {
  CENTER_TABS, SHARED_SECTIONS, SHARED_SECTION_IDS, currentIn, isSharedSection, wellbeingEmpty, wellbeingError,
} from '@/pages/features/clients/unique/uniqueTabs'
import type { WorkoutRow } from '@/pages/features/wellbeing/WorkoutPage'
import { mountHook } from './react-host'

const root = process.env.SPA_ROOT ?? process.cwd()
const source = (file: string) => readFileSync(resolve(root, 'src/pages/features/clients', file), 'utf8')
/** a sentence as react-dom/server writes it */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;')

/** Drawn by react-dom/server, with the markers it puts between adjacent text nodes taken out. */
function draw(node: Parameters<typeof renderToString>[0]): string {
  const g = globalThis as unknown as Record<string, unknown>
  const held = { add: g.addEventListener, remove: g.removeEventListener }
  g.addEventListener = held.add ?? (() => {})
  g.removeEventListener = held.remove ?? (() => {})
  try {
    return renderToString(node).replace(/<!-- -->/g, '')
  } finally {
    g.addEventListener = held.add
    g.removeEventListener = held.remove
  }
}

/* ---------- who is looking ------------------------------------------------ */

const APPS = [...wellbeingSuiteManifests, ...financeManifests] as AppManifest[]
const EVERYONE = ['ADMIN', 'MANAGER', 'STAFF', 'CLIENT']
const OPEN = { sleep: EVERYONE, hydration: EVERYONE, workout: EVERYONE, 'ideal-meals': EVERYONE }
const signIn = (role: string) =>
  useAuthStore.setState({ user: { id: 'u1', name: 'Ann Roe', email: '', types: [], role } } as never)
const visit = (role: string) =>
  useMemberStore.setState({ currentMemberId: 'm2', memberName: 'Mo Lee', memberRole: role, memberTypes: [] })
const leave = () => useMemberStore.setState({ currentMemberId: '', memberName: '', memberRole: '', memberTypes: [] })

const heldApps = useRegistryStore.getState().apps
function resetWho() {
  useAuthStore.setState({ user: null } as never)
  useBadgeAccessStore.setState({ rules: {}, tenantRules: {} })
  leave()
}

/* ---------- the doors, answered at fetch ---------------------------------- */

type Sent = { resource?: string; action?: string; payload?: Record<string, unknown> }
type Answer = (sent: Sent) => unknown | Promise<unknown>
let answer: Answer = () => ({ status: 404, message: 'nothing here' })
const realFetch = globalThis.fetch
before(() => {
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method !== 'POST') return new Response('', { status: 404 })
    const sent = JSON.parse(decodeURIComponent(String(init.body).slice('body='.length))) as Sent
    const envelope = await answer(sent)
    return new Response(JSON.stringify(envelope), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  useRegistryStore.setState({ apps: APPS })
})
after(() => {
  globalThis.fetch = realFetch
  useRegistryStore.setState({ apps: heldApps })
  resetWho()
})
afterEach(() => {
  resetWho()
  answer = () => ({ status: 404, message: 'nothing here' })
})

/* ---------- one client, and somebody else -------------------------------- */

const JO: ClientRow = {
  id: 'CLI_JD1', name: 'Jo Doe', client_key: 'JD1', funding_source: 'Medicaid IO Waiver', dodd_id: 'D-7781',
}

const sleep = (key: string, name: string, notes: string): SleepProfile => ({
  id: `slp-${key}`, clientId: `CLI_${key}`, client_key: key, clientName: name,
  targetHours: 8, avgHours: 7.4, quality: 71, bedtime: '21:30', wakeTime: '06:30', notes, trend: 'flat',
})
const SLEEP_ROWS: SleepProfile[] = [
  sleep('JD1', 'Jo Doe', 'Jo winds down with music.'),
  sleep('AR2', 'Al Roe', 'Al needs a night light.'),
]

const RECORD_OWN = RECORD_TABS.map((t) => t.id)

const sectionsFor = () => {
  const h = mountHook(() => useClientSections(), undefined)
  const out = { ids: h.current.sections.map((s) => s.id), finance: h.current.financeAllowed }
  h.unmount()
  return out
}

/* ------------------------------------------------------------------ */

describe('one declaration for both views', () => {
  it('the five sections are the Unique view\'s own tabs — same ids, labels and apps', () => {
    assert.deepEqual([...SHARED_SECTION_IDS], ['finances', 'sleep', 'hydration', 'workout', 'meals'])
    assert.deepEqual(SHARED_SECTIONS, CENTER_TABS.slice(5), 'the sections ARE the center tabs from Finances on')
    assert.deepEqual(SHARED_SECTIONS.map((s) => [s.label, s.app]), [
      ['Finances', undefined], ['Sleep', 'sleep'], ['Hydration', 'hydration'], ['Workout', 'workout'], ['Meals', 'ideal-meals'],
    ])
    for (const id of ['summary', 'care', 'medical', 'appointments', 'incidents', 'demographics', 'nonsense']) {
      assert.equal(isSharedSection(id), false, `${id} is the view's own tab, not a shared section`)
    }
  })

  it('neither view keeps a copy: both mount ClientSections, and neither draws a section itself', () => {
    for (const file of ['ClientRecordPage.tsx', 'ClientUniquePage.tsx']) {
      const code = source(file)
      assert.match(code, /<ClientSections\b/, `${file} mounts the shared component`)
      assert.ok(!/from '\.\/unique\/WellbeingTabs'/.test(code), `${file} does not draw a wellbeing section itself`)
      assert.ok(!/from '\.\/unique\/FinancesTab'/.test(code), `${file} does not draw the Finances section itself`)
    }
  })
})

describe('the record\'s tabs: its own six, then what this viewer\'s apps admit', () => {
  it('a member of staff the four apps admit gets all five after the six', () => {
    signIn('staff')
    useBadgeAccessStore.setState({ rules: { ...OPEN, finance: ['ADMIN', 'MANAGER'] } })
    const { ids, finance } = sectionsFor()
    assert.deepEqual(ids, [...SHARED_SECTION_IDS])
    assert.deepEqual(recordTabs(SHARED_SECTIONS).map((t) => t.id), [...RECORD_OWN, ...SHARED_SECTION_IDS])
    assert.deepEqual(
      recordTabs(SHARED_SECTIONS).slice(RECORD_TABS.length).map((t) => t.label),
      ['Finances', 'Sleep', 'Hydration', 'Workout', 'Meals'],
      'the sections are named on the record as they are named on Unique',
    )
    assert.equal(FIRST_RECORD_TAB, 'demographics', 'a record still opens on its own first tab')
    assert.equal(finance, false, 'Finance.gs answers admin and manager only')
  })

  it('an app the badge matrix refuses loses its section; the others keep their order', () => {
    signIn('staff')
    useBadgeAccessStore.setState({ rules: { ...OPEN, sleep: ['ADMIN'], 'ideal-meals': ['ADMIN'] } })
    assert.deepEqual(sectionsFor().ids, ['finances', 'hydration', 'workout'])
  })

  it('an app with no row is the master\'s: nobody else is offered its section', () => {
    signIn('staff')
    assert.deepEqual(sectionsFor().ids, ['finances'])
  })

  it('a manager the finance app admits gets Client Finances inside Finances', () => {
    signIn('manager')
    useBadgeAccessStore.setState({ rules: { finance: ['ADMIN', 'MANAGER'] } })
    assert.equal(sectionsFor().finance, true)
  })

  it('a visit narrows the sections to the visited person, whatever the session could open', () => {
    signIn('admin')
    useBadgeAccessStore.setState({ rules: { sleep: ['ADMIN'], hydration: EVERYONE, finance: ['ADMIN', 'MANAGER'] } })
    assert.deepEqual(sectionsFor().ids, ['finances', 'sleep', 'hydration'])
    visit('staff')
    const { ids, finance } = sectionsFor()
    assert.deepEqual(ids, ['finances', 'hydration'], 'the visited staff member is not given Sleep')
    assert.equal(finance, false, 'nor the ledger the admin could read')
  })

  it('a chosen section hidden under the viewer falls back to the record\'s first tab', () => {
    signIn('staff')
    useBadgeAccessStore.setState({ rules: { ...OPEN, workout: ['ADMIN'] } })
    const ids = recordTabs(sectionsFor().ids.map((id) => ({ id, label: id }))).map((t) => t.id)
    assert.equal(currentIn(ids, 'workout', 'demographics'), 'demographics')
    assert.equal(currentIn(ids, 'meals', 'demographics'), 'meals')
    assert.equal(currentIn(ids, 'incidents', 'demographics'), 'incidents')
    assert.equal(currentIn(ids, 'nonsense', 'demographics'), 'demographics')
  })
})

describe('the section drawn on the record is the one the Unique view draws', () => {
  it('each wellbeing section mounts its app\'s own tab, drawn identically', () => {
    for (const tab of ['sleep', 'hydration', 'workout', 'meals'] as const) {
      assert.equal(
        draw(<ClientSections current={tab} client={JO} financeAllowed={false} />),
        draw(<ClientWellbeingTab tab={tab} client={JO} />),
        `${tab} is the wellbeing app's own tab, not a second drawing of it`,
      )
    }
  })

  it('Finances is the same tab, with Client Finances merged in for a viewer that app admits', () => {
    // the holder is the div that keeps the tab mounted once opened; inside it, the Unique view's own tab
    assert.equal(
      draw(<ClientSections current="finances" client={JO} financeAllowed={false} />),
      draw(<div><FinancesTab client={JO} finance={null} /></div>),
    )
    assert.equal(
      draw(<ClientSections current="finances" client={JO} financeAllowed />),
      draw(<div><FinancesTab client={JO} finance={<ClientFinances client={JO} />} /></div>),
    )
    const open = draw(<ClientSections current="finances" client={JO} financeAllowed />)
    assert.ok(open.includes('Medicaid IO Waiver') && open.includes('D-7781'), 'the row\'s funding facts')
    assert.ok(open.includes('Client Finances') && open.includes('Reading Client Finances…'))
    const shut = draw(<ClientSections current="finances" client={JO} financeAllowed={false} />)
    assert.ok(shut.includes('Medicaid IO Waiver') && !shut.includes('Client Finances'))
  })

  it('a tab of the record\'s own draws no section, so nothing of another app is read', () => {
    for (const own of RECORD_OWN) {
      assert.equal(draw(<ClientSections current={own} client={JO} financeAllowed />), '', own)
    }
  })
})

describe('the rows the record\'s section draws are this client\'s, and a failed read says so', () => {
  beforeEach(() => {
    answer = (sent) => sent.resource === 'hydrationProfiles'
      ? { status: 403, message: 'Hydration is not open to you.' }
      : { status: 200, data: sent.resource === 'sleepProfiles' ? SLEEP_ROWS : [] }
  })

  it('Sleep: this client\'s row out of every client the app serves, and nobody else\'s', async () => {
    const h = mountHook(({ c }: { c: ClientRow }) => useClientWellbeing<SleepProfile>('sleep', c), { c: JO })
    await h.settle(() => !h.current.loading)
    const read = h.current
    h.unmount()
    assert.equal(read.error, '')
    assert.deepEqual(read.rows.map((r) => r.id), ['slp-JD1'])
    const html = draw(<SleepTabView client={JO} read={read} />)
    assert.ok(html.includes('Jo winds down with music.'))
    assert.ok(!html.includes('Al needs a night light.'), 'nobody else\'s row')
  })

  it('a lane that could not be read says so — never as "nothing on file"', async () => {
    const h = mountHook(({ c }: { c: ClientRow }) => useClientWellbeing<HydrationProfile>('hydration', c), { c: JO })
    await h.settle(() => !h.current.loading)
    const read = h.current
    h.unmount()
    assert.match(read.error, /Hydration is not open to you/)
    const html = draw(<HydrationTabView client={JO} read={read} />)
    assert.ok(html.includes(esc(wellbeingError('hydration', read.error))))
    assert.ok(!html.includes('No hydration profile'), 'a refusal is not an empty file')
  })

  it('a client with no row in a lane reads as nothing on file — no empty box, no zero', async () => {
    const h = mountHook(({ c }: { c: ClientRow }) => useClientWellbeing<WorkoutRow>('workout', c), { c: JO })
    await h.settle(() => !h.current.loading)
    const read = h.current
    h.unmount()
    assert.deepEqual(read.rows, [])
    const html = draw(<WorkoutTabView client={JO} read={read} canGenerate={false} generating={false} onGenerate={() => {}} />)
    assert.ok(html.includes(esc(wellbeingEmpty('workout', 'Jo Doe'))))
    assert.ok(!html.includes('0 ready'), 'no counter standing in for a measurement')
    assert.ok(!html.includes('could not be read'), 'and it is not reported as a failure either')
  })
})
