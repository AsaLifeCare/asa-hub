// CLIENTS · THE PROFILE, CARE, MEDICATION AND TRANSPORTATION EDITIONS — their Settings › Editions rows under Clients (key
// off, nobody), the pencils a holder is offered (never a protected cell or a family member), their Apply strips, JSON first.
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { EDITION_IDS, editionsByApp, editionsFrom } from '@/lib/editions'
import { EditionsView } from '@/pages/settings/EditionsSection'
import { runApply, type ApplyDeps, type ApplyState, type SheetSettled } from '@/pages/features/locations/locationApply'
import ApplyStrip from '@/pages/features/locations/ApplyStrip'
import {
  ASK_EDITION, EDIT_FIELDS, OWN_DOORS, careOf, clientEditFields, mayOpenAsk, medsOf, profileOf, type ClientAsk, type RosterRow,
} from '@/pages/features/clientprofiles/clientModel'
import { ClientReaderContext, clientCan, type ClientReader } from '@/pages/features/clientprofiles/clientViewer'
import {
  CLIENT_REREAD, clientTarget, readClientEditions, readKey, type ReadState,
} from '@/pages/features/clientprofiles/useClientRead'
import { ProfileView } from '@/pages/features/clientprofiles/sections/Profile'
import { CareBody } from '@/pages/features/clientprofiles/sections/Care'
import MedicationSection from '@/pages/features/clientprofiles/sections/Medication'
import { CareEditBody, MedEditBody } from '@/pages/features/clientprofiles/ClientPanel'
import { AddMedicationForm } from '@/pages/features/clientprofiles/ClientForms'
import { TransportPanel } from '@/pages/features/clientprofiles/sources/TransportTab'
import { transportOf } from '@/pages/features/clientprofiles/sources/transport'
import { transportTarget } from '@/pages/features/clientprofiles/useClientRead'
import TripPanel from '@/pages/features/vehiclecalendar/TripPanel'
import { boardFrom } from '@/pages/features/vehiclecalendar/vehicleCalendarModel'
import { readClientBoard } from '@/pages/features/vehiclecalendar/vehicleCalendarLane'
import { SHELL_SHOWN, primeShellHides } from '@/lib/myWorkHides'

// the parts Settings › My Work can hide are drawn as the master's own session sees them
primeShellHides(SHELL_SHOWN)

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const noop = () => {}
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))
const as = (reader: ClientReader, node: ReactNode) =>
  draw(<ClientReaderContext.Provider value={reader}>{node}</ClientReaderContext.Provider>)
const ready = <T,>(data: T): ReadState<T> => ({ status: 'ready', data, error: '', refreshing: false })

const MASTER: ClientReader = { viewer: 'master', mayWrite: true }
const HOLDER: ClientReader = { viewer: 'all', mayWrite: false, editions: ['clients.profile'] }
const STAFF: ClientReader = { viewer: 'all', mayWrite: false }
const OTHER_EDITION: ClientReader = { viewer: 'all', mayWrite: false, editions: ['locations.house'] }
const FAMILY: ClientReader = { viewer: 'guardian', mayWrite: false,
  editions: ['clients.profile', 'clients.care', 'clients.medication', 'clients.transportation'] }
const CARER: ClientReader = { viewer: 'all', mayWrite: false, editions: ['clients.care'] }
const MEDIC: ClientReader = { viewer: 'all', mayWrite: false, editions: ['clients.medication'] }
const RIDER: ClientReader = { viewer: 'all', mayWrite: false, editions: ['clients.transportation'] }

const C: RosterRow = { client_key: 'kay9', client_id: 'CLI_kay9', name: 'Kay Nine', status: 'active', house: 'ZZ9999', avatar: '', isp_year: '2026' }

const CLIENT_ROWS: Record<string, { label: string; description: string }> = {
  'clients.profile': { label: 'Client profile — the details',
    description: 'Edit a client\'s profile: the details the master edits today (contact, house, initials, ISP signed date…).' },
  'clients.care': { label: 'Care — daily care, health, goals and home',
    description: 'Edit, hide or add a client\'s care record in Care & Support, kept in the Hub over the plan.' },
  'clients.family': { label: 'Family members — correct, hide or add',
    description: 'Correct, hide or add a family member over the plan\'s important people.' },
  'clients.medication': { label: 'Medication — add, change or remove a medication',
    description: 'Add a medication to a client\'s eMAR chart, change one or take one off the chart.' },
  'clients.transportation': { label: 'Transportation — change or cancel a client\'s trip',
    description: 'Open a client\'s trip in the Transportation app\'s own trip panel and change or cancel it.' },
}

