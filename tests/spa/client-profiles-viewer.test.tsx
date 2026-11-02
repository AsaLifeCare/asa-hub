/**
 * CLIENTS · as App Control releases it. The doors decide every answer (ClientProfiles.gs clientProfilesReader_); the
 * page only keeps from offering what they refuse: an account the server may narrow reads the doors, never
 * headquarters' slices or the relay's pack; every write is offered to the master's own session alone; a client, an
 * SSA or a family member is never offered Billing, Refills, the fleet, the MAR errors audit or the drive scan; and a
 * refusal that still arrives reads as a door shut to them, plainly. SSA and FAMILY are the operator's FIX BADGES
 * sheet (10-30): there is no GUARDIAN badge, and neither wearer's role word ever counts. The fixtures are invented.
 */
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { forgetSnapshot } from '@/lib/snapshotClient'
import { forgetPack } from '@/lib/appPack'
import { ClientsScreen } from '@/pages/features/clientprofiles/ClientProfilesPage'
import ClientActions from '@/pages/features/clientprofiles/ClientActions'
import {
  NOT_PUBLISHED, clientIncidentsOf, isWriteAsk, profileOf, readRefusal, rosterOf, type ClientAsk, type RosterRow,
} from '@/pages/features/clientprofiles/clientModel'
import {
  ClientReaderContext, NOT_OPEN, narrowedReader, ownRecordOnly, shownTabs, shownViews, viewerOf, type ClientReader,
} from '@/pages/features/clientprofiles/clientViewer'
import { forgetClientReads, readDetails, readRoster, type ReadState } from '@/pages/features/clientprofiles/useClientRead'
import { ProfileView } from '@/pages/features/clientprofiles/sections/Profile'
import MedicationSection from '@/pages/features/clientprofiles/sections/Medication'
import { IncidentsBody, StatusControl } from '@/pages/features/clientprofiles/sections/Incidents'
import { AppointmentsView } from '@/pages/features/clientprofiles/sources/AppointmentsTab'
import { apptRefusal, appointmentsOf, NOT_PUBLISHED as APPT_NOT_PUBLISHED } from '@/pages/features/clientprofiles/sources/appointments'
import { FINANCE_NOT_PUBLISHED, financeRefusal } from '@/pages/features/clientprofiles/sources/finance'
import { MarBody } from '@/pages/features/clientprofiles/sources/MarTab'
import { readRefusal as marRefusal } from '@/pages/features/clientprofiles/sources/mar'
import { REFILLS_NOT_PUBLISHED, refusalWords } from '@/pages/features/clientprofiles/sources/refills'
import { TransportBody } from '@/pages/features/clientprofiles/sources/TransportTab'
import { transportRefusal } from '@/pages/features/clientprofiles/sources/transport'
import { CLIENT_TABS, SECTION_VIEWS } from '@/pages/features/clientprofiles/clientModel'
import { MAR_VIEWS } from '@/pages/features/clientprofiles/sources/mar'
import { TRANSPORT_VIEWS } from '@/pages/features/clientprofiles/sources/transport'
import { SHELL_SHOWN, primeShellHides } from '@/lib/myWorkHides'

// the sections Settings › My Work can hide are drawn as a session it shows them to sees them
primeShellHides(SHELL_SHOWN)

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const noop = () => {}
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const ready = <T,>(data: T): ReadState<T> => ({ status: 'ready', data, error: '', refreshing: false })
const loading = <T,>(): ReadState<T> => ({ status: 'loading', data: null, error: '', refreshing: false })
const failed = <T,>(error: string): ReadState<T> => ({ status: 'failed', data: null, error, refreshing: false })

const as = (reader: ClientReader, node: ReactNode) =>
  flat(renderToString(<MemoryRouter><ClientReaderContext.Provider value={reader}>{node}</ClientReaderContext.Provider></MemoryRouter>))
const MASTER_READ: ClientReader = { viewer: 'master', mayWrite: true }
const STAFF_READ: ClientReader = { viewer: 'all', mayWrite: false }
const SSA_READ: ClientReader = { viewer: 'ssa', mayWrite: false }
const CLIENT_READ: ClientReader = { viewer: 'client', mayWrite: false }
const FAMILY_READ: ClientReader = { viewer: 'guardian', mayWrite: false }

const C: RosterRow = { client_key: 'kay9', client_id: 'CLI_kay9', name: 'Kay Nine', status: 'active', house: 'ZZ9999', avatar: '', isp_year: '2026' }

