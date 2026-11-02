/**
 * SETTINGS > MY WORK, THE SSA PARTS: each switch on leaves its part of the SSA overview out for every session but the
 * master's own, which still draws it with a line naming what is hidden; off — or an answer with no display — draws
 * everything. The county goes from the whole app — Share and the switcher too. The four switches sit under an SSA
 * heading in the Settings section and ship on.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { ReadStamp, UpdatedStamp } from '@/components/FreshnessStamp'
import { stampsHiddenFor } from '@/lib/stamps'
import { OverviewView } from '@/pages/features/ssaprofiles/sections/Overview'
import { NotesView } from '@/pages/features/ssaprofiles/sections/Notes'
import { SwitcherList } from '@/pages/features/ssaprofiles/SsaSwitcher'
import {
  SSA_SHOWN, clientLine, countyAgency, notesOf, overviewOf, rosterLine, sharePayloadFor, ssaCountyHidden, ssaForUsersLine,
  ssaHiddenFor, ssaHiddenOf, switcherSsas, type RosterRow, type SsaHidden, type SsaNotes, type SsaOverview,
} from '@/pages/features/ssaprofiles/ssaModel'
import type { ReadState } from '@/pages/features/ssaprofiles/useSsaRead'
import { MyWorkDisplayBody } from '@/pages/settings/MyWorkDisplaySection'
import { MY_WORK_SWITCHES, SSA_LANDS, STAMPS_LANDS, SWITCHES_OFF, SWITCH_GROUPS } from '@/pages/settings/myWorkDisplay'

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))
const noop = () => {}

const KEY = 'ssa_denisealvarez'
const ROW: RosterRow = { key: KEY, name: 'Denise Alvarez', phone: '(330) 555-0102', email: 'denise.alvarez@starkdd.org',
  agency: 'Stark County Board of DD', county: 'FRAN', clients: 1, status: 'active', avatar: '' }
const ANSWER = {
  ssa: { key: KEY, name: 'Denise Alvarez', phone: '(330) 555-0102', email: 'denise.alvarez@starkdd.org',
    agency: 'Stark County Board of DD', county: 'FRAN', office_address: '', avatar: '', status: 'active' },
  clients: [{ client_key: 'annettekowal', name: 'Annette Kowal', house: 'ABD4708', house_label: '47TH - ABD4708',
    avatar: '', status: 'active' }],
  why: [], degraded: false,
}
const NOTES = { notes: [{ id: 'SSAN_1', at: '2026-09-28T14:00:00Z', by: 'Boss', body: 'Met at the ISP review.' }] }

const HIDE_ALL: SsaHidden = { updated: true, county: true, count: true, role: true }
const PARTS = Object.keys(SSA_SHOWN) as (keyof SsaHidden)[]

/** The answers as SsaProfiles.gs sends them: with display.hidden when the switches were read, without when not. */
const withDisplay = <T extends object>(answer: T, hidden: Partial<SsaHidden> | null) =>
  (hidden ? { ...answer, display: { hidden: { ...SSA_SHOWN, ...hidden } } } : answer)

const recently = () => new Date(Date.now() - 5 * 60_000).toISOString()
const ready = <T,>(data: T): ReadState<T> => ({ status: 'ready', data, error: '', refreshing: false, updatedAt: recently() })

function screen(hidden: Partial<SsaHidden> | null, master: boolean, notesHidden: Partial<SsaHidden> | null = hidden) {
  const overview = ready<SsaOverview>(overviewOf(withDisplay(ANSWER, hidden)))
  const notes = ready<SsaNotes>(notesOf(withDisplay(NOTES, notesHidden)))
  // the Overview and the Notes tab, each with its own Updated stamp
  return draw(<><OverviewView row={ROW} overview={overview} master={master} onRetryOverview={noop} />
    <NotesView row={ROW} notes={notes} write={master} master={master} onRetry={noop} /></>)
}

/** Which of the four parts a drawn overview shows. */
function partsIn(html: string): Record<keyof SsaHidden, boolean> {
  const stamps = (html.match(/data-read="updated"/g) ?? []).length
  assert.ok(stamps === 0 || stamps === 2, `the two stamps go together (${stamps})`)
  return {
    updated: stamps === 2 && html.includes('Updated 5 min ago'),
    county: html.includes('FRAN County · Stark County Board of DD'),
    count: html.includes('1 client whose record names this SSA.'),
    role: html.includes('Service and Support Administrator · 47TH - ABD4708'),
  }
}

