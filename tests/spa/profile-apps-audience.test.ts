/**
 * THE SIX PROFILE APPS REACH A CLIENT-SIDE ACCOUNT THROUGH APP CONTROL ALONE — Clients, Locations, SSA, Families, Staff
 * and Staff Candidates. Their audience names 'client', so a client (CLIENT), an SSA (SSA: the guardian the client
 * records name, here a client-role account linked to its ward) or a family member (FAMILY: the person the records name
 * as SSA, on a staff-role account) the row releases an app to is drawn its tile and passes the route guard; the server
 * cuts what it reads. A cell written before 10-30 says GUARDIAN and reads FAMILY. No row stays the master's, a row
 * naming none of the account's badges keeps it out — an SSA's or a FAMILY's role word never counts as one — and a
 * person focus hides the tiles as before.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Role } from '@/auth/types'
import { useAuthStore } from '@/auth/useAuthStore'
import { isAllowedWith } from '@/lib/appAccess'
import { isManifestVisible, visibleManifests } from '@/lib/audience'
import { useBadgeAccessStore } from '@/lib/badgeAccess'
import { useMemberStore } from '@/stores/useMemberStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { useWorldStore } from '@/stores/useWorldStore'
import { appManifests } from '@/registry/apps'

const PROFILE_APPS = ['client-profiles', 'locations', 'ssa-profiles', 'family-profiles', 'staff-profiles', 'staff-candidates']
const JANE = { id: 'u-jane', name: 'Jane Doe', email: 'jane@example.invalid', role: 'client', types: ['CLIENT'], isMaster: false }
// the guardian a client record names, on a client-role account linked to that one ward: the FIX BADGES sheet's SSA
const MARY = { id: 'u-mary', name: 'Mary Doe', email: 'mary@example.invalid', role: 'client', types: ['SSA'], isMaster: false }
// the SSA a client record names, on a staff-role account with no client linked: the FIX BADGES sheet's FAMILY
const FRAN = { id: 'u-fran', name: 'Fran Roe', email: 'fran@example.invalid', role: 'staff', types: ['FAMILY'], isMaster: false }
// a FAMILY account whose cell was written before 10-30 (scope.BADGE_RENAMED)
const OLGA = { id: 'u-olga', name: 'Olga Roe', email: 'olga@example.invalid', role: 'staff', types: ['GUARDIAN'], isMaster: false }
const rules = (r: Record<string, string[]>) => useBadgeAccessStore.setState({ rules: r, tenantRules: {}, configRules: {} })
const signIn = (user: unknown) => useAuthStore.setState({ user } as never)
const every = (badges: string[]) => Object.fromEntries(PROFILE_APPS.map((id) => [id, badges]))
const allowed = (id: string, role: Role = 'client') => isAllowedWith(appManifests, role, id)

describe('the six profile apps and a client-side account', () => {
  before(() => {
    useTenantStore.setState({ currentTenantId: 'hq', homeTenantId: 'hq', tenantsLoaded: true })
    useWorldStore.setState({ currentWorldId: '' })
    useMemberStore.setState({ currentMemberId: '' } as never)
  })
  after(() => {
    rules({})
    signIn(null)
  })

  it('each names the client role and keeps every person focus hiding its tile', () => {
    for (const id of PROFILE_APPS) {
      const app = appManifests.find((m) => m.id === id)
      assert.ok(app, id)
      assert.equal(isManifestVisible(app, { role: 'client' }), true, id)
      for (const role of ['admin', 'manager', 'staff'] as const) assert.equal(isManifestVisible(app, { role }), true, id)
      assert.equal(isManifestVisible(app, { role: 'onboarding' }), false, id)
      for (const type of ['client', 'staff', 'house'] as const) {
        assert.equal(isManifestVisible(app, { role: 'admin', focus: { type, id: 'x', name: 'X' } }), false, `${id} ${type}`)
      }
    }
  })

  it('a client released by CLIENT, an SSA by SSA and a family member by FAMILY are drawn the tiles and pass the guard', () => {
    for (const [who, badge] of [[JANE, 'CLIENT'], [MARY, 'SSA'], [FRAN, 'FAMILY'], [OLGA, 'FAMILY']] as const) {
      const role = who.role as Role
      signIn(who)
      rules(every([badge, 'STAFF']))
      for (const id of PROFILE_APPS) assert.equal(allowed(id, role), true, `${who.name} by ${badge}: ${id}`)
      const tiles = visibleManifests(appManifests, { role }, (id) => allowed(id, role)).map((a) => a.id)
      assert.deepEqual(PROFILE_APPS.filter((id) => !tiles.includes(id)), [], `${who.name} by ${badge}`)
    }
  })

  it('no row, or a row naming none of its badges, keeps a client-side account out — an SSA or FAMILY role word included', () => {
    const others: [typeof JANE, string[]][] = [
      [JANE, ['SSA', 'FAMILY']],
      // the role word of an SSA or a FAMILY never counts: client on an SSA's account, staff on a FAMILY's
      [MARY, ['CLIENT', 'FAMILY']],
      [FRAN, ['STAFF', 'SSA']],
      [OLGA, ['STAFF', 'SSA']],
    ]
    for (const [who, other] of others) {
      const role = who.role as Role
      signIn(who)
      rules({})
      for (const id of PROFILE_APPS) assert.equal(allowed(id, role), false, `${who.name} with no row: ${id}`)
      rules(every(['STAFF', 'MANAGER']))
      for (const id of PROFILE_APPS) assert.equal(allowed(id, role), false, `${who.name} with STAFF only: ${id}`)
      rules(every(other))
      for (const id of PROFILE_APPS) assert.equal(allowed(id, role), false, `${who.name} with ${other.join('+')}: ${id}`)
    }
  })
})