type Signed = { id: string; name: string; email: string; role: string; types: string[]; isMaster: boolean }
const signIn = (user: Signed | null) => useAuthStore.setState({ user } as never)
const MASTER: Signed = { id: 'u-boss', name: 'Boss', email: 'boss@example.org', role: 'admin', types: [], isMaster: true }
const STAFF: Signed = { id: 'u-st9', name: 'Sally Staff', email: 'st9@example.org', role: 'staff', types: ['STAFF'], isMaster: false }
const CLIENT: Signed = { id: 'u-cl9', name: 'Kay Nine', email: 'kay9@example.org', role: 'client', types: ['CLIENT'], isMaster: false }
// the sheet's SSA: the person the client records name as guardian, on a staff role (or a client-role account)
const SSA: Signed = { id: 'u-ss9', name: 'Sam Support', email: 'sam@example.org', role: 'staff', types: ['SSA'], isMaster: false }
// the sheet's FAMILY: the person the client records name as their SSA, on a staff role, no client linked
const FAMILY: Signed = { id: 'u-fa9', name: 'Fay Family', email: 'fay@county.org', role: 'staff', types: ['FAMILY'], isMaster: false }

/* ---------- the words and the lists ---------- */

describe('who reads, and what the page offers them', () => {
  after(() => signIn(null))

  it('the roster carries the word the doors read the account as; a slice roster carries none', () => {
    assert.equal(rosterOf({ clients: [], viewer: 'guardian' }).viewer, 'guardian')
    assert.equal(rosterOf({ clients: [] }).viewer, '')
    assert.equal(viewerOf('SSA'), 'ssa')
    assert.equal(viewerOf('house'), '')
    assert.deepEqual(['master', 'all', 'ssa', 'client', 'guardian', ''].map((v) => ownRecordOnly(viewerOf(v))),
      [false, false, true, true, true, false])
  })

  it('a client, an SSA or family is offered every section but Billing, and no Refills, Vehicles or MAR errors tab; anyone else all', () => {
    const ids = (list: readonly { id: string }[]) => list.map((t) => t.id).join()
    for (const v of ['client', 'guardian', 'ssa'] as const) {
      assert.equal(ids(shownTabs(CLIENT_TABS, v)), 'profile,care,medication,appointments,transportation,incidents,funds,activity')
      assert.equal(ids(shownViews('medication', SECTION_VIEWS.medication, v)), 'meds,admin')
      assert.equal(ids(shownViews('transportation', TRANSPORT_VIEWS, v)), 'calendar,history')
      assert.equal(ids(shownViews('administration', MAR_VIEWS, v)), 'papers,passes')
    }
    for (const v of ['master', 'all', ''] as const) {
      assert.equal(shownTabs(CLIENT_TABS, v).length, CLIENT_TABS.length)
      assert.equal(shownViews('medication', SECTION_VIEWS.medication, v).length, 3)
      assert.equal(shownViews('transportation', TRANSPORT_VIEWS, v).length, 3)
      assert.equal(shownViews('administration', MAR_VIEWS, v).length, 3)
    }
  })

  it('every panel mode that files something or runs Client management is a write; reading a record is not', () => {
    const writes: ClientAsk[] = [{ kind: 'edit-profile' }, { kind: 'add-client' }, { kind: 'create-user', who: 'client' },
      { kind: 'tool', tool: 'read-plans' }, { kind: 'add-medication' }, { kind: 'add-authorization' }, { kind: 'new-incident' }]
    const reads: ClientAsk[] = [{ kind: 'share' }, { kind: 'record', section: 'care', view: 'plans', id: 'r1' },
      { kind: 'activity', id: 'a1' }, { kind: 'incident', id: 'i1' }, { kind: 'source', value: 'visit~r1' }]
    assert.ok(writes.every(isWriteAsk))
    assert.ok(!reads.some(isWriteAsk))
  })

  it('narrowed readers: a client-role account and one wearing SSA, FAMILY or CLIENT, whatever its role word; never staff or the master', () => {
    signIn(CLIENT)
    assert.equal(narrowedReader(), true)
    signIn(SSA)
    assert.equal(narrowedReader(), true)
    // a client-role account linked to its one ward wears SSA
    signIn({ ...SSA, id: 'u-ss8', role: 'client', types: ['SSA'] })
    assert.equal(narrowedReader(), true)
    signIn(FAMILY)
    assert.equal(narrowedReader(), true)
    // an SSA's or a FAMILY's role word never counts: not staff, not a manager
    for (const who of [SSA, FAMILY]) {
      signIn({ ...who, role: 'manager' })
      assert.equal(narrowedReader(), true, who.id)
      signIn({ ...who, types: [...who.types, 'STAFF'] })
      assert.equal(narrowedReader(), true, who.id)
    }
    signIn({ ...STAFF, types: ['STAFF', 'CLIENT'] })
    assert.equal(narrowedReader(), true)
    signIn(STAFF)
    assert.equal(narrowedReader(), false)
    signIn(MASTER)
    assert.equal(narrowedReader(), false)
    signIn(null)
    assert.equal(narrowedReader(), false)
  })

  it('"Unknown action." to a signed-in account that is not the master reads as a door shut to them, in every section', () => {
    const all: [(e: string) => string, string][] = [[readRefusal, NOT_PUBLISHED], [apptRefusal, APPT_NOT_PUBLISHED],
      [financeRefusal, FINANCE_NOT_PUBLISHED], [marRefusal, 'Administration'], [refusalWords, REFILLS_NOT_PUBLISHED],
      [transportRefusal, 'Clients answers']]
    signIn(STAFF)
    for (const [words] of all) assert.equal(words('Unknown action.'), NOT_OPEN)
    for (const [words] of all) assert.equal(words('No client "x" is on file.'), 'No client "x" is on file.')
    signIn(MASTER)
    for (const [words, published] of all) assert.ok(words('Unknown action.').includes(published), published)
    signIn(null)
    assert.equal(readRefusal('Unknown action.'), NOT_PUBLISHED)
    for (const t of [NOT_PUBLISHED, APPT_NOT_PUBLISHED, FINANCE_NOT_PUBLISHED, REFILLS_NOT_PUBLISHED]) {
      assert.doesNotMatch(t, /visit|master/i, 'a visit and the master are no reason a door is unknown any more')
    }
  })
})

