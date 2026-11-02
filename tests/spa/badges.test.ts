/**
 * THE TEAM LEAD BADGE — what it reaches, what it is called, and the one thing
 * it must never become.
 *
 * The rule was first stated as "a new BADGE, currently equivalent to the
 * director", and kept separate so it could be narrowed later without touching
 * the director. The later came (the operator's rule, 2026-10-29): a team lead
 * no longer counts as a director anywhere, and is drawn directly above a house
 * manager, whose column the operator's matrix gives it. The fold that remains
 * — SUPERVISOR and PLATFORMLEAD answered as DIRECTOR — is asserted beside it.
 *
 * Both are asserted here against the real access checkers — no copy of the
 * law, no mocked rule. `badgeRuleAllows` gates the Settings sections,
 * `badgeAllowsApp` gates the apps, and both read the same fold, so a change
 * that taught one and not the other has one place left to hide and this file
 * stands in it.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CALENDAR_BADGE_APPS, MASTER_ONLY_APPS, badgeAllowsApp, badgeLinkAllows, badgeRuleAllows, wornTypes } from '@/lib/badgeAccess'
import { pageGateAllows } from '@/lib/pageGate'
import { timeOffReach } from '@/lib/timeOffAccess'
import { effectiveUserFrom } from '@/lib/effectiveUser'
import { mapBackendUser } from '@/auth/useAuthStore'
import { BADGE_FOLLOWS, withFollowedBadges } from '@/lib/badgeFollows'
import { BADGE_ORDER, badgeWord } from '@/components/shared/RoleBadge'
import { EDITION_BADGES } from '@/lib/editions'
import { roleBadge } from '@/auth/types'
import { tourStepsFor } from '@/features/auth/tourSteps'
import { franchiseBadgeOf } from '@/pages/features/releaseusers/ReleaseUsersPage'

/** A plain staff login wearing exactly these badges. */
const wearing = (...types: string[]) => ({ role: 'staff', types })

const director = wearing('DIRECTOR')
const supervisor = wearing('SUPERVISOR')
const teamlead = wearing('TEAMLEAD')
const houseManager = wearing('HM')
const nobody = wearing()

describe('the equivalence, as it stands', () => {
  it('stands TEAMLEAD in for nobody, and keeps SUPERVISOR answered as DIRECTOR', () => {
    assert.equal(Object.prototype.hasOwnProperty.call(BADGE_FOLLOWS, 'TEAMLEAD'), false)
    assert.equal(BADGE_FOLLOWS.SUPERVISOR, 'DIRECTOR')
  })

  it('folds a worn badge into the one it currently stands in for — and a team lead into nothing', () => {
    assert.deepEqual(withFollowedBadges(['SUPERVISOR']), ['SUPERVISOR', 'DIRECTOR'])
    assert.deepEqual(withFollowedBadges(['TEAMLEAD']), ['TEAMLEAD'])
  })

  it('never loses a word, and never duplicates one', () => {
    assert.deepEqual(withFollowedBadges(['SUPERVISOR', 'DIRECTOR']), ['SUPERVISOR', 'DIRECTOR'])
    assert.deepEqual(withFollowedBadges(['TEAMLEAD', 'HM']), ['TEAMLEAD', 'HM'])
    assert.deepEqual(withFollowedBadges(['HM', 'STAFF']), ['HM', 'STAFF'])
    assert.deepEqual(withFollowedBadges([]), [])
  })

  it('goes one way only — a DIRECTOR becomes neither a supervisor nor a team lead', () => {
    assert.ok(!withFollowedBadges(['DIRECTOR']).includes('SUPERVISOR'))
    assert.ok(!withFollowedBadges(['DIRECTOR']).includes('TEAMLEAD'))
  })

  it('upper-cases, so a caller that forgets does not silently stop matching', () => {
    assert.deepEqual(withFollowedBadges(['supervisor']), ['SUPERVISOR', 'DIRECTOR'])
    assert.deepEqual(withFollowedBadges(['teamlead']), ['TEAMLEAD'])
  })
})