const EVERY = { updated: true, county: true, count: true, role: true }

describe('the SSA parts Settings › My Work hides', () => {
  // the every-app stamps switch off, so only the SSA answer's own display decides here
  before(() => useAuthStore.setState({ user: { id: 'u1', role: 'staff', stampsHidden: false } } as never))
  after(() => useAuthStore.setState({ user: null } as never))

  it('off, or an answer that carries no display: every part is drawn for everyone', () => {
    for (const hidden of [null, {}, { ...SSA_SHOWN }]) {
      for (const master of [false, true]) {
        const html = screen(hidden, master)
        assert.deepEqual(partsIn(html), EVERY, `hidden=${JSON.stringify(hidden)} master=${master}`)
        assert.ok(html.includes('Stark County Board of DD') && html.includes('47TH - ABD4708'))
        assert.ok(!html.includes('data-for-users'), 'nothing is hidden, so no line')
      }
    }
  })

  for (const part of PARTS) {
    it(`${part} on: absent for a session that is not the master, present for the master's own`, () => {
      const other = screen({ [part]: true }, false)
      assert.deepEqual(partsIn(other), { ...EVERY, [part]: false }, 'only its own part goes')
      assert.ok(!other.includes('data-for-users'), 'nobody else is told what is hidden')
      const own = screen({ [part]: true }, true)
      assert.deepEqual(partsIn(own), EVERY, 'the master sees everything')
      assert.ok(own.includes('data-for-users') && own.includes('Hidden from everyone else by Settings › My Work:'), own)
    })
  }

  it('all four on: the agency alone, the house alone, no count line, no stamp — the clients and notes stay', () => {
    const html = screen(HIDE_ALL, false)
    assert.deepEqual(partsIn(html), { updated: false, county: false, count: false, role: false })
    assert.ok(html.includes('Stark County Board of DD') && !html.includes('FRAN'))
    assert.ok(html.includes('>47TH - ABD4708<') && !html.includes('Service and Support Administrator'))
    assert.ok(html.includes('Annette Kowal') && html.includes('Met at the ISP review.'))
    assert.ok(!html.includes('whose record names this SSA'))
    assert.equal(ssaForUsersLine(true, HIDE_ALL), 'Hidden from everyone else by Settings › My Work: the Updated stamps, ' +
      'the county before the agency, the clients count and the role on each client. You see everything.')
    assert.ok(screen(HIDE_ALL, true).includes(ssaForUsersLine(true, HIDE_ALL)))
  })

  it('the stamp is one switch; each card hides its own as its answer says, never for the master', () => {
    const stamps = (html: string) => (html.match(/data-read="updated"/g) ?? []).length
    assert.equal(stamps(screen({ updated: true }, false, null)), 1, 'the overview hides its own')
    assert.equal(stamps(screen(null, false, { updated: true })), 1, 'the notes hide their own')
    assert.equal(stamps(screen({ updated: true }, false)), 0, 'both answers saying so hide both')
    assert.equal(stamps(screen(null, true, { updated: true })), 2, 'never for the master')
  })

  it('before the overview lands a non-master\'s county waits — its switch ships on — and the master\'s does not', () => {
    const loading: ReadState<SsaOverview> = { status: 'loading', data: null, error: '', refreshing: false }
    const view = (master: boolean) => draw(<OverviewView row={ROW} overview={loading} master={master} onRetryOverview={noop} />)
    assert.ok(view(false).includes('Stark County Board of DD') && !view(false).includes('FRAN'))
    assert.ok(view(true).includes('FRAN County · Stark County Board of DD'))
  })

  it('reads the answer the way the backend writes it: only a plain true hides, no display hides nothing', () => {
    assert.equal(ssaHiddenOf(ANSWER), null)
    assert.equal(ssaHiddenOf({ display: {} }), null)
    assert.equal(ssaHiddenOf(null), null)
    assert.deepEqual(ssaHiddenOf({ display: { hidden: { updated: 'yes', county: 1, count: true, role: null } } }),
      { ...SSA_SHOWN, count: true })
    assert.deepEqual(overviewOf(withDisplay(ANSWER, { role: true })).hidden, { ...SSA_SHOWN, role: true })
    assert.deepEqual(notesOf(withDisplay(NOTES, { updated: true })).hidden, { ...SSA_SHOWN, updated: true })
    assert.deepEqual(ssaHiddenFor(true, HIDE_ALL), SSA_SHOWN)
    assert.deepEqual(ssaHiddenFor(false, null), SSA_SHOWN)
    assert.deepEqual(ssaHiddenFor(false, HIDE_ALL), HIDE_ALL)
    assert.equal(ssaForUsersLine(false, HIDE_ALL), '')
    assert.equal(ssaForUsersLine(true, SSA_SHOWN), '')
    assert.equal(countyAgency({ county: 'FRAN', agency: 'Stark County Board of DD' }), 'FRAN County · Stark County Board of DD')
    assert.equal(countyAgency({ county: 'FRAN', agency: 'Stark County Board of DD' }, true), 'Stark County Board of DD')
    assert.equal(countyAgency({ county: 'FRAN', agency: '' }, true), '')
    assert.equal(clientLine({ house: 'ABD4708', house_label: '47TH - ABD4708' }),
      'Service and Support Administrator · 47TH - ABD4708')
    assert.equal(clientLine({ house: 'ABD4708', house_label: '47TH - ABD4708' }, true), '47TH - ABD4708')
    assert.equal(clientLine({ house: '', house_label: '' }, true), '')
  })
})

