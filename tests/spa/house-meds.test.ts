/**
 * HOUSE SUPPLIES — the hero's figures and the reach, on the relay's own shape.
 *
 *   figures     the latest report's age and overdue line, on record now (a
 *               relabelled prescription counted ONCE), running low, reports
 *               on file against the periods since the first, the band
 *   filters     current by default, running low, a drug found by any label
 *   groups      house, then client; unmatched and no-house last
 *   strip       imported, missing, held — never merged into one
 *   reach       every house imports, a house manager reads, staff, a
 *               client, a FAMILY or an SSA are drawn nothing
 *
 * The fixture is synthetic and shaped like `/erp-lanes/house-supplies/meds`.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  batchWords, bandOf, cutoffWords, filterRx, groupRx, heroFigures, leftWords, periodStrip, span,
  type MedsPatient, type MedsRx, type MedsView,
} from '@/lib/houseMedsAnalysis'
import { houseMedsReach, tabFor, tabsFor } from '@/lib/houseMedsAccess'

const patient = (over: Partial<MedsPatient>): MedsPatient => ({
  patid: 'T1', key: 'T1', group: 'house', house: 'ABD1711', house_label: '48TH (B)', client_key: 'c1',
  client_name: 'Ann Test', initials: 'A.T.', match: 'auto', note: '', same_as: '', last_seen: '2026-08-29',
  facilities: ['ASLIFE'], ...over,
})

const rx = (over: Partial<MedsRx>): MedsRx => ({
  rx_root: 'r1', patid: 'T1', patient: 'T1', drug: 'LISINOPRIL 10 MG TABLET', physician: 'DR ONE', sig: 'TAKE 1',
  date_written: '2026-01-02', last_dispense: '2026-08-20', dispensed_in_period: '30', qty_written: '300',
  qty_remaining: '120', qty_dispensed_to_date: '180', cutoff: '', report_end: '2026-08-29',
  first_report_end: '2026-01-31', reports_seen: 6, labels: ['LISINOPRIL 10MG TAB', 'LISINOPRIL 10 MG TABLET'],
  sum_dispensed: '180', current: true, maybe_same_as: '', facility: 'ASLIFE', ...over,
})

const view: MedsView = {
  version: 'v1', pharmacy: 'A Brighter Dawn',
  scope: { every_house: true, houses: [], writer: true, why: '' },
  latest: { start: '2026-08-15', end: '2026-08-29' },
  periods: [
    { import_id: 'MI-1', start: '2026-07-01', end: '2026-07-15', file_name: 'a', lines: 5, facility: 'BDWNSL' },
    { import_id: 'MI-2', start: '2026-07-31', end: '2026-08-14', file_name: 'b', lines: 5, facility: 'ASLIFE' },
    { import_id: 'MI-3', start: '2026-08-15', end: '2026-08-29', file_name: 'c', lines: 5, facility: 'ASLIFE' },
  ],
  gaps: [{ start: '2026-07-16', end: '2026-07-30' }],
  facilities: [{ facility: 'BDWNSL', from: '2026-07-01' }, { facility: 'ASLIFE', from: '2026-07-31' }],
  summary: { reports: 3, duplicates: 1, held: 1, invalid: 0, failed: 0, house_pending: 0 },
  patients: [
    patient({}),
    patient({ patid: 'T2', key: 'T2', house: 'ABD2704', house_label: 'JH', client_key: 'c2', client_name: 'Bob Test' }),
    patient({ patid: 'T3', key: 'T3', group: 'unmatched', house: '', house_label: '', client_key: '', client_name: '',
      initials: 'E.N.', match: 'none' }),
    patient({ patid: 'T4', key: 'T4', group: 'nohouse', house: '', house_label: '', client_key: 'c4', client_name: 'Dee Test' }),
  ],
  rx: [
    rx({}),
    rx({ rx_root: 'r2', drug: 'METFORMIN 500MG', labels: ['METFORMIN 500MG'], qty_remaining: '5' }),
    rx({ rx_root: 'r3', patid: 'T2', patient: 'T2', drug: 'ASPIRIN 81MG', labels: ['ASPIRIN 81MG'], qty_remaining: '0' }),
    rx({ rx_root: 'r4', patid: 'T3', patient: 'T3', drug: 'VITAMIN D', labels: ['VITAMIN D'], cutoff: '2026-08-20' }),
    rx({ rx_root: 'r5', patid: 'T4', patient: 'T4', drug: 'OLD DRUG', labels: ['OLD DRUG'], current: false }),
    rx({ rx_root: 'r6', patid: 'T4', patient: 'T4', drug: 'BLANK LEFT', labels: ['BLANK LEFT'], qty_remaining: '' }),
  ],
  folder: { at: '2026-09-01T06:00:00Z', new: 0 },
  sweep: {},
  low_left: 7,
  period_days: 15,
  ledger: [{
    import_id: 'MI-9', received_at: '', source: 'upload', actor_label: '', file_name: 'x', stage_id: '',
    outcome: 'held', layers: ['period'], reason: '', duplicate_of: '', report_start: '2026-07-16',
    report_end: '2026-07-30', lines: 5, lines_new: 0, patients: 5, house_state: 'pending', house_error: '',
    superseded_by: '',
  }],
}

describe('the hero', () => {
  it('ages the latest report and turns amber past 16 days', () => {
    const fresh = heroFigures(view, '2026-09-10')
    assert.equal(fresh.latest?.ageDays, 12)
    assert.equal(fresh.latest?.overdue, false)
    assert.equal(fresh.latest?.span, 'Aug 15 – Aug 29, 2026')
    const late = heroFigures(view, '2026-09-23')
    assert.equal(late.latest?.overdue, true)
    assert.equal(late.latest?.due, '2026-09-14')
  })

  it('counts a relabelled prescription once, and only the current ones', () => {
    const f = heroFigures(view, '2026-09-10')
    assert.equal(f.onRecord.count, 5)
    assert.equal(f.onRecord.clients, 4)
    assert.equal(f.onRecord.houses, 2)
  })

  it('counts running low and none left; a blank quantity is never guessed', () => {
    const f = heroFigures(view, '2026-09-10')
    assert.deepEqual(f.low, { count: 2, none: 1 })
    assert.deepEqual(f.band, { plenty: 1, low: 1, none: 1, ending: 1 })
    assert.equal(bandOf(view.rx[5], view.latest, 7), null)
  })

  it('counts the reports on file against every period since the first', () => {
    const f = heroFigures(view, '2026-09-10')
    assert.deepEqual(f.reports, { count: 3, expected: 4, missing: 1, duplicates: 1, since: '2026-07-01' })
    assert.equal(f.facilitySwitch, 'BDWNSL → ASLIFE, Jul 2026')
  })
})

describe('the medications tab', () => {
  const all = { house: '', client: '', drug: '', lowOnly: false, current: true }

  it('shows current prescriptions by default, and all reports on request', () => {
    assert.equal(filterRx(view, all).length, 5)
    assert.equal(filterRx(view, { ...all, current: false }).length, 6)
  })

  it('finds a drug by any label it was reported under', () => {
    assert.deepEqual(filterRx(view, { ...all, drug: '10mg tab' }).map((r) => r.rx_root), ['r1'])
  })

  it('keeps only the running-low ones', () => {
    assert.deepEqual(filterRx(view, { ...all, lowOnly: true }).map((r) => r.rx_root).sort(), ['r2', 'r3'])
  })

  it('groups by house, then client — no house and unmatched last', () => {
    const g = groupRx(view, filterRx(view, all))
    assert.deepEqual(g.map((x) => x.title), ['48TH (B)', 'JH', 'No house', 'Not matched to a client'])
    assert.equal(g[0].clients[0].rx.length, 2)
  })

  it('says what is left and when it ends', () => {
    assert.equal(leftWords(view.rx[2]), 'none left')
    assert.equal(leftWords(view.rx[5]), '—')
    assert.equal(cutoffWords('2026-09-02', '2026-09-01'), 'Ends Sep 2')
    assert.equal(cutoffWords('2026-08-20', '2026-09-01'), 'Ended Aug 20')
    assert.equal(span('2025-12-22', '2026-01-05'), 'Dec 22, 2025 – Jan 5, 2026')
  })
})

describe('the import tab', () => {
  it('marks each 15-day period imported, missing or held', () => {
    const strip = periodStrip(view, '2026-09-01')
    assert.deepEqual(strip.slice(0, 4).map((c) => c.state), ['imported', 'held', 'imported', 'imported'])
  })

  it('never offers an import when nothing is new, and says the rest was recorded', () => {
    const none = batchWords([{ stage_id: '', import_id: 'MI-1', file_name: 'a', source: 'folder', verdict: 'duplicate',
      pill: '', reason: '', layers: ['content'], duplicate_of: '', start: '', end: '', lines: 5, lines_new: 0, patients: 1 }])
    assert.equal(none.newCount, 0)
    assert.equal(none.label, 'Nothing new in this batch')
    assert.match(none.note, /will not be read again/)
    const one = batchWords([{ stage_id: 'MS-1', import_id: '', file_name: 'b', source: 'folder', verdict: 'new',
      pill: '', reason: '', layers: [], duplicate_of: '', start: '', end: '', lines: 145, lines_new: 145, patients: 9 }])
    assert.equal(one.label, 'Import 1 new report (145 lines)')
  })
})

describe('the reach', () => {
  it('every house imports; a house manager reads; staff, a client, a family or an SSA see none', () => {
    const admin = houseMedsReach({ role: 'admin', types: ['ADMINISTRATOR'] })
    assert.deepEqual(admin, { medications: true, import: true, everyHouse: true })
    const hm = houseMedsReach({ role: 'staff', types: ['STAFF'], derivedTypes: ['HM'] })
    assert.deepEqual(hm, { medications: true, import: false, everyHouse: false })
    assert.deepEqual(houseMedsReach({ role: 'staff', types: ['STAFF'] }).medications, false)
    assert.deepEqual(houseMedsReach({ role: 'staff', types: ['MANAGER'] }).medications, false)
    assert.deepEqual(houseMedsReach({ role: 'client', types: [] }).medications, false)
    // the FIX BADGES sheet: FAMILY (the badge once called GUARDIAN) and SSA shut it, whatever else is ticked
    const none = { medications: false, import: false, everyHouse: false }
    assert.deepEqual(houseMedsReach({ role: 'staff', types: ['FAMILY', 'ADMIN'] }), none)
    assert.deepEqual(houseMedsReach({ role: 'staff', types: ['SSA', 'ADMIN'] }), none)
    // a client-role guardian account now wears SSA
    assert.deepEqual(houseMedsReach({ role: 'client', types: ['SSA'] }), none)
    assert.deepEqual(houseMedsReach({ isMaster: true }).import, true)
  })

  it('an SSA or a FAMILY wearer\'s role word never counts as a badge', () => {
    const none = { medications: false, import: false, everyHouse: false }
    assert.deepEqual(houseMedsReach({ role: 'admin', types: ['SSA'] }), none)
    assert.deepEqual(houseMedsReach({ role: 'admin', types: ['FAMILY'] }), none)
    assert.deepEqual(houseMedsReach({ role: 'staff', types: ['FAMILY'], derivedTypes: ['HM'] }), none)
  })

  it('an unmigrated GUARDIAN cell is read as FAMILY (scope.BADGE_RENAMED) and opens no medication', () => {
    assert.deepEqual(houseMedsReach({ role: 'staff', types: ['GUARDIAN', 'ADMIN'] }),
      { medications: false, import: false, everyHouse: false })
  })

  it('the calendars\' named role exception opens no medication: a role alone is not a badge', () => {
    assert.deepEqual(houseMedsReach({ role: 'manager', types: [] }), { medications: false, import: false, everyHouse: false })
    assert.deepEqual(houseMedsReach({ role: 'manager', types: ['STAFF'] }).medications, false)
    // the role folds in as a word, as the relay's badges_of folds it
    assert.deepEqual(houseMedsReach({ role: 'admin', types: [] }).import, true)
  })

  it('draws only the tabs a reader may open, and falls back to the default', () => {
    const hm = houseMedsReach({ role: 'staff', derivedTypes: ['HM'] })
    assert.deepEqual(tabsFor(hm), ['inventory', 'medications'])
    assert.equal(tabFor('import', hm), 'medications')
    const staff = houseMedsReach({ role: 'staff', types: ['STAFF'] })
    assert.deepEqual(tabsFor(staff), ['inventory'])
    assert.equal(tabFor('medications', staff), 'inventory')
  })
})