describe('the access matrix — a director\'s rows are not a team lead\'s', () => {
  /* A SETTINGS SECTION. These rules are the `config_badge_access` rows, and
     every one of them was written before TEAMLEAD existed. */
  it('a section rule naming DIRECTOR admits a supervisor and NOT a team lead', () => {
    assert.equal(badgeRuleAllows(['DIRECTOR'], director), true)
    assert.equal(badgeRuleAllows(['DIRECTOR'], supervisor), true)
    assert.equal(badgeRuleAllows(['DIRECTOR'], teamlead), false)
    assert.equal(badgeRuleAllows(['DIRECTOR'], houseManager), false)
  })

  /* AN APP. Same law, the other checker. */
  it('an app rule naming DIRECTOR admits a supervisor and NOT a team lead', () => {
    const rules = { leadership: ['DIRECTOR'] }
    assert.equal(badgeAllowsApp('leadership', director, rules), true)
    assert.equal(badgeAllowsApp('leadership', supervisor, rules), true)
    assert.equal(badgeAllowsApp('leadership', teamlead, rules), false)
    assert.equal(badgeAllowsApp('leadership', houseManager, rules), false)
  })

  it('a rule naming HM beside TEAMLEAD admits the team lead by its own word', () => {
    const rules = { shiftboard: ['TEAMLEAD', 'HM'] }
    assert.equal(badgeAllowsApp('shiftboard', teamlead, rules), true)
    assert.equal(badgeAllowsApp('shiftboard', houseManager, rules), true)
    assert.equal(badgeAllowsApp('shiftboard', director, rules), false)
  })

  it('wherever a director may NOT, neither may a team lead', () => {
    const rules = { payroll: ['ADMIN'] }
    assert.equal(badgeAllowsApp('payroll', director, rules), false)
    assert.equal(badgeAllowsApp('payroll', teamlead, rules), false)
    assert.equal(badgeRuleAllows(['ADMIN', 'HM'], director), false)
    assert.equal(badgeRuleAllows(['ADMIN', 'HM'], teamlead), false)
  })

  it('an app with no row is still nobody\'s but the master\'s', () => {
    assert.equal(badgeAllowsApp('brandnew', teamlead, {}), false)
    assert.equal(badgeAllowsApp('brandnew', { ...teamlead, isMaster: true }, {}), true)
  })

  it('the person\'s own denial still narrows it', () => {
    const rules = { leadership: ['DIRECTOR'] }
    const denied = { ...supervisor, appDenials: ['leadership'] }
    assert.equal(badgeAllowsApp('leadership', denied, rules), false)
  })

  it('a badge nobody wears opens nothing', () => {
    assert.equal(badgeAllowsApp('leadership', nobody, { leadership: ['DIRECTOR'] }), false)
  })
})

describe('the user-menu links, which had their own copy of the law', () => {
  /* Topbar filtered these by hand against `types` alone: no master pass and
     no equivalence. It calls badgeLinkAllows now, which adds those two AND
     NOTHING ELSE — the last four cases are the guard on that "nothing else". */
  const link = ['DIRECTOR']
  it('a link given to DIRECTOR is seen by a supervisor and NOT by a team lead', () => {
    assert.equal(badgeLinkAllows(link, supervisor), true)
    assert.equal(badgeLinkAllows(link, teamlead), false)
    assert.equal(badgeLinkAllows(link, houseManager), false)
  })
  it('an empty badge list is still everyone', () => {
    assert.equal(badgeLinkAllows([], wearing('HM')), true)
    assert.equal(badgeLinkAllows(undefined, null), true)
  })
  it('the master sees every link, whatever it names', () => {
    assert.equal(badgeLinkAllows(['ADMIN'], { ...houseManager, isMaster: true }), true)
  })

  // the role is not a badge for links: folding it in would hand every caregiver the STAFF-scoped links
  it('a link scoped to STAFF is NOT handed to every account whose ROLE is staff', () => {
    assert.equal(badgeLinkAllows(['STAFF'], { role: 'staff', types: [] }), false)
    assert.equal(badgeLinkAllows(['STAFF'], { role: 'staff', types: ['STAFF'] }), true)
  })
  it('nor to a manager, an admin, a client or an interviewer by role alone', () => {
    for (const word of ['MANAGER', 'ADMIN', 'CLIENT', 'ONBOARDING', 'INTERVIEWER']) {
      assert.equal(badgeLinkAllows([word], { role: word.toLowerCase(), types: [] }), false,
                   `${word} as a role alone must not open a link scoped to the ${word} badge`)
    }
  })
  it('a signed-out viewer sees only the links scoped to nobody', () => {
    assert.equal(badgeLinkAllows(['DIRECTOR'], null), false)
    assert.equal(badgeLinkAllows([], null), true)
  })

  /* And the one screen that asks, asked. The cases above are about a
     function; this is about the filter actually calling it, which is the
     half a behaviour test cannot see — `badgeRuleAllows` has the same shape
     and a wider answer, so swapping one for the other compiles, runs and
     changes who sees what. */
  it('Topbar filters the user menu with THIS checker, not the matrices\' one', () => {
    const root = process.env.SPA_ROOT ?? process.cwd()
    const src = readFileSync(resolve(root, 'src/components/shell/Topbar.tsx'), 'utf8')
    assert.match(src, /import \{[^}]*\bbadgeLinkAllows\b[^}]*\} from '@\/lib\/badgeAccess'/)
    assert.match(src, /userMenuItems\.filter\(\(it\) => badgeLinkAllows\(it\.badges, user\)\)/)
    assert.ok(!/badgeRuleAllows/.test(src),
              'the settings-section checker folds the role in; these rules are about badges')
  })
})