/** The other apps' rows, by the id's own prefix (app/editions.py). */
const APP_OF: Record<string, [string, string]> = {
  staff: ['staff-profiles', 'Staff'], ssa: ['ssa-profiles', 'SSA'], family: ['family-profiles', 'Families & Guardians'],
  scheduling: ['scheduling', 'Scheduling'], transportation: ['vehicle-calendar', 'Transportation'],
  emergencyContacts: ['emergency-contacts', 'Emergency Contacts'], candidates: ['staff-candidates', 'Staff Candidates'],
  clientCandidates: ['client-candidates', 'Client Candidates'], certDocs: ['cert-docs', 'Compliance documents'],
  myCalendar: ['my-calendar', 'My Calendar'], myInbox: ['my-inbox', 'My Inbox'],
  smartComms: ['smart-comms', 'Smart Comms'], forms: ['forms', 'Forms'], docs: ['docs', 'Docs'],
  support: ['support-desk', 'Support Requests'], learning: ['learning', 'Learning'],
  recon: ['time-recon', 'Time Reconciliation'],
}

/** The server's answer as the editions ship: the Locations ones, the four of Clients, then Staff's, SSA's and Families'. */
const SHIPPED = EDITION_IDS.map((id) => {
  const [app, appName] = APP_OF[id.split('.')[0]] ?? ['locations', 'Locations']
  return { id, ...(CLIENT_ROWS[id]
    ? { app: 'client-profiles', app_name: 'Clients', ...CLIENT_ROWS[id] }
    : { app, app_name: appName, label: `Label ${id}`, description: `What ${id} lets a person change.` }),
  on: false, people: [] as string[] }
})