/* ---------- the lanes ---------- */

describe('an account the server may narrow reads the doors, never headquarters\' copies', () => {
  const realFetch = globalThis.fetch
  let seen: string[] = []
  // the word the doors read the signed-in account as
  let answersAs = 'client'
  before(() => {
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      const url = String(input)
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
      if (url.startsWith('/snapshot/')) {
        const name = url.slice('/snapshot/'.length).replace(/\.json$/, '')
        seen.push(`slice:${name}`)
        if (name === 'index') return json({ slices: { clients: { built_at: '2026-09-28T10:00:00Z' } } })
        if (name === 'clients') {
          return json({ resource: 'clients', built_at: '2026-09-28T10:00:00Z', rows: [
            { client_key: 'kay9', name: 'Kay Nine', status: 'active' }, { client_key: 'lee9', name: 'Lee Nine', status: 'active' }] })
        }
        return new Response('no', { status: 404 })
      }
      if (url.startsWith('/erp-lanes/app-pack/')) {
        seen.push('pack')
        return json({ status: 403, message: 'This app is not open to you.' }, 403)
      }
      const body = typeof init?.body === 'string' ? init.body : ''
      const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action?: string }
      seen.push(`gas:${env.action ?? ''}`)
      if (env.action === 'clientProfileRoster') {
        return json({ status: 200, data: { clients: [{ client_key: 'kay9', name: 'Kay Nine', status: 'active' }], viewer: answersAs } })
      }
      return json({ status: 200, data: { client: { client_key: 'kay9', name: 'Kay Nine' } } })
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch; signIn(null) })
  beforeEach(() => {
    seen = []
    answersAs = 'client'
    forgetSnapshot()
    forgetClientReads()
    forgetPack()
    useMemberStore.setState({ currentMemberId: '' } as never)
  })
  afterEach(() => forgetPack())

  it('a client-role account, an SSA and a family member: the roster and a record come from the doors, cut to their own; no slice, no pack', async () => {
    const readers: [Signed, string][] = [[CLIENT, 'client'], [SSA, 'ssa'], [{ ...SSA, id: 'u-ss8', role: 'client' }, 'ssa'],
      [FAMILY, 'guardian']]
    for (const [who, word] of readers) {
      signIn(who)
      answersAs = word
      seen = []
      forgetSnapshot()
      forgetClientReads()
      const r = rosterOf(await readRoster(false))
      assert.deepEqual(r.clients.map((c) => c.client_key), ['kay9'], who.id)
      assert.equal(r.viewer, word, who.id)
      assert.ok(ownRecordOnly(r.viewer), who.id)
      await readDetails('kay9')
      assert.deepEqual(seen, ['gas:clientProfileRoster', 'gas:clientProfileDetails'], who.id)
    }
  })

  it('a staff member at headquarters draws the switcher from the slices, as before', async () => {
    signIn(STAFF)
    const r = rosterOf(await readRoster(false))
    assert.deepEqual(r.clients.map((c) => c.client_key).sort(), ['kay9', 'lee9'])
    assert.ok(seen.some((s) => s.startsWith('slice:')) && !seen.includes('gas:clientProfileRoster'), seen.join())
  })
})