describe('separate, not an alias — this is the half that cannot be undone later', () => {
  it('a rule naming only TEAMLEAD admits team leads and NOT directors', () => {
    const rules = { shiftrequests: ['TEAMLEAD'] }
    assert.equal(badgeAllowsApp('shiftrequests', teamlead, rules), true)
    assert.equal(badgeAllowsApp('shiftrequests', director, rules), false)
    assert.equal(badgeRuleAllows(['TEAMLEAD'], teamlead), true)
    assert.equal(badgeRuleAllows(['TEAMLEAD'], director), false)
  })

  it('the matrix offers TEAMLEAD its own column, beside DIRECTOR and not inside it', () => {
    const offered = BADGE_ORDER.filter((b) => b !== 'MASTER')
    assert.ok(offered.includes('TEAMLEAD'))
    assert.ok(offered.includes('DIRECTOR'))
    assert.notEqual(offered.indexOf('TEAMLEAD'), offered.indexOf('DIRECTOR'))
  })
})

/**
 * THE REACH THE TABLE HANDS OUT, WHEREVER IT IS NOT AN ACCESS RULE.
 *
 * Two screens grant something by badge without going through the matrices —
 * the welcome tour's franchise step and the Release Users status line — and
 * both were first written with the new word spelled into them. That reads
 * identically today and breaks the one promise that matters: empty
 * BADGE_FOLLOWS and a spelled word keeps granting, so the two badges never
 * part company. They read the fold now; these cases hold them to it, and
 * tools/check-badges.mjs hunts the word through the rest of the checkout.
 */
describe('the places that grant by badge outside the matrices', () => {
  const stepIds = (user: { role: string; types: string[] }) =>
    tourStepsFor(user).map((s) => s.id)

  it('the franchise step is heard through the equivalence, not through a second word', () => {
    assert.ok(stepIds(director).includes('akron'))
    assert.ok(stepIds(supervisor).includes('akron'), 'a supervisor currently reaches what a director reaches')
    assert.ok(!stepIds(teamlead).includes('akron'), 'a team lead no longer counts as a director')
    assert.ok(!stepIds(houseManager).includes('akron'))
    assert.ok(!stepIds(nobody).includes('akron'))
  })

  it('the step says "your badge", never one badge\'s name', () => {
    const akron = tourStepsFor(supervisor).find((s) => s.id === 'akron')
    assert.ok(akron, 'the step is there to be read')
    assert.ok(!/because you are a director/i.test(akron.body),
              'five words open this step; naming one of them is untrue for four of them')
  })

  it('the release status line names the badge the person WEARS', () => {
    assert.equal(franchiseBadgeOf({ director: true, types: ['SUPERVISOR'] }), ' · SUPERVISOR')
    assert.equal(franchiseBadgeOf({ director: true, types: ['DIRECTOR'] }), ' · DIRECTOR')
    assert.equal(franchiseBadgeOf({ director: true, types: ['DIRECTOR', 'TEAMLEAD'] }), ' · DIRECTOR')
  })

  it('… and never names TEAMLEAD as the franchise badge, which no longer stands in for one', () => {
    assert.equal(franchiseBadgeOf({ director: true, types: ['TEAMLEAD', 'SUPERVISOR'] }), ' · SUPERVISOR')
    assert.equal(franchiseBadgeOf({ director: true, types: ['TEAMLEAD'] }), ' · DIRECTOR')
  })

  it('… and says nothing at all when the backend says no', () => {
    assert.equal(franchiseBadgeOf({ director: false, types: ['TEAMLEAD'] }), '')
    assert.equal(franchiseBadgeOf({ director: false, types: [] }), '')
  })
})

