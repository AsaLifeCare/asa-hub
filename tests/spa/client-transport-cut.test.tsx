/**
 * CLIENTS · Transportation under its own App Control row (the operator's access sheet, 2026-10-29, rows 23-24: Calendar
 * and History open to every staff column, shut to SSA, Family and clients). The tab is not offered to a badge the row
 * does not name, and an address naming it opens the client's profile instead; a holder of clients.transportation keeps
 * it, since an edition only ever adds people. The master is never narrowed. Appointments (and its trips card) is not
 * touched.
 *
 * The row is asked of the real checker (featureAllowsWith, useFeatureAllowed under real React); the screen is drawn
 * whole by react-dom/server for the reader the page builds.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { useBadgeAccessStore } from '@/lib/badgeAccess'
import { APP_FEATURES, featureAllowsWith, featureOf } from '@/lib/featureAccess'
import { EDITION_BADGES, type EditionId } from '@/lib/editions'
import { SHELL_SHOWN, primeShellHides } from '@/lib/myWorkHides'
import type { ReadState } from '@/lib/readCache'
import { useMemberStore } from '@/stores/useMemberStore'
import { ClientsScreen } from '@/pages/features/clientprofiles/ClientProfilesPage'
import type { ClientTab, RosterRow } from '@/pages/features/clientprofiles/clientModel'
import {
  ClientReaderContext, TRANSPORT_EDITION, TRANSPORT_FEATURE, tabOffered, transportOffered, useTransportOffered,
  type ClientReader, type ClientViewer,
} from '@/pages/features/clientprofiles/clientViewer'
import { mountHook } from './react-host'

primeShellHides(SHELL_SHOWN)

// motion mounts its projection nodes against the window; a screen drawn whole reaches them
for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const noop = () => {}
const draw = (node: ReactNode) => renderToString(<MemoryRouter>{node}</MemoryRouter>).replace(/<!-- -->/g, '')
const ready = <T,>(data: T): ReadState<T> => ({ status: 'ready', data, error: '', refreshing: false })

// the sheet's lead columns (Director, Platform Lead, Supervisor, Administrator, Admin): Admin and every badge above it,
// read off the order of access rather than spelled, so a badge that stands in for another is never copied here
const LEADS: string[] = EDITION_BADGES.slice(0, EDITION_BADGES.indexOf('ADMIN') + 1)
// the row the operator writes before the release: every staff column, never GUARDIAN or CLIENT
const ROW = [...LEADS, 'ENTITY', 'MANAGER', 'TEAMLEAD', 'HM', 'INTERVIEWER', 'STAFF']
const RULES: Record<string, string[]> = { [TRANSPORT_FEATURE]: ROW }

type Who = { isMaster?: boolean; types: string[]; role: string }
const MASTER: Who = { isMaster: true, types: [], role: 'admin' }
const STAFF_COLUMNS: Record<string, Who> = {
  ...Object.fromEntries(LEADS.map((b) => [b, { role: 'admin', types: [b] }])),
  'House Manager': { role: 'staff', types: ['HM', 'STAFF', 'INTERVIEWER'] },
  'House Manager on the manager role': { role: 'manager', types: ['INTERVIEWER', 'HM'] },
  'Team Lead': { role: 'staff', types: ['TEAMLEAD'] },
  DSP: { role: 'staff', types: ['STAFF'] },
}
const FAMILY: Who = { role: 'client', types: ['GUARDIAN'] }
const CLIENT: Who = { role: 'client', types: [] }

const reader = (viewer: ClientViewer, mayWrite = false, editions: EditionId[] = []): ClientReader => ({ viewer, mayWrite, editions })
const offered = (who: Who, rules: Record<string, string[]>, r = reader('all', who.isMaster === true)) =>
  transportOffered(r, featureAllowsWith(TRANSPORT_FEATURE, { ...who, isMaster: who.isMaster === true }, rules))

describe('the Transportation row', () => {
  it('is listed under Clients, under the id the server asks, the master\'s until released', () => {
    assert.equal(TRANSPORT_FEATURE, 'client-profiles.transportation')
    assert.ok((APP_FEATURES['client-profiles'] ?? []).some((f) => f.id === TRANSPORT_FEATURE))
    assert.equal(featureOf(TRANSPORT_FEATURE)?.masterUntilReleased, true)
    assert.equal(TRANSPORT_EDITION, 'clients.transportation')
  })

  it('every staff column is offered the tab once the row is written', () => {
    assert.ok(LEADS.length === 5 && ['DIRECTOR', 'ADMINISTRATOR', 'ADMIN'].every((b) => LEADS.includes(b)), 'the five leads')
    for (const [column, who] of Object.entries(STAFF_COLUMNS)) assert.equal(offered(who, RULES), true, column)
  })

  it('Family and a client are never offered it', () => {
    assert.equal(offered(FAMILY, RULES, reader('guardian')), false)
    assert.equal(offered(CLIENT, RULES, reader('client')), false)
    // the edition is never a client's or a family's, whatever list it is on
    assert.equal(offered(FAMILY, RULES, reader('guardian', false, [TRANSPORT_EDITION])), false)
  })

  it('before the row is written the tab is the master\'s alone, and a holder of clients.transportation\'s', () => {
    assert.equal(offered(STAFF_COLUMNS.DIRECTOR, {}), false)
    assert.equal(offered(STAFF_COLUMNS.DSP, {}, reader('all', false, [TRANSPORT_EDITION])), true, 'an edition only adds people')
    assert.equal(offered(STAFF_COLUMNS.DSP, {}, reader('all', false, ['clients.profile'])), false, 'another edition opens no tab')
    assert.equal(offered(MASTER, {}), true)
    assert.equal(offered(MASTER, { [TRANSPORT_FEATURE]: ['DIRECTOR'] }), true, 'the master is never narrowed')
  })

  it('an address naming a shut Transportation opens the profile; every other tab is left as asked', () => {
    assert.equal(tabOffered<ClientTab>('transportation', false), 'profile')
    assert.equal(tabOffered<ClientTab>('transportation', true), 'transportation')
    for (const tab of ['appointments', 'care', 'incidents', 'activity'] as const) assert.equal(tabOffered<ClientTab>(tab, false), tab)
  })
})

describe('the screen', () => {
  const C: RosterRow = { client_key: 'annettekowal', client_id: 'CLI_annettekowal', name: 'Annette Kowal', status: 'active',
    house: 'NW4045', avatar: '', isp_year: '2026' }
  const inactive = { on: false, reading: false, why: '' }
  const signIn = (who: Who | null) =>
    useAuthStore.setState({ user: who ? { id: 'u1', name: 'Bea Lee', email: 'bea@example.org', isMaster: false, ...who } : null } as never)
  const rules = (r: Record<string, string[]>) => useBadgeAccessStore.setState({ rules: r, tenantRules: {}, configRules: {} } as never)
  const screen = (who: Who, r: Record<string, string[]>, tab: ClientTab, read: ClientReader = reader('all', who.isMaster === true)) => {
    signIn(who)
    rules(r)
    return draw(
      <ClientReaderContext.Provider value={read}>
        <ClientsScreen roster={ready({})} onRetry={noop} clients={[C]} wanted="annettekowal" client={C} tab={tab}
          view={tab === 'transportation' ? 'history' : ''}
          today="2026-10-29" inactive={inactive} onInactive={noop} onClient={noop} onTab={noop} onView={noop} onAsk={noop} />
      </ClientReaderContext.Provider>)
  }
  const nav = (html: string) => {
    const at = html.indexOf('aria-label="Client sections"')
    assert.notEqual(at, -1, 'the sections are drawn')
    return html.slice(at, html.indexOf('</nav>', at))
  }
  before(() => useMemberStore.setState({ currentMemberId: '' } as never))
  after(() => {
    signIn(null)
    rules({})
  })

  // react-dom/server reads each store as it started: no row written. The rows themselves are asked under real React below.
  it('a reader it is offered to (the master) is drawn the tab and its section; Appointments stays', () => {
    const html = screen(MASTER, {}, 'transportation', reader('master', true))
    assert.ok(nav(html).includes('data-tab="transportation"') && nav(html).includes('data-tab="appointments"'))
    assert.ok(html.includes('data-section="transportation"') && html.includes('data-transport="history"'))
  })

  it('before the row is written a director is drawn no Transportation, and no section for an address that names it', () => {
    const html = screen(STAFF_COLUMNS.DIRECTOR, {}, 'transportation')
    assert.ok(!nav(html).includes('data-tab="transportation"'))
    assert.ok(nav(html).includes('data-tab="appointments"'), 'Appointments is not touched')
    assert.ok(!html.includes('data-transport='), 'the section is not mounted')
    assert.ok(nav(screen(STAFF_COLUMNS.DIRECTOR, {}, 'appointments')).includes('aria-current="page" data-tab="appointments"'))
  })

  it('a holder of the edition is drawn it with no row written', () => {
    const holder = screen(STAFF_COLUMNS.DSP, {}, 'profile', reader('all', false, [TRANSPORT_EDITION]))
    assert.ok(nav(holder).includes('data-tab="transportation"'))
  })

  it('useTransportOffered under real React answers as the screen does', () => {
    const asked = (who: Who, r: Record<string, string[]>, read: ClientReader) => {
      signIn(who)
      rules(r)
      const hook = mountHook(() => useTransportOffered(read), {})
      const got = hook.current
      hook.unmount()
      return got
    }
    assert.equal(asked(STAFF_COLUMNS['Team Lead'], RULES, reader('all')), true)
    assert.equal(asked(STAFF_COLUMNS['Team Lead'], {}, reader('all')), false)
    assert.equal(asked(FAMILY, RULES, reader('guardian')), false)
    assert.equal(asked(MASTER, {}, reader('master', true)), true)
  })
})
