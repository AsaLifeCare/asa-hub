/**
 * THE FAMILY/SSA-WEARER RULE — a family or SSA account is matched on its badges alone.
 *
 * The operator's access sheet (2026-10-29) shuts the Family column on My Inbox › Chat, Locations, Staff, Emergency
 * Contacts, Scheduling and Transportation, where DSP (STAFF) is open. Accounts wearing a family badge on role `staff`
 * had the role word counted as a badge, so every one of those rows opened to them through STAFF.
 *
 * His FIX BADGES sheet (2026-10-30) names the two columns SSA and FAMILY, and there is no GUARDIAN badge: an old
 * GUARDIAN cell is worn as FAMILY (scope.BADGE_RENAMED; appBadgeAccessGet reads a row's GUARDIAN as FAMILY too). The
 * SSA is the person the client records name as guardian — on role `staff` (a professional guardian of several clients)
 * or on role `client` (an account linked to its one ward); FAMILY is the person they name as SSA, on role `staff`. The
 * two columns are identical except that SSA opens the SSA app and never Families & Guardians, and FAMILY the reverse.
 * An account whose ticked badges include SSA or FAMILY is never matched on its role word — staff or client — and is
 * never DSP through it; the master is never narrowed.
 *
 * Asserted against the real checkers, `badgeAllowsApp` (the apps) and `badgeRuleAllows` (the Settings sections),
 * over the rows as App Control holds them.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { badgeAllowsApp, badgeRuleAllows, roleWordCounts, wornTypes } from '@/lib/badgeAccess'

const words = (cell: string) => cell.split(',').map((w) => w.trim())

// App Control’s rows as the app reads them (the sheet’s Family ‘o’ rows, and three naming the Family column — read
// FAMILY since 10-30), less the two badges that stand in for DIRECTOR; My Work opens to SSA as well, and the two apps
// the FIX BADGES sheet splits between the columns: the SSA app to SSA alone, Families & Guardians to FAMILY alone
const rules: Record<string, string[]> = {
  'emergency-contacts': words('DIRECTOR, TEAMLEAD, ADMINISTRATOR, ADMIN, ENTITY, MANAGER, HM, STAFF'),
  'my-inbox.liveChat': words('DIRECTOR, TEAMLEAD, ADMINISTRATOR, ADMIN, ENTITY, MANAGER, HM, INTERVIEWER, STAFF, ONBOARDING'),
  locations: words('DIRECTOR, ADMIN, ADMINISTRATOR, HM, TEAMLEAD, STAFF, INTERVIEWER, MANAGER, ENTITY'),
  'staff-profiles': words('DIRECTOR, ADMIN, ADMINISTRATOR, HM, TEAMLEAD, STAFF'),
  scheduling: words('STAFF, INTERVIEWER, HM, DIRECTOR, MANAGER, ENTITY, ADMIN, ADMINISTRATOR, TEAMLEAD'),
  transportation: words('DIRECTOR, ADMINISTRATOR, ADMIN, ENTITY, MANAGER, HM'),
  'vehicle-calendar': words('DIRECTOR, ADMIN, ADMINISTRATOR, HM, TEAMLEAD, STAFF, ENTITY'),
  chat: words('DIRECTOR, FAMILY, ADMINISTRATOR, ADMIN, ENTITY, MANAGER, HM, STAFF, CLIENT, TEAMLEAD'),
  'my-work': words('DIRECTOR, TEAMLEAD, ADMINISTRATOR, ONBOARDING, FAMILY, SSA, ADMIN, ENTITY, STAFF, INTERVIEWER, HM, MANAGER, CLIENT'),
  'house-repair': words('DIRECTOR, ADMINISTRATOR, ADMIN, ENTITY, MANAGER, HM, STAFF, CLIENT'),
  'ssa-profiles': words('DIRECTOR, ADMINISTRATOR, ADMIN, SSA'),
  'family-profiles': words('DIRECTOR, ADMINISTRATOR, ADMIN, FAMILY'),
}
const FAMILY_SHUT = ['emergency-contacts', 'my-inbox.liveChat', 'locations', 'staff-profiles', 'scheduling',
  'vehicle-calendar']

const familyOnStaff = { role: 'staff', types: ['FAMILY'] }
const ssaOnStaff = { role: 'staff', types: ['SSA'] }
const ssaOnClient = { role: 'client', types: ['SSA'] }
const dsp = { role: 'staff', types: ['STAFF'] }
const roleOnly = { role: 'staff', types: [] as string[] }

describe('a FAMILY worn on role staff', () => {
  it('opens none of the rows that name STAFF and not FAMILY', () => {
    for (const app of FAMILY_SHUT) {
      assert.equal(badgeAllowsApp(app, familyOnStaff, rules), false, app)
    }
    assert.equal(badgeAllowsApp('transportation', familyOnStaff, rules), false)
  })

  it('still opens every row that names FAMILY, by the badge it wears', () => {
    assert.equal(badgeAllowsApp('chat', familyOnStaff, rules), true)
    assert.equal(badgeAllowsApp('my-work', familyOnStaff, rules), true)
    assert.equal(badgeAllowsApp('family-profiles', familyOnStaff, rules), true)
    assert.equal(badgeAllowsApp('myasa', familyOnStaff, rules), true) // the floor, with no row
  })

  it('never opens the SSA app, the one row the SSA column holds alone', () => {
    assert.equal(badgeAllowsApp('ssa-profiles', familyOnStaff, rules), false)
  })

  it('is matched the same way by the Settings-section checker', () => {
    assert.equal(badgeRuleAllows(['STAFF'], familyOnStaff), false)
    assert.equal(badgeRuleAllows(['FAMILY'], familyOnStaff), true)
    assert.equal(badgeRuleAllows(['SSA'], familyOnStaff), false)
    assert.equal(badgeRuleAllows([], familyOnStaff), true) // no rule narrows nothing
  })

  it('keeps a STAFF tick a badge: only the role word stops counting', () => {
    const both = { role: 'staff', types: ['FAMILY', 'STAFF'] }
    for (const app of FAMILY_SHUT) assert.equal(badgeAllowsApp(app, both, rules), true, app)
  })

  it('is told case- and space-blind, as the ticks are read everywhere else', () => {
    assert.equal(roleWordCounts({ types: [' family '] }), false)
    assert.equal(badgeAllowsApp('emergency-contacts', { role: 'staff', types: ['family'] }, rules), false)
  })
})

describe('a GUARDIAN cell written before 10-30', () => {
  const legacy = { role: 'staff', types: ['GUARDIAN'] }

  it('is worn as FAMILY: there is no GUARDIAN badge', () => {
    assert.deepEqual(wornTypes(legacy), ['FAMILY'])
    assert.deepEqual(wornTypes({ types: [' guardian ', 'FAMILY'] }), ['FAMILY'])
    assert.equal(roleWordCounts({ types: [' guardian '] }), false)
  })

  it('opens what FAMILY opens, and nothing a DSP row alone names', () => {
    assert.equal(badgeAllowsApp('family-profiles', legacy, rules), true)
    assert.equal(badgeAllowsApp('my-work', legacy, rules), true)
    assert.equal(badgeAllowsApp('ssa-profiles', legacy, rules), false)
    for (const app of FAMILY_SHUT) assert.equal(badgeAllowsApp(app, legacy, rules), false, app)
    assert.equal(badgeRuleAllows(['FAMILY'], legacy), true)
    assert.equal(badgeRuleAllows(['STAFF'], legacy), false)
  })
})

describe('an SSA worn on role staff', () => {
  it('is never matched on its role word', () => {
    assert.equal(roleWordCounts(ssaOnStaff), false)
    for (const app of FAMILY_SHUT) assert.equal(badgeAllowsApp(app, ssaOnStaff, rules), false, app)
    assert.equal(badgeAllowsApp('transportation', ssaOnStaff, rules), false)
  })

  it('opens the SSA app and My Work, and never Families & Guardians', () => {
    assert.equal(badgeAllowsApp('ssa-profiles', ssaOnStaff, rules), true)
    assert.equal(badgeAllowsApp('my-work', ssaOnStaff, rules), true)
    assert.equal(badgeAllowsApp('family-profiles', ssaOnStaff, rules), false)
    assert.equal(badgeAllowsApp('myasa', ssaOnStaff, rules), true)
  })

  it('is matched the same way by the Settings-section checker', () => {
    assert.equal(badgeRuleAllows(['STAFF'], ssaOnStaff), false)
    assert.equal(badgeRuleAllows(['SSA'], ssaOnStaff), true)
    assert.equal(badgeRuleAllows(['FAMILY'], ssaOnStaff), false)
  })
})

describe('everyone else, as before', () => {
  it('a DSP opens the Family-shut rows by its STAFF badge', () => {
    for (const app of FAMILY_SHUT) assert.equal(badgeAllowsApp(app, dsp, rules), true, app)
  })

  it('a staff login with no badge ticked is still matched on its role word', () => {
    assert.equal(roleWordCounts(roleOnly), true)
    for (const app of FAMILY_SHUT) assert.equal(badgeAllowsApp(app, roleOnly, rules), true, app)
    assert.equal(badgeRuleAllows(['STAFF'], roleOnly), true)
  })

  it('the master is never narrowed, a FAMILY or SSA tick or none', () => {
    for (const types of [['FAMILY'], ['SSA'], ['GUARDIAN']]) {
      const master = { isMaster: true, role: 'admin', types }
      for (const app of [...FAMILY_SHUT, 'transportation', 'chat', 'ssa-profiles', 'family-profiles']) {
        assert.equal(badgeAllowsApp(app, master, rules), true, `${types[0]} ${app}`)
      }
      assert.equal(badgeRuleAllows(['STAFF'], master), true)
    }
  })
})

describe('an SSA worn on role client (an account linked to its one ward)', () => {
  it('is never matched on CLIENT, its role word, nor on anything a DSP row alone names', () => {
    assert.equal(roleWordCounts(ssaOnClient), false)
    assert.equal(badgeAllowsApp('house-repair', ssaOnClient, rules), false)
    assert.equal(badgeAllowsApp('chat', ssaOnClient, rules), false)
    assert.equal(badgeRuleAllows(['CLIENT'], ssaOnClient), false)
    for (const app of FAMILY_SHUT) assert.equal(badgeAllowsApp(app, ssaOnClient, rules), false, app)
  })

  it('opens what the SSA column opens, by the badge it wears', () => {
    assert.equal(badgeAllowsApp('my-work', ssaOnClient, rules), true)
    assert.equal(badgeAllowsApp('ssa-profiles', ssaOnClient, rules), true)
    assert.equal(badgeAllowsApp('family-profiles', ssaOnClient, rules), false)
    assert.equal(badgeRuleAllows(['SSA'], ssaOnClient), true)
  })

  it('leaves a client account with no SSA or FAMILY tick matched on its role word', () => {
    assert.equal(roleWordCounts({ role: 'client', types: [] }), true)
    assert.equal(badgeAllowsApp('house-repair', { role: 'client', types: [] }, rules), true)
    assert.equal(badgeAllowsApp('house-repair', { role: 'client', types: ['CLIENT'] }, rules), true)
  })
})
