/** Support Requests answers as SupportDesk.gs supportDeskList sends them (INTERFACE-SR §4.2), for the tests. */

/** The live staff accounts a request may be redirected to, as the server lists them (the viewer left out). */
export const PEOPLE = [
  { uid: 'USR_RB', name: 'Regina Bowman' }, { uid: 'USR_AN', name: 'Ann Roe' },
  { uid: 'USR_B08C57743A1E', name: 'Brittany Anderson' },
]

export function rawRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ref: 'HQ5EF1CB5F25', source: 'queue', kind: 'request', status: { word: 'New', tone: 'new' },
    date: '2026-01-27T15:04:00Z', requestor: { name: 'Ty Bond', uid: 'USR_8F7DD2A6B756' },
    type: { raw: 'Operations - Vehicle Issue', area: 'Operations', label: 'Vehicle Issue', display: 'Operations · Vehicle Issue' },
    urgency: 'High', description: 'Van broke down on Route 62, stranded with client', route: 'vehicle', completed: false,
    details: [{ label: 'Call ID', value: 'AC123' }], history: [], acks: [], waiting_on: ['Ty Bond', 'Brittany Anderson'],
    may: { approve: true, deny: true, resolve: true, aware: false, redirect: true, why: '' }, link: '/app/support-desk/requests?ref=HQ5EF1CB5F25',
    ...over,
  }
}

export function rawBoard(rows: unknown[] = [rawRow()], over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true, now: '2026-10-01T15:00:00Z', today: '2026-10-01',
    viewer: { uid: 'USR_8F7DD2A6B756', name: 'Ty Bond', is_master: false, is_director: true, is_lead: false, can_decide: true },
    test_mode: { on: true, readable: true, why: '' },
    directors: [{ uid: 'USR_8F7DD2A6B756', name: 'Ty Bond' }, { uid: 'USR_B08C57743A1E', name: 'Brittany Anderson' }],
    leads: [{ uid: 'USR_B8C0CBACDB82', name: 'Arthur Rodrigues' }, { uid: 'USR_09B7C99C4DF1', name: 'Wellington' }],
    directors_readable: true, directors_why: '',
    automations: { late_show: false, no_call: false, punch: null, incident: false, general: false, vehicle: false, payroll: false, adp_update: false, time_off: false },
    sources: [{ key: 'queue', state: 'ready', why: '', count: 1, as_of: '2026-10-01T15:00:00Z' }],
    rows, counts: { open: 1, waiting_on_me: 1, warnings: 0, completed: 0 }, note: '',
    people: PEOPLE, people_why: '',
    ...over,
  }
}