/**
 * THE HOUSE MANAGER'S COLUMN. The operator's matrix gives a team lead exactly
 * a house manager's access, so wherever code outside the matrix decides
 * something for HM, a team lead is decided the same — and never as a director.
 */
describe('where code decides for a house manager, a team lead is decided the same', () => {
  it('the house-manager page gate admits a team lead, as it admits HM; every-house admits neither', () => {
    assert.equal(pageGateAllows('house-manager', teamlead), true)
    assert.equal(pageGateAllows('house-manager', houseManager), true)
    assert.equal(pageGateAllows('every-house', teamlead), false)
    assert.equal(pageGateAllows('every-house', houseManager), false)
    assert.equal(pageGateAllows('house-manager', nobody), false)
  })

  it('Time Off\'s first guess reads a team lead\'s houses, as a house manager\'s, never every house', () => {
    assert.equal(timeOffReach(teamlead).scope, 'houses')
    assert.equal(timeOffReach(teamlead).everyHouse, false)
    assert.equal(timeOffReach(houseManager).scope, 'houses')
    assert.equal(timeOffReach(director).scope, 'all')
  })

  it('… and falls back to the rule\'s own word when the list is empty', () => {
    assert.equal(franchiseBadgeOf({ director: true, types: [] }), ' · DIRECTOR')
  })
})

/**
 * WHICH CHIP A PERSON DRAWS — and which badge counts as "X or above".
 *
 * BADGE_ORDER is the display order — the one word a person's own corners show,
 * and the column order of the access matrix — AND the server's ladder: its
 * Python copy, app/scope.py BADGE_ORDER (held equal by check-badges), is what
 * `wears_from` ranks "X or above" by, and the editions' "X and above" is its
 * slice (src/lib/editions.ts EDITION_BADGES, app/editions.py open_badges). So
 * where TEAMLEAD sits here is where it ranks there: directly over HM.
 * DIGEST_BADGE_RANK (apps-script/Digest.gs) is the digest's own table for
 * "whose upload goes first" — it disagrees on admin against director because
 * it answers a different question, and check-badges refuses a copy of it
 * appearing under src/ or server/.
 */
describe('the display order, and where somebody carrying both lands', () => {
  const at = (b: string) => BADGE_ORDER.indexOf(b as (typeof BADGE_ORDER)[number])

  it('sits directly above HM and below MANAGER in the display order', () => {
    assert.ok(at('DIRECTOR') < at('TEAMLEAD'), 'DIRECTOR is drawn over TEAMLEAD')
    assert.ok(at('MANAGER') < at('TEAMLEAD'), 'MANAGER is drawn over TEAMLEAD')
    assert.equal(at('TEAMLEAD'), at('MANAGER') + 1)
    assert.equal(at('HM'), at('TEAMLEAD') + 1)
    assert.equal(at('SUPERVISOR'), at('DIRECTOR') + 1)
  })

  it('somebody carrying both reads DIRECTOR — the senior word wins', () => {
    const both = ['TEAMLEAD', 'DIRECTOR']
    const highest = BADGE_ORDER.find((b) => both.includes(b))
    assert.equal(highest, 'DIRECTOR')
  })

  it('a team lead who is also a house manager reads TEAMLEAD; one who is also a manager reads MANAGER', () => {
    assert.equal(BADGE_ORDER.find((b) => ['HM', 'TEAMLEAD'].includes(b)), 'TEAMLEAD')
    assert.equal(BADGE_ORDER.find((b) => ['TEAMLEAD', 'MANAGER'].includes(b)), 'MANAGER')
  })

  it('the edition dropdown offers the same order, PLATFORMLEAD down to STAFF', () => {
    assert.deepEqual([...EDITION_BADGES], BADGE_ORDER.slice(1, at('STAFF') + 1))
  })
})