describe('the county switch reaches the whole SSA app', () => {
  const COUNTY_ONLY: RosterRow = { ...ROW, key: 'ssa_samsupport', name: 'Sam Support', agency: '', county: 'Summit',
    email: 'sam.support@gmail.com' }
  const overviewSaying = (hidden: Partial<SsaHidden> | null) => overviewOf(withDisplay(ANSWER, hidden))
  const inactive = { on: false, reading: false, why: '' }
  const list = (hideCounty: boolean, query = '') => draw(<SwitcherList ssas={[ROW, COUNTY_ONLY]} current={KEY} query={query}
    onQuery={noop} inactive={inactive} onInactive={noop} onPick={noop} hideCounty={hideCounty} />)

  it('one answer for the session: the switch for everyone else, never for the master, and waiting before the overview', () => {
    assert.equal(ssaCountyHidden(false, overviewSaying({ county: true })), true)
    assert.equal(ssaCountyHidden(true, overviewSaying({ county: true })), false)
    assert.equal(ssaCountyHidden(false, overviewSaying({ county: false })), false)
    assert.equal(ssaCountyHidden(false, overviewSaying(null)), false, 'an answer with no display hides nothing')
    assert.equal(ssaCountyHidden(false, null), true, 'before the overview lands')
    assert.equal(ssaCountyHidden(true, null), false)
  })

  it('Share drops its County line when hidden and keeps the agency', () => {
    assert.match(sharePayloadFor(ROW, 'overview').text ?? '', /^County: FRAN$/m)
    const hidden = sharePayloadFor(ROW, 'overview', true).text ?? ''
    assert.ok(!/County:|FRAN/.test(hidden), hidden)
    assert.match(hidden, /^Agency: Stark County Board of DD$/m)
    assert.match(hidden, /^Status: Active$/m)
    assert.equal(sharePayloadFor(COUNTY_ONLY, 'overview', true).text, 'Status: Active')
  })

  it('the switcher neither draws nor searches the county when hidden', () => {
    assert.equal(rosterLine(COUNTY_ONLY), 'Summit')
    assert.equal(rosterLine(COUNTY_ONLY, true), '')
    assert.equal(rosterLine(ROW, true), 'Stark County Board of DD')
    assert.deepEqual(switcherSsas([ROW, COUNTY_ONLY], 'summit', false).map((r) => r.key), [COUNTY_ONLY.key])
    assert.deepEqual(switcherSsas([ROW, COUNTY_ONLY], 'summit', false, true), [])
    assert.deepEqual(switcherSsas([ROW, COUNTY_ONLY], 'sam', false, true).map((r) => r.key), [COUNTY_ONLY.key])
    assert.ok(list(false).includes('>Summit<'))
    const shut = list(true)
    assert.ok(shut.includes('Sam Support') && !shut.includes('Summit'), shut)
    assert.ok(list(true, 'summit').includes('No SSA matches.'))
  })

  it('the page hands the session\'s answer to Share and to the switcher', () => {
    const src = readFileSync(resolve(ROOT, 'src/pages/features/ssaprofiles/SsaProfilesPage.tsx'), 'utf8')
    assert.ok(src.includes('const hideCounty = ssaCountyHidden(master, overview.data)'))
    // the row a share carries may take the agency the overview reads; the county rule rides it either way
    assert.match(src, /sharePayloadFor\((row|ownAgency \? \{ \.\.\.row, agency: ownAgency \} : row), tab, hideCounty\)/)
    assert.ok(src.includes('hideCounty={ssaCountyHidden(master, overview)}'))
    const sw = readFileSync(resolve(ROOT, 'src/pages/features/ssaprofiles/SsaSwitcher.tsx'), 'utf8')
    assert.ok(sw.includes('rosterLine(r, hideCounty)') && sw.includes('switcherSsas(ssas, query, inactive.on, hideCounty)'))
  })

  it('no other SSA file draws the county', () => {
    const dir = resolve(ROOT, 'src/pages/features/ssaprofiles')
    const files = ['SsaActions.tsx', 'SsaForms.tsx', 'SsaPanel.tsx', 'SsaParts.tsx', 'sections/Activity.tsx', 'sections/Documents.tsx']
    for (const f of files) assert.doesNotMatch(readFileSync(resolve(dir, f), 'utf8'), /\.county\b/, f)
  })
})

