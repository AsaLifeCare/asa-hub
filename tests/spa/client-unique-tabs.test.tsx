/**
 * Clients › Unique: the tabs the client apps became (Sleep, Hydration, Workout, Meals after Finances) and
 * Client Finances merged INTO Finances. The order and the door (the one checker, asked of the effective
 * person), the join to this client alone, the read that fails said as a failure, each tab drawn from its app's
 * own pieces, the Finances tab with no figure twice and no pooled ledger, and actions that name this client and
 * nobody else.
 *
 * The hooks run under real React (react-host) with every read answered at `fetch` with the door's own
 * envelope; the views are drawn whole by react-dom/server from what those hooks return.
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
import { useToastStore } from '@/stores/useToastStore'
import { wellbeingSuiteManifests } from '@/registry/apps-wellbeing'
import { financeManifests } from '@/registry/apps-finance'
import { sleepProfiles as SEED_SLEEP } from '@/lib/seed-wellbeing'
import type { HydrationProfile, SleepProfile } from '@/lib/seed-wellbeing'
import type { AppManifest } from '@/engine/types'
import type { ClientRow } from '@/pages/features/clients/shared'
import {
  CENTER_TABS, FINANCE_APP, WELLBEING_RESOURCE, financeClientName, financeNameShared, mayGenerate,
  revealTab, rowsForClient, showsGenerate, singleClientPick, sortMeals, stripEdges, wellbeingEmpty,
  wellbeingError, wellbeingSource,
} from '@/pages/features/clients/unique/uniqueTabs'
import { useRecordTabs } from '@/pages/features/clients/unique/useRecordTabs'
import { useClientWellbeing } from '@/pages/features/clients/unique/useClientWellbeing'
import { useClientImages } from '@/pages/features/clients/unique/useClientImages'
import { useFinClients, type FinRead } from '@/pages/features/clients/unique/useFinClients'
import {
  HydrationTabView, MealsTabView, SleepTabView, WorkoutTabView,
} from '@/pages/features/clients/unique/WellbeingTabs'
import { ClientFinancesView, FinancesTab } from '@/pages/features/clients/unique/FinancesTab'
import { TabStripView } from '@/pages/features/clients/unique/TabStrip'
import FinanceLedger, { LedgerView } from '@/pages/features/finance/FinanceLedger'
import { useLedger, useMayCloseMonth, type Ledger } from '@/pages/features/finance/useLedger'
import NewTransactionModal from '@/pages/features/finance/NewTransactionModal'
import type { WorkoutRow } from '@/pages/features/wellbeing/WorkoutPage'
import type { MealRow } from '@/pages/features/wellbeing/MealsPage'
import { mountHook } from './react-host'

const root = process.env.SPA_ROOT ?? process.cwd()
const count = (hay: string, needle: string) => hay.split(needle).length - 1
/** the Generate missing BUTTON — the phrase alone also stands in the tab's source line */
const GENERATE = 'Generate missing</button>'
/** a sentence as react-dom/server writes it */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;')
const noop = () => {}

/**
 * Drawn by react-dom/server, with the markers it puts between adjacent text nodes taken out so a sentence
 * reads as one. The server render reads every store at its INITIAL state, so who is looking is asked of the
 * hooks under real React, never of a drawn screen.
 */
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
const signIn = (role: string, extra: Record<string, unknown> = {}) =>
  useAuthStore.setState({ user: { id: 'u1', name: 'Ann Roe', email: '', types: [], role, ...extra } } as never)
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
    // the snapshot index is not there: every read goes to the live door
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

/** This client's record — a typed clients-tab row may carry its own id, so the key is what joins. */
const JO: Pick<ClientRow, 'id' | 'name' | 'client_key'> = { id: 'CLI_JD1', name: 'Jo Doe', client_key: 'JD1' }
const TYPED: Pick<ClientRow, 'id' | 'name' | 'client_key'> = { id: 'typed-7', name: 'Al Roe', client_key: 'AR2' }

const sleep = (key: string, name: string, notes: string): SleepProfile => ({
  id: `slp-${key}`, clientId: `CLI_${key}`, client_key: key, clientName: name,
  targetHours: 8, avgHours: 7.4, quality: 71, bedtime: '21:30', wakeTime: '06:30', notes, trend: 'flat',
})
const SLEEP_ROWS: SleepProfile[] = [
  sleep('JD1', 'Jo Doe', 'Jo winds down with music.'),
  sleep('AR2', 'Al Roe', 'Al needs a night light.'),
  // the same name under another key is somebody else
  sleep('JD9', 'Jo Doe', 'The other Jo reads before bed.'),
]

const workout = (key: string, status: 'ready' | 'pending'): WorkoutRow => ({
  id: `wo-${key}`, clientId: `CLI_${key}`, client_key: key, clientName: 'Jo Doe', activity: 'Gentle Walking',
  image: '', description: 'Walker at all times.', durationMin: 20, intensity: 'gentle', status,
})

