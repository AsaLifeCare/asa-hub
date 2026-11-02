/**
 * CLIENTS · the model: the address and every panel round trip (a source section's own panel included), the
 * switcher's list, the masks (never more than four digits), each read's tolerant shape, the one table's filter, the
 * Actions groups per section and the share payload.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLIENTS_PATH, EDIT_FIELDS, INCIDENT_STATUSES, NOT_PUBLISHED, SECTION_VIEWS, actionGroups, activityOf, ageOf,
  cardMask, careOf, clientEditFields, clientHref, clientIncidentsOf, clientQuery, clockLabel, dayLabel, defaultClient,
  filterRows, lastFour, medEditFields, medsOf, onFileMask, panelOf, panelParam, profileOf, readRefusal, recordText,
  resolveClient, rosterOf, routineLabel, sharePayloadFor, sourcePanelOf, ssnMask, statusTint, switcherClients, tabOf, viewOf,
  type ClientAsk, type RosterRow,
} from '@/pages/features/clientprofiles/clientModel'
import { APPT_FIELDS, apptChanges, apptPanelOf, apptPanelParam } from '@/pages/features/clientprofiles/sources/appointments'
import { diffChanges } from '@/lib/recordEdit'

const row = (over: Partial<RosterRow> = {}): RosterRow => ({
  client_key: 'annettekowal', client_id: 'CLI_annettekowal', name: 'Annette Kowal', status: 'active', house: 'NW4045',
  avatar: '', isp_year: '2026', ...over,
})
const ROSTER = [
  row(),
  row({ client_key: 'kennymarsh', client_id: 'CLI_kennymarsh', name: 'Kenny Marsh', house: 'BW1001' }),
  row({ client_key: 'oldclient', client_id: '', name: 'Old Client', status: 'inactive', house: '' }),
]

describe('the address', () => {
  it('a section is one of the nine, anything else is Client Profile', () => {
    assert.equal(tabOf('billing'), 'billing')
    assert.equal(tabOf('activity'), 'activity')
    assert.equal(tabOf('nope'), 'profile')
    assert.equal(tabOf(null), 'profile')
  })

  it("a section's own tab is one of its list, else its first; a section with none has ''", () => {
    assert.equal(viewOf('care', 'daily'), 'daily')
    assert.equal(viewOf('care', 'nope'), 'team')
    assert.equal(viewOf('funds', null), 'balances')
    assert.equal(viewOf('billing', 'claims'), 'claims')
    assert.equal(viewOf('profile', 'daily'), '')
    assert.deepEqual(SECTION_VIEWS.funds.map((v) => v.label), ['Balances', 'Transactions', 'Receipts'])
    assert.deepEqual(SECTION_VIEWS.billing.map((v) => v.label), ['Authorizations', 'Claims'])
  })

  it('every panel rides the address and comes back as itself', () => {
    const asks: ClientAsk[] = [
      { kind: 'share' }, { kind: 'edit-profile' }, { kind: 'add-client' }, { kind: 'add-medication' }, { kind: 'add-authorization' },
      { kind: 'new-incident' }, { kind: 'create-user', who: 'guardian' }, { kind: 'tool', tool: 'read-plans' },
      { kind: 'record', section: 'care', view: 'daily', id: 'r~1' }, { kind: 'record', section: 'medication', view: 'meds', id: 'm1' },
      { kind: 'activity', id: 'a1' }, { kind: 'incident', id: 'i1' },
      { kind: 'source', value: 'visit~r12' }, { kind: 'source', value: 'txn:x~1' }, { kind: 'source', value: 'sources' },
    ]
    for (const ask of asks) assert.deepEqual(panelOf(panelParam(ask)), ask, panelParam(ask))
    assert.equal(panelParam(null), '')
    assert.equal(panelParam({ kind: 'source', value: '' }), '', 'a source panel with nothing in it is no panel')
    for (const bad of ['', 'nope', 'record~care~nope~x', 'record~billing~claims~x', 'record~medication~admin~m1', 'create-user~admin',
      'tool~wipe', 'trip~t1', 'doc~file1xxxxxxx~ISP', 'appointment~d1', 'src', 'src~']) {
      assert.equal(panelOf(bad), null, bad)
    }
  })

  it("a source section's panel is its own parameter, held by the page so one panel is open at a time", () => {
    assert.equal(sourcePanelOf(panelOf('src~visit~r12')), 'visit~r12')
    assert.equal(sourcePanelOf(panelOf('share')), null)
    assert.equal(sourcePanelOf(null), null)
    assert.equal(clientQuery('annettekowal', 'appointments', '', { kind: 'source', value: 'edit~r12' }),
      '?client=annettekowal&tab=appointments&panel=src%7Eedit%7Er12')
    const wrapped = panelParam({ kind: 'source', value: apptPanelParam({ kind: 'edit', id: 'r12' }) })
    assert.deepEqual(apptPanelOf(sourcePanelOf(panelOf(wrapped))), { kind: 'edit', id: 'r12' }, 'the page wraps it; the section reads it back')
    assert.deepEqual(apptPanelOf(apptPanelParam({ kind: 'visit', id: 'future:r7' })), { kind: 'visit', id: 'future:r7' })
  })

  it('the query carries the client, the section, its tab when not the first, and the panel', () => {
    assert.equal(clientQuery('annettekowal', 'profile'), '?client=annettekowal')
    assert.equal(clientQuery('annettekowal', 'care', 'team'), '?client=annettekowal&tab=care')
    assert.equal(clientQuery('annettekowal', 'care', 'plans'), '?client=annettekowal&tab=care&view=plans', 'Care plans reads last')
    assert.equal(clientQuery('annettekowal', 'care', 'daily', { kind: 'share' }), '?client=annettekowal&tab=care&view=daily&panel=share')
    assert.equal(clientQuery('annettekowal', 'profile', 'daily'), '?client=annettekowal', 'a section with no tabs drops a stray view')
    assert.equal(clientHref('annettekowal', 'billing', 'claims'), `${CLIENTS_PATH}?client=annettekowal&tab=billing&view=claims`)
  })
})

describe('the roster and the switcher', () => {
  it('reads the roster tolerantly: a row with no name is dropped, a key is the folded name when missing, no key twice', () => {
    const r = rosterOf({ clients: [{ name: 'Annette Kowal', client_id: 'CLI_a', status: 'Active' }, { name: '' },
      { client_key: 'annettekowal', name: 'Annette Again' }, { name: 'Old One', status: 'inactive' }], inactive_why: 'the archive is 22 rows' })
    assert.deepEqual(r.clients.map((c) => [c.client_key, c.status]), [['annettekowal', 'active'], ['oldone', 'inactive']])
    assert.equal(r.inactiveWhy, 'the archive is 22 rows')
    assert.deepEqual(rosterOf(null), { clients: [], inactiveWhy: '', viewer: '' })
  })

  it('active clients by name; Show Inactive adds the inactive after them; the search narrows by name or house', () => {
    assert.deepEqual(switcherClients(ROSTER, '', false).map((c) => c.name), ['Annette Kowal', 'Kenny Marsh'])
    assert.deepEqual(switcherClients(ROSTER, '', true).map((c) => c.name), ['Annette Kowal', 'Kenny Marsh', 'Old Client'])
    assert.deepEqual(switcherClients(ROSTER, 'kenny', true).map((c) => c.name), ['Kenny Marsh'])
    assert.deepEqual(switcherClients(ROSTER, 'bw1001', false).map((c) => c.name), ['Kenny Marsh'])
  })

  it('an address resolves by key or folded name, never a near match; none opens on the first active one', () => {
    assert.equal(resolveClient('kennymarsh', ROSTER)?.name, 'Kenny Marsh')
    assert.equal(resolveClient('Kenny Marsh', ROSTER)?.name, 'Kenny Marsh')
    assert.equal(resolveClient('kenny', ROSTER), null)
    assert.equal(defaultClient(ROSTER)?.name, 'Annette Kowal')
    assert.equal(defaultClient([]), null)
  })
})

describe('the profile and its masks', () => {
  const P = profileOf({
    client: { client_key: 'annettekowal', name: 'Annette Kowal', status: 'active', client_number: 'CL-1', dob: '1980-03-04', age: null },
    identity: { ssn_last4: '4544', ssn_on_file: true, medicaid_id: '123456789012' },
    financial: { tl_card_last4: '4812', dc_exp_on_file: true, dc_security_code_on_file: true, dc_pin_on_file: false, spending_limit: '$50' },
    family: [{ name: 'Mary Kowal', relationship: 'Mother', phone: '5550100' }, { name: '' }],
    guardian: { name: 'Mary Kowal', person_id: 'PPL_guardian_marykowal' },
  })

  it('draws the last four only, dots for what is only on file, nothing when not on file', () => {
    assert.equal(ssnMask(P.identity), '•••-••-4544')
    assert.equal(cardMask(P.financial.tl_card_last4), '•••• •••• •••• 4812')
    assert.equal(onFileMask(P.financial.dc_exp_on_file, '••/••'), '••/••')
    assert.equal(onFileMask(P.financial.dc_pin_on_file, '••••'), null)
    assert.equal(ssnMask({ ssn_last4: null, ssn_on_file: true, medicaid_id: '' }), '•••-••-••••')
    assert.equal(ssnMask({ ssn_last4: null, ssn_on_file: false, medicaid_id: '' }), null)
  })

  it('never keeps more than four digits of an SSN or a card, whatever the answer carried', () => {
    assert.equal(lastFour('123456789'), null)
    assert.equal(lastFour('4111111111111111'), null)
    assert.equal(lastFour(' 4544 '), '4544')
    const leaky = profileOf({ identity: { ssn_last4: '123-45-6789' }, financial: { tl_card_last4: '4111111111111111' } })
    assert.equal(leaky.identity.ssn_last4, null)
    assert.equal(leaky.financial.tl_card_last4, null)
    const drawn = JSON.stringify([ssnMask(leaky.identity), cardMask(leaky.financial.tl_card_last4)])
    assert.doesNotMatch(drawn, /\d{5,}/)
  })

  it('reads the rest tolerantly; family rows need a name; the age is counted from the birthdate when not sent', () => {
    assert.equal(P.client.initials, 'AK')
    assert.equal(P.family.length, 1)
    assert.equal(P.guardian.person_id, 'PPL_guardian_marykowal')
    assert.equal(P.home.home_address, '')
    assert.equal(ageOf(P.client.dob, P.client.age, '2026-09-28'), 46)
    assert.equal(ageOf('1980-10-01', null, '2026-09-28'), 45)
    assert.equal(ageOf('', null, '2026-09-28'), null)
    assert.equal(ageOf('', 51, '2026-09-28'), 51)
  })

  it('the edit panel opens each field on its raw value, locks the name, the status and the masked cells, and sends only ' +
     'what changed', () => {
    const raw = Object.fromEntries(EDIT_FIELDS.map((f) => [f.key, '']))
    const fields = clientEditFields({ ...P, edit: { ...raw, spending_limit: '$50', house: 'NW4045' },
      houses: [{ code: 'NW4045', name: 'CAN - NW - NW4045' }, { code: 'NE2020', name: 'CAN - NE - NE2020' }] })
    assert.deepEqual(fields.filter((f) => f.lockedBy).map((f) => f.key), ['name', 'status', 'ssn', 'tl_card', 'dc_exp', 'dc_security_code', 'dc_pin'])
    assert.ok(!EDIT_FIELDS.some((f) => /ssn|card|dc_|pin|security/.test(f.key)))
    assert.ok(['house', 'initials', 'isp_signed_date'].every((k) => fields.some((f) => f.key === k && !f.lockedBy)))
    const house = fields.find((f) => f.key === 'house')
    assert.deepEqual([house?.kind, house?.options, house?.optionLabels?.NE2020], ['select', ['NW4045', 'NE2020'], 'CAN - NE - NE2020'])
    assert.deepEqual(diffChanges(fields, { spending_limit: ' $60 ', ssn: '123456789', name: 'Someone Else', house: 'NE2020' }), [
      { field: 'house', value: 'NE2020', expected: 'NW4045' }, { field: 'spending_limit', value: '$60', expected: '$50' }])
    assert.ok(clientEditFields(P).filter((f) => !f.lockedBy).length === 0, 'a read with no edit map edits nothing')
    const meds = medEditFields({ name: 'Med A', dose: '5 mg', times: '08:00 20:00', route: 'Tablet', freq: 'Daily', discontinued: '' })
    assert.deepEqual(diffChanges(meds, { dose: '10 mg', times: '08:00 20:00' }), [{ field: 'dose', value: '10 mg', expected: '5 mg' }])
    assert.ok(medEditFields({}).every((f) => f.lockedBy), 'a chart row with no id is not edited')
  })
})

describe('the one table', () => {
  const care = careOf({ tab: 'daily', rows: [
    { id: 'r1', record: 'Morning routine', date: '2026-01-10', details: 'Wakes at 7', status: 'Current', source: 'ISP 2026', text: 'She wakes…' },
    { id: 'r2', record: 'Bedtime routine', date: '2025-01-10', details: 'Lights out 10', status: 'Past plan', source: 'ISP 2025' },
    { id: '', record: '', details: '' },
  ], absent: ['afternoon', 'overnight'] })

  it('care rows keep the plan\'s words; the statuses come from the rows when not listed; absent routines are named', () => {
    assert.equal(care.rows.length, 2)
    assert.deepEqual(care.statuses, ['Current', 'Past plan'])
    assert.deepEqual(care.absent.map(routineLabel), ['Afternoon routine', 'Overnight routine'])
    assert.equal(care.rows[0].text, 'She wakes…')
  })

  it('filters by status and by any drawn word', () => {
    assert.deepEqual(filterRows(care.rows, '', 'Current', recordText).map((r) => r.id), ['r1'])
    assert.deepEqual(filterRows(care.rows, 'lights', '', recordText).map((r) => r.id), ['r2'])
    assert.deepEqual(filterRows(care.rows, 'jan 10, 2025', '', recordText).map((r) => r.id), ['r2'])
    assert.deepEqual(filterRows(care.rows, 'zzz', '', recordText), [])
  })

  it('medications carry the newest chart date; the appointment pencil sends only what changed', () => {
    const m = medsOf({ tab: 'meds', rows: [{ id: 'm1', record: 'Gabapentin', details: '300 mg · 08:00', status: 'Active' }], as_of: '2026-03-01' })
    assert.equal(m.asOf, '2026-03-01')
    assert.deepEqual(m.statuses, ['Active'])
    assert.deepEqual(APPT_FIELDS.map((f) => f.key), ['date', 'time', 'dr_name', 'dr_address', 'van'])
    const before = { date: '2026-10-02', time: '10:30 AM', dr_name: 'Dr Lee', dr_address: '1 Main St', van: 'No' }
    assert.deepEqual(apptChanges(before, { ...before, time: ' 11:00 AM ', van: 'Yes', witness: 'x' }), { time: '11:00 AM', van: 'Yes' })
    assert.deepEqual(apptChanges(before, before), {})
  })

  it('status pills: current and paid are green, missing and under review amber, expired red, the rest slate', () => {
    assert.equal(statusTint('Current'), 'mint')
    assert.equal(statusTint('Receipt On File'), 'mint')
    assert.equal(statusTint('Missing receipt'), 'amber')
    assert.equal(statusTint('Under review'), 'amber')
    assert.equal(statusTint('Expired'), 'danger')
    assert.equal(statusTint('Reported'), 'blue')
    assert.equal(statusTint('Past plan'), 'slate')
  })
})

describe('incidents', () => {
  it('newest first, the status Reported by default, employees split, categories split', () => {
    const got = clientIncidentsOf({ rows: [
      { incident_ts: '2026-09-01T10:00:00Z', your_name: 'Ann Lee', incident_date: '2026-09-01', incident_category: 'Fall, Medication error', employees_involved: 'Bo Diaz, Cy Ray' },
      { incident_ts: '2026-09-20T10:00:00Z', your_name: 'Bo Diaz', incident_date: '2026-09-20', status: 'Under review', employees_involved: ['Ann Lee'] },
    ] })
    assert.deepEqual(got.rows.map((r) => r.your_name), ['Bo Diaz', 'Ann Lee'])
    assert.deepEqual(got.rows.map((r) => r.status), ['Under review', 'Reported'])
    assert.equal(got.rows[1].id, '2026-09-01T10:00:00Z', 'the key is the report stamp, never a row number')
    assert.deepEqual(got.rows[1].employees_involved, ['Bo Diaz', 'Cy Ray'])
    assert.deepEqual(got.rows[1].categories, ['Fall', 'Medication error'])
    assert.deepEqual(got.statuses, [...INCIDENT_STATUSES])
  })
})

describe('activity', () => {
  it('newest first, a kind named as the answer names it, counts kept only when they are numbers', () => {
    const a = activityOf({ rows: [
      { id: 'a1', date: '2026-09-01', kind: 'daily_note', record: 'Behavior', text: 'Calm day.' },
      { id: 'a2', date: '2026-09-20', kind: 'visit', record: 'Dr Lee' },
      { id: 'a3', date: '2026-09-10', kind: 'med_stopped', record: 'Med B' },
    ], counts: { daily_notes: 40, incidents: 'x' }, total: 3 })
    assert.deepEqual(a.rows.map((r) => r.id), ['a2', 'a3', 'a1'])
    assert.equal(a.rows[2].text, 'Calm day.')
    assert.deepEqual(a.counts, { daily_notes: 40 })
    assert.equal(a.total, 3)
    assert.deepEqual(a.kinds, ['Doctor visit', 'Medication discontinued', 'Daily note'])
  })
})

describe('days and clocks', () => {
  it('a day as itself, a typed M/D/YYYY as typed, the 1899 time carrier blank', () => {
    assert.equal(dayLabel('2026-09-24'), 'Sep 24, 2026')
    assert.equal(dayLabel('9/24/2026'), 'Sep 24, 2026')
    assert.equal(dayLabel(''), '')
    assert.equal(clockLabel('08:00'), '08:00')
    assert.equal(clockLabel('1899-12-30T13:00:00.000Z'), '')
  })
})

describe('the Actions menu', () => {
  const labels = (tab: Parameters<typeof actionGroups>[0], view: string) =>
    actionGroups(tab, view).map((g) => [g.label, g.items.map((i) => i.label)])
  const MANAGEMENT = ['Create user', 'Create user guardian', 'Users for all clients', 'Users for all guardians', 'Guardians to roster', 'Read the plans']

  it('Client Profile: Add client first, and not again under Client management', () => {
    assert.deepEqual(labels('profile', ''), [['Client Profile', ['Add client']], ['Client management', MANAGEMENT]])
  })

  it('Medication · Medications: Add medication; Billing · Authorizations: Add authorization', () => {
    assert.deepEqual(labels('medication', 'meds'), [['Medication · Medications', ['Add medication']], ['Client management', ['Add client', ...MANAGEMENT]]])
    assert.deepEqual(labels('billing', 'authorizations'), [['Billing · Authorizations', ['Add authorization']], ['Client management', ['Add client', ...MANAGEMENT]]])
  })

  it('a section with no own action shows Client management alone, Add client in it', () => {
    assert.deepEqual(labels('funds', 'balances'), [['Client management', ['Add client', ...MANAGEMENT]]])
    assert.deepEqual(labels('medication', 'admin'), [['Client management', ['Add client', ...MANAGEMENT]]])
    assert.deepEqual(labels('appointments', ''), [['Client management', ['Add client', ...MANAGEMENT]]])
    assert.deepEqual(labels('transportation', 'calendar'), [['Client management', ['Add client', ...MANAGEMENT]]])
  })
})

describe('a refusal and a share', () => {
  it('"Unknown action." is a deployment without Clients', () => {
    assert.equal(readRefusal('Unknown action.'), NOT_PUBLISHED)
    assert.equal(readRefusal('the plan could not be read'), 'the plan could not be read')
    assert.equal(readRefusal(''), 'The read did not answer.')
  })

  it('shares the name, the house and the status — nothing clinical — and the address of the section', () => {
    const s = sharePayloadFor(ROSTER[0], 'care', 'daily')
    assert.equal(s.title, 'Annette Kowal')
    assert.equal(s.subtitle, 'Clients · Care & Support · Daily care')
    assert.equal(s.appHref, `${CLIENTS_PATH}?client=annettekowal&tab=care&view=daily`)
    assert.equal(s.text, 'House: NW4045\nStatus: Active')
  })
})
