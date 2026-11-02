/**
 * LOCATIONS · the model: the address, the switcher's list, every read's tolerant shape, the
 * repair buckets, the incident filters, the documents' APPLIES TO, the supplies' formatting and the forms' payloads.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { HouseRow } from '@/pages/features/houses/houseModel'
import { splitCategories } from '@/lib/incidentCategories'
import {
  ALL_LOCATIONS, INCIDENT_FIELDS, NOT_MEASURED, NOT_OPEN,
  consumptionLine, dayWords, defaultHouse, documentRows, documentsOf, driveIdOf, filterIncidents, houseDocuments,
  isMedErrorCategory, medErrorOnly,
  incidentChoices, incidentClock, incidentDay, incidentPayload, incidentsOf, istCellFor, istPaperProblem, istPaperType,
  locationHref, locationQuery, missingFields, nameKey, noteClient, notesOf, openNotes, overviewOf, panelLabel, panelOf,
  panelParam, panelTitle, policyType, readRefusal, repairCounts, repairEditFields, repairPayload, repairStreet,
  repairTypes,
  repairsOf, scopeHouseRows, scopeOf, sharePayloadFor, shownRepairs, slicePolicies, staffOf, suppliesOf, supplyDraft,
  supplyStatusOf, switcherHouses, tabOf, tabsFor, LOCATION_EDITIONS,
  type PanelAsk,
} from '@/pages/features/locations/locationModel'

function house(over: Partial<HouseRow> = {}): HouseRow {
  return {
    id: 'NW4045', code: 'NW4045', label: 'CAN - NW - NW4045', title: 'Arlington', city: 'Canton', active: true,
    address: '908 Arlington Ave NW, Canton, OH 44708', photo: { src: '', source: '' }, managers: [], leads: [],
    clients: [{ name: 'Kenny Marsh', client_id: 'C1', client_key: 'kennymarsh' }, { name: 'Lia Gomez', client_id: 'C2' }],
    client_count: 2, staff: [], staff_source: '', week_notes: [], policies: [], sources: [], ...over,
  }
}

describe('the address', () => {
  it('a section is one of the seven, anything else is Overview', () => {
    assert.equal(tabOf('staff'), 'staff')
    assert.equal(tabOf('documents'), 'documents')
    assert.equal(tabOf('nope'), 'overview')
    assert.equal(tabOf(null), 'overview')
  })

  it('every panel rides the address and comes back as itself', () => {
    const asks: PanelAsk[] = [
      { kind: 'notes' }, { kind: 'incident' }, { kind: 'repair' }, { kind: 'share' },
      { kind: 'staff', name: 'Noah Reed' }, { kind: 'ist', staff: 'Noah Reed', client: 'Kenny Marsh' },
      { kind: 'repair-row', id: 'r42' }, { kind: 'incident-row', id: 'r7' },
      { kind: 'supply', entry: 'delivery', item: 'Toilet paper' },
    ]
    for (const a of asks) assert.deepEqual(panelOf(panelParam(a)), a, panelParam(a))
    assert.equal(panelOf('doc~policy-2'), null, 'a document opens centred, never in the panel')
    assert.equal(panelOf('cell~9/22/2026~Noah'), null, 'a cell names a day')
    assert.equal(panelOf('supply~steal~x'), null)
    assert.equal(panelOf('whatever'), null)
    assert.equal(panelOf(''), null)
  })

  it('the query carries the house, the section and the panel', () => {
    assert.equal(locationQuery('NW4045', 'overview'), '?house=NW4045')
    assert.equal(locationQuery('NW4045', 'repairs', { kind: 'repair-row', id: 'r42' }), '?house=NW4045&tab=repairs&panel=repair-row%7Er42')
    assert.equal(locationHref('NW4045', 'staff'), '/app/locations/overview?house=NW4045&tab=staff')
  })
})

describe('the switcher', () => {
  const rows = [
    house(),
    house({ id: 'BW1', code: 'BW1001', title: 'Briarwood', address: '1 Briar Rd' }),
    house({ id: 'OLD', code: 'OL2002', title: 'Oldfield', active: false, address: '2 Old Rd' }),
  ]

  it('lists the active houses by title, and the inactive ones only when asked', () => {
    assert.deepEqual(switcherHouses(rows, '', false).map((h) => h.title), ['Arlington', 'Briarwood'])
    const all = switcherHouses(rows, '', true)
    assert.deepEqual(all.map((h) => [h.title, h.active]), [['Arlington', true], ['Briarwood', true], ['Oldfield', false]])
  })

  it("searches the way the Houses grid does, the inactive ones too", () => {
    assert.deepEqual(switcherHouses(rows, 'briar', false).map((h) => h.code), ['BW1001'])
    assert.deepEqual(switcherHouses(rows, 'old', false).map((h) => h.code), [])
    assert.deepEqual(switcherHouses(rows, 'old', true).map((h) => h.code), ['OL2002'])
    assert.deepEqual(switcherHouses(rows, 'kenny', true).map((h) => h.code), ['NW4045', 'BW1001', 'OL2002'])
  })

  it('opens on the first active house by title', () => {
    assert.equal(defaultHouse(rows)?.code, 'NW4045')
    assert.equal(defaultHouse([rows[2]])?.code, 'OL2002')
    assert.equal(defaultHouse([]), null)
  })
})

describe('overview and notes', () => {
  it('the house manager is the hotline calendar\'s ** anchor, then everyone current; the type is null when nothing holds one', () => {
    const o = overviewOf({
      house: { code: 'NW4045', address: '908 Arlington Ave NW', phone: '(555) 010-2102', calendar_link: 'x', type: null },
      manager: { name: 'Marcus Reed', phone: '5550101202', day: '2026-09-20' },
      managers: [{ name: 'marcus reed', phone: '1' }, { name: 'Ada Lane', phone: '2' }],
      manager_why: '', registry_manager: { name: 'Old Name', phone: '9' },
      clients: [{ client_key: 'CK1', name: 'Kenny Marsh' }],
    })
    assert.equal(o.type, null)
    assert.deepEqual(o.managers, [{ name: 'Marcus Reed', phone: '5550101202' }, { name: 'Ada Lane', phone: '2' }], 'one name once, the anchor first')
    assert.deepEqual(o.registryManager, { name: 'Old Name', phone: '9' })
    assert.equal(o.housePhone, '(555) 010-2102')
    assert.equal(o.address, '908 Arlington Ave NW')
    assert.deepEqual(o.clients, [{ client_key: 'CK1', name: 'Kenny Marsh' }])
    const none = overviewOf({ manager: null, managers: [], manager_why: 'the Calendar Archive has no ** row for NW4045' })
    assert.deepEqual(none.managers, [], 'the registry manager never stands in for the calendar\'s')
    assert.equal(none.managersWhy, 'the Calendar Archive has no ** row for NW4045')
    assert.deepEqual(overviewOf(null), {
      type: null, managers: [], managersWhy: '', registryManager: null, housePhone: '', address: '', calendarLink: '',
      registryWhy: '', clients: [], edit: {},
    })
  })

  it('notes come newest first; resolved ones leave the open list', () => {
    const notes = notesOf({ notes: [
      { id: 'n1', details: 'Old', state: 'open', at: '2026-09-20T10:00:00Z', priority: 'normal' },
      { id: 'n2', details: 'New', state: 'OPEN', at: '2026-09-25T10:00:00Z', priority: 'High', client_key: 'CK1', client_name: 'Kenny Marsh' },
      { id: 'n3', details: 'Done', state: 'resolved', at: '2026-09-26T10:00:00Z' },
      { details: 'no id' },
    ] })
    assert.deepEqual(notes.map((n) => n.id), ['n3', 'n2', 'n1'])
    assert.deepEqual(openNotes(notes).map((n) => n.id), ['n2', 'n1'])
    assert.equal(notes[1].priority, 'high')
    assert.equal(noteClient(notes[1], []), 'Kenny Marsh', 'the answer\'s own name')
    assert.equal(noteClient({ clientKey: 'kennymarsh', clientName: '' }, house().clients), 'Kenny Marsh')
    assert.equal(noteClient({ clientKey: '', clientName: '' }, house().clients), '')
  })
})

describe('staff', () => {
  it('each date keeps the source the answer names; one source read names both', () => {
    const s = staffOf({ staff: [
      { name: 'Noah Reed', first_day: '2025-01-06', first_source: 'archive', last_day: '2026-09-23', last_source: 'punches', shifts: 88, sources: ['archive', 'punches'] },
      { name: 'Only Punches', first_day: '2026-06-07', last_day: '2026-09-01', sources: ['punches'] },
      { name: 'Nested', first: { day: '2025-02-01', source: 'archive' }, last: { day: '2025-03-01T00:00:00Z', source: 'archive' }, hm: true },
      { name: 'Unnamed sources', first_day: '2025-01-01', last_day: '2025-02-01', sources: ['archive', 'punches'] },
      { first_day: 'no name' },
    ] })
    const by = Object.fromEntries(s.rows.map((r) => [r.name, r]))
    assert.equal(s.rows[0].name, 'Nested', 'the house manager first')
    assert.deepEqual([by['Noah Reed'].first, by['Noah Reed'].last], [{ day: '2025-01-06', source: 'archive' }, { day: '2026-09-23', source: 'punches' }])
    assert.deepEqual(by['Only Punches'].first, { day: '2026-06-07', source: 'punches' })
    assert.deepEqual(by.Nested.last, { day: '2025-03-01', source: 'archive' })
    assert.equal(by['Unnamed sources'].first.source, '', 'a date whose source is not named keeps none')
    assert.equal(by['Noah Reed'].shifts, 88)
    assert.equal(s.rows.length, 4)
  })

  it('an IST cell is the paper, "Trained" with no paper, Upload — or nothing when no record pairs them', () => {
    const s = staffOf({
      clients: [{ client_key: 'CK1', name: 'Kenny Marsh' }, { client_key: 'CK2', name: 'Lia Gomez' }],
      staff: [{ name: 'Noah Reed', ist: [
        { client: 'Kenny Marsh', id: 'I1', status: 'done', trainedAt: '2026-01-10', docUrl: 'https://drive.google.com/file/d/abcdefghijkl/view', docFileId: 'abcdefghijkl' },
        { client: 'LIA gomez', id: 'I2', status: 'done', trainedAt: '2026-02-11', docUrl: '', docFileId: '' },
        { client: 'Sam Poe', id: 'I3', status: 'owed', trainedAt: '' },
        { client: 'Unpaired', id: '', status: null, trainedAt: '' },
      ] }],
      ist_why: '', sources: { archive: { readable: true, why: '' }, punches: { readable: false, why: 'the PSI punch house is not declared' } },
    })
    const m = s.rows[0]
    assert.deepEqual(s.clients.map((c) => c.name), ['Kenny Marsh', 'Lia Gomez'])
    assert.equal(s.why, 'the PSI punch house is not declared')
    assert.deepEqual(istCellFor(m, 'Kenny Marsh'), { kind: 'paper', fileId: 'abcdefghijkl', at: '2026-01-10' })
    assert.deepEqual(istCellFor(m, 'Lia Gomez'), { kind: 'trained', at: '2026-02-11' })
    assert.deepEqual(istCellFor(m, 'Sam Poe'), { kind: 'upload' }, 'owed is not trained')
    assert.deepEqual(istCellFor(m, 'Unpaired'), { kind: 'none' }, 'no record to file a paper against')
    assert.deepEqual(istCellFor(m, 'Nobody'), { kind: 'none' })
    const byLink = staffOf({ staff: [{ name: 'A', ist: [{ client: 'K', id: 'x', docUrl: 'https://drive.google.com/file/d/zyxwvutsrqpo/view' }] }] })
    assert.deepEqual(istCellFor(byLink.rows[0], 'K'), { kind: 'paper', fileId: 'zyxwvutsrqpo', at: '' }, 'the id from the link')
  })

  it('an IST paper is a PDF or a picture up to 15 MB', () => {
    assert.equal(istPaperProblem({ name: 'ist.pdf', size: 1000, type: 'application/pdf' }), '')
    assert.equal(istPaperType({ name: 'scan.JPG', type: '' }), 'image/jpeg')
    assert.equal(istPaperType({ name: 'scan.jpg', type: 'image/pjpeg' }), 'image/jpeg')
    assert.match(istPaperProblem({ name: 'ist.docx', size: 1000, type: 'application/msword' }), /Only a PDF or a picture/)
    assert.equal(istPaperProblem({ name: 'ist.pdf', size: 0, type: 'application/pdf' }), 'The file is empty.')
    assert.equal(istPaperProblem({ name: 'ist.pdf', size: 15 * 1024 * 1024 + 1, type: 'application/pdf' }), 'The file is over 15 MB.')
  })
})

describe('house repairs', () => {
  const raw = { rows: [
    { id: 'r1', select_address_vehicle: '908 Arlington Ave NW', repair_type: 'Plumbing', urgency_level: '5', please_describe_the_issue: 'Leak', status: '', timestamp: '2026-09-20T12:00:00Z' },
    { id: 'r2', select_address_vehicle: '908 Arlington Ave NW', repair_type: 'Door', urgency_level: '2', please_describe_the_issue: 'Hinge', status: 'Completed', timestamp: '2026-09-10T12:00:00Z' },
    { id: 'r3', select_address_vehicle: '908 Arlington Ave', repair_type: 'plumbing', please_describe_the_issue: 'Drain', status: 'Cancelled', timestamp: '2026-09-11T12:00:00Z' },
    { id: 'r4', select_address_vehicle: 'ALL', repair_type: 'Roof', please_describe_the_issue: 'Gutters', status: 'In Progress', timestamp: '2026-09-25T12:00:00Z', whole_estate: true },
  ] }

  it('the open list by default; Show resolved adds Completed and Cancelled; newest first', () => {
    const rows = repairsOf(raw)
    assert.deepEqual(shownRepairs(rows, false).map((r) => r.id), ['r4', 'r1'])
    assert.deepEqual(shownRepairs(rows, true).map((r) => r.id), ['r4', 'r1', 'r3', 'r2'])
    assert.deepEqual(repairCounts(rows), { open: 2, resolved: 2 })
    assert.equal(rows.find((r) => r.id === 'r4')?.wholeEstate, true)
    assert.equal(repairsOf({ rows: [{ id: 'x', select_address_vehicle: 'All' }] })[0].wholeEstate, true, 'ALL is the whole estate')
  })

  it('the edit panel opens at the status, urgency picked 1 to 5, the house and the filing locked with no words', () => {
    const r = repairsOf(raw).find((x) => x.id === 'r1')!
    const fields = repairEditFields(r, ['Plumbing', 'Door'])
    assert.deepEqual(fields.map((f) => f.key), ['status', 'select_address_vehicle', 'timestamp', 'repair_type',
      'urgency_level', 'please_describe_the_issue', 'resolution_notes'])
    const urgency = fields.find((f) => f.key === 'urgency_level')!
    assert.equal(urgency.kind, 'select')
    assert.deepEqual(urgency.options, ['1', '2', '3', '4', '5'])
    assert.equal(urgency.hint, undefined)
    for (const key of ['select_address_vehicle', 'timestamp']) {
      assert.deepEqual(fields.find((f) => f.key === key)?.lockedBy, {})
    }
    assert.equal(panelTitle({ kind: 'repair-row', id: 'r1' }, { title: '38TH - ABD2005' }), '')
  })

  it('the street is spelled as the Repairs tab already spells it', () => {
    const rows = repairsOf(raw)
    assert.equal(repairStreet({ street: 'As Told' }, rows, 'fallback'), 'As Told')
    assert.equal(repairStreet({}, rows, 'fallback'), '908 Arlington Ave NW')
    const matched = repairsOf({ rows: [
      { id: 'a', select_address_vehicle: '908 Arlington', match: 'street_number' },
      { id: 'b', select_address_vehicle: '908 Arlington', match: 'street_number' },
      { id: 'c', select_address_vehicle: '908 Arlington Ave NW', match: 'exact' },
    ] })
    assert.equal(repairStreet({}, matched, 'fallback'), '908 Arlington Ave NW', 'a row tied by its street spells it')
    assert.equal(repairStreet({}, [], '908 Arlington Ave NW, Canton, OH 44708'), '908 Arlington Ave NW, Canton, OH 44708')
    assert.deepEqual(repairTypes(rows), ['Plumbing', 'Door', 'Roof'])
  })

  it('a new request carries the form\'s columns and when, never a status', () => {
    const fields = [{ key: 'select_address_vehicle', label: 'House', required: true }, { key: 'repair_type', label: 'Type', required: true }]
    assert.deepEqual(repairPayload(fields, { select_address_vehicle: ' 908 Arlington Ave NW ', repair_type: 'Door', status: 'Completed' }, 'T'),
      { select_address_vehicle: '908 Arlington Ave NW', repair_type: 'Door', timestamp: 'T' })
  })
})

describe('incidents', () => {
  const raw = { rows: [
    { id: 'r1', your_name: 'Ann', client_name: 'Kenny Marsh', incident_category: 'Fall, Minor injury or illness (rash, bruise, small cut)', incident_location: 'Home', incident_date: '2026-09-20', incident_time: '14:05' },
    { id: 'r2', your_name: 'Bo', client_name: 'Lia Gomez', incident_category: 'Medication error', incident_date: '9/24/26', incident_time: '1899-12-30T13:32:11Z' },
    { your_name: 'Cy', client_name: 'kenny marsh', incident_category: 'Fall', incident_date: '2026-09-01T04:00:00Z', row: { summary_of_incident: 'Slipped' } },
  ] }

  it('newest first, the category split on its own commas, the full row kept', () => {
    const rows = incidentsOf(raw)
    assert.deepEqual(rows.map((r) => r.id), ['r2', 'r1', 'ui-2'])
    assert.deepEqual(rows[1].categories, ['Fall', 'Minor injury or illness (rash, bruise, small cut)'])
    assert.deepEqual(rows[1].categories, splitCategories(raw.rows[0].incident_category))
    assert.equal(rows[2].row.summary_of_incident, 'Slipped')
  })

  it('the answer\'s own split wins, and the panel\'s row keeps only the sheet\'s fields', () => {
    const [r] = incidentsOf({ rows: [{ id: 'r9', client_name: 'Kenny Marsh', client_key: 'kenny_marsh',
      incident_category: 'Fall, Minor injury or illness (rash, bruise)', categories: ['Fall', 'Minor injury or illness (rash, bruise)'],
      row: { id: 'r9', summary_of_incident: 'x' } }] })
    assert.deepEqual(r.categories, ['Fall', 'Minor injury or illness (rash, bruise)'])
    assert.ok(!('categories' in r.row) && !('client_key' in r.row) && r.row.summary_of_incident === 'x')
  })

  it('filters by client (folded) and by category; empty is All', () => {
    const rows = incidentsOf(raw)
    const choices = incidentChoices(rows)
    assert.deepEqual(choices.clients, ['Kenny Marsh', 'Lia Gomez'])
    assert.equal(choices.categories[0], 'Fall', 'the most used first')
    assert.equal(filterIncidents(rows, '', '').length, 3)
    assert.deepEqual(filterIncidents(rows, 'Kenny Marsh', '').map((r) => r.id), ['r1', 'ui-2'])
    assert.deepEqual(filterIncidents(rows, '', 'Medication error').map((r) => r.id), ['r2'])
    assert.deepEqual(filterIncidents(rows, 'Kenny Marsh', 'Fall').map((r) => r.id), ['r1', 'ui-2'])
    assert.deepEqual(filterIncidents(rows, 'Lia Gomez', 'Fall'), [])
  })

  it('med errors hide while asked to, unless the category chosen is one; an incident that is more than one stays', () => {
    for (const c of ['Medication related error', 'Medication Error', 'Medication Documentation Error', 'Medication related error / minor injury']) {
      assert.ok(isMedErrorCategory(c), c)
    }
    for (const c of ['Fall', 'Taken to the hospital', 'Medication refusal', 'Minor Issue (Schedule/Late/Verbal Tension)']) {
      assert.ok(!isMedErrorCategory(c), c)
    }
    const rows = incidentsOf(raw)
    const med = rows.filter((r) => r.categories.every(isMedErrorCategory)).map((r) => r.id)
    assert.ok(med.length > 0, 'the sample holds a med error')
    assert.ok(filterIncidents(rows, '', '', false).every((r) => !med.includes(r.id)))
    assert.deepEqual(filterIncidents(rows, '', 'Medication error', false).map((r) => r.id), ['r2'], 'chosen, it shows')
    const mixed = { ...rows[0], categories: ['Medication related error', 'Taken to the hospital'] }
    assert.ok(!medErrorOnly(mixed) && filterIncidents([mixed], '', '', false).length === 1)
  })

  it('dates on Ohio\'s clock; a typed day as typed; the 1899 carrier blank', () => {
    assert.equal(incidentDay('2026-09-20'), 'Sep 20, 2026')
    assert.equal(incidentDay('9/24/26'), 'Sep 24, 2026')
    assert.equal(incidentDay('2026-09-01T04:00:00Z'), 'Sep 1, 2026')
    assert.equal(incidentDay(''), '—')
    assert.equal(incidentClock('14:05'), '14:05')
    assert.equal(incidentClock('1899-12-30T13:32:11Z'), '')
    assert.equal(incidentClock('2026-09-01T18:30:00Z'), '2:30 PM')
  })

  it('a new incident names who filed it and when, and only the form\'s columns', () => {
    const p = incidentPayload({ client_name: 'Kenny Marsh', incident_category: 'Fall', incident_date: '2026-09-27', summary_of_incident: ' Slipped ', your_name: 'forged', extra: 'x' }, 'Maya Chen', 'T')
    assert.deepEqual(p, { client_name: 'Kenny Marsh', incident_category: 'Fall', incident_date: '2026-09-27', summary_of_incident: 'Slipped', your_name: 'Maya Chen', timestamp: 'T' })
    // category, location, date and the four narratives
    assert.deepEqual(missingFields(INCIDENT_FIELDS, { client_name: 'K' }).length, 7)
    const other = incidentPayload({ incident_location: 'Other', incident_location_other: ' Day program ' }, 'M', 'T')
    assert.equal(other.incident_location, 'Other: Day program')
    assert.ok(!('incident_location_other' in other))
    assert.equal(incidentPayload({ incident_location: 'Community' }, 'M', 'T').incident_location, 'Community')
  })
})

describe('documents', () => {
  const policies = ['Company Policies', 'Medical Policies and Procedures', 'Med Del Cat 1', 'Med Del Cat 2', 'Med Del Cat 3 Part 1',
    'Med Del Cat 3 Part 2', 'Bill of Rights - ER', 'MUI Handbook'].map((title, i) => ({ title, url: `https://drive.google.com/file/d/slice${i}xxxxxx/view`, audience: 'all' }))

  it('"Med Del" is Medication Delivery; every other company document is a Policy', () => {
    assert.equal(policyType('Med Del Cat 3 Part 2'), 'Medication Delivery')
    assert.equal(policyType('MUI Handbook'), 'Policy')
    assert.equal(policyType('Medical Policies and Procedures'), 'Policy')
  })

  it('APPLIES TO: all locations, the client, the house — or no guidebook on file; every row names its Drive file', () => {
    const docs = documentsOf({
      policies: policies.map((p, i) => ({ title: p.title, url: p.url, drive_id: `pol${i}xxxxxxxx` })),
      isps: [{ client: 'Kenny Marsh', isp_doc_url: 'https://docs.google.com/document/d/isp1xxxxxxxx/edit', isp_doc_id: 'isp1xxxxxxxx',
        isp_doc_name: 'Kenny ISP 2026', isp_year: '2026' }],
      guidebook: null, guidebook_why: 'no folder in the houses room names NW4045',
    })
    const rows = documentRows(slicePolicies(policies), docs, 'Arlington', house().clients)
    assert.equal(rows.length, 9, 'no placeholder row for a house with no guidebook')
    assert.ok(rows.slice(0, 8).every((d) => d.applies === ALL_LOCATIONS && d.appliesTo === 'all'))
    assert.equal(rows[0].fileId, 'pol0xxxxxxxx', 'the answer\'s own company list')
    assert.deepEqual(rows.slice(0, 8).map((d) => d.type).filter((t) => t === 'Medication Delivery').length, 4)
    assert.deepEqual([rows[8].type, rows[8].applies, rows[8].clientId, rows[8].title, rows[8].fileId],
      ['ISP', 'Kenny Marsh', 'C1', 'Kenny ISP 2026', 'isp1xxxxxxxx'])
    const withBook = documentRows(slicePolicies(policies), documentsOf({ isps: [], guidebook: { folder_id: 'f', folder_name: 'NW4045 Arlington',
      files: [{ id: 'notes1xxxxxx', name: 'House rules.pdf', guide: false }, { id: 'guide1xxxxxx', name: 'Arlington Guidebook', guide: true }] } }), 'Arlington')
    assert.deepEqual(withBook.slice(8).map((d) => [d.title, d.type, d.applies, d.fileId]), [
      ['House rules.pdf', 'House document', 'Arlington', 'notes1xxxxxx'],
      ['Arlington Guidebook', 'Guidebook', 'Arlington', 'guide1xxxxxx'],
    ])
    assert.deepEqual([withBook[0].title, withBook[0].fileId], ['Company Policies', ''],
      'an answer that carries no company list: the slice\'s titles, with no file the door would refuse')
    assert.equal(docs.guidebookWhy, 'no folder in the houses room names NW4045')
    assert.equal(documentsOf({ guidebook: { folder_name: 'x', files: [] }, guidebook_why: '' }).guidebookWhy, '')
  })

  it('before the read answers, only the company documents are listed', () => {
    assert.equal(houseDocuments(house({ policies }), null).length, 8)
    assert.equal(driveIdOf('https://drive.google.com/file/d/abcdefghijkl/view'), 'abcdefghijkl')
    assert.equal(driveIdOf('https://drive.google.com/open?id=abcdefghijkl'), 'abcdefghijkl')
    assert.equal(driveIdOf('https://example.org/x'), '')
  })
})

describe('house supplies', () => {
  it('a consumption the ledger cannot measure says so — never 0', () => {
    const s = suppliesOf({ ledger_ready: true, ledger_why: '', assets_why: '', consumables: [
      { item: 'Toilet paper', category: 'Household', in_stock: 36, par: 24, status: 'in_stock', checked: '2026-09-23', consumption: 12,
        last_delivery: { at: '2026-09-10', qty: 48, on_hand_after: null }, days_of_cover: 18, measured: true },
      { item: 'Gloves', category: 'Care supplies', in_stock: '3', par: '8', status: 'order_now', consumption: null, last_delivery: null },
      { item: 'Soap', in_stock: 4, par: 6, status: 'low' },
    ], assets: [{ item: 'Fridge', address: '908 Arlington Ave NW', current_condition: 'Good' }] })
    const by = Object.fromEntries(s.consumables.map((c) => [c.item, c]))
    assert.equal(consumptionLine(by.Gloves), NOT_MEASURED)
    assert.equal(consumptionLine(by.Soap), NOT_MEASURED)
    assert.equal(consumptionLine(by['Toilet paper']), '12 used since Sep 10, 2026')
    assert.deepEqual([by['Toilet paper'].status, by.Gloves.status, by.Soap.status], ['In stock', 'Order now', 'Low'])
    assert.equal(by.Gloves.onHand, 3)
    assert.equal(by['Toilet paper'].daysCover, 18)
    assert.equal(supplyStatusOf('whatever'), '')
    assert.equal(s.assets.length, 1)
    assert.equal(s.ledgerReady, true)
    const shut = suppliesOf({ ledger_ready: false, ledger_why: 'the houseSupplies house is not declared', consumables: [], assets: [] })
    assert.deepEqual([shut.ledgerReady, shut.ledgerWhy], [false, 'the houseSupplies house is not declared'])
  })

  it('an entry names the item and a count; a delivery may give what is on hand after it', () => {
    const base = { kind: 'delivery' as const, item: ' Gloves ', category: 'Care', qty: '200', onHandAfter: '', note: '' }
    assert.deepEqual(supplyDraft('NW4045', base), { house: 'NW4045', item: 'Gloves', category: 'Care', kind: 'delivery', qty: 200 })
    assert.deepEqual(supplyDraft('NW4045', { ...base, onHandAfter: '203', note: 'box' }),
      { house: 'NW4045', item: 'Gloves', category: 'Care', kind: 'delivery', qty: 200, on_hand_after: 203, note: 'box' })
    assert.equal(supplyDraft('NW4045', { ...base, item: '' }), 'Name the item.')
    assert.match(String(supplyDraft('NW4045', { ...base, qty: '-1' })), /zero or more/)
    assert.match(String(supplyDraft('NW4045', { ...base, onHandAfter: 'lots' })), /On hand after/)
    assert.equal((supplyDraft('NW4045', { ...base, kind: 'count', onHandAfter: '9' }) as { on_hand_after?: number }).on_hand_after, undefined,
      'only a delivery carries on_hand_after')
  })
})

describe('the rest', () => {
  it('"Unknown action." is the closed gate\'s answer, said plainly', () => {
    assert.equal(readRefusal('Unknown action.'), NOT_OPEN)
    assert.equal(NOT_OPEN, 'This part is not open to you.')
    assert.equal(readRefusal('No house "X".'), 'No house "X".')
  })

  it('names fold the way Apps Script folds them', () => {
    assert.equal(nameKey('  Kenny  Marsh-Jr. '), 'kennymarshjr')
  })

  it('days read as themselves', () => {
    assert.equal(dayWords('2025-01-06'), 'Jan 06, 2025')
    assert.equal(dayWords(''), '')
  })

  it('the panel is headed by what it holds', () => {
    const h = house()
    assert.equal(panelLabel({ kind: 'notes' }), 'House Notes')
    assert.equal(panelTitle({ kind: 'share' }, h), h.title)
    assert.equal(panelTitle({ kind: 'supply', entry: 'delivery', item: '' }, h), 'Record delivery')
  })

  it('a share is a deep link to the house and the section', () => {
    const p = sharePayloadFor(house(), 'staff', overviewOf({ manager: { name: 'Marcus Reed', phone: '555' }, house: { phone: '777' } }))
    assert.equal(p.appHref, '/app/locations/overview?house=NW4045&tab=staff')
    assert.equal(p.title, 'Arlington')
    assert.match(p.text ?? '', /House manager: Marcus Reed · 555/)
    assert.equal(p.url, undefined, 'the page itself, never a document link')
  })
})

describe('the viewer\'s scope', () => {
  it('every house for STAFF, no write; the master alone writes', () => {
    assert.deepEqual(scopeOf({ kind: 'all', writes: false, cut: false, houses: null }),
      { kind: 'all', writes: false, editions: [], cut: false, houses: null, why: '' })
    assert.equal(scopeOf({ kind: 'master', writes: true, cut: false, houses: null }).writes, true)
    assert.equal(scopeOf({ kind: 'all', writes: true, houses: null }).writes, false, 'only the master writes')
  })

  it('the editions: every one for the master, the ones the server names for anybody else, none in a cut view', () => {
    assert.deepEqual(scopeOf({ kind: 'master', writes: true, cut: false, houses: null }).editions, LOCATION_EDITIONS)
    assert.equal(LOCATION_EDITIONS.length, 8)
    assert.deepEqual(scopeOf({ kind: 'all', writes: false, cut: false, houses: null,
      editions: ['locations.documents', 'nope.edition', 'locations.house'] }).editions, ['locations.house', 'locations.documents'],
      'catalogue order, an unknown one dropped')
    assert.deepEqual(scopeOf({ kind: 'client', cut: true, editions: ['locations.house'], houses: [] }).editions, [],
      'a cut view makes none, whatever it is told')
  })

  it('a client and an SSA are held to their houses and cut; anything unknown is held to nothing and cut', () => {
    const client = scopeOf({ kind: 'client', writes: false, cut: true, why: '',
      houses: [{ code: 'nw4045', home_name: 'CAN - NW - NW4045', address: '908 Arlington Ave NW', thumbnail_url: 'https://x/p.jpg',
        client_count: 3, clients: [{ client_key: 'kennymarsh', name: 'Kenny Marsh' }] }] })
    assert.deepEqual([client.cut, client.houses?.map((h) => [h.code, h.title, h.clientCount, h.clients.length])],
      [true, [['NW4045', 'CAN - NW - NW4045', 3, 1]]])
    const ssa = scopeOf({ kind: 'ssa', cut: false, editions: ['locations.house'], houses: [{ code: 'NW4045', clients: [] }] })
    assert.deepEqual([ssa.cut, ssa.houses?.length, ssa.editions], [true, 1, []],
      'an SSA is narrowed like a client or a family: cut whatever the answer says, no edition')
    const odd = scopeOf({ kind: 'someday', cut: false })
    assert.deepEqual([odd.cut, odd.houses, odd.writes], [true, [], false])
    assert.deepEqual(scopeOf(null).houses, [], 'no answer is no house')
  })

  it('a scope\'s houses draw as house rows: the switcher\'s title, the photo, only the clients the answer named', () => {
    const [row] = scopeHouseRows(scopeOf({ kind: 'guardian', cut: true, houses: [{ code: 'NW4045', home_name: 'Arlington',
      address: '908 Arlington Ave NW', thumbnail_url: 'https://x/p.jpg', client_count: 2,
      clients: [{ client_key: 'liagomez', name: 'Lia Gomez' }] }] }).houses ?? [])
    assert.deepEqual([row.code, row.title, row.active, row.photo.src, row.client_count, row.clients],
      ['NW4045', 'Arlington', true, 'https://x/p.jpg', 2, [{ name: 'Lia Gomez', client_key: 'liagomez' }]])
    assert.deepEqual(switcherHouses([row], '', false).map((h) => h.code), ['NW4045'])
  })

  it('a cut view has no House Calendar; everyone else has every section', () => {
    assert.ok(!tabsFor(true).some((t) => t.id === 'calendar'))
    assert.equal(tabsFor(false).length, 7)
  })

  it('a withheld guidebook is no row at all, never "No guidebook on file"', () => {
    const docs = documentsOf({ policies: [], isps: [], guidebook: null, guidebook_why: '', guidebook_withheld: true })
    assert.equal(docs.withheld, true)
    assert.ok(!documentRows([], docs, 'Arlington').some((d) => d.type === 'Guidebook'))
    assert.equal(documentsOf({ guidebook: null, guidebook_why: 'none' }).withheld, false)
  })
})