/* ------------------------------------------------------------------ */

describe('the tabs: after Finances, in order, behind each app\'s own door, for the effective person', () => {
  const EVERYONE = ['ADMIN', 'MANAGER', 'STAFF', 'CLIENT']
  const OPEN = { sleep: EVERYONE, hydration: EVERYONE, workout: EVERYONE, 'ideal-meals': EVERYONE }
  const tabsFor = (chosen = 'summary') => {
    const h = mountHook(({ c }: { c: string }) => useRecordTabs(c), { c: chosen })
    const out = { ids: h.current.tabs.map((t) => t.id), current: h.current.current, finance: h.current.financeAllowed }
    h.unmount()
    return out
  }

  it('the four follow Finances, in the order drawn, each tagged with the app it belongs to', () => {
    assert.deepEqual(CENTER_TABS.map((t) => t.id), [
      'summary', 'care', 'medical', 'appointments', 'incidents', 'finances', 'sleep', 'hydration', 'workout', 'meals',
    ])
    assert.deepEqual(CENTER_TABS.slice(6).map((t) => [t.label, t.app]), [
      ['Sleep', 'sleep'], ['Hydration', 'hydration'], ['Workout', 'workout'], ['Meals', 'ideal-meals'],
    ])
    for (const t of CENTER_TABS.slice(6)) assert.ok(APPS.some((a) => a.id === t.app), `${t.app} is a registered app`)
  })

  it('Client Finances is not a tab of its own — it answers to the finance app inside Finances', () => {
    assert.equal(FINANCE_APP, 'finance')
    assert.ok(!CENTER_TABS.some((t) => t.app === FINANCE_APP || /client finances/i.test(t.label)))
    assert.equal(CENTER_TABS.filter((t) => t.id === 'finances').length, 1)
  })

  it('a member of staff the four apps admit sees all four after Finances, and no ledger', () => {
    signIn('staff')
    useBadgeAccessStore.setState({ rules: { ...OPEN, finance: ['ADMIN', 'MANAGER', 'STAFF'] } })
    const t = tabsFor()
    assert.deepEqual(t.ids.slice(5), ['finances', 'sleep', 'hydration', 'workout', 'meals'])
    assert.equal(t.finance, false, 'the matrix lets staff open the app, but Finance.gs answers admin and manager only')
  })

  it('an app the badge matrix refuses loses its tab; the others keep their order', () => {
    signIn('staff')
    useBadgeAccessStore.setState({ rules: { ...OPEN, sleep: ['ADMIN'], 'ideal-meals': ['ADMIN'] } })
    assert.deepEqual(tabsFor().ids.slice(5), ['finances', 'hydration', 'workout'])
  })

  it('an app with no row is the master\'s: nobody else is offered its tab', () => {
    signIn('staff')
    assert.deepEqual(tabsFor().ids, ['summary', 'care', 'medical', 'appointments', 'incidents', 'finances'])
  })

  it('a manager the finance app admits gets Client Finances inside Finances', () => {
    signIn('manager')
    useBadgeAccessStore.setState({ rules: { finance: ['ADMIN', 'MANAGER'] } })
    assert.equal(tabsFor().finance, true)
  })

  it('a client sees the wellbeing tabs the matrix gives them, and never the ledger', () => {
    signIn('client')
    useBadgeAccessStore.setState({ rules: { ...OPEN, finance: ['ADMIN', 'MANAGER'] } })
    const t = tabsFor()
    assert.deepEqual(t.ids.slice(5), ['finances', 'sleep', 'hydration', 'workout', 'meals'])
    assert.equal(t.finance, false)
  })

  it('a visit narrows the tabs to the visited person, whatever the session could open', () => {
    signIn('admin')
    useBadgeAccessStore.setState({ rules: { sleep: ['ADMIN'], hydration: EVERYONE, finance: ['ADMIN', 'MANAGER'] } })
    assert.deepEqual(tabsFor().ids.slice(5), ['finances', 'sleep', 'hydration'])
    visit('staff')
    const t = tabsFor()
    assert.deepEqual(t.ids.slice(5), ['finances', 'hydration'], 'the visited staff member is not given Sleep')
    assert.equal(t.finance, false, 'nor the ledger the admin could read')
  })

  it('a chosen tab that is hidden under the viewer falls back to Summary', () => {
    signIn('staff')
    useBadgeAccessStore.setState({ rules: { ...OPEN, workout: ['ADMIN'] } })
    assert.equal(tabsFor('workout').current, 'summary')
    assert.equal(tabsFor('meals').current, 'meals')
    assert.equal(tabsFor('nonsense').current, 'summary')
  })

  it('the wellbeing slices stay gated by their own apps — the Clients app was not added to them', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'public/snapshot-manifest.json'), 'utf8')) as {
      resources: { resource: string; apps: string[] }[]
    }
    for (const [tab, resource] of Object.entries(WELLBEING_RESOURCE)) {
      const entry = manifest.resources.find((r) => r.resource === resource)
      assert.ok(entry, resource)
      const app = CENTER_TABS.find((t) => t.id === tab)?.app
      assert.deepEqual(entry.apps, [app], `${resource} is read by ${app} alone`)
    }
  })
})

