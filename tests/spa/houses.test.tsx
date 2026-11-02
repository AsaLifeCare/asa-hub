/**
 * THE HOUSES PAGE — the arithmetic the screen does on the slice, and the
 * house page drawn whole for a staff member and for a client.
 *
 * The slice builder is held in tools/test-houses.py; this file holds what the
 * SPA adds: a `?house=` is resolved by its code alone (never a street number),
 * the grid shows active houses only, the band counts what it says, every House
 * Tool lands where houseTools.ts says, the Time Off tile waits for its app, a
 * policy opens the platform's own copy for staff, and a client's page carries
 * no staff list, no staff tools and no internal documents. A roster that was
 * not read is unknown on the page, never a zero.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import HouseDetail from '@/pages/features/houses/HouseDetail'
import HouseGrid from '@/pages/features/houses/HouseGrid'
import { effectiveUserFrom } from '@/lib/effectiveUser'
import {
  band, clientStaleLine, codeIn, fromClient, fromRow, gridHouses, houseDay, photoThumb, resolveHouse, seesSourceHealth,
  staffCaption, staleSources, withBuildError,
  type ClientHouse, type Clock, type HouseRow, type HouseSource, type ShiftRow,
} from '@/pages/features/houses/houseModel'
import { houseCalendarLink, houseTools, policyOpen, TIME_OFF_PATH } from '@/pages/features/houses/houseTools'

const FRESH: HouseSource[] = [
  { key: 'client_db', label: 'Asa Client Database · Master', state: 'fresh' },
  { key: 'calendar', label: 'Hotline calendar · Calendar Archive', state: 'stale', why: 'Drive holds changes the mirror has not read yet' },
  { key: 'psi', label: 'PsiAnywhere punches', state: 'unreadable', why: 'rows.json could not be read' },
]

const POLICIES = [
  { title: 'Company Policies', url: 'https://drive.google.com/file/d/a/view', in_app_doc: 'pol-asa-lifecare-general-policies', audience: 'staff' },
  { title: 'Med Del - Cat 1', url: 'https://drive.google.com/file/d/b/view', in_app_doc: '', audience: 'staff' },
  { title: 'Bill of Rights - ER', url: 'https://drive.google.com/file/d/c/view', in_app_doc: '', audience: 'all' },
]

function house(code: string, over: Partial<HouseRow> = {}): HouseRow {
  return {
    id: code, code, label: code.slice(0, 2), title: `${code.slice(0, 2)} - ${code}`, city: 'Canton',
    calendar_location: `CAN - ${code.slice(0, 2)} - ${code}`, active: true, address: `${code} Street`,
    photo: { src: '', source: '' }, managers: [], leads: [], clients: [], client_count: 0,
    staff: [], staff_source: '', week_notes: [], policies: POLICIES, sources: FRESH, ...over,
  }
}

const NW = house('NW4045', {
  address: '4045 Guilford Ave NW, Apt A, Canton',
  managers: [{ name: 'Wanda McCollum-Dotson', phone: '330-224-1560', last_day: '2026-09-21' }],
  clients: [{ name: 'Nakita Wade', client_id: 'c-1', avatar: '' }], client_count: 1,
  staff: [{ name: 'Anissa Hall', shifts: 59, last_day: '2026-09-21', hm: false }],
  staff_source: 'psi', staff_label: 'Worked here — PsiAnywhere punches',
  staff_window: { from: '2026-06-23', to: '2026-09-23' }, staff_gaps: [{ from: '2026-08-13', to: '2026-09-19' }],
})
const SB = house('SB4045', { address: '4045 Guilford Ave NW, Apt B, Canton', clients: [{ name: 'Sarina Bunting' }], client_count: 1 })
const ZK = house('ZK1109', { active: false, active_why: 'no active client in the Asa Client Database' })
const ROWS = [SB, ZK, NW]

const CLOCK: Clock = { today: '2026-09-23', weekEnd: '2026-09-29', now: 23 * 60 }
const shift = (staff: string, houseCode: string, date: string, start = '08:00', end = '16:00'): ShiftRow =>
  ({ staff, house: '', date, start, end, status: 'Day', houseCode })

describe('a ?house= is a code, never a street', () => {
  it('reads the code out of a location or any case', () => {
    assert.equal(codeIn('CAN - NW - NW4045'), 'NW4045')
    assert.equal(codeIn('sb4045'), 'SB4045')
    assert.equal(codeIn('4045'), '')
  })

  it('resolves each unit of a shared street number to its own house', () => {
    assert.equal(resolveHouse('NW4045', ROWS)?.address, '4045 Guilford Ave NW, Apt A, Canton')
    assert.equal(resolveHouse('CAN - SB - SB4045', ROWS)?.address, '4045 Guilford Ave NW, Apt B, Canton')
    assert.equal(resolveHouse('4045', ROWS), null)
  })
})

describe('the grid and its band', () => {
  it('shows the active houses only, by title, and searches managers and clients', () => {
    assert.deepEqual(gridHouses(ROWS).map((h) => h.code), ['NW4045', 'SB4045'])
    assert.deepEqual(gridHouses(ROWS, 'wanda').map((h) => h.code), ['NW4045'])
    assert.deepEqual(gridHouses(ROWS, 'sarina').map((h) => h.code), ['SB4045'])
  })

  it('counts active houses, their clients, and distinct staff on their roster this week', () => {
    const shifts = [
      shift('Anissa Hall', 'NW4045', '2026-09-23'),
      shift('anissa hall', 'SB4045', '2026-09-25'),
      shift('Jordyn Walker', 'SB4045', '2026-09-29'),
      shift('Too Late', 'SB4045', '2026-09-30'),
      shift('Closed House', 'ZK1109', '2026-09-24'),
    ]
    const b = band(ROWS, shifts, CLOCK)
    assert.equal(b.houses, 2)
    assert.equal(b.clients, 2)
    assert.equal(b.staffWeek, 2)
  })

  it('names every source that is not fresh, once', () => {
    assert.deepEqual(staleSources([...FRESH, ...FRESH]).map((s) => s.key), ['calendar', 'psi'])
    assert.deepEqual(band(ROWS, [], CLOCK).stale.map((s) => s.state), ['stale', 'unreadable'])
  })

  it('draws a card from a small copy: the Image Bank thumb, or the registry photo at a width', () => {
    assert.equal(photoThumb('/assets/library/houses/a1.png'), '/assets/library/thumbs/houses/a1.webp')
    assert.equal(photoThumb('https://lh3.googleusercontent.com/d/abc'), 'https://lh3.googleusercontent.com/d/abc=w640')
    assert.equal(photoThumb('https://lh3.googleusercontent.com/d/abc=w200'), 'https://lh3.googleusercontent.com/d/abc=w200')
  })

  it('counts an overnight shift as on duty after midnight', () => {
    const d = houseDay('NW4045', [shift('Night Owl', 'NW4045', '2026-09-23', '22:00', '08:00')], { ...CLOCK, now: 60 })
    assert.deepEqual(d?.onDuty, ['Night Owl'])
  })

  it('keeps a roster that was not read unknown — no zero staff, no empty day', () => {
    assert.equal(band(ROWS, null, CLOCK).staffWeek, null)
    assert.equal(houseDay('NW4045', null, CLOCK), null)
    assert.equal(band(ROWS, [], CLOCK).staffWeek, 0)
  })

  it('names a failed build of the houses slice as a stale source on every row', () => {
    const rows = withBuildError(ROWS, 'which houses are active cannot be said')
    assert.deepEqual(staleSources(rows[0].sources).map((s) => s.key), ['calendar', 'psi', 'build'])
    assert.match(band(rows, [], CLOCK).stale.at(-1)?.why ?? '', /last build failed \(which houses/)
    assert.equal(withBuildError(ROWS, ''), ROWS)
  })
})

describe('House Tools land where houseTools.ts says', () => {
  it('gives staff the six tiles, the calendar through its one helper', () => {
    const tools = houseTools(NW, 'staff', { timeOff: false })
    assert.deepEqual(tools.map((t) => t.label),
      ['Report Incident', 'Request Maintenance', 'Time Off', 'Submit Suggestion', 'Calendar', 'Emergency Contacts'])
    assert.equal(tools.find((t) => t.key === 'incident')?.href, '/app/ui-incidents/log')
    assert.equal(tools.find((t) => t.key === 'maintenance')?.href, '/app/house-repair/orders')
    assert.equal(tools.find((t) => t.key === 'calendar')?.href, houseCalendarLink(NW))
    assert.equal(houseCalendarLink(NW), '/app/calendarbuilder/house-cal?house=CAN%20-%20NW%20-%20NW4045')
    assert.equal(tools.find((t) => t.key === 'contacts')?.href, '/app/policy-acks/contacts')
  })

  it('keeps Time Off on "coming soon" until the Time Off app exists, never the old form', () => {
    const soon = houseTools(NW, 'staff', { timeOff: false }).find((t) => t.key === 'timeoff')
    assert.equal(soon?.href, undefined)
    assert.equal(soon?.note, 'Coming soon')
    assert.equal(houseTools(NW, 'staff', { timeOff: true }).find((t) => t.key === 'timeoff')?.href,
      `${TIME_OFF_PATH}?house=NW4045`)
  })

  it('gives a client only what the portal opens, and files incidents and repairs in place', () => {
    const tools = houseTools(NW, 'client', { timeOff: true })
    assert.deepEqual(tools.map((t) => t.key), ['incident', 'maintenance', 'suggestion', 'contacts'])
    assert.equal(tools.find((t) => t.key === 'contacts')?.href, '/app/suggestions/box')
    const incident = tools.find((t) => t.key === 'incident')
    const maintenance = tools.find((t) => t.key === 'maintenance')
    assert.deepEqual([incident?.file, incident?.href], ['uiIncidents', undefined], 'never the UI Reports list')
    assert.deepEqual([maintenance?.file, maintenance?.href], ['workOrders', undefined], 'never the House Repair list')
    assert.ok(houseTools(NW, 'staff', { timeOff: true }).every((t) => !t.file), 'staff open the apps themselves')
  })

  it('opens the platform copy of a policy for staff, the document itself otherwise', () => {
    assert.deepEqual(policyOpen(POLICIES[0], 'staff'), { kind: 'in-app', href: '/app/policy-acks/documents' })
    assert.deepEqual(policyOpen(POLICIES[0], 'client'), { kind: 'viewer', url: POLICIES[0].url })
    assert.deepEqual(policyOpen(POLICIES[1], 'staff'), { kind: 'viewer', url: POLICIES[1].url })
  })
})

describe('the staff list says where it came from', () => {
  it('names the punches, the window and the hole in the record', () => {
    const line = staffCaption(NW)
    assert.match(line, /Worked here — PsiAnywhere punches, Jun 23 → Sep 23/)
    assert.match(line, /No punches on record Aug 13 → Sep 19/)
  })

  it('says why a list came from the calendar instead', () => {
    const line = staffCaption({ staff_source: 'calendar', staff_label: 'Scheduled here — hotline calendar',
      staff_why: 'no PsiAnywhere punch is placed at this house since 2026-06-23',
      staff_window: { from: '2026-06-23', to: '2026-09-23' } })
    assert.match(line, /^Scheduled here — hotline calendar/)
    assert.match(line, /Not from the punches: no PsiAnywhere punch/)
  })
})

const MINE: ClientHouse = {
  code: 'NW4045', title: 'NW - NW4045', label: 'NW', city: 'Canton', address: NW.address, photo: { src: '', source: '' },
  managers: NW.managers, you: [{ name: 'Nakita Wade', avatar: '' }], resident_count: 2,
  policies: POLICIES,
  sources: [{ key: 'client_db', label: 'the residents', state: 'fresh' }, { key: 'calendar', label: 'the house manager', state: 'stale' }],
}

describe("a client's page says what may be behind, in a client's words", () => {
  it('names the parts, never a book or a reason', () => {
    assert.equal(clientStaleLine(MINE.sources), 'Some of this may be out of date: the house manager.')
    assert.equal(clientStaleLine([{ key: 'people', label: "the house manager's phone", state: 'fresh' }]), '')
    assert.equal(clientStaleLine([...MINE.sources, { key: 'build', label: 'this page', state: 'stale' }]),
      'This page may be out of date.')
  })
})

describe('the house page, drawn', () => {
  const draw = (el: ReturnType<typeof createElement>) =>
    renderToString(createElement(MemoryRouter, null, el))
  // framer-motion listens for resizes on the window it finds
  const g = globalThis as unknown as Record<string, unknown>
  const had = { add: g.addEventListener, remove: g.removeEventListener }
  before(() => {
    g.addEventListener = () => {}
    g.removeEventListener = () => {}
  })
  after(() => {
    g.addEventListener = had.add
    g.removeEventListener = had.remove
  })

  it('a client sees their house, its manager and the resident tools — no staff, no internal documents', () => {
    const view = fromClient(MINE)
    assert.equal(view.staff, null)
    assert.equal(view.peopleNote, 'and 1 other resident')
    const html = draw(createElement(HouseDetail, { view, mode: 'client', timeOff: true, onRefresh: () => {} }))
    for (const want of ['NW - NW4045', '4045 Guilford Ave NW, Apt A, Canton', 'Wanda McCollum-Dotson', '(330) 224-1560',
      'Report Incident', 'Request Maintenance', 'Submit Suggestion', 'Emergency Contacts', 'Bill of Rights - ER']) {
      assert.ok(html.includes(want), `the client page shows ${want}`)
    }
    const tile = (label: string) => new RegExp(`<button[^>]*>(?:(?!</button>)[^])*${label}`).exec(html)?.[0] ?? ''
    for (const label of ['Report Incident', 'Request Maintenance']) {
      assert.ok(tile(label) && !/disabled=""/.test(tile(label)), `${label} is a live tile for a client`)
    }
    for (const never of ['Staff — recent months', 'UI Reports', 'House Repair', 'Med Del - Cat 1',
      'Company Policies</span>', 'All houses', 'Anissa Hall', 'Reading the roster']) {
      assert.ok(!html.includes(never), `the client page never shows ${never}`)
    }
    assert.ok(!html.includes('may be out of date'), 'a client is never told a source is stale')
  })

  it('a manager whose phone could not be read is "Phone unknown", not "no phone"', () => {
    const unknown = fromClient({ ...MINE, managers: [{ name: 'Wanda McCollum-Dotson', phone: '', phone_known: false, last_day: '2026-09-21' }] })
    const html = draw(createElement(HouseDetail, { view: unknown, mode: 'client', timeOff: true, onRefresh: () => {} }))
    assert.ok(html.includes('Phone unknown'))
    assert.ok(!html.includes('No phone'))
    const staff = fromRow({ ...NW, managers: [{ name: 'Jordyn Walker', phone: '', phone_known: true, phone_why: 'no People record carries this name', last_day: '2026-09-21' }] })
    assert.ok(draw(createElement(HouseDetail, { view: staff, mode: 'staff', timeOff: false, onRefresh: () => {}, day: null, dayWhy: 'x' }))
      .includes('No phone in People'))
  })

  it('a roster that was not read is unknown on the house page, never "Nobody on duty"', () => {
    const html = draw(createElement(HouseDetail, {
      view: fromRow(NW), mode: 'staff', timeOff: false, onRefresh: () => {},
      day: houseDay('NW4045', null, CLOCK), dayWhy: 'the shifts slice did not answer',
    }))
    assert.ok(html.includes('the roster could not be read: the shifts slice did not answer'))
    for (const never of ['Nobody on duty', 'shifts today', 'days covered']) assert.ok(!html.includes(never), never)
  })

  it('a roster that was not read is unknown on the grid, never a zero', () => {
    const html = draw(createElement(HouseGrid, {
      houses: ROWS, shifts: null, shiftsWhy: 'the shifts slice did not answer', clock: CLOCK, failed: '', loading: false,
      showBooks: false, onOpen: () => {}, onRefresh: () => {},
    }))
    assert.ok(html.includes('the roster could not be read — the shifts slice did not answer'))
    assert.ok(html.includes('On duty unknown'))
    assert.ok(!html.includes('0 on duty'))
  })

  it('a staff member sees every section and the source of the staff list, never the stale sources', () => {
    const html = draw(createElement(HouseDetail, {
      view: fromRow(NW), mode: 'staff', timeOff: false, onBack: () => {}, onRefresh: () => {},
      day: houseDay('NW4045', [], CLOCK),
    }))
    for (const want of ['All houses', 'Staff — recent months', 'Anissa Hall', 'Worked here — PsiAnywhere punches',
      'Report Incident', 'Coming soon', 'Med Del - Cat 1', 'No photo in the Image Bank']) {
      assert.ok(html.includes(want), `the staff page shows ${want}`)
    }
    assert.ok(!html.includes('Hotline calendar · Calendar Archive'), 'the stale sources are not drawn for staff')
  })

  it('the stale sources are the master\'s and the platform lead\'s only — a director and everyone under see none', () => {
    const as = (role: string, types: string[], isMaster = false) =>
      seesSourceHealth(effectiveUserFrom({ id: 'u', name: 'u', role: role as never, types, isMaster }, null))
    assert.equal(as('admin', [], true), true)
    assert.equal(as('admin', ['PLATFORMLEAD']), true)
    for (const [role, types] of [['admin', ['DIRECTOR']], ['admin', ['ADMIN', 'ADMINISTRATOR']], ['manager', ['SUPERVISOR']],
      ['manager', ['TEAMLEAD', 'HM']], ['staff', []], ['client', []]] as const) {
      assert.equal(as(role, [...types]), false, `${role} ${types.join(' ')}`)
    }
    const visiting = effectiveUserFrom({ id: 'm', name: 'm', role: 'admin', types: [], isMaster: true },
      { memberId: 'd', name: 'd', role: 'admin', types: ['DIRECTOR'] })
    assert.equal(seesSourceHealth(visiting), false, 'the master visiting a director sees what the director sees')
    const grid = draw(createElement(HouseGrid, {
      houses: ROWS, shifts: [], clock: CLOCK, failed: '', loading: false, showBooks: false, onOpen: () => {},
      onRefresh: () => {},
    }))
    assert.ok(!grid.includes('Sources') && !grid.includes('Hotline calendar · Calendar Archive'))
  })
})