describe('what a person reads', () => {
  it('the chip says TEAM LEAD, two words', () => {
    assert.equal(badgeWord('TEAMLEAD'), 'Team Lead')
  })

  it('the token is what is stored and compared — never the pretty spelling', () => {
    assert.ok(BADGE_ORDER.includes('TEAMLEAD' as (typeof BADGE_ORDER)[number]))
    assert.ok(!BADGE_ORDER.includes('TEAM LEAD' as (typeof BADGE_ORDER)[number]))
    assert.equal(badgeWord('TEAM LEAD'), 'TEAM LEAD', 'an unknown token draws itself, unchanged')
  })

  it('every other badge still draws its own token', () => {
    for (const b of ['DIRECTOR', 'HM', 'ADMINISTRATOR', 'GUARDIAN']) {
      assert.equal(badgeWord(b), b)
    }
  })

  it('the label map knows the word, so roleBadge cannot fall through to the raw token', () => {
    // roleBadge reads EXTRA_TYPE_LABEL for anything outside the Role union
    assert.equal(roleBadge({ role: 'teamlead' as never, isMaster: false }), 'Team Lead')
  })

  it('the master still outranks every badge on the chip', () => {
    assert.equal(roleBadge({ role: 'admin', isMaster: true }), 'MASTER')
  })
})

/**
 * THE PLATFORM LEAD — under the master, over the director. It reaches what a
 * director reaches through the same fold, its own rows stop at it, and what
 * the master alone holds is never lent to it.
 */
describe('the platform lead badge', () => {
  const lead = wearing('PLATFORMLEAD')
  const at = (b: string) => BADGE_ORDER.indexOf(b as (typeof BADGE_ORDER)[number])

  it('is answered as DIRECTOR, one way', () => {
    assert.equal(BADGE_FOLLOWS.PLATFORMLEAD, 'DIRECTOR')
    assert.deepEqual(withFollowedBadges(['PLATFORMLEAD']), ['PLATFORMLEAD', 'DIRECTOR'])
    assert.ok(!withFollowedBadges(['DIRECTOR']).includes('PLATFORMLEAD'))
  })

  it('wherever a director may, a platform lead may — apps, sections, links, page gates and the tour', () => {
    const rules = { leadership: ['DIRECTOR'] }
    assert.equal(badgeAllowsApp('leadership', lead, rules), true)
    assert.equal(badgeRuleAllows(['DIRECTOR'], lead), true)
    assert.equal(badgeLinkAllows(['DIRECTOR'], lead), true)
    assert.equal(pageGateAllows('every-house', lead), true)
    assert.equal(pageGateAllows('every-house', houseManager), false)
    assert.ok(tourStepsFor(lead).map((s) => s.id).includes('akron'))
  })

  it('a PLATFORMLEAD row admits platform leads and NOT directors', () => {
    const rules = { leadership: ['PLATFORMLEAD'] }
    assert.equal(badgeAllowsApp('leadership', lead, rules), true)
    assert.equal(badgeAllowsApp('leadership', director, rules), false)
    assert.equal(badgeRuleAllows(['PLATFORMLEAD'], director), false)
  })

  it('what only the master reaches stays the master\'s', () => {
    assert.equal(badgeAllowsApp('brandnew', lead, {}), false)
    for (const id of MASTER_ONLY_APPS) {
      assert.equal(badgeAllowsApp(id, lead, { [id]: ['PLATFORMLEAD', 'DIRECTOR'] }), false)
      assert.equal(badgeAllowsApp(id, { ...lead, isMaster: true }, {}), true)
    }
    assert.equal(badgeAllowsApp('payroll', lead, { payroll: ['ADMIN'] }), false)
    assert.equal(roleBadge({ role: 'admin', isMaster: true }), 'MASTER')
  })

  it('is drawn under MASTER and over DIRECTOR, with its own matrix column', () => {
    assert.ok(at('MASTER') < at('PLATFORMLEAD') && at('PLATFORMLEAD') < at('DIRECTOR'))
    assert.equal(at('PLATFORMLEAD'), at('MASTER') + 1)
    assert.equal(BADGE_ORDER.find((b) => ['DIRECTOR', 'PLATFORMLEAD'].includes(b)), 'PLATFORMLEAD')
    assert.ok(BADGE_ORDER.filter((b) => b !== 'MASTER').includes('PLATFORMLEAD'))
  })

  it('reads Platform Lead on every chip', () => {
    assert.equal(badgeWord('PLATFORMLEAD'), 'Platform Lead')
    assert.equal(roleBadge({ role: 'platformlead' as never, isMaster: false }), 'Platform Lead')
  })
})