describe('the strip: every tab reachable, the hidden side marked', () => {
  const TABS = CENTER_TABS
  const strip = (edges: { left: boolean; right: boolean }, current: (typeof CENTER_TABS)[number]['id'] = 'sleep') =>
    draw(<TabStripView tabs={TABS} current={current} counts={{ incidents: 3 }} edges={edges} onPick={noop} onStep={noop} />)

  it('all ten tabs, in order, the chosen one marked, the incident count beside its tab', () => {
    const html = strip({ left: false, right: false })
    const at = TABS.map((t) => html.indexOf(`>${t.label}`))
    assert.ok(at.every((i) => i >= 0), 'every tab is drawn')
    assert.deepEqual([...at].sort((a, b) => a - b), at, 'in order')
    assert.equal(count(html, 'aria-current="true"'), 1)
    assert.match(html, /aria-current="true"[^>]*>Sleep</)
    assert.match(html, />Incidents<span[^>]*>3<\/span>/)
  })

  it('the baseline is drawn inside the scroller, so the active underline is not clipped by it', () => {
    const html = strip({ left: false, right: false })
    const scroller = /<div class="([^"]*overflow-x-auto[^"]*)"/.exec(html)?.[1] ?? ''
    const cls = scroller.split(/\s+/)
    assert.ok(cls.includes('shadow-[inset_0_-2px_0_var(--border)]'), 'the grey line is the scroller\'s own inset')
    assert.ok(cls.includes('overflow-y-hidden'), 'no stray vertical scroll')
    assert.ok(!cls.some((c) => /^border-b/.test(c)), 'no border for the tabs to overlap and be clipped against')
    assert.ok(!/-mb-0\.5/.test(html), 'no tab reaches outside the scroller')
  })

  it('a side that hides tabs gets a button; a strip that fits gets none', () => {
    assert.ok(!/More tabs|Earlier tabs/.test(strip({ left: false, right: false })))
    const right = strip({ left: false, right: true })
    assert.ok(right.includes('aria-label="More tabs"') && !right.includes('aria-label="Earlier tabs"'))
    const both = strip({ left: true, right: true })
    assert.ok(both.includes('aria-label="More tabs"') && both.includes('aria-label="Earlier tabs"'))
  })

  it('the edges are read from the scroller, with a pixel of slack', () => {
    assert.deepEqual(stripEdges({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400 }), { left: false, right: false })
    assert.deepEqual(stripEdges({ scrollLeft: 0, clientWidth: 330, scrollWidth: 820 }), { left: false, right: true })
    assert.deepEqual(stripEdges({ scrollLeft: 200, clientWidth: 330, scrollWidth: 820 }), { left: true, right: true })
    assert.deepEqual(stripEdges({ scrollLeft: 489.5, clientWidth: 330, scrollWidth: 820 }), { left: true, right: false })
  })

  it('the chosen tab is brought into the strip sideways, clear of the edge buttons; the page never moves', () => {
    const s = { scrollLeft: 0, getBoundingClientRect: () => ({ left: 100, right: 500 }) }
    revealTab(s, { getBoundingClientRect: () => ({ left: 540, right: 620 }) })
    assert.equal(s.scrollLeft, 120)
    revealTab(s, { getBoundingClientRect: () => ({ left: 60, right: 140 }) })
    assert.equal(s.scrollLeft, 80)
    revealTab(s, { getBoundingClientRect: () => ({ left: 200, right: 300 }) })
    assert.equal(s.scrollLeft, 80, 'a visible tab moves nothing')
    const p = { scrollLeft: 0, getBoundingClientRect: () => ({ left: 100, right: 500 }) }
    revealTab(p, { getBoundingClientRect: () => ({ left: 400, right: 480 }) }, 44)
    assert.equal(p.scrollLeft, 24, 'a tab under the right-hand button is pulled clear of it')
  })
})