describe('the Settings section', () => {
  const SSA_KEYS = ['mywork_hide_ssa_updated', 'mywork_hide_ssa_county', 'mywork_hide_ssa_count', 'mywork_hide_ssa_role']

  it('groups the three SSA switches under an SSA heading; the stamps switch sits with My Work\'s, for every app', () => {
    assert.deepEqual(SWITCH_GROUPS.map((g) => g.heading), ['', 'SSA', 'Scheduling', 'Staff', 'Clients', 'Families & Guardians'])
    assert.deepEqual(SWITCH_GROUPS[1].switches.map((s) => s.key), SSA_KEYS.slice(1))
    assert.ok(SWITCH_GROUPS[1].switches.every((s) => s.page === 'SSA'))
    assert.ok(SWITCH_GROUPS[0].switches.every((s) => s.page !== 'SSA'))
    assert.equal(SWITCH_GROUPS.flatMap((g) => g.switches).length, MY_WORK_SWITCHES.length)
    const stamps = MY_WORK_SWITCHES.find((s) => s.part === 'ssa_updated')
    assert.deepEqual([stamps?.key, stamps?.label, stamps?.page],
      ['mywork_hide_ssa_updated', 'Updated stamps — every app', 'Every app'], 'the old key, so the saved value carries over')
    const html = flat(renderToString(<MyWorkDisplayBody hidden={{ ...SWITCHES_OFF, ssa_county: true, ssa_role: true }}
      known={MY_WORK_SWITCHES.map((s) => s.part)} catalogue={null} busy={false} onFlip={noop} />))
    const heading = html.indexOf('>SSA</h3>')
    assert.ok(heading > html.indexOf('Updated stamps — every app') && heading < html.indexOf('SSA · County before the agency'), html)
    assert.match(html, /data-switch-group="SSA"/)
    assert.match(html, /data-part="ssa_county">Hidden from everyone else</)
    assert.match(html, /data-part="ssa_role">Hidden from everyone else</)
    assert.match(html, /data-part="ssa_updated">Shown to everyone</)
    assert.equal((html.match(/role="switch"/g) ?? []).length, MY_WORK_SWITCHES.length)
  })

  it('a backend that does not know the SSA keys yet offers the others, and says so of the four', () => {
    const others = MY_WORK_SWITCHES.filter((s) => !s.key.startsWith('mywork_hide_ssa_') && s.page !== 'Scheduling')
      .map((s) => s.part)
    const html = flat(renderToString(<MyWorkDisplayBody hidden={SWITCHES_OFF} known={others} catalogue={null} busy={false}
      onFlip={noop} />))
    assert.equal((html.match(/role="switch"/g) ?? []).length, others.length)
    for (const p of ['ssa_updated', 'ssa_county', 'ssa_count', 'ssa_role']) assert.match(html, new RegExp(`data-not-known="${p}"`))
  })

  it('the four ship on, in the catalogue the backend falls back to and in the one the migration writes', () => {
    const shipped = readFileSync(resolve(ROOT, 'apps-script/AlertsCatalog.gs'), 'utf8')
    const migration = JSON.parse(readFileSync(resolve(ROOT, 'tools/hiring-alerts-catalogue.json'), 'utf8')) as
      { key: string; group: string; default_value: string }[]
    for (const key of SSA_KEYS) {
      assert.ok(shipped.includes(`{"key":"${key}","group":"mywork","value":"yes"}`), key)
      assert.deepEqual(migration.filter((r) => r.key === key).map((r) => [r.group, r.default_value]), [['mywork', 'yes']], key)
    }
  })

  it('a save says when SSA follows, not the three minutes of the relay\'s doors', () => {
    const src = readFileSync(resolve(ROOT, 'src/pages/settings/MyWorkDisplaySection.tsx'), 'utf8')
    assert.ok(src.includes("sw.page === 'SSA' ? SSA_LANDS"))
    assert.ok(SSA_LANDS.startsWith('Everyone else sees it in SSA'))
  })
})

