/**
 * SSA · the Notes tab follows App Control's Notes row (the operator's access sheet, 2026-10-29, row 49: Director,
 * Admin, Supervisor). The switcher's first roster comes from the slices and carries no notes flag, so the page used to
 * read "shut" for every uncut viewer until the action's roster arrived. Where the roster says nothing, the screen now
 * decides as the server does (app/ssa.py notes_open): the master; the badges the row names; with no badge named, Admin
 * and every badge above it. A roster that says, decides. A cut viewer is never offered the notes.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EDITION_BADGES } from '@/lib/editions'
import { APP_FEATURES } from '@/lib/featureAccess'
import { SSA_NOTES_FEATURE, SSA_NOTES_FLOOR, rosterOf, ssaNotesOpen, ssaReach } from '@/pages/features/ssaprofiles/ssaModel'

type Who = { isMaster?: boolean; types: string[]; role: string }
const who = (types: string[], role = 'staff'): Who => ({ isMaster: false, types, role })
const MASTER: Who = { isMaster: true, types: [], role: 'admin' }
// the sheet's lead columns: Admin and every badge above it, read off the order of access rather than spelled
const LEADS = EDITION_BADGES.slice(0, EDITION_BADGES.indexOf('ADMIN') + 1)
// the row the operator writes: the leads, Admin and Administrator among them
const ROW = { [SSA_NOTES_FEATURE]: [...LEADS] }
const SLICES = rosterOf({ ssas: [{ key: 'ssa_denisealvarez', name: 'Denise Alvarez' }], why: [], degraded: false })

describe('the SSA Notes tab', () => {
  it('asks the row the server asks, and the slices\' roster says nothing', () => {
    assert.ok((APP_FEATURES['ssa-profiles'] ?? []).some((f) => f.id === SSA_NOTES_FEATURE))
    assert.equal(SLICES.notes, null)
    assert.deepEqual([...SSA_NOTES_FLOOR], [...LEADS])
    assert.equal(SSA_NOTES_FLOOR[SSA_NOTES_FLOOR.length - 1], 'ADMIN', 'Admin is the floor')
    for (const b of ['ENTITY', 'MANAGER', 'TEAMLEAD', 'HM', 'STAFF']) assert.ok(!SSA_NOTES_FLOOR.includes(b), b)
  })

  it('Director, Platform Lead, Supervisor, Administrator and Admin are offered Notes on the usual page load', () => {
    assert.equal(LEADS.length, 5)
    for (const badge of LEADS) {
      const notes = ssaNotesOpen(SLICES.notes, who([badge], 'admin'), ROW)
      assert.equal(notes, true, badge)
      assert.ok(ssaReach(SLICES.viewer, false, false, notes).tabs.includes('notes'), badge)
    }
  })

  it('HM, Team Lead, DSP, Entity and a manager-role house manager are not', () => {
    for (const types of [['HM', 'STAFF'], ['TEAMLEAD'], ['STAFF'], ['ENTITY'], ['INTERVIEWER', 'HM']]) {
      const notes = ssaNotesOpen(SLICES.notes, who(types, types.includes('INTERVIEWER') ? 'manager' : 'staff'), ROW)
      assert.equal(notes, false, types.join())
      assert.ok(!ssaReach(SLICES.viewer, false, false, notes).tabs.includes('notes'), types.join())
    }
  })

  it('with no badge named the server opens Admin and above; so does the screen', () => {
    assert.equal(ssaNotesOpen(null, who(['ADMIN'], 'admin'), {}), true)
    assert.equal(ssaNotesOpen(null, who([], 'admin'), {}), true, 'the admin role reads as its badge')
    assert.equal(ssaNotesOpen(null, who(['HM', 'STAFF']), {}), false)
    assert.equal(ssaNotesOpen(null, who(['TEAMLEAD']), {}), false, 'a team lead stands in for nobody')
  })

  it('a roster that says decides; the master is never narrowed; nobody signed in is offered nothing', () => {
    assert.equal(ssaNotesOpen(false, who(['DIRECTOR'], 'admin'), ROW), false)
    assert.equal(ssaNotesOpen(true, who(['STAFF']), ROW), true)
    assert.equal(ssaNotesOpen(null, MASTER, {}), true)
    assert.equal(ssaNotesOpen(null, MASTER, { [SSA_NOTES_FEATURE]: ['DIRECTOR'] }), true)
    assert.equal(ssaNotesOpen(null, null, ROW), false)
  })

  it('a cut viewer is never offered the notes, whatever the row says', () => {
    assert.equal(ssaReach('ssa', true, false, true).notes, false)
    assert.equal(ssaReach('guardian', true, false, true).notes, false)
    assert.equal(ssaReach('', true, false, ssaNotesOpen(null, who(['DIRECTOR', 'GUARDIAN'], 'admin'), ROW)).notes, false)
  })
})