describe('this client\'s rows, and nobody else\'s', () => {
  it('the key decides: the same name under another key is somebody else', () => {
    assert.deepEqual(rowsForClient(SLEEP_ROWS, JO).map((r) => r.notes), ['Jo winds down with music.'])
  })

  it('a record whose id was typed over still finds its rows by the key', () => {
    assert.deepEqual(rowsForClient(SLEEP_ROWS, TYPED).map((r) => r.id), ['slp-AR2'])
  })

  it('the id answers only when the key is missing on a side; the name only for a row with neither', () => {
    const noKey = { ...JO, client_key: '' }
    const rows = [
      { id: 'a', clientId: 'CLI_JD1', clientName: 'Jo Doe' },
      { id: 'b', clientId: 'CLI_ZZ', clientName: 'Jo Doe' },
      { id: 'legacy', clientName: 'JO DOE' },
      { id: 'legacy-other', clientName: 'Al Roe' },
    ]
    assert.deepEqual(rowsForClient(rows, noKey).map((r) => r.id), ['a', 'legacy'])
    assert.deepEqual(rowsForClient(rows, JO).map((r) => r.id), ['a', 'legacy'])
  })

  it('the demo seed never answers for a real client, not even one who shares a seed name', () => {
    assert.ok(SEED_SLEEP.length > 0 && SEED_SLEEP.every((s) => !s.client_key && !!s.clientId))
    assert.deepEqual(rowsForClient(SEED_SLEEP, { id: 'CLI_X', name: SEED_SLEEP[0].clientName, client_key: 'X' }), [],
      'a seed row carries an id, so its name is never consulted')
  })

  it('the day\'s plates come in the order they are eaten', () => {
    const rows = ['Dinner', 'Snack', 'Breakfast', 'Lunch'].map((mealType) => ({ mealType }))
    assert.deepEqual(sortMeals(rows).map((r) => r.mealType), ['Breakfast', 'Lunch', 'Snack', 'Dinner'])
  })
})

describe('the read: the app\'s own hook, answered at fetch', () => {
  beforeEach(() => {
    answer = (sent) => sent.resource === 'hydrationProfiles'
      ? { status: 403, message: 'Hydration is not open to you.' }
      : { status: 200, data: sent.resource === 'sleepProfiles' ? SLEEP_ROWS : [] }
  })

  it('Sleep keeps only this client\'s row out of every client the app serves', async () => {
    const h = mountHook(({ c }: { c: typeof JO }) => useClientWellbeing<SleepProfile>('sleep', c), { c: JO })
    await h.settle(() => !h.current.loading)
    const { rows, error } = h.current
    h.unmount()
    assert.equal(error, '')
    assert.deepEqual(rows.map((r) => r.id), ['slp-JD1'])
  })

  it('a refused read keeps its error and draws no demo rows in its place', async () => {
    const h = mountHook(({ c }: { c: typeof JO }) => useClientWellbeing<HydrationProfile>('hydration', c), { c: JO })
    await h.settle(() => !h.current.loading)
    const { rows, error } = h.current
    h.unmount()
    assert.match(error, /Hydration is not open to you/)
    assert.deepEqual(rows, [])
    const html = draw(<HydrationTabView client={JO} read={{ rows, loading: false, error }} />)
    assert.ok(html.includes('The Hydration app could not be read'), 'the failure is said')
    assert.ok(!html.includes('No hydration profile'), 'and never as "no profile"')
  })

  it('an app that answers nothing for this client draws the empty sentence, and says only that', async () => {
    const h = mountHook(({ c }: { c: typeof JO }) => useClientWellbeing<WorkoutRow>('workout', c), { c: JO })
    await h.settle(() => !h.current.loading)
    const { rows, error } = h.current
    h.unmount()
    assert.equal(error, '')
    const html = draw(<WorkoutTabView client={JO} read={{ rows, loading: false, error }} canGenerate generating={false} onGenerate={noop} />)
    assert.ok(html.includes(esc(wellbeingEmpty('workout', 'Jo Doe'))))
    assert.ok(!/ISP/.test(html), 'an empty read does not claim the ISP is missing')
    assert.ok(!html.includes(GENERATE), 'nothing to render for nobody')
  })
})

describe('Workout and Meals: the app\'s generate, for this client and the roles its door accepts', () => {
  let asked: Sent[] = []
  beforeEach(() => {
    asked = []
    answer = (sent) => {
      if (sent.action === 'wellbeingGenerateImage') {
        asked.push(sent)
        return { status: 200, data: { id: sent.payload?.row_id, image: 'https://img.example/wo.png', status: 'ready' } }
      }
      // somebody else's pending card comes FIRST: a generate that is not scoped would pick it
      return { status: 200, data: sent.resource === 'workoutPlans' ? [workout('ZZ9', 'pending'), workout('JD1', 'pending')] : [] }
    }
  })

  it('the rows are this client\'s, and Generate missing renders this client\'s card — never another\'s', async () => {
    signIn('staff')
    const h = mountHook(({ c }: { c: typeof JO }) => useClientImages<WorkoutRow>('workout', c), { c: JO })
    await h.settle(() => !h.current.read.loading)
    assert.deepEqual(h.current.read.rows.map((r) => r.id), ['wo-JD1'])
    assert.equal(h.current.canGenerate, true)
    h.run(() => h.current.onGenerate())
    await h.settle(() => asked.length > 0 && !h.current.generating)
    h.unmount()
    assert.deepEqual(asked.map((s) => s.payload?.row_id), ['wo-JD1'])
  })

  it('the render button follows the EFFECTIVE role: a client, or a visit to one, cannot ask for a render', async () => {
    for (const setUp of [() => signIn('client'), () => { signIn('admin'); visit('client') }]) {
      setUp()
      const h = mountHook(({ c }: { c: typeof JO }) => useClientImages<WorkoutRow>('workout', c), { c: JO })
      await h.settle(() => !h.current.read.loading)
      const { canGenerate, read } = h.current
      h.unmount()
      assert.equal(canGenerate, false)
      const html = draw(<WorkoutTabView client={JO} read={read} canGenerate={canGenerate} generating={false} onGenerate={noop} />)
      assert.ok(!html.includes(GENERATE))
      assert.ok(!html.includes('Generate missing'), 'nor does the source line name a button that is not there')
      resetWho()
    }
    assert.deepEqual(['admin', 'manager', 'staff', 'client', 'onboarding'].map((r) => mayGenerate(r as never)), [true, true, true, false, false])
  })
})