describe('the stamps switch, every app', () => {
  const as = (user: object | null) => useAuthStore.setState({ user } as never)
  const stamps = () => draw(<><UpdatedStamp at={new Date(Date.now() - 5 * 60_000).toISOString()} /><ReadStamp at={Date.now()} /></>)
  after(() => as(null))

  it('hides from every session but the master\'s own; absent reads as on, as the switch ships', () => {
    assert.equal(stampsHiddenFor(true, false), true)
    assert.equal(stampsHiddenFor(undefined, false), true)
    assert.equal(stampsHiddenFor(false, false), false)
    assert.equal(stampsHiddenFor(true, true), false)
  })

  it('the shared Updated and Read stamps obey it: gone for a staff session, drawn for the master and when off', () => {
    as({ id: 'u1', role: 'staff', stampsHidden: true })
    assert.ok(!/data-read="updated"|data-stamp="read"/.test(stamps()), 'a staff session sees no stamp')
    as({ id: 'u1', role: 'staff' })
    assert.ok(!/data-read="updated"|data-stamp="read"/.test(stamps()), 'an older backend hides too')
    as({ id: 'm1', role: 'admin', isMaster: true, stampsHidden: true })
    const own = stamps()
    assert.ok(own.includes('Updated 5 min ago') && own.includes('data-stamp="read"'), own)
    as({ id: 'u1', role: 'staff', stampsHidden: false })
    assert.ok(stamps().includes('Updated 5 min ago'), 'off: everyone sees it')
  })

  it('every app draws its stamps through the shared place, and a save says when it lands', () => {
    const dir = resolve(ROOT, 'src/pages/features')
    for (const f of ['clientprofiles/ClientParts.tsx', 'clientcandidates/CandidateParts.tsx', 'familyprofiles/FamilyParts.tsx',
      'ssaprofiles/SsaParts.tsx', 'locations/LocationParts.tsx', 'staffcandidates/CandidateParts.tsx']) {
      const src = readFileSync(resolve(dir, f), 'utf8')
      assert.ok(src.includes('<UpdatedStamp') && !src.includes('Updated {age}'), f)
    }
    for (const f of ['myprofile/MyProfilePage.tsx', 'mycalendar/MyCalendarPage.tsx', 'mycalendar/FamilyWeek.tsx',
      'myinbox/AlertsView.tsx']) assert.ok(readFileSync(resolve(dir, f), 'utf8').includes('<ReadStamp'), f)
    for (const f of ['mywork/MyWorkPage.tsx', 'mywork/FamilyWork.tsx']) {
      assert.ok(readFileSync(resolve(dir, f), 'utf8').includes('state.readAt && !stampsHidden'), f)
    }
    assert.match(readFileSync(resolve(ROOT, 'src/pages/settings/MyWorkDisplaySection.tsx'), 'utf8'),
      /sw\.page === 'Every app'[^?]*\? STAMPS_LANDS/)
    assert.match(STAMPS_LANDS, /next time their Hub opens/)
    const auth = readFileSync(resolve(ROOT, 'apps-script/Auth.gs'), 'utf8')
    assert.equal((auth.match(/stamps_hidden = hubStampsHidden_\(\)/g) ?? []).length, 2, 'authMe and authLogin carry it')
  })
})