describe('a current ** manager wears HM by code — derived, never written', () => {
  const hm = { role: 'staff', types: ['STAFF'], derivedTypes: ['HM'] }
  const staff = { role: 'staff', types: ['STAFF'], derivedTypes: [] as string[] }
  it('the badges worn are the ticked ones and the derived one, each once, upper-cased', () => {
    assert.deepEqual(wornTypes(hm), ['STAFF', 'HM'])
    assert.deepEqual(wornTypes({ types: ['hm'], derivedTypes: ['HM'] }), ['HM'])
    assert.deepEqual(wornTypes(null), [])
  })
  it('the calendar apps the matrix grants HM open for them, and not for the caregiver beside them', () => {
    const rules = { calendarbuilder: ['DIRECTOR', 'ADMINISTRATOR', 'ADMIN', 'ENTITY', 'HM'], shiftboard: ['HM'] }
    assert.equal(badgeAllowsApp('calendarbuilder', hm, rules), true)
    assert.equal(badgeAllowsApp('shiftboard', hm, rules), true)
    assert.equal(badgeAllowsApp('calendarbuilder', staff, rules), false)
  })
  it('no other app, settings section or menu link opens for a badge worn by code', () => {
    const rules = { smartcomms: ['DIRECTOR', 'HM'], users: ['HM'] }
    assert.equal(badgeAllowsApp('smartcomms', hm, rules), false)
    assert.equal(badgeAllowsApp('users', hm, rules), false)
    assert.equal(badgeAllowsApp('users', { role: 'staff', types: ['HM'] }, rules), true, 'a ticked HM still does')
    assert.equal(badgeRuleAllows(['HM'], hm), false)
    assert.equal(badgeLinkAllows(['HM'], hm), false)
    assert.equal(badgeRuleAllows(['HM'], { role: 'staff', types: ['HM'] }), true)
  })
  it('the effective user carries it apart from `types` — and a visit still hands out nothing', () => {
    const me = effectiveUserFrom({ id: 'U1', name: 'Ashley Davenport', role: 'staff', types: ['STAFF'],
                                   derivedTypes: ['hm', 'HM'], isMaster: false, appDenials: [] }, null)
    assert.deepEqual(me?.types, ['STAFF'])
    assert.deepEqual(me?.derivedTypes, ['HM'])
    assert.deepEqual(CALENDAR_BADGE_APPS, ['calendarbuilder', 'shiftboard'])
    const visit = effectiveUserFrom({ id: 'U1', name: 'Ashley Davenport', role: 'staff', types: ['STAFF'],
                                      derivedTypes: ['HM'], isMaster: false, appDenials: [] },
                                    { memberId: 'U2', name: 'Other', role: 'staff', types: ['STAFF'] })
    assert.ok(!visit?.types.includes('HM') && !visit?.derivedTypes?.length)
    assert.match(readFileSync(resolve(process.env.SPA_ROOT ?? process.cwd(), 'server/snapshot_service.py'), 'utf8'),
                 /^CALENDAR_BADGE_APPS = frozenset\(\{"calendarbuilder", "shiftboard"\}\)$/m)
  })
  it('the session carries it apart from `types`, so no editor of `types` can write it back', () => {
    const u = mapBackendUser({ id: 'U1', role: 'staff', types: ['STAFF'], derived_types: ['HM'] })
    assert.deepEqual(u.types, ['STAFF'])
    assert.deepEqual(u.derivedTypes, ['HM'])
    assert.deepEqual(mapBackendUser({ id: 'U1', role: 'staff', types: ['STAFF'] }).derivedTypes, [])
    const editor = readFileSync(resolve(process.env.SPA_ROOT ?? process.cwd(), 'src/pages/settings/UsersSection.tsx'), 'utf8')
    assert.doesNotMatch(editor, /derivedTypes/)
  })
})