describe('each tab draws its app\'s pieces for this client', () => {
  const ok = <T,>(rows: T[]) => ({ rows, loading: false, error: '' })

  it('Sleep: the ISP target and notes lead; no placeholder average, quality, trend, bedtime or week', () => {
    const html = draw(<SleepTabView client={JO} read={ok(rowsForClient(SLEEP_ROWS, JO))} />)
    assert.ok(html.includes('Jo winds down with music.'))
    assert.ok(!html.includes('Al needs a night light.') && !html.includes('The other Jo'), 'nobody else\'s row')
    assert.match(html, />8h</, 'the target leads')
    assert.ok(html.includes('target from the ISP'))
    for (const invented of ['7.4', '71%', '% quality', 'Trending', 'avg', 'ideal week', '21:30']) {
      assert.ok(!html.includes(invented), `"${invented}" is not drawn on the record`)
    }
    assert.ok(html.includes(esc(wellbeingSource('sleep', 'Jo'))))
  })

  it('Hydration: the same — no "last logged today" the platform never logged, no invented average', () => {
    const row: HydrationProfile = {
      id: 'hyd-JD1', clientId: 'CLI_JD1', client_key: 'JD1', clientName: 'Jo Doe', targetOz: 64, avgOz: 60,
      glasses: 8, lastLogged: 'today', notes: 'Thickened liquids only.', trend: 'flat',
    }
    const html = draw(<HydrationTabView client={JO} read={ok([row])} />)
    assert.ok(html.includes('Thickened liquids only.'))
    assert.match(html, />64oz</)
    for (const invented of ['last logged', '60oz', 'glasses', 'avg']) assert.ok(!html.includes(invented), invented)
    assert.ok(html.includes('No drink is logged on this platform'))
  })

  it('Workout: the app\'s card; Generate missing while a card is pending, kept (disabled) while it renders', () => {
    const row = workout('JD1', 'pending')
    const staff = draw(<WorkoutTabView client={JO} read={ok([row])} canGenerate generating={false} onGenerate={noop} />)
    assert.ok(staff.includes('Gentle Walking') && staff.includes('Walker at all times.'))
    assert.ok(staff.includes(GENERATE))
    assert.ok(staff.includes('0 ready / 1 pending'))
    assert.ok(staff.includes('Generate missing asks for today'), 'the source line names the button that is there')
    const rendering = draw(
      <WorkoutTabView client={JO} read={ok([{ ...row, status: 'generating' as const }])} canGenerate generating onGenerate={noop} />,
    )
    assert.ok(rendering.includes(GENERATE), 'the last pending card rendering does not take the button away')
    assert.match(rendering, /<button[^>]*disabled=""[^>]*>.*Generate missing<\/button>/)
    assert.ok(rendering.includes('0 ready / 0 pending / 1 rendering'))
    const done = draw(<WorkoutTabView client={JO} read={ok([{ ...row, status: 'ready' as const }])} canGenerate generating={false} onGenerate={noop} />)
    assert.ok(!done.includes(GENERATE), 'nothing is missing')
    assert.ok(!done.includes('Generate missing'))
    assert.equal(showsGenerate([{ status: 'ready' }], true), false)
    assert.equal(showsGenerate([{ status: 'generating' }], true), true)
    assert.equal(showsGenerate([{ status: 'pending' }], false), false)
  })

  it('Meals: four plates in the order they are eaten, and nobody else\'s', () => {
    const meal = (mealType: MealRow['mealType'], key = 'JD1'): MealRow => ({
      id: `meal-${key}-${mealType.toLowerCase()}`, clientId: `CLI_${key}`, client_key: key, clientName: 'Jo Doe',
      dishName: `${mealType} · ~500 kcal`, description: `${mealType} for ${key}`, image: '', status: 'ready',
      dietaryTags: ['Soft'], mealType, recipe: { ingredients: [], steps: [], allergens: [], prepMin: 20, servings: 1 },
    })
    const all = [meal('Dinner'), meal('Snack'), meal('Breakfast'), meal('Lunch'), meal('Lunch', 'JD9')]
    const html = draw(<MealsTabView client={JO} read={ok(rowsForClient(all, JO))} canGenerate generating={false} onGenerate={noop} />)
    const at = (s: string) => html.indexOf(s)
    assert.ok(at('Breakfast for JD1') < at('Lunch for JD1') && at('Lunch for JD1') < at('Snack for JD1') && at('Snack for JD1') < at('Dinner for JD1'))
    assert.ok(at('Breakfast for JD1') >= 0)
    assert.ok(!html.includes('for JD9'))
  })

  it('the cards sit flat in the record\'s card — no card in a card, no lift', () => {
    const html = draw(<WorkoutTabView client={JO} read={ok([workout('JD1', 'ready')])} canGenerate={false} generating={false} onGenerate={noop} />)
    assert.ok(!html.includes('shadow-1'), 'no shadowed card inside the record')
    assert.ok(html.includes('bg-surface-2'))
    const sleepHtml = draw(<SleepTabView client={JO} read={ok([SLEEP_ROWS[0]])} />)
    assert.ok(!/border border-border bg-surface /.test(sleepHtml))
  })

  it('each tab has its empty sentence — only what is known — and a failure sentence that is not it', () => {
    for (const tab of ['sleep', 'hydration', 'workout', 'meals'] as const) {
      const empty = wellbeingEmpty(tab, 'Jo Doe')
      assert.match(empty, /^No .* on file for Jo Doe\.$/)
      assert.notEqual(wellbeingError(tab, 'boom'), empty)
      assert.match(wellbeingError(tab, 'boom'), /could not be read — boom$/)
    }
    const empty = draw(<SleepTabView client={JO} read={ok([])} />)
    assert.ok(empty.includes(esc(wellbeingEmpty('sleep', 'Jo Doe'))))
    const failed = draw(<SleepTabView client={JO} read={{ rows: [], loading: false, error: 'boom' }} />)
    assert.ok(failed.includes(esc(wellbeingError('sleep', 'boom'))) && !failed.includes('No sleep profile'))
    const reading = draw(<SleepTabView client={JO} read={{ rows: [], loading: true, error: '' }} />)
    assert.ok(reading.includes('Reading the Sleep app'))
  })
})