describe('Settings › Editions: the client profile, care, medication and transportation rows', () => {
  it('ship under Clients, after the Locations rows, each key off and nobody listed', () => {
    const list = editionsFrom(SHIPPED)
    assert.deepEqual(editionsByApp(list).map((g) => [g.app, g.appName, g.editions.map((e) => e.id)]), [
      ['locations', 'Locations', EDITION_IDS.filter((id) => id.startsWith('locations.'))],
      ['client-profiles', 'Clients',
        ['clients.profile', 'clients.care', 'clients.family', 'clients.medication', 'clients.transportation']],
      ['staff-profiles', 'Staff', EDITION_IDS.filter((id) => id.startsWith('staff.'))],
      ['ssa-profiles', 'SSA', ['ssa.profile', 'ssa.notes', 'ssa.documents', 'ssa.activity']],
      ['family-profiles', 'Families & Guardians', EDITION_IDS.filter((id) => id.startsWith('family.'))],
      ['scheduling', 'Scheduling', ['scheduling.calendar', 'scheduling.swaps', 'scheduling.builder', 'scheduling.settings',
        'scheduling.timeOffApprove']],
      ['vehicle-calendar', 'Transportation',
        ['transportation.trips', 'transportation.vehicles', 'transportation.settings']],
      ['emergency-contacts', 'Emergency Contacts', ['emergencyContacts.directory']],
      ['staff-candidates', 'Staff Candidates', ['candidates.information', 'candidates.pipeline', 'candidates.notes',
        'candidates.interviews', 'candidates.documents']],
      ['client-candidates', 'Client Candidates', ['clientCandidates.information', 'clientCandidates.intake',
        'clientCandidates.pipeline', 'clientCandidates.notes', 'clientCandidates.documents']],
      ['cert-docs', 'Compliance documents', ['certDocs.review']],
      ['my-calendar', 'My Calendar', ['myCalendar.anyone']],
      ['my-inbox', 'My Inbox', ['myInbox.anyone', 'myInbox.directors']],
      ['smart-comms', 'Smart Comms', ['smartComms.words', 'smartComms.switch', 'smartComms.audience', 'smartComms.pacing',
        'smartComms.ai', 'smartComms.recording', 'smartComms.replies']],
      ['forms', 'Forms', ['forms.answers', 'forms.links']],
      ['docs', 'Docs', ['docs.library']],
      ['support-desk', 'Support Requests', ['support.requests', 'support.settings']],
      ['learning', 'Learning', ['learning.skills']],
      ['time-recon', 'Time Reconciliation', ['recon.review', 'recon.settings']]])
    const html = draw(<EditionsView list={list} people={[]} busy={false} onKey={noop} onChoose={noop} />)
    const locations = html.indexOf('data-editions-app="locations"')
    const clients = html.indexOf('data-editions-app="client-profiles"')
    assert.ok(locations !== -1 && clients > locations, 'the Clients group stands next to the Locations one')
    const row = html.slice(html.indexOf('data-edition="clients.profile"'))
    assert.match(html.slice(clients), />Clients</)
    assert.match(row, /data-edition-key="clients\.profile"/)
    assert.match(row, /aria-label="Client profile — the details key"/)
    assert.match(row, /Off/)
    assert.match(row, /Edit a client&#x27;s profile/)
    assert.match(row, /data-edition-nobody[^>]*>Nobody but you\./)
    assert.match(row, /data-edition-choose="clients\.profile"/)
    const care = html.slice(html.indexOf('data-edition="clients.care"'))
    assert.ok(html.indexOf('data-edition="clients.care"') > html.indexOf('data-edition="clients.profile"'))
    assert.match(care, /data-edition-key="clients\.care"/)
    assert.match(care, /aria-label="Care — daily care, health, goals and home key"/)
    assert.match(care, /Off/)
    assert.match(care, /data-edition-nobody[^>]*>Nobody but you\./)
    assert.match(care, /data-edition-choose="clients\.care"/)
    const meds = html.slice(html.indexOf('data-edition="clients.medication"'))
    assert.ok(html.indexOf('data-edition="clients.medication"') > html.indexOf('data-edition="clients.care"'))
    assert.match(meds, /data-edition-key="clients\.medication"/)
    assert.match(meds, /aria-label="Medication — add, change or remove a medication key"/)
    assert.match(meds, /Off/)
    assert.match(meds, /data-edition-nobody[^>]*>Nobody but you\./)
    assert.match(meds, /data-edition-choose="clients\.medication"/)
    const trips = html.slice(html.indexOf('data-edition="clients.transportation"'))
    assert.ok(html.indexOf('data-edition="clients.transportation"') > html.indexOf('data-edition="clients.medication"'))
    assert.match(trips, /data-edition-key="clients\.transportation"/)
    assert.match(trips, /aria-label="Transportation — change or cancel a client&#x27;s trip key"/)
    assert.match(trips, /Off/)
    assert.match(trips, /data-edition-nobody[^>]*>Nobody but you\./)
    assert.match(trips, /data-edition-choose="clients\.transportation"/)
  })
})

describe('who is offered the profile edit', () => {
  it('the master always; a listed holder its own edition; never another edition\'s holder or a family\'s own view', () => {
    assert.equal(clientCan(MASTER, 'clients.profile'), true)
    assert.equal(clientCan(HOLDER, 'clients.profile'), true)
    for (const r of [STAFF, OTHER_EDITION, FAMILY]) assert.equal(clientCan(r, 'clients.profile'), false, r.viewer)
    const asks: ClientAsk[] = [{ kind: 'edit-profile' }, { kind: 'add-client' }, { kind: 'family-edit', id: 'new' },
      { kind: 'add-medication' }, { kind: 'share' }]
    assert.deepEqual(asks.map((a) => mayOpenAsk(HOLDER, a)), [true, false, false, false, true])
    assert.deepEqual(asks.map((a) => mayOpenAsk(STAFF, a)), [false, false, false, false, true])
    assert.ok(asks.every((a) => mayOpenAsk(MASTER, a)))
    assert.deepEqual(ASK_EDITION, { 'edit-profile': 'clients.profile', 'care-add': 'clients.care',
      'family-edit': 'clients.family', 'add-medication': 'clients.medication' })
  })

  it('the details pencil is drawn for the master and the holder; the master\'s other pencils stay the master\'s', () => {
    const p = profileOf({ client: { client_key: 'kay9', name: 'Kay Nine', status: 'active' } })
    const pencil = (r: ClientReader) => as(r, <ProfileView client={C} profile={ready(p)} today="2026-10-08" onAsk={noop} onRetry={noop} />)
    assert.ok(pencil(MASTER).includes('Edit client details'))
    assert.ok(pencil(HOLDER).includes('Edit client details'))
    assert.ok(!pencil(HOLDER).includes('Add a family member'))
    for (const r of [STAFF, OTHER_EDITION, FAMILY]) assert.ok(!pencil(r).includes('Edit client details'), r.viewer)
  })

  it('the holder\'s panel: every profile field on its raw value; the name and the status locked to their own doors, ' +
     'the protected cells locked', () => {
    const raw = Object.fromEntries(EDIT_FIELDS.map((f) => [f.key, '']))
    const p = profileOf({ client: { client_key: 'kay9', name: 'Kay Nine', status: 'active' },
      edit: { ...raw, outcome: 'Work', name: 'Kay Nine', status: 'Active', house: 'ZZ9999' },
      houses: [{ code: 'ZZ9999', name: 'ZZ - Test' }] })
    const holder = clientEditFields(p, false)
    const locked = holder.filter((f) => f.lockedBy)
    assert.deepEqual(locked.map((f) => f.key), ['name', 'status', 'ssn', 'tl_card', 'dc_exp', 'dc_security_code', 'dc_pin'])
    assert.deepEqual(locked.slice(0, 2).map((f) => f.lockedBy), [OWN_DOORS, OWN_DOORS])
    assert.ok(EDIT_FIELDS.every((s) => holder.some((f) => f.key === s.key && !f.lockedBy)), 'every profile field is open')
    assert.deepEqual(clientEditFields(p).filter((f) => f.lockedBy).map((f) => f.key),
      ['ssn', 'tl_card', 'dc_exp', 'dc_security_code', 'dc_pin'], 'the master renames and sets the status')
  })
})

describe('who is offered the care edit', () => {
  const daily = careOf({ tab: 'daily', statuses: ['Current'], absent: [], why: '', rows: [
    { id: 'isp_kay9_personal_care', record: 'Personal care', date: '2026-01-02', details: 'Needs prompts.', status: 'Current',
      source: 'ISP 2026', text: 'Needs prompts.', edit: { record: 'Personal care', removed: '' } }] })
  const body = (r: ClientReader, view: 'daily' | 'plans' = 'daily') =>
    as(r, <CareBody view={view} care={ready(daily)} onView={noop} onAsk={noop} onRetry={noop} />)

  it('the master always; a listed holder of the care edition; never the profile\'s holder alone or a family\'s own view', () => {
    assert.equal(clientCan(MASTER, 'clients.care'), true)
    assert.equal(clientCan(CARER, 'clients.care'), true)
    for (const r of [HOLDER, STAFF, OTHER_EDITION, FAMILY]) assert.equal(clientCan(r, 'clients.care'), false, r.viewer)
    const asks: ClientAsk[] = [{ kind: 'care-add', view: 'daily' }, { kind: 'family-edit', id: 'new' }, { kind: 'edit-profile' },
      { kind: 'record', section: 'care', view: 'daily', id: 'isp_kay9_personal_care' }]
    assert.deepEqual(asks.map((a) => mayOpenAsk(CARER, a)), [true, false, false, true])
    assert.deepEqual(asks.map((a) => mayOpenAsk(HOLDER, a)), [false, false, true, true])
    assert.deepEqual(asks.map((a) => mayOpenAsk(FAMILY, a)), [false, false, false, true])
  })

  it('Add a care record is drawn for the master and the care holder on the tabs the Hub corrects, never on Care plans', () => {
    assert.ok(body(MASTER).includes('Add a care record'))
    assert.ok(body(CARER).includes('Add a care record'))
    assert.ok(!body(CARER, 'plans').includes('Add a care record'))
    for (const r of [HOLDER, STAFF, FAMILY]) assert.ok(!body(r).includes('Add a care record'), r.viewer)
  })

  it('the care panel: an aside with title, text and hide on the row as read (no hide for a new row); each tab its own reread', () => {
    const html = draw(<CareEditBody client={C} view="daily" row={daily.rows[0]} onDone={noop} />)
    assert.match(html, /data-care-edit-panel="isp_kay9_personal_care"/)
    assert.match(html, /Kept in the Hub over the plan/)
    assert.match(html, /Hidden from the profile/)
    assert.ok(!html.includes('role="dialog"') && !html.includes('aria-modal'))
    assert.ok(!draw(<CareEditBody client={C} view="goals" row={null} onDone={noop} />).includes('Hidden from the profile'))
    assert.equal(CLIENT_REREAD.care('kay9', 'daily').key, CLIENT_REREAD.care('kay9', 'daily').key)
    assert.notEqual(CLIENT_REREAD.care('kay9', 'daily').key, CLIENT_REREAD.care('kay9', 'health').key)
  })
})

describe('who is offered the medication edit', () => {
  const chart = medsOf({ tab: 'meds', statuses: ['Active'], why: '', rows: [
    { id: '7', record: 'Gabapentin 300mg', date: '2026-01-02', details: '1 cap · Capsule · Daily · 08:00', status: 'Active',
      source: 'eMAR', text: '', edit: { name: 'Gabapentin 300mg', dose: '1 cap', times: '08:00', route: 'Capsule', freq: 'Daily',
        discontinued: '' } }] })
  const section = (r: ClientReader, view: 'meds' | 'admin' = 'meds') =>
    as(r, <MedicationSection client={C} view={view} today="2026-10-08" onView={noop} onAsk={noop} panel={null} onPanel={noop} />)

  it('the master always; a listed holder of the medication edition; never the other editions\' holders or a family\'s own view', () => {
    assert.equal(clientCan(MASTER, 'clients.medication'), true)
    assert.equal(clientCan(MEDIC, 'clients.medication'), true)
    for (const r of [HOLDER, CARER, STAFF, OTHER_EDITION, FAMILY]) assert.equal(clientCan(r, 'clients.medication'), false, r.viewer)
    const asks: ClientAsk[] = [{ kind: 'add-medication' }, { kind: 'care-add', view: 'daily' }, { kind: 'edit-profile' },
      { kind: 'record', section: 'medication', view: 'meds', id: '7' }]
    assert.deepEqual(asks.map((a) => mayOpenAsk(MEDIC, a)), [true, false, false, true])
    assert.deepEqual(asks.map((a) => mayOpenAsk(CARER, a)), [false, true, false, true])
    assert.deepEqual(asks.map((a) => mayOpenAsk(FAMILY, a)), [false, false, false, true])
  })

  it('Add medication is drawn on Medications for the master and the medication holder, never on Administration', () => {
    assert.ok(section(MASTER).includes('aria-label="Add medication"'))
    assert.ok(section(MEDIC).includes('aria-label="Add medication"'))
    assert.ok(!section(MEDIC, 'admin').includes('aria-label="Add medication"'))
    for (const r of [HOLDER, CARER, STAFF, FAMILY]) assert.ok(!section(r).includes('aria-label="Add medication"'), r.viewer)
  })

  it('the medication panels: an aside with the eMAR cells as read, the add form with no strip until it runs; the chart\'s ' +
     'own reread', () => {
    const html = draw(<MedEditBody client={C} row={chart.rows[0]} edit={chart.rows[0].edit ?? {}} onDone={noop} />)
    assert.match(html, /data-med-edit-panel="7"/)
    assert.match(html, /Written to the eMAR list/)
    assert.ok(html.includes('value="1 cap"') && html.includes('value="08:00"'), html)
    assert.ok(!html.includes('data-apply-strip') && !html.includes('role="dialog"') && !html.includes('aria-modal'))
    const add = draw(<AddMedicationForm client={C} onDone={noop} />)
    assert.ok(add.includes('data-add-medication=""') && add.includes('Kay Nine') && !add.includes('data-apply-strip'))
    assert.equal(CLIENT_REREAD.meds('kay9').key, readKey('clientProfileMeds', 'kay9', 'meds'))
    assert.notEqual(CLIENT_REREAD.meds('kay9').key, CLIENT_REREAD.care('kay9', 'daily').key)
  })
})

describe('who is offered the transportation edit', () => {
  const answer = transportOf({ client: { client_key: 'kay9', name: 'Kay Nine' }, today: '2026-10-08', date: '2026-10-08', rule: 'The rule.',
    sources: [], tabs: { calendar: { rows: [] }, vehicles: { rows: [] }, mileage: { rows: [] }, history: { rows: [
      { id: 'VT00000000A1', source: 'vehicle_calendar', record: 'Doctor appointment', date: '2026-10-21', status: 'Scheduled', vehicle: 'Van' },
      { id: 'vc3', source: 'van_calendar', record: 'Social', date: '2025-10-16', status: 'Completed', sheet_row: 3 }] } } })
  const panel = (r: ClientReader, id = 'VT00000000A1') =>
    as(r, <TransportPanel ask={{ kind: 'trip', id }} answer={answer} onAsk={noop} onClose={noop} />)
  const TRIP = { state: 'scheduled', vehicle_id: 'VVAN0000001', vehicle_name: 'Van', requested_vehicle_id: 'VVAN0000001',
    start_at: '2026-10-21T13:00:00.000Z', end_at: '2026-10-21T14:00:00.000Z', day: '2026-10-21', trip_type: 'Doctor appointment',
    staff_key: 'taylorbrooks', staff_name: 'Taylor Brooks', driver_key: 'taylorbrooks', driver_name: 'Taylor Brooks',
    requested_by: { uid: 'U_TB', name: 'Taylor Brooks' }, source: 'platform' }
  const board = (viewer: Record<string, unknown>) => boardFrom({ ok: true, today: '2026-10-08',
    viewer: { uid: 'U_SAM', name: 'Sam Lee', ...viewer },
    settings: { trip_types: ['Doctor appointment'], directors_readable: true, directors: [] },
    vehicles: [{ id: 'VVAN0000001', name: 'Van', availability: 'available', order: 1, status: { word: 'Available', tone: 'mint' } }],
    trips: [{ ...TRIP, id: 'VT00000000A1', client_key: 'kay9', client_name: 'Kay Nine' },
      { id: 'VT00000000B2', state: 'scheduled', vehicle_id: 'VVAN0000001', vehicle_name: 'Van', start_at: '2026-10-21T16:00:00.000Z',
        end_at: '2026-10-21T17:00:00.000Z', day: '2026-10-21', private: true }],
    people: [{ key: 'taylorbrooks', uid: 'U_TB', name: 'Taylor Brooks' }], clients: [{ key: 'kay9', name: 'Kay Nine' }] })
  const tripPanel = (b: ReturnType<typeof board>, at = 0) =>
    draw(<TripPanel board={b} trip={b.trips[at]} isMaster={false} onDone={noop} onClose={noop} />)
  const clientSelect = (html: string) => /<select[^>]*data-field="client"[^>]*>/.exec(html)?.[0] ?? ''

  it('the master always; a listed holder of the transportation edition; never the other editions\' holders or a family\'s own view', () => {
    assert.equal(clientCan(MASTER, 'clients.transportation'), true)
    assert.equal(clientCan(RIDER, 'clients.transportation'), true)
    for (const r of [HOLDER, CARER, MEDIC, STAFF, OTHER_EDITION, FAMILY]) assert.equal(clientCan(r, 'clients.transportation'), false, r.viewer)
  })

  it('Change or cancel is drawn on a trip the Transportation app holds, for the master and the holder; never on a Van Calendar row', () => {
    for (const r of [MASTER, RIDER]) {
      const html = panel(r)
      assert.ok(html.includes('data-trip-change=""') && html.includes('Change or cancel the trip'), r.viewer)
      assert.ok(html.includes('<aside') && !html.includes('role="dialog"') && !html.includes('aria-modal'))
    }
    for (const r of [STAFF, MEDIC, CARER, FAMILY]) assert.ok(!panel(r).includes('data-trip-change'), r.viewer)
    assert.ok(!panel(MASTER, 'vc3').includes('data-trip-change'))
  })

  it('the Transportation app\'s own panel: the holder changes the client\'s trip with the client locked, another client\'s trip ' +
     'stays private, a board asked for no client stays read-only, and a director\'s keeps the client free', () => {
    const lent = board({ client: 'kay9', can_edit: false })
    const mine = tripPanel(lent)
    assert.match(mine, /data-assign-form=""/)
    assert.match(clientSelect(mine), /disabled=""/)
    assert.ok(!tripPanel(lent, 1).includes('data-assign-form') && tripPanel(lent, 1).includes('Booked'))
    const plain = tripPanel(board({ can_edit: false }))
    assert.ok(!plain.includes('data-assign-form') && plain.includes('data-trip-facts'))
    const director = tripPanel(board({ can_edit: true, client: 'kay9' }))
    assert.match(director, /data-assign-form=""/)
    assert.doesNotMatch(clientSelect(director), /disabled=""/)
    assert.deepEqual(transportTarget('kay9').where, { app: 'client-profiles', label: 'Clients', subject: 'client\'s trips' })
  })
})

describe('the profile edit\'s Apply, through the Locations strip', () => {
  const where = clientTarget('kay9').where
  const OVERLAID = {
    written: ['outcome'], refused: [],
    steps: [{ id: 'json', label: 'JSON overlay', landed: true, words: 'Laid on the relay\'s JSON overlay and into clients.' },
            { id: 'cache', label: 'Kept caches', landed: true, words: 'The pack and the kept copies show it as they are read.' }],
    slices: [], mirror: [], app: 'client-profiles',
    overlay: { ids: ['Ecli1'], ahead: 1, slices: ['clients'], per_min: 40, at: '2026-10-08T15:00:00.000Z' },
  }
  const DIRECT = {
    written: ['house'], refused: [],
    steps: [{ id: 'sheet', label: 'Sheet', landed: true, words: 'The client\'s row on the Hub clients tab.' },
            { id: 'cache', label: 'Kept caches', landed: true, words: 'The client\'s profile and the roster, read again.' }],
    slices: ['clients'], mirror: ['houses'], app: 'client-profiles',
  }
  const deps = (over: Partial<ApplyDeps> = {}): ApplyDeps => ({
    heard: async (name) => name === 'app:client-profiles' || name === 'clients',
    notify: async (names) => names,
    live: () => true,
    now: () => Date.parse('2026-10-08T15:00:00Z'),
    refetch: async () => {},
    ...over,
  })
  const states = (s: ApplyState) => s.steps.map((x) => `${x.id}:${x.state}`).join(' ')

  it('the relay\'s JSON takes it: overlay, caches, the clients slice, the Clients ring and the client read again; ' +
     'the sheet queued, then written', async () => {
    assert.deepEqual(where, { app: 'client-profiles', label: 'Clients', subject: 'client' })
    const hold: { tell?: (id: string, s: SheetSettled) => void } = {}
    const seen: ApplyState[] = []
    let reread = 0
    const got = await runApply({ send: async () => OVERLAID, reread: async () => { reread++ }, onState: (s) => seen.push(s), where,
      deps: deps({ settled: (_ids, fn) => { hold.tell = fn; return () => {} } }) })
    let last = seen[seen.length - 1]
    assert.deepEqual(got, { answer: OVERLAID })
    assert.equal(states(last), 'json:landed cache:landed slices:landed ring:landed page:landed sheet:owed')
    assert.match(last.steps.find((s) => s.id === 'ring')!.words, /^The relay rang Clients at/)
    assert.match(last.steps.find((s) => s.id === 'sheet')!.words, /^Queued \(1 ahead\)/)
    assert.equal(reread, 1)
    hold.tell?.('Ecli1', { state: 'written', words: '' })
    last = seen[seen.length - 1]
    assert.equal(last.steps.find((s) => s.id === 'sheet')!.state, 'landed')
    const html = draw(<ApplyStrip state={last} onDone={noop} />)
    assert.match(html, /data-apply-step="json" data-state="landed"/)
    assert.match(html, /data-apply-done=""/)
    assert.ok(!html.includes('role="dialog"') && !html.includes('aria-modal'))
  })

  it('refused after it was laid: the server\'s words, and the client is read again as it is', async () => {
    const hold: { tell?: (id: string, s: SheetSettled) => void } = {}
    const seen: ApplyState[] = []
    await runApply({ send: async () => OVERLAID, reread: async () => {}, onState: (s) => seen.push(s), where,
      deps: deps({ settled: (_ids, fn) => { hold.tell = fn; return () => {} } }) })
    hold.tell?.('Ecli1', { state: 'refused', words: '' })
    const last = seen[seen.length - 1]
    assert.equal(last.phase, 'refused')
    assert.equal(last.refusal, 'The platform refused it after it was laid; the client is read again as it is.')
  })

  it('a door\'s own answer (a house move): the sheet and the caches as the door says, the houses list owed to the mirror',
    async () => {
      const seen: ApplyState[] = []
      await runApply({ send: async () => DIRECT, reread: async () => {}, onState: (s) => seen.push(s), where, deps: deps() })
      const last = seen[seen.length - 1]
      assert.equal(states(last), 'sheet:landed cache:landed slices:owed ring:landed page:landed')
      assert.match(last.steps.find((s) => s.id === 'slices')!.words, /Rebuilt: clients\..*the houses list/)
      assert.match(last.steps.find((s) => s.id === 'page')!.words, /^Read again at/)
    })

  it('a care edit the relay\'s JSON took: no slice carries it, the pack and the kept copies show it, the sheet queued',
    async () => {
      const seen: ApplyState[] = []
      const care = { ...OVERLAID, written: ['text'], overlay: { ...OVERLAID.overlay, ids: ['Ecare1'], slices: [] } }
      await runApply({ send: async () => care, reread: async () => {}, onState: (s) => seen.push(s), where,
        deps: deps({ settled: () => () => {} }) })
      const last = seen[seen.length - 1]
      assert.equal(states(last), 'json:landed cache:landed slices:skipped ring:landed page:landed sheet:owed')
    })

  it('a new care record, the door\'s own answer: the client_overrides row and the caches as the door says, no slice', async () => {
    const seen: ApplyState[] = []
    const added = { written: ['record'], refused: [], id: 'CO_kay9_care_ab12', slices: [], mirror: [], app: 'client-profiles',
      steps: [{ id: 'sheet', label: 'Sheet', landed: true, words: 'The care record on the Hub client_overrides tab.' },
              { id: 'cache', label: 'Kept caches', landed: true, words: 'The client\'s Care & Support, read again.' }] }
    await runApply({ send: async () => added, reread: async () => {}, onState: (s) => seen.push(s), where, deps: deps() })
    const last = seen[seen.length - 1]
    assert.equal(states(last), 'sheet:landed cache:landed slices:skipped ring:landed page:landed')
    assert.match(last.steps.find((s) => s.id === 'sheet')!.words, /client_overrides/)
  })

  it('a chart row changed or taken off, the relay\'s JSON took it: no slice, the pack and the kept copies show it, the ' +
     'sheet queued', async () => {
    for (const [written, extra] of [[['dose'], {}], [['removed'], { removed: '8' }]] as const) {
      const seen: ApplyState[] = []
      const med = { ...OVERLAID, ...extra, written, overlay: { ...OVERLAID.overlay, ids: ['Emed1'], slices: [] } }
      await runApply({ send: async () => med, reread: async () => {}, onState: (s) => seen.push(s), where,
        deps: deps({ settled: () => () => {} }) })
      const last = seen[seen.length - 1]
      assert.equal(states(last), 'json:landed cache:landed slices:skipped ring:landed page:landed sheet:owed', written.join())
    }
  })

  it('a new medication, the door\'s own answer: the medications row and the caches as the door says, no slice', async () => {
    const seen: ApplyState[] = []
    const added = { id: '10', written: ['name', 'dose', 'times', 'route', 'freq'], refused: [], slices: [], mirror: [],
      app: 'client-profiles',
      steps: [{ id: 'sheet', label: 'Sheet', landed: true, words: 'The medicine\'s row on the Hub medications tab (the eMAR list).' },
              { id: 'cache', label: 'Kept caches', landed: true, words: 'The client\'s Medication, read again.' }] }
    await runApply({ send: async () => added, reread: async () => {}, onState: (s) => seen.push(s), where, deps: deps() })
    const last = seen[seen.length - 1]
    assert.equal(states(last), 'sheet:landed cache:landed slices:skipped ring:landed page:landed')
    assert.match(last.steps.find((s) => s.id === 'sheet')!.words, /medications tab/)
  })

  it('a trip changed from the client\'s page, the Transportation door\'s own answer: the trip\'s row and the caches as the ' +
     'door says, no slice, the Clients ring', async () => {
    const seen: ApplyState[] = []
    const saved = { ok: true, said: 'Saved. The trip is scheduled with the Ford.', trip_id: 'VT00000000A1',
      written: ['state', 'vehicle_id'], slices: [], mirror: [], app: 'client-profiles',
      steps: [{ id: 'sheet', label: 'Sheet', landed: true, words: 'The trip\'s row in the Transportation trips house, and its log line.' },
              { id: 'cache', label: 'Kept caches', landed: true, words: 'The vehicle calendar and the client\'s Transportation, read again.' }] }
    await runApply({ send: async () => saved, reread: async () => {}, onState: (s) => seen.push(s),
      where: transportTarget('kay9').where, deps: deps() })
    const last = seen[seen.length - 1]
    assert.equal(states(last), 'sheet:landed cache:landed slices:skipped ring:landed page:landed')
    assert.match(last.steps.find((s) => s.id === 'sheet')!.words, /Transportation trips house/)
    assert.match(last.steps.find((s) => s.id === 'page')!.words, /Read again/)
  })
})

describe('the client\'s board, read through the Transportation app\'s lane', () => {
  let answer: unknown = {}
  const asked: string[] = []
  const realFetch = globalThis.fetch
  before(() => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload: { client?: string } }
      asked.push(`${env.action}:${env.payload?.client ?? ''}`)
      return new Response(JSON.stringify(answer))
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })

  it('vehicleCalendarBoard names the client; an answer without its trips is not confirmed, never an empty calendar', async () => {
    answer = { status: 200, data: { accepted: true, queued: true } }
    await assert.rejects(readClientBoard('kay9'), /did not confirm/)
    answer = { status: 200, data: { ok: true, viewer: { uid: 'U_SAM', client: 'kay9', can_edit: false }, trips: [] } }
    const b = await readClientBoard('kay9')
    assert.equal(b.viewer.client, 'kay9')
    assert.equal(b.viewer.can_edit, false)
    assert.deepEqual(asked, ['vehicleCalendarBoard:kay9', 'vehicleCalendarBoard:kay9'])
  })
})

describe('the editions a viewer makes, read from the server', () => {
  let answer: unknown = {}
  const asked: string[] = []
  const realFetch = globalThis.fetch
  before(() => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload: { app?: string } }
      asked.push(`${env.action}:${env.payload?.app ?? ''}`)
      return new Response(JSON.stringify(answer))
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })

  it('editionsMine for Clients: the known ids kept; an answer without its list is not confirmed, never "none"', async () => {
    answer = { status: 200, data: { accepted: true, queued: true } }
    await assert.rejects(readClientEditions(), /not confirmed/)
    answer = { status: 200, data: { editions: ['clients.profile', 'made.up'] } }
    assert.deepEqual(await readClientEditions(), ['clients.profile'])
    answer = { status: 200, data: { editions: [] } }
    assert.deepEqual(await readClientEditions(), [])
    assert.deepEqual(asked, ['editionsMine:client-profiles', 'editionsMine:client-profiles', 'editionsMine:client-profiles'])
  })
})
