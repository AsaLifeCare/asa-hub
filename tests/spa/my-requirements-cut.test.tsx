/**
 * MY PROFILE · My Requirements under its own App Control row (the operator's access sheet, 2026-10-29, row 4): open to
 * every staff badge, shut to SSA, Family and clients. My Details and My Docs stay as App Control has My Profile.
 *
 * The page carries the row (`feature`), so the one checker (isAllowedWith), the menus (allowedPages) and the route guard
 * refuse it; the rail asks it too (useRailPages, mounted by real React). The rows are the ones the operator writes
 * before the release; with none written the page is the master's alone, and the master is never narrowed.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import type { Role } from '@/auth/types'
import { useAuthStore } from '@/auth/useAuthStore'
import { isAllowedWith, selectAccessChecker } from '@/lib/appAccess'
import { allowedPages } from '@/lib/audience'
import { useBadgeAccessStore } from '@/lib/badgeAccess'
import { EDITION_BADGES } from '@/lib/editions'
import { APP_FEATURES, featureOf, useFeatureAllowed } from '@/lib/featureAccess'
import { SHELL_SHOWN, primeShellHides } from '@/lib/myWorkHides'
import { useMemberStore } from '@/stores/useMemberStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { useWorldStore } from '@/stores/useWorldStore'
import { appManifests } from '@/registry/apps'
import { MY_REQUIREMENTS_FEATURE, myProfileManifests } from '@/registry/apps-myprofile'
import { ProfileNav, useRailPages } from '@/pages/features/myprofile/MyProfilePage'
import { mountHook } from './react-host'

primeShellHides(SHELL_SHOWN)

const draw = (node: ReactNode) => renderToString(<MemoryRouter>{node}</MemoryRouter>).replace(/<!-- -->/g, '')

// the sheet's lead columns (Director, Platform Lead, Supervisor, Administrator, Admin): Admin and every badge above it,
// read off the order of access rather than spelled, so a badge that stands in for another is never copied here
const LEADS: string[] = EDITION_BADGES.slice(0, EDITION_BADGES.indexOf('ADMIN') + 1)
// the my-profile row as it stands (the FIX BADGES sheet, 10-30: SSA and FAMILY are named, there is no GUARDIAN), and the
// My Requirements row the operator writes: every staff badge, no SSA, FAMILY or CLIENT
const STAFF_ROW = [...LEADS, 'ENTITY', 'MANAGER', 'TEAMLEAD', 'HM', 'INTERVIEWER', 'STAFF', 'ONBOARDING']
const APP_ROW = [...STAFF_ROW, 'CLIENT', 'FAMILY', 'SSA']
const REQS_ROW = STAFF_ROW
const RELEASED = { 'my-profile': APP_ROW, [MY_REQUIREMENTS_FEATURE]: REQS_ROW }
const UNRELEASED = { 'my-profile': APP_ROW }

type Who = { role: Role; types: string[]; isMaster?: boolean }
const MASTER: Who = { role: 'admin', types: [], isMaster: true }
// each sheet column as an account wears it
const STAFF_COLUMNS: Record<string, Who> = {
  ...Object.fromEntries(LEADS.map((b) => [b, { role: 'admin' as Role, types: [b] }])),
  'House Manager': { role: 'staff', types: ['HM', 'STAFF', 'INTERVIEWER'] },
  'House Manager on the manager role': { role: 'manager', types: ['INTERVIEWER', 'HM'] },
  'Team Lead': { role: 'staff', types: ['TEAMLEAD'] },
  DSP: { role: 'staff', types: ['STAFF'] },
}
// the sheet's SSA column: the guardian the client records name, on a client-role account linked to its ward, or on
// role staff with no client link; its FAMILY column: the SSA they name, an external account created on role staff
const SSA_WARD: Who = { role: 'client', types: ['SSA'] }
const SSA: Who = { role: 'staff', types: ['SSA'] }
const FAMILY: Who = { role: 'staff', types: ['FAMILY'] }
// a cell written before 10-30 says GUARDIAN, and reads FAMILY
const OLD_CELL: Who = { role: 'staff', types: ['GUARDIAN'] }
const CLIENT: Who = { role: 'client', types: [] }
const NARROWED: Record<string, Who> = {
  'SSA on its ward\'s account': SSA_WARD, SSA, FAMILY, 'an old GUARDIAN cell': OLD_CELL, client: CLIENT,
}

const signIn = (who: Who | null) =>
  useAuthStore.setState({ user: who ? { id: 'u1', name: 'Bea Lee', email: 'bea@example.org', isMaster: false, ...who } : null } as never)
const rules = (r: Record<string, string[]>) => useBadgeAccessStore.setState({ rules: r, tenantRules: {}, configRules: {} } as never)
const opens = (who: Who, r: Record<string, string[]>, page: string) => {
  signIn(who)
  rules(r)
  return isAllowedWith(appManifests, who.role, 'my-profile', page)
}

before(() => {
  useTenantStore.setState({ currentTenantId: 'hq', homeTenantId: 'hq', tenantsLoaded: true })
  useWorldStore.setState({ currentWorldId: '' })
  useMemberStore.setState({ currentMemberId: '' } as never)
})
after(() => {
  rules({})
  signIn(null)
})

describe('My Requirements is its own row', () => {
  it('the page carries the row the server asks, listed under My Profile, the master\'s until released', () => {
    const page = myProfileManifests[0].pages.find((p) => p.id === 'requirements')
    assert.equal(page?.feature, 'my-profile.requirements')
    assert.equal(page?.gate, 'no-client', 'the client gate stays')
    assert.ok((APP_FEATURES['my-profile'] ?? []).some((f) => f.id === MY_REQUIREMENTS_FEATURE))
    assert.equal(featureOf(MY_REQUIREMENTS_FEATURE)?.masterUntilReleased, true)
    for (const id of ['details', 'docs']) {
      assert.equal(myProfileManifests[0].pages.find((p) => p.id === id)?.feature, undefined, `${id} is not split off`)
    }
  })

  it('every staff column opens it once the row is written; My Details opens beside it', () => {
    assert.ok(LEADS.length === 5 && ['DIRECTOR', 'ADMINISTRATOR', 'ADMIN'].every((b) => LEADS.includes(b)), 'the five leads')
    for (const [column, who] of Object.entries(STAFF_COLUMNS)) {
      assert.equal(opens(who, RELEASED, 'requirements'), true, column)
      assert.equal(opens(who, RELEASED, 'details'), true, `${column}: My Details`)
    }
  })

  it('SSA, Family and a client are refused it, and keep My Details', () => {
    for (const [column, who] of Object.entries(NARROWED)) {
      assert.equal(opens(who, RELEASED, 'requirements'), false, column)
      assert.equal(opens(who, RELEASED, 'details'), true, `${column}: My Details`)
    }
  })

  it('an SSA\'s or a FAMILY\'s role word never counts: a row naming only STAFF and CLIENT opens them nothing', () => {
    const roleWordsOnly = { 'my-profile': [...STAFF_ROW, 'CLIENT'], [MY_REQUIREMENTS_FEATURE]: [...REQS_ROW, 'CLIENT'] }
    for (const [column, who] of Object.entries({ 'SSA on its ward\'s account': SSA_WARD, SSA, FAMILY, 'an old GUARDIAN cell': OLD_CELL })) {
      assert.equal(opens(who, roleWordsOnly, 'details'), false, `${column}: My Details`)
      assert.equal(opens(who, roleWordsOnly, 'requirements'), false, column)
    }
    assert.equal(opens(CLIENT, roleWordsOnly, 'details'), true, 'a client is still opened by CLIENT')
    assert.equal(opens(STAFF_COLUMNS.DSP, roleWordsOnly, 'details'), true, 'a DSP is still opened by STAFF')
  })

  it('a badge the row does not name is refused it; the menus then list My Details and My Docs alone', () => {
    const dsp = STAFF_COLUMNS.DSP
    assert.equal(opens(dsp, { ...RELEASED, [MY_REQUIREMENTS_FEATURE]: ['DIRECTOR'] }, 'requirements'), false)
    const listed = allowedPages(myProfileManifests[0], 'staff', selectAccessChecker(appManifests, 'staff')).map((p) => p.id)
    assert.deepEqual(listed, ['details', 'docs'])
  })

  it('before the row is written it is the master\'s alone; the master is never narrowed', () => {
    assert.equal(opens(STAFF_COLUMNS.DIRECTOR, UNRELEASED, 'requirements'), false)
    assert.equal(opens(STAFF_COLUMNS.DIRECTOR, UNRELEASED, 'details'), true)
    assert.equal(opens(MASTER, {}, 'requirements'), true)
    assert.equal(opens(MASTER, { ...RELEASED, [MY_REQUIREMENTS_FEATURE]: ['DIRECTOR'] }, 'requirements'), true)
  })
})

describe('the rail', () => {
  // asked under real React (react-dom/server reads each store as it started, before anyone signed in)
  const rail = (who: Who, r: Record<string, string[]>) => {
    signIn(who)
    rules(r)
    const hook = mountHook(() => useRailPages(), {})
    const got = hook.current.map((p) => p.id)
    hook.unmount()
    return got
  }

  it('offers My Requirements to whom the row names, and never to a badge it does not', () => {
    assert.deepEqual(rail(STAFF_COLUMNS['Team Lead'], RELEASED), ['details', 'requirements', 'docs'])
    assert.deepEqual(rail(STAFF_COLUMNS.DSP, UNRELEASED), ['details', 'docs'], 'not offered before the row is written')
    assert.deepEqual(rail(STAFF_COLUMNS.DSP, { ...RELEASED, [MY_REQUIREMENTS_FEATURE]: ['DIRECTOR'] }), ['details', 'docs'])
    assert.deepEqual(rail(FAMILY, RELEASED), ['details'], 'a family member: My Details alone, as before')
    assert.deepEqual(rail(SSA, RELEASED), ['details'], 'an SSA: My Details alone')
    assert.deepEqual(rail(SSA_WARD, RELEASED), ['details'], 'an SSA on its ward\'s account: My Details alone')
    assert.deepEqual(rail(MASTER, {}), ['details', 'requirements', 'docs'], 'the master always')
  })

  it('the rail draws what it offers, in order, the open page marked', () => {
    const html = draw(<ProfileNav page="requirements" person="" />)
    const order = ['My Details', 'My Requirements', 'My Docs'].map((t) => html.indexOf(t))
    assert.ok(order.every((i, n) => i > -1 && (n === 0 || i > order[n - 1])), 'nobody known yet: every page, as before')
    assert.match(html, /aria-current="page" class="[^"]*" href="\/app\/my-profile\/requirements"/)
  })

  it('useFeatureAllowed under real React answers as the rail does', () => {
    const asked = (who: Who, r: Record<string, string[]>) => {
      signIn(who)
      rules(r)
      const hook = mountHook(() => useFeatureAllowed(MY_REQUIREMENTS_FEATURE), {})
      const got = hook.current
      hook.unmount()
      return got
    }
    assert.equal(asked(STAFF_COLUMNS['House Manager'], RELEASED), true)
    assert.equal(asked(STAFF_COLUMNS['House Manager'], UNRELEASED), false)
    assert.equal(asked(FAMILY, RELEASED), false)
    assert.equal(asked(SSA, RELEASED), false)
    assert.equal(asked(SSA_WARD, RELEASED), false)
    assert.equal(asked(MASTER, {}), true)
  })
})