describe('Finances, with Client Finances merged in', () => {
  const LEDGER: Ledger = {
    client: 'Jo Doe', month: '2026-09', closed: false, missingReceipts: 1,
    funds: [
      { fundType: 'Cash', opening: 50, deposits: 0, spending: -9.5, closing: 40.5, count: 2, openingKnown: true },
      { fundType: 'TrueLink', opening: 10, deposits: 100, spending: 0, closing: 110, count: 1, openingKnown: false },
    ],
    transactions: [
      { id: 't1', date: '2026-09-03', vendor: 'Kroger', type: 'Spending', amount: -6.25, fundType: 'Cash', category: 'Groceries',
        description: '', staffMember: 'Ann', receiptName: '', receiptVerdict: '', receiptNote: '', needsReceipt: true },
      { id: 't2', date: '2026-09-04', vendor: 'Dollar Tree', type: 'Spending', amount: -3.25, fundType: 'Cash', category: 'Personal',
        description: '', staffMember: 'Ann', receiptName: 'r.jpg', receiptVerdict: 'MATCH', receiptNote: '', needsReceipt: false },
      { id: 't3', date: '2026-09-01', vendor: '', type: 'Deposit', amount: 100, fundType: 'TrueLink', category: '',
        description: 'SSI', staffMember: 'Ann', receiptName: '', receiptVerdict: '', receiptNote: '', needsReceipt: false },
    ],
  }
  const VOCAB = { fundTypes: ['Cash', 'TrueLink'], categories: ['Groceries'], txnTypes: ['Spending', 'Deposit', 'Withdraw'], exemptReasons: ['Lost'] }
  const view = (ledger: Ledger | null, extra: Partial<{ error: string; loading: boolean; isAdmin: boolean; flat: boolean }> = {}) => (
    <LedgerView
      ledger={ledger} loading={extra.loading ?? false} error={extra.error ?? ''} month="2026-09" vocab={VOCAB} canCompose
      isAdmin={extra.isAdmin ?? false} busy="" exemptFor="" onMonth={noop} onCompose={noop} onCloseMonth={noop}
      onAttach={noop} onExemptAsk={noop} onExemptPick={noop} onExemptCancel={noop} flat={extra.flat ?? true}
    />
  )
  const ROW = { funding_source: 'Medicaid IO Waiver', dodd_id: 'D-7781' }
  const BOOT = {
    clients: [{ id: 'CLI_JD1', name: 'Jo Doe', house: 'BM' }, { id: 'CLI_AR2', name: 'Al Roe' }],
    fundTypes: ['Cash'], categories: [], txnTypes: ['Spending'], exemptReasons: [],
  }
  const finances = (read: FinRead) =>
    draw(<ClientFinancesView client={JO} read={read} view="ledger" onView={noop} month="2026-09" onMonth={noop} />)

  it('the row\'s funding facts, then this client\'s ledger, then what nobody holds — each once', () => {
    const html = draw(<FinancesTab client={ROW} finance={view(LEDGER)} />)
    for (const once of ['Funding source', 'DODD #', 'Medicaid IO Waiver', 'D-7781', 'Client Finances', 'New transaction',
                        'TrueLink consent', 'Kroger', 'Dollar Tree', '−$6.25', '−$3.25']) {
      assert.equal(count(html, once), 1, `"${once}" is drawn once`)
    }
    const at = (s: string) => html.indexOf(s)
    assert.ok(at('>Funding<') < at('Client Finances') && at('Client Finances') < at('TrueLink consent'))
    assert.ok(!html.includes('What the platform holds'), 'the heading names its row, not everything the platform holds')
    assert.ok(html.includes('$150.50'), 'what is left across the funds')
    assert.ok(html.includes('no receipt on file'), 'the missing-receipt strip')
    assert.ok(!html.includes('Every client') && !html.includes('Documents'), 'nothing about anybody else, nothing company-wide')
    assert.ok(!html.includes('Close month'), 'closing a month is the admin\'s alone')
    assert.ok(!html.includes('shadow-1'), 'flat boxes inside the record\'s card')
  })

  it('a viewer Client Finances does not admit keeps the tab as it was', () => {
    const html = draw(<FinancesTab client={ROW} finance={null} />)
    assert.ok(html.includes('Medicaid IO Waiver') && html.includes('D-7781') && html.includes('TrueLink consent'))
    assert.ok(!html.includes('Client Finances') && !html.includes('New transaction'))
  })

  it('a month with nothing on it is one sentence — no empty cards, no confident $0.00', () => {
    const html = draw(view({ ...LEDGER, funds: [], transactions: [], missingReceipts: 0 }))
    assert.ok(html.includes('Nothing is on the ledger for September 2026'))
    for (const gone of ['$0.00', '0 transactions', 'Nothing recorded', 'Nothing moved', 'Every figure here']) {
      assert.ok(!html.includes(gone), gone)
    }
  })

  it('a ledger that could not be read says so, once — never "pick a client", never an empty month', () => {
    const html = draw(view(null, { error: 'Not allowed.' }))
    assert.ok(html.includes('The ledger could not be read — Not allowed.'))
    assert.ok(!html.includes('Pick a client') && !html.includes('Nothing is on the ledger'))
  })

  it('the name the ledger is keyed by: finClients\' name for this record\'s id; the record\'s own otherwise', () => {
    const fin = [{ id: 'CLI_JD1', name: 'Jo  Doe-Smith' }, { id: 'CLI_AR2', name: 'Al Roe' }]
    assert.equal(financeClientName({ id: 'CLI_JD1', name: 'Jo Doe' }, fin), 'Jo  Doe-Smith')
    assert.equal(financeClientName({ id: 'typed-7', name: 'Al Roe' }, fin), 'Al Roe')
  })

  it('a name two clients carry is refused, whichever record it is opened from', () => {
    const fin = [{ id: 'CLI_jo_doe', name: 'Jo Doe' }, { id: 'CLI_jodoe', name: 'jo doe ' }, { id: 'CLI_AR2', name: 'Al Roe' }]
    assert.equal(financeNameShared({ id: 'CLI_jo_doe' }, 'Jo Doe', fin), true)
    assert.equal(financeNameShared({ id: 'CLI_jodoe' }, 'jo doe', fin), true)
    assert.equal(financeNameShared({ id: 'CLI_AR2' }, 'Al Roe', fin), false)
    assert.equal(financeNameShared({ id: 'typed-9' }, 'Al Roe', fin), true, 'a record finClients does not list shares the name with one it does')
  })

  it('the section: reading, then the pane — the first paint is the skeleton, never "pick a client"', () => {
    assert.ok(finances({ boot: null, error: '' }).includes('Reading Client Finances…'))
    const html = finances({ boot: BOOT, error: '' })
    assert.ok(html.includes('New transaction') && html.includes('September 2026'))
    assert.ok(!html.includes('Pick a client'))
  })

  it('the section refuses a shared name: no figure, no New transaction, no Close month', () => {
    signIn('admin')
    const html = finances({ boot: { ...BOOT, clients: [...BOOT.clients, { id: 'CLI_jodoe', name: 'JO DOE' }] }, error: '' })
    assert.ok(html.includes('More than one client on file is named'))
    for (const gone of ['New transaction', 'Close month', 'Ledger', 'Analytics', '$']) assert.ok(!html.includes(gone), gone)
  })

  it('finClients is read through its door; a refusal is said as a failure', async () => {
    answer = (sent) => sent.action === 'finClients' ? { status: 200, data: BOOT } : { status: 404, message: '' }
    const ok = mountHook(() => useFinClients(), undefined)
    await ok.settle(() => !!ok.current.boot)
    assert.deepEqual(ok.current.boot?.clients.map((c) => c.id), ['CLI_JD1', 'CLI_AR2'])
    ok.unmount()
    answer = () => ({ status: 403, message: 'Money is admin and manager only.' })
    const no = mountHook(() => useFinClients(), undefined)
    await no.settle(() => !!no.current.error)
    const read = no.current
    no.unmount()
    assert.ok(finances(read).includes('Client Finances could not be read — Money is admin and manager only.'))
  })

  it('New transaction from the record names this client, and offers nobody else', () => {
    const pick = singleClientPick('Jo Doe', 'BM')
    assert.deepEqual(pick, { clients: [{ name: 'Jo Doe', house: 'BM' }], initialClient: 'Jo Doe' })
    const html = draw(<NewTransactionModal clients={pick.clients} initialClient={pick.initialClient} vocab={VOCAB} onClose={noop} onSaved={noop} />)
    const select = /<select id="fin-client"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? ''
    const options = [...select.matchAll(/<option value="([^"]*)"([^>]*)>/g)]
    assert.deepEqual(options.map((o) => o[1]), ['', 'Jo Doe'])
    assert.match(options[1][2], /selected/, 'pre-selected')
  })

  it('Close month follows the effective person: an admin visiting a manager is not offered it', () => {
    const mayClose = () => {
      const h = mountHook(() => useMayCloseMonth(), undefined)
      const out = h.current
      h.unmount()
      return out
    }
    signIn('admin')
    assert.equal(mayClose(), true)
    visit('manager')
    assert.equal(mayClose(), false, 'the server clamps the visit to the manager, who cannot close')
    const pane = (isAdmin: boolean) => draw(view(LEDGER, { isAdmin }))
    assert.ok(pane(true).includes('Close month') && !pane(false).includes('Close month'))
    // the pane asks the same hook: drawn with no one signed in, it offers no close
    assert.ok(!draw(<FinanceLedger client="Jo Doe" clients={[]} vocab={VOCAB} month="2026-09" onMonth={noop} flat />).includes('Close month'))
  })
})