/* ---------- the screen ---------- */

describe('the screen, as each reader sees it', () => {
  const screen = (reader: ClientReader, tab: 'profile' | 'billing', view = '') => as(reader,
    <ClientsScreen roster={ready({})} onRetry={noop} clients={[C]} wanted="kay9" client={C} tab={tab} view={view} today="2026-09-29"
      inactive={{ on: false, reading: false, why: '' }} onInactive={noop} onClient={noop} onTab={noop} onView={noop} onAsk={noop} />)

  it('only the master\'s own session is offered Actions; Share stays for everyone', () => {
    const bar = (reader: ClientReader) => as(reader, <ClientActions tab="profile" view="" onAsk={noop} />)
    assert.ok(bar(MASTER_READ).includes('data-actions=""'))
    for (const r of [STAFF_READ, SSA_READ, CLIENT_READ, FAMILY_READ]) {
      const html = bar(r)
      assert.ok(!html.includes('data-actions=""') && html.includes('data-share=""'), r.viewer)
    }
  })

  it('a client, an SSA and family: no Billing in the sections, and an address naming it says plainly it is not open', () => {
    for (const r of [CLIENT_READ, SSA_READ, FAMILY_READ]) {
      const html = screen(r, 'billing', 'authorizations')
      assert.ok(!html.includes('data-tab="billing"') && html.includes('data-tab="funds"'), r.viewer)
      assert.ok(html.includes('data-not-open=""') && html.includes(NOT_OPEN) && !html.includes('data-finance="billing"'), r.viewer)
      assert.ok(!html.includes('role="alert"'), 'never a red failure')
    }
    for (const r of [STAFF_READ]) {
      const html = screen(r, 'billing', 'authorizations')
      assert.ok(html.includes('data-tab="billing"') && html.includes('data-finance="billing"') && !html.includes('data-not-open'), r.viewer)
    }
  })

  it('the details pencil is the master\'s alone', () => {
    const p = profileOf({ client: { client_key: 'kay9', name: 'Kay Nine', status: 'active' } })
    const draw = (r: ClientReader) => as(r, <ProfileView client={C} profile={ready(p)} today="2026-09-29" onAsk={noop} onRetry={noop} />)
    assert.ok(draw(MASTER_READ).includes('Edit client details'))
    for (const r of [STAFF_READ, SSA_READ, CLIENT_READ]) assert.ok(!draw(r).includes('Edit client details'), r.viewer)
  })

  it('incidents: New incident and the Status select are the master\'s; anyone else reads the status', () => {
    const a = clientIncidentsOf({ rows: [{ id: 'r2', incident_ts: '2026-09-20T18:00:00.000Z', your_name: 'Ann Lee', client_name: 'Kay Nine',
      client_key: 'kay9', incident_category: 'Fall', status: 'Under review', status_by: 'boss@example.org', status_at: '2026-09-21T10:00:00Z' }],
    statuses: ['Reported', 'Under review', 'Closed'] })
    const row = a.rows[0]
    assert.ok(as(MASTER_READ, <IncidentsBody client={C} incidents={ready(a)} onAsk={noop} onRetry={noop} />).includes('data-new-incident'))
    for (const r of [STAFF_READ, CLIENT_READ]) {
      assert.ok(!as(r, <IncidentsBody client={C} incidents={ready(a)} onAsk={noop} onRetry={noop} />).includes('data-new-incident'), r.viewer)
      const status = as(r, <StatusControl client={C} row={row} statuses={a.statuses} />)
      assert.ok(status.includes('data-status-read="r2"') && status.includes('Under review'), r.viewer)
      assert.ok(!status.includes('<select') && !status.includes('boss@example.org'), r.viewer)
    }
    const own = as(MASTER_READ, <StatusControl client={C} row={row} statuses={a.statuses} />)
    assert.ok(own.includes('<select') && own.includes('data-status-control="r2"'))
  })

  it('Medication to a client, an SSA or family: Medications and Administration, no Refills; an address naming it is not open', () => {
    const med = (r: ClientReader, view: 'meds' | 'admin' | 'refills') => as(r,
      <MedicationSection client={C} view={view} today="2026-09-29" onView={noop} onAsk={noop} panel={null} onPanel={noop} />)
    for (const r of [CLIENT_READ, SSA_READ, FAMILY_READ]) {
      const own = med(r, 'meds')
      assert.ok(own.includes('data-view="meds"') && own.includes('data-view="admin"') && !own.includes('data-view="refills"'), r.viewer)
    }
    for (const r of [SSA_READ, FAMILY_READ]) {
      const refills = med(r, 'refills')
      assert.ok(refills.includes('data-not-open=""') && !refills.includes('data-refills'), r.viewer)
    }
    assert.ok(med(STAFF_READ, 'refills').includes('data-refills'), 'staff read the refills')
  })

  it('Transportation and Administration to a client, an SSA or family: their trips and papers, never the fleet, the errors or the scan', () => {
    const trips = (r: ClientReader, view: 'calendar' | 'history' | 'vehicles') => as(r,
      <TransportBody read={{ status: 'loading', data: null, error: '', refreshing: false } as never} view={view} onView={noop}
        date="" onDate={noop} onAsk={noop} />)
    for (const r of [CLIENT_READ, SSA_READ]) {
      const t = trips(r, 'history')
      assert.ok(t.includes('data-view="calendar"') && t.includes('data-view="history"') && !t.includes('data-view="vehicles"'), r.viewer)
    }
    for (const r of [SSA_READ, FAMILY_READ]) assert.ok(trips(r, 'vehicles').includes('data-not-open=""'), r.viewer)
    assert.ok(trips(STAFF_READ, 'history').includes('data-view="vehicles"'))
    const mar = (r: ClientReader, view: 'papers' | 'passes' | 'errors', data: unknown = null) => as(r,
      <MarBody state={data ? ready(data as never) : loading()} view={view} onView={noop} onAsk={noop} onRetry={noop} />)
    for (const r of [CLIENT_READ, SSA_READ]) {
      const papers = mar(r, 'papers')
      assert.ok(papers.includes('data-view="papers"') && papers.includes('data-view="passes"') && !papers.includes('data-view="errors"'), r.viewer)
    }
    for (const r of [SSA_READ, FAMILY_READ]) assert.ok(mar(r, 'errors').includes('data-not-open=""'), r.viewer)
    assert.ok(mar(STAFF_READ, 'papers').includes('data-view="errors"'))
  })

  it('an appointment\'s pencil opens its form for the master alone; anyone else opens the visit', () => {
    const a = appointmentsOf({ client: { client_key: 'kay9', name: 'Kay Nine' }, tabs: {
      visits: { rows: [{ id: 'r5', client_name: 'Kay Nine', date: '2026-10-02', dr_name: 'Dr Lee', editable: true, status: 'Upcoming' }],
        kpis: { total: 1, upcoming: 1, past: 0 } },
      doctors: { rows: [] } } })
    const draw = (r: ClientReader) => as(r, <AppointmentsView state={ready(a)} query="" status="" onQuery={noop} onStatus={noop}
      onOpen={noop} onRetry={noop} />)
    assert.match(draw(MASTER_READ), /aria-label="Edit the appointment/)
    for (const r of [STAFF_READ, SSA_READ, CLIENT_READ]) assert.match(draw(r), /aria-label="Open the appointment/, r.viewer)
  })

  it('a refusal that still arrives is said plainly, not as a red failure', () => {
    signIn(CLIENT)
    try {
      const html = as(CLIENT_READ, <ProfileView client={C} profile={failed('Unknown action.')} today="2026-09-29" onAsk={noop} onRetry={noop} />)
      assert.ok(html.includes('data-not-open=""') && html.includes(NOT_OPEN) && !html.includes('role="alert"'))
    } finally { signIn(null) }
  })
})
