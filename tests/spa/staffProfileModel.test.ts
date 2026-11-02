/**
 * STAFF · the model: every reader against the answers StaffProfiles.gs sends, the address, the switcher, the pills,
 * and the rules the screen must keep — a mask with more digits than a mask is never drawn, a course with no date is
 * never Current, a missing document has nothing to open, a stretch with no texts is a gap and not silence.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTION_GROUPS, ACTION_STATUS_META, DOC_STATUS_META, NOT_PUBLISHED, SCREEN_META, TRAINING_META, actionButton, actionCount, actionsOf,
  activityOf, assignSplit, assignableHouses, callsByDay, complianceOf, dateWords, defaultStaff, diplomaWords, docLine, docOpens,
  documentsOf, driverLine, employmentOf, endDayWords, favoriteFor, filterActions, hrOf, notesOf, olderCursor, overviewOf, panelOf,
  panelParam, panelTitle, parseSpeakerTranscript, patternWords, readRefusal, referralPaidWords, resolveStaff, rosterOf, safeMask,
  screenWords, sharePayloadFor, shiftsOf, staffHref, staffQuery, switcherStaff, tabOf, textsOf, threadItems, threadOrder,
  trainingSub, transcriptOf, transcriptsOf, viewOf, workedSpan, type StaffAsk,
  WRITE_ASKS, actionGroupsFor, askFor, isRefusal, tabsFor, viewerOf, staffEditFields, staffEditViewOf,
} from '@/pages/features/staffprofiles/staffModel'
import { diffChanges, editShown } from '@/lib/recordEdit'

const ROSTER = rosterOf({
  staff: [
    { key: 'adamlaurent', name: 'Adam Laurent', first_name: 'Adam', last_name: 'Laurent', status: 'active', role: 'Chief of Staff', avatar: '', employee_id: 'ASA-1060' },
    { key: 'bealee', name: 'Bea Lee', status: 'active', role: 'DSP', employee_id: '104220' },
    { key: 'carlreyes', name: 'Carl Reyes', status: 'inactive', role: 'DSP' },
    { key: 'danaoak', name: 'Dana Oak', status: 'active', ambiguous: true },
    { name: 'Eve Park', status: 'pending' },
    { key: '', name: '' },
  ],
  counts: { active: 3, inactive: 1, ambiguous: 1 },
  why: '',
})

describe('the roster and the switcher', () => {
  it('reads each row; a row with no name is dropped; the key falls back to the folded name', () => {
    assert.deepEqual(ROSTER.staff.map((r) => r.key), ['adamlaurent', 'bealee', 'carlreyes', 'danaoak', 'evepark'])
    assert.deepEqual(ROSTER.staff.map((r) => r.status), ['active', 'active', 'inactive', 'active', 'pending'])
    assert.equal(ROSTER.staff[3].ambiguous, true)
    assert.deepEqual(ROSTER.counts, { active: 3, inactive: 1, ambiguous: 1 })
  })

  it('lists the active first by name; Show Inactive adds the inactive after them; the search reads name, id and role', () => {
    assert.deepEqual(switcherStaff(ROSTER.staff, '', false).map((r) => r.key), ['adamlaurent', 'bealee', 'danaoak', 'evepark'])
    assert.deepEqual(switcherStaff(ROSTER.staff, '', true).map((r) => r.key), ['adamlaurent', 'bealee', 'danaoak', 'evepark', 'carlreyes'])
    assert.deepEqual(switcherStaff(ROSTER.staff, 'asa-1060', false).map((r) => r.key), ['adamlaurent'])
    assert.deepEqual(switcherStaff(ROSTER.staff, 'dsp', true).map((r) => r.key), ['bealee', 'carlreyes'])
  })

  it('opens on the first active person that can be opened; the address resolves by key or by name', () => {
    assert.equal(defaultStaff(ROSTER.staff)?.key, 'adamlaurent')
    assert.equal(defaultStaff(ROSTER.staff.filter((r) => r.key !== 'adamlaurent' && r.key !== 'bealee'))?.key, 'evepark', 'an ambiguous row is never the default')
    assert.equal(resolveStaff('bealee', ROSTER.staff)?.name, 'Bea Lee')
    assert.equal(resolveStaff('Bea Lee', ROSTER.staff)?.key, 'bealee')
    assert.equal(resolveStaff('nobody', ROSTER.staff), null)
  })
})

describe('the address', () => {
  it('the seven sections, Activity\'s views, and every panel mode round-trip', () => {
    assert.equal(tabOf('hr'), 'hr')
    assert.equal(tabOf('nope'), 'profile')
    assert.equal(viewOf('activity', 'texts'), 'texts')
    assert.equal(viewOf('activity', 'x'), 'timeline')
    assert.equal(viewOf('profile', 'texts'), '')
    const asks: StaffAsk[] = [{ kind: 'share' }, { kind: 'assign', house: '' }, { kind: 'assign', house: 'NW4045' }, { kind: 'incident' },
      { kind: 'note' }, { kind: 'transcript', id: 'AC123' }, { kind: 'invite' }, { kind: 'access' }, { kind: 'reset' },
      { kind: 'filedoc', course: '' }, { kind: 'filedoc', course: 'cpr' }, { kind: 'edit', section: 'profile' },
      { kind: 'edit', section: 'employment' }, { kind: 'edit', section: 'hr' }]
    for (const a of asks) assert.deepEqual(panelOf(panelParam(a)), a, JSON.stringify(a))
    assert.equal(panelOf('edit~documents'), null, 'only the three sections that edit')
    assert.equal(panelOf('transcript'), null)
    assert.equal(panelOf('doc~x'), null, 'no document mode: a document opens centred, never in the panel')
  })

  it('the whole state of the screen rides the address', () => {
    assert.equal(staffQuery('adamlaurent', 'profile'), '?staff=adamlaurent')
    assert.equal(staffQuery('adamlaurent', 'activity', 'texts', { kind: 'transcript', id: 'AC1' }),
      '?staff=adamlaurent&tab=activity&view=texts&panel=transcript%7EAC1')
    assert.equal(staffQuery('adamlaurent', 'hr', 'texts'), '?staff=adamlaurent&tab=hr', 'a view only for Activity')
    assert.equal(staffHref('adamlaurent', 'documents'), '/app/staff-profiles/profile?staff=adamlaurent&tab=documents')
  })
})

describe('the staff profile', () => {
  const o = overviewOf({
    person: {
      key: 'adamlaurent', name: 'Adam Laurent', first_name: 'Adam', last_name: 'Laurent', employee_id: 'ASA-1060', employee_id_source: 'master',
      role: 'Chief of Staff', status: 'active', start_date: '2026-09-01',
      phones: [{ label: 'Mobile', value: '(555) 010-1160' }, { label: 'Roster', value: '+15550101160' }, { label: 'Master', value: '555-010-2222' }, { value: '' }],
      emails: [{ label: 'Account', value: 'adam.laurent@example.invalid' }, { label: 'Roster', value: 'Adam.Laurent@Example.Invalid' }, { value: 'second@example.invalid' }],
    },
    clients: [{ client_key: 'dannywhitaker', name: 'Danny Whitaker', via: ['ist', 'punches', 'house', 'bogus'], house: 'NW4045' },
      { name: '' }],
    houses: [{ code: 'nw4045', home_name: 'Meadowlane', address: '1 Main St', current: true, days: 40, first_day: '2025-01-06', last_day: '2026-09-23', hm: true }],
    ist: [{ id: 'I1', client_name: 'Danny Whitaker', house: 'nw4045', status: 'done', trained_at: '2026-02-01' }, { id: 'I2', client_name: 'Sam Petrakis', house: 'BW1001', status: 'owed', due: '2026-10-01' }],
    notes_open: 2,
  })

  it('every phone and every e-mail on its own line, in the answer\'s order, the same one never twice', () => {
    assert.deepEqual(o.person.phones.map((p) => [p.label, p.value]), [['Mobile', '(555) 010-1160'], ['Master', '555-010-2222']])
    assert.deepEqual(o.person.emails.map((p) => p.value), ['adam.laurent@example.invalid', 'second@example.invalid'])
  })

  it('clients keep only the ties the answer names (an IST ties no client); houses are keyed by their code', () => {
    assert.deepEqual(o.clients.map((c) => [c.name, c.via]), [['Danny Whitaker', ['punches', 'house']]])
    assert.equal(o.houses[0].code, 'NW4045')
    assert.equal(workedSpan(o.houses[0]), 'Jan 06, 2025 – Sep 23, 2026 · 40 days')
    assert.equal(o.notesOpen, 2)
  })

  it('Assign Training offers the houses where a client has no IST yet, and splits them as the door does (any house, any state)', () => {
    const houses = [
      { code: 'NW4045', title: 'Meadowlane', active: true, clients: [{ name: 'Danny Whitaker' }] },
      { code: 'BW1001', title: 'Briarwood', active: true, clients: [{ name: 'Sam Petrakis' }, { name: 'Gary Ostrander' }] },
      { code: 'OL2002', title: 'Oldfield', active: false, clients: [] },
      { code: 'EM3003', title: 'Empty', active: true, clients: [] },
    ]
    assert.deepEqual(assignableHouses(houses, o.ist).map((h) => h.code), ['BW1001', 'EM3003'])
    // Sam's IST is owed at BW1001: the door answers him as already on record, so the form does not offer him
    assert.deepEqual(assignSplit(houses[1], o.ist), { toTrain: ['Gary Ostrander'], trained: [], owed: ['Sam Petrakis'] })
    assert.deepEqual(assignSplit(houses[0], o.ist), { toTrain: [], trained: ['Danny Whitaker'], owed: [] })
    // a pair trained at another house is the same pair: one IST row per staff member and client
    const moved = { code: 'EM3003', title: 'Elsewhere', active: true, clients: [{ name: 'Danny Whitaker' }] }
    assert.deepEqual(assignSplit(moved, o.ist), { toTrain: [], trained: ['Danny Whitaker'], owed: [] })
    assert.deepEqual(assignableHouses([moved], o.ist), [])
  })
})

describe('shifts', () => {
  const s = shiftsOf({
    houses: [{ code: 'NW4045', home_name: 'Meadowlane' }],
    days: [{ date: '2026-09-01', house: 'nw4045', start: '7a', end: '3p', designation: 'hm', source: 'archive' },
      { date: '2026-09-20', house: 'NW4045', start: '3p', end: '11p', source: 'punches' }],
    upcoming: [{ date: '2026-10-02', house: 'NW4045' }, { date: '2026-09-30', house: 'NW4045' }],
    patterns: [{ house: 'NW4045', weekdays: ['Mon', 'Wed', 'Fri'], start: '7a', end: '3p' }],
    sources: { archive: { readable: true, rows: 12 }, punches: { readable: false, why: 'PSI did not answer' } },
    gaps: [{ from: '2025-10-01', to: '2025-12-31' }],
  })

  it('worked days newest first, what is ahead oldest first, a pattern in words, and the gap kept', () => {
    assert.deepEqual(s.days.map((d) => d.date), ['2026-09-20', '2026-09-01'])
    assert.deepEqual(s.upcoming.map((d) => d.date), ['2026-09-30', '2026-10-02'])
    assert.equal(patternWords(s.patterns[0], 'Meadowlane'), 'Meadowlane · Mon, Wed, Fri · 7a–3p')
    assert.equal(s.sources.punches.readable, false)
    assert.deepEqual(s.gaps, [{ from: '2025-10-01', to: '2025-12-31' }])
  })
})

describe('employment', () => {
  const e = employmentOf({
    hiring: { referral: 'Maya Chen', referral_paid: '2026-09-18', referral_paid_flag: 'Yes', job_app_date: '2026-07-28', resume: { flag: 'yes', doc_id: null }, attestation_date: '2026-08-24' },
    dates: { start_doc: '2026-08-24', start_first_day: '2026-09-01', end_last_day: '' },
    qualifications: { hs_diploma: { value: '1', flag: '1', doc_id: 'hsfile123456', doc_date: '2026-08-26' }, driver: { value: 'Yes', approved: true } },
    on_master: true,
  })

  it('pure data, in the mockup\'s words', () => {
    assert.equal(referralPaidWords(e.hiring), 'Yes · Sep 18, 2026')
    assert.equal(e.hiring.resume.flag, 'yes')
    assert.equal(e.hiring.resume.doc_id, '', 'a flag with no file names no file')
    assert.equal(diplomaWords(e.qualifications.hs_diploma), 'Verified · Aug 26, 2026')
    assert.equal(endDayWords(e.dates.end_last_day, 'active'), 'Not applicable · Active')
    assert.equal(endDayWords('', 'inactive'), '')
    assert.equal(endDayWords('2026-01-02', 'inactive'), 'Jan 02, 2026')
  })
})

describe('documents', () => {
  const d = documentsOf({
    docs: [
      { id: 'f1xxxxxxxxxx', file_id: 'f1xxxxxxxxxx', title: 'Form I-9', category: 'work_authorization', date: '2026-08-24', expires: '2032-03-18', status: 'verified', source: 'drive' },
      { id: 'master:w4', file_id: null, title: 'Form W-4', category: 'tax', date: '2026-08-24', status: 'missing', source: 'master' },
      { id: 'f3', file_id: 'f3xxxxxxxxxx', title: 'Odd', category: 'nonsense', status: 'nonsense' },
    ],
    counts: { total: 3, with_file: 2, missing: 1 },
  })

  it('each row\'s line and pill; only a row with a file opens, and a missing one has nothing to open', () => {
    assert.equal(docLine(d.docs[0]), 'Work authorization · Aug 24, 2026 · expires Mar 18, 2032')
    assert.equal(DOC_STATUS_META[d.docs[0].status].label, 'Verified')
    assert.equal(docOpens(d.docs[0]), true)
    assert.equal(docOpens(d.docs[1]), false)
    assert.deepEqual([d.docs[2].category, d.docs[2].status], ['other', 'on_file'])
    assert.deepEqual(d.counts, { total: 3, with_file: 2, missing: 1 })
  })
})

describe('compliance', () => {
  const c = complianceOf({
    training: [
      { id: 'dodd8', label: 'DODD 8-Hour', expires: '2026-10-15', state: 'due_soon' },
      { id: 'mandt', label: 'MANDT', expires: '', state: 'current' },
      { id: 'money', label: 'Money Management', expires: '', state: 'no_date' },
      { id: 'cpr', label: 'CPR / First Aid', expires: '2028-09-16', state: 'current' },
    ],
    credentials: [{ id: 'nurse_aide', label: 'Nurse Aide / STNA', state: 'na', note: 'The Master\'s Nurse Aide columns are the registry check' }],
    screening: [{ id: 'bci_fbi', label: 'BCI / FBI', state: 'clear', date: '2026-08-28', rapback_date: '2026-08-30', ref_masked: 'BMT•••••789' }],
    window_days: 60,
  })

  it('a course with no date is never Current', () => {
    assert.deepEqual(c.training.map((t) => t.state), ['due_soon', 'no_date', 'no_date', 'current'])
    assert.equal(TRAINING_META.no_date.label, 'No date on file')
    assert.equal(TRAINING_META.due_soon.label, 'Due Soon')
    assert.equal(TRAINING_META.na.label, 'Not Applicable')
    assert.equal(c.credentials[0].state, 'na')
  })

  it('a running Med Del renewal and the tracker\'s own word are the course\'s sub-line; with no date the renewal is the pill', () => {
    const r = complianceOf({
      training: [
        { id: 'med1', label: 'Med Delivery 1', expires: '2026-10-15', state: 'due_soon', renewal: { phase: '3', phase_label: 'Relias training', level: 'Med 1' } },
        { id: 'med3', label: 'Med Delivery 3', expires: '', state: 'renewal_assigned', renewal: { phase: '2', phase_label: 'Application received', level: 'Med 3' } },
        { id: 'dodd', label: 'DODD 8-Hour', expires: '2026-10-15', state: 'due_soon', tracker_word: 'Renewal assigned' },
        { id: 'cpr', label: 'CPR / First Aid', expires: '2026-10-01', state: 'expired', tracker_word: 'expired' },
        { id: 'mandt', label: 'MANDT', expires: '2027-01-01', state: 'in_review', tracker_word: 'Scheduled 10/2' },
        { id: 'money', label: 'Money Management', expires: '', state: 'no_date', renewal: 'not an object' },
        { id: 'med2', label: 'Med Delivery 2', expires: '', state: 'renewal_assigned', renewal: { phase: '', phase_label: '' },
          tracker_word: 'Renewal assigned' },
      ],
    })
    assert.equal(TRAINING_META.renewal_assigned.label, 'Renewal assigned')
    assert.deepEqual(r.training.map((t) => t.state), ['due_soon', 'renewal_assigned', 'due_soon', 'expired', 'in_review', 'no_date', 'renewal_assigned'])
    assert.deepEqual(r.training.map(trainingSub), [
      'Renewal assigned · Phase 3 · Relias training',
      'Phase 2 · Application received',
      'Renewal assigned',
      '',
      'A certificate is waiting for review · Scheduled 10/2',
      '',
      '',
    ])
    assert.deepEqual(r.training[0].renewal, { phase: '3', phaseLabel: 'Relias training', level: 'Med 1' })
    assert.equal(r.training[5].renewal, null)
  })

  it('screening: clear with its date, the Rapback day and the masked reference', () => {
    assert.equal(screenWords(c.screening[0]), 'Clear · Aug 28, 2026')
    assert.equal(screenWords({ state: 'na', date: '2026-01-01' }), 'Not applicable')
    assert.equal(SCREEN_META.clear.label, 'Clear')
    assert.equal(c.screening[0].refMasked, 'BMT•••••789')
    assert.equal(c.windowDays, 60)
  })
})

describe('HR admin', () => {
  it('a mask is drawn as sent; anything with more digits than a mask is never drawn', () => {
    assert.equal(safeMask('•••-••-1842'), '•••-••-1842')
    assert.equal(safeMask('OH •••• 7731'), 'OH •••• 7731')
    assert.equal(safeMask('123-45-1842'), '')
    assert.equal(safeMask('OH12345678'), '')
    const h = hrOf({
      personal: { ssn_masked: '123451842', dob: '1992-03-18' },
      driver: { driver: 'Yes', approved: true, license_masked: 'SV123456' },
      screening: [{ id: 'bci_fbi', label: 'BCI / FBI', state: 'clear', ref_masked: 'BMT123456789' }],
      account: { user_id: 'u1', login: 'adam@example.invalid', active: true, pass_hash: 'x', salt: 'y', password: 'z' },
    })
    assert.equal(h.personal.ssn_masked, '')
    assert.equal(h.driver.license_masked, '')
    assert.equal(h.screening[0].refMasked, '')
    assert.equal(driverLine(h.driver), 'Yes · approved')
    const text = JSON.stringify(h)
    assert.ok(!/pass_hash|salt|password|123451842|SV123456|BMT123456789/i.test(text), text)
    assert.equal(hrOf({ account: { login: 'x' } }).account, null, 'an account with no id is none')
  })
})

describe('actions', () => {
  const a = actionsOf({
    items: [
      { id: 'r1', status: 'needs_attention', item: 'CPR / First Aid', date: '2026-09-01', flow: 'Training renewal', phase: 'Expired', action: { kind: 'none' } },
      { id: 'u1', status: 'in_review', item: 'CPR certificate', flow: 'Certificate review', phase: 'In review', action: { kind: 'doc', doc_id: 'certfile1234' } },
      { id: 'd1', status: 'due_soon', item: 'Form I-9', flow: 'Document renewal', phase: 'Expires in 12 days', action: { kind: 'doc' } },
      { id: 'i1', status: 'due_soon', item: 'IST · Danny Whitaker', flow: 'IST training', phase: 'Owed · due Oct 01, 2026', action: { kind: 'assign_training', house: 'nw4045' } },
    ],
    counts: { needs_attention: 1, due_soon: 2, in_review: 1 },
  })

  it('the platform\'s own words; a document without a file has no button', () => {
    assert.deepEqual(a.items.map(actionButton), ['', 'Review certificate', '', 'Assign training'])
    assert.equal(a.items[3].action.house, 'NW4045')
    assert.equal(ACTION_STATUS_META.needs_attention.label, 'Needs Attention')
    assert.equal(actionCount(a), 4)
    assert.equal(actionCount(null), null)
    assert.deepEqual(filterActions(a.items, 'renewal').map((i) => i.id), ['r1', 'd1'])
  })
})

describe('activity, notes, texts and transcripts', () => {
  it('events and visits newest first', () => {
    const a = activityOf({
      events: [{ at: '2026-09-01T10:00:00Z', kind: 'note', title: 'Note added', by: 'Boss' }, { at: '2026-09-20T10:00:00Z', kind: 'scheduled', title: 'Scheduled — Meadowlane · Mon · 7a–3p' },
        { at: '2026-09-10T10:00:00Z', kind: 'weird', title: 'Other' }],
      visits: [{ at: '2026-09-02T10:00:00Z', visitor: 'Boss', section: 'hr' }, { at: '2026-09-25T10:00:00Z', visitor: 'Ann', section: 'profile' }],
      visits_total: 2,
    })
    assert.deepEqual(a.events.map((e) => e.kind), ['scheduled', 'note', 'note'])
    assert.deepEqual(a.visits.map((v) => v.visitor), ['Ann', 'Boss'])
    const n = notesOf({ notes: [{ id: 'n1', details: 'x', state: 'resolved', at: '2026-01-01' }, { id: 'n2', details: 'y', at: '2026-02-01' }],
      earlier: [{ at: '2025-01-01', by: 'Old', details: 'Manager note' }] })
    assert.deepEqual(n.notes.map((x) => [x.id, x.state]), [['n2', 'open'], ['n1', 'resolved']])
    assert.equal(n.earlier.length, 1)
  })

  it('texts: the older cursor, the thread oldest first with each message once, and the gap drawn in its place', () => {
    const t = textsOf({
      counterparts: [{ id: '+13305550100', label: 'Hotline', count: 3 }], with: '+13305550100',
      messages: [{ id: 'm3', at: '2026-08-25T10:00:00Z', dir: 'out', body: 'Back', by: 'Office' }, { id: 'm2', at: '2026-05-06T10:00:00Z', dir: 'in', body: 'Hi' }],
      more: true, coverage: { from: '2026-01-01', to: '2026-09-28', gaps: [{ from: '2026-05-07', to: '2026-08-23' }] },
    })
    assert.equal(olderCursor(t.messages), '2026-05-06T10:00:00Z')
    const thread = threadOrder([{ id: 'm1', at: '2026-05-01T10:00:00Z', dir: 'in', body: 'First', by: '' }, t.messages[1]], t.messages)
    assert.deepEqual(thread.map((m) => m.id), ['m1', 'm2', 'm3'])
    const items = threadItems(thread, t.coverage.gaps)
    assert.deepEqual(items.map((i) => i.kind), ['day', 'msg', 'day', 'msg', 'gap', 'day', 'msg'])
  })

  it('transcripts by day, filtered by category; the words parsed into turns by side', () => {
    const tr = transcriptsOf({
      calls: [{ call_id: 'AC1', at: '2026-09-20T14:00:00Z', categories: ['Call-off'] }, { call_id: 'AC2', at: '2026-09-20T16:00:00Z', categories: ['Question'] },
        { call_id: 'AC3', at: '2026-09-18T10:00:00Z', kind: 'call_off' }],
      categories: [{ name: 'Call-off', count: 1 }], gaps: [{ from: '2026-06-01', to: '2026-06-30' }],
    })
    assert.deepEqual(tr.calls.map((c) => c.callId), ['AC2', 'AC1', 'AC3'])
    assert.deepEqual(callsByDay(tr.calls, '').map((g) => [g.day, g.calls.length]), [['Sep 20, 2026', 2], ['Sep 18, 2026', 1]])
    assert.deepEqual(callsByDay(tr.calls, 'Call-off').flatMap((g) => g.calls.map((c) => c.callId)), ['AC1'])
    const turns = parseSpeakerTranscript('[0:00] +13305550100: Hotline, how can I help?\n[0:04] (555) 010-1160: I am sick\nand cannot come\n[0:09] +19995550000: hi',
      '+1 330-555-0100', ['(555) 010-1160'])
    assert.deepEqual(turns.map((t) => [t.role, t.text]), [['agent', 'Hotline, how can I help?'], ['caller', 'I am sick\nand cannot come'], ['other', 'hi']])
    assert.deepEqual(parseSpeakerTranscript('no labels at all', '', []), [])
    const one = transcriptOf({ call_id: 'AC1', full_transcript: 'words', speaker_transcript: '', duration_sec: '61' })
    assert.deepEqual([one.hasWords, one.durationSec], [true, 61])
  })
})

describe('the menu, favorites, share and the refusal', () => {
  it('Actions in three groups, the favorite a bookmark and not a panel', () => {
    assert.deepEqual(ACTION_GROUPS.map((g) => [g.label, g.items.map((i) => i.label)]), [
      ['Performance', ['New HR Issue', 'Add Note', 'Assign Training', 'File training document']],
      ['Staff actions', ['New Incident', 'New Employee Loan', 'Add Payment']],
      ['Navigation & preferences', ['Add to favorites']],
    ])
    assert.ok(!('ask' in ACTION_GROUPS[2].items[0]))
    const fav = favoriteFor(ROSTER.staff[0])
    assert.deepEqual([fav.type, fav.refId, fav.href, fav.tint], ['person', 'staff:adamlaurent', '/app/staff-profiles/profile?staff=adamlaurent', 'blue'])
    assert.equal(panelTitle({ kind: 'access' }, 'Adam', false), 'Enable Access')
    assert.equal(panelTitle({ kind: 'access' }, 'Adam', true), 'Disable Access')
  })

  it('share carries the role, status and id — never a phone, an e-mail or an HR value', () => {
    const p = sharePayloadFor(ROSTER.staff[0], 'hr')
    assert.equal(p.appHref, '/app/staff-profiles/profile?staff=adamlaurent&tab=hr')
    assert.equal(p.text, 'Role: Chief of Staff\nStatus: Active\nEmployee ID: ASA-1060')
  })

  it('"Unknown action." is a part not open to this session, said as such', () => {
    assert.equal(readRefusal('Unknown action.'), NOT_PUBLISHED)
    assert.equal(readRefusal('Two staff records share this name — resolve them in People first.'),
      'Two staff records share this name — resolve them in People first.')
    assert.equal(dateWords('2026-09-01'), 'Sep 01, 2026')
    assert.equal(dateWords(''), '')
  })
})

describe('the viewer', () => {
  it('the roster says the cut; only the master in its own session writes, and a basic viewer never does', () => {
    assert.equal(rosterOf({ staff: [], view: 'basic' }).view, 'basic')
    assert.equal(rosterOf({ staff: [] }).view, 'full')
    assert.equal(rosterOf({ staff: [], view: 'everything' }).view, 'full')
    assert.deepEqual(viewerOf(true, 'full'), { writes: true, basic: false, assign: '', selfKey: '' })
    assert.deepEqual(viewerOf(false, 'full'), { writes: false, basic: false, assign: '', selfKey: '' })
    assert.deepEqual(viewerOf(true, 'basic'), { writes: false, basic: true, assign: '', selfKey: '' })
    assert.deepEqual(viewerOf(false, undefined), { writes: false, basic: false, assign: '', selfKey: '' })
    assert.deepEqual(viewerOf(false, 'basic', { assign: 'any', selfKey: 'bealee' }), { writes: false, basic: true, assign: '', selfKey: '' },
      'a basic viewer is never handed the manager-or-self rule')
  })

  it('a basic viewer has the profile alone and Share; a viewer who writes nothing opens no form and no account door', () => {
    const basic = viewerOf(false, 'basic'), reader = viewerOf(false, 'full'), master = viewerOf(true, 'full')
    assert.deepEqual(tabsFor(basic).map((t) => t.id), ['profile'])
    assert.deepEqual(tabsFor(reader).map((t) => t.id), ['profile', 'calendar', 'preferences', 'employment', 'documents', 'compliance',
      'performance', 'hr', 'pay', 'actions', 'activity'])
    const asks: StaffAsk[] = [{ kind: 'share' }, { kind: 'assign', house: 'NW4045' }, { kind: 'filedoc', course: 'cpr' },
      { kind: 'hrissue' }, { kind: 'incident' }, { kind: 'note' }, { kind: 'loan' }, { kind: 'payment' }, { kind: 'transcript', id: 'AC1' },
      { kind: 'invite' }, { kind: 'access' }, { kind: 'reset' }, { kind: 'edit', section: 'hr' }]
    assert.deepEqual(asks.filter((a) => askFor(a, basic)).map((a) => a.kind), ['share'])
    // Add Payment is no form the menu withholds: its door judges a manager, a director, the master or the person's own loan
    assert.deepEqual(asks.filter((a) => askFor(a, reader)).map((a) => a.kind), ['share', 'payment', 'transcript'])
    assert.equal(asks.filter((a) => askFor(a, master)).length, asks.length)
    assert.equal(askFor(null, master), null)
    assert.deepEqual([...WRITE_ASKS].sort(),
      ['access', 'assign', 'docmark', 'edit', 'filedoc', 'hrissue', 'incident', 'invite', 'loan', 'note', 'reset'])
    // a missing record is marked concluded by a holder of staff.documentation, as editionsMine names it (the master's too)
    const mark: StaffAsk = { kind: 'docmark', date: '2026-10-10', area: 'daily_notes' }
    assert.equal(askFor(mark, reader), null)
    assert.equal(askFor(mark, master), null)
    assert.deepEqual(askFor(mark, viewerOf(true, 'full', undefined, ['staff.documentation'])), mark)
    assert.deepEqual(actionGroupsFor(reader).flatMap((g) => g.items.map((i) => i.label)), ['Add Payment', 'Add to favorites'])
    assert.deepEqual(actionGroupsFor(basic).map((g) => g.label), ['Navigation & preferences'])
    assert.equal(actionGroupsFor(master), ACTION_GROUPS)
    // Compliance documents' review edition opens the filed papers' panel alone; never for a basic viewer
    const reviewer = viewerOf(false, 'full', undefined, [], true)
    assert.deepEqual(asks.filter((a) => askFor(a, reviewer)).map((a) => a.kind), ['share', 'filedoc', 'payment', 'transcript'])
    assert.deepEqual(viewerOf(false, 'basic', undefined, [], true), basic)
  })

  it('Assign Training: a manager on any record, the person on their own alone; New HR Issue and New Employee Loan stay restricted', () => {
    const manager = viewerOf(false, 'full', { assign: 'any', selfKey: 'bealee' })
    const self = viewerOf(false, 'full', { assign: '', selfKey: 'bealee' })
    const assign: StaffAsk = { kind: 'assign', house: '' }
    assert.deepEqual([askFor(assign, manager, 'adamlaurent'), askFor(assign, self, 'bealee')], [assign, assign])
    assert.equal(askFor(assign, self, 'adamlaurent'), null, 'never on another person\'s record')
    for (const viewer of [manager, self]) {
      for (const kind of ['hrissue', 'loan', 'note', 'incident', 'filedoc'] as const) {
        assert.equal(askFor(kind === 'filedoc' ? { kind, course: '' } : { kind }, viewer, 'bealee'), null, kind)
      }
    }
    const labels = (v: typeof self, key: string) => actionGroupsFor(v, key).flatMap((g) => g.items.map((i) => i.label))
    assert.deepEqual(labels(self, 'bealee'), ['Assign Training', 'Add Payment', 'Add to favorites'])
    assert.deepEqual(labels(self, 'adamlaurent'), ['Add Payment', 'Add to favorites'])
    assert.deepEqual(labels(manager, 'adamlaurent'), ['Assign Training', 'Add Payment', 'Add to favorites'])
  })

  it('the record edit: a field is open only when the read handed its raw value; the rename, the payroll id and the protected ones stay locked; only a change is sent, witnessed by the raw', () => {
    const view = staffEditViewOf('hr', {
      personal: { ssn_masked: '•••-••-4329', dob: '1990-05-17' }, driver: { license_masked: 'OH •••• 7731' },
      edit: { address: '12 Main St NW', w4_date: '2023-12-22T05:00:00.000Z', nurse_aide: 'n/a', ssn: '987-65-4329' },
    })
    const fields = staffEditFields('hr', view)
    const by = new Map(fields.map((f) => [f.key, f]))
    assert.equal(by.get('address')?.lockedBy, undefined)
    assert.equal(editShown(by.get('w4_date')!), '2023-12-22', 'a sheet instant is its Ohio day')
    assert.equal(editShown(by.get('nurse_aide')!), 'n/a', 'a cell of words stays words')
    assert.ok(by.get('city')?.lockedBy, 'no raw value handed over: locked')
    for (const k of ['ssn', 'dob', 'dl', 'bci_fbi']) assert.ok(by.get(k)?.lockedBy, k)
    assert.equal(by.get('ssn')?.raw, '•••-••-4329', 'a protected field shows its mask, never a raw value')
    const prof = staffEditFields('profile', staffEditViewOf('profile', { person: { first_name: 'Noah', employee_id: 'ASA-1060' }, edit: { status: 'Yes' } }))
    assert.deepEqual(prof.filter((f) => f.lockedBy && ['first_name', 'last_name', 'employee_id', 'role'].includes(f.key)).length, 4)
    assert.ok(prof.find((f) => f.key === 'login_email')?.confirm)
    assert.deepEqual(diffChanges(fields, { address: '12 Main St NW ', w4_date: '2024-01-03', city: 'Akron', ssn: '1' }),
      [{ field: 'w4_date', value: '2024-01-03', expected: '2023-12-22T05:00:00.000Z' }])
  })

  it('a refusal — the app\'s own "Unknown action." or a door that is not this account\'s — is said plainly', () => {
    assert.equal(NOT_PUBLISHED, 'This part is not open to you.')
    for (const e of ['Unknown action.', 'Requires an admin or manager account', 'This action is for admin or manager.']) {
      assert.ok(isRefusal(e), e)
      assert.equal(readRefusal(e), NOT_PUBLISHED)
    }
    assert.ok(!isRefusal('No staff member with that key.'))
    assert.ok(!isRefusal('The staff list could not be read just now (x).'))
  })
})