describe('the ledger read: only the latest ask for the month on screen is kept', () => {
  type Held = { client: string; month: string; release: () => void }
  let held: Held[] = []
  const ledgerFor = (client: string, month: string): Ledger => ({
    client, month, closed: false, missingReceipts: 0, transactions: [],
    funds: [{ fundType: 'Cash', opening: 0, deposits: 0, spending: 0, closing: Number(month.slice(5)), count: 0, openingKnown: true }],
  })
  const releaseAll = (client: string, month: string) => {
    for (const x of held.filter((y) => y.client === client && y.month === month)) x.release()
    held = held.filter((y) => !(y.client === client && y.month === month))
  }
  beforeEach(() => {
    held = []
    answer = (sent) => {
      if (sent.action !== 'finLedger') return { status: 404, message: '' }
      const client = String(sent.payload?.client)
      const month = String(sent.payload?.month)
      return new Promise((res) => held.push({ client, month, release: () => res({ status: 200, data: ledgerFor(client, month) }) }))
    }
  })

  it('a slower answer for the month just left never lands under the new month', async () => {
    const h = mountHook(({ c, m }: { c: string; m: string }) => useLedger(c, m), { c: 'Jo Doe', m: '2026-09' })
    const now = () => h.current
    assert.equal(now().loading, true, 'reading from the first paint')
    h.rerender({ c: 'Jo Doe', m: '2026-08' })
    assert.equal(now().ledger, null, 'the change clears the pane before it reads')
    releaseAll('Jo Doe', '2026-08')
    await h.settle(() => now().ledger?.month === '2026-08')
    releaseAll('Jo Doe', '2026-09')
    await h.settle(() => false)
    assert.equal(now().ledger?.month, '2026-08')
    assert.equal(now().loading, false)
    h.unmount()
  })

  it('a slower answer for the client just left never lands under the new client', async () => {
    const h = mountHook(({ c, m }: { c: string; m: string }) => useLedger(c, m), { c: 'Jo Doe', m: '2026-09' })
    h.rerender({ c: 'Al Roe', m: '2026-09' })
    releaseAll('Al Roe', '2026-09')
    await h.settle(() => h.current.ledger?.client === 'Al Roe')
    releaseAll('Jo Doe', '2026-09')
    await h.settle(() => false)
    assert.equal(h.current.ledger?.client, 'Al Roe')
    h.unmount()
  })

  it('a failed read is said inline and nowhere else', async () => {
    answer = () => ({ status: 403, message: 'Not allowed.' })
    const before = useToastStore.getState().toasts.length
    const h = mountHook(({ c, m }: { c: string; m: string }) => useLedger(c, m), { c: 'Jo Doe', m: '2026-09' })
    await h.settle(() => !!h.current.error)
    const { error, ledger } = h.current
    h.unmount()
    assert.equal(error, 'Not allowed.')
    assert.equal(ledger, null)
    assert.equal(useToastStore.getState().toasts.length, before, 'no second report as a toast')
  })
})
