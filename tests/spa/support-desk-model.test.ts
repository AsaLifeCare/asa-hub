/**
 * Support Requests · the model: the hotline's type read as "Area · Label", the answer read defensively (a row that
 * cannot be read is counted, never shown as something else), the search over the five fields, the date sort, the
 * Ohio words, the paint of the status and the type, and the buttons a row's panel draws from `may`.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTO_PARTS, SEARCH_PLACEHOLDER, UNKNOWN_CALLER, VERDICTS, VERDICT_WORDS, adpLine, answerRow, areaOf, boardFrom, countChips,
  dateWords, decideToast, emptyLine, historyHead, isConflict, matches, naturalVerdicts, openRefOf, panelButtons, replaceRow,
  requestorName, searchPeople, seatFrom, sourceLines, statusLook, statusPill, typeParts, typeTint, verdictWord, visibleRows,
  type Row,
} from '@/pages/features/supportdesk/supportDeskModel'
import { PEOPLE, rawBoard, rawRow } from './fixtures/supportDesk'

const row = (over: Record<string, unknown> = {}): Row => boardFrom(rawBoard([rawRow(over)])).rows[0]

describe('support desk model — the hotline type', () => {
  it('splits on the first " - " and shows "Area · Label"', () => {
    assert.deepEqual(typeParts('Operations - Vehicle Issue'), { raw: 'Operations - Vehicle Issue', area: 'Operations', label: 'Vehicle Issue', display: 'Operations · Vehicle Issue' })
    assert.deepEqual(typeParts('ADP - Update - Information'), { raw: 'ADP - Update - Information', area: 'ADP', label: 'Update - Information', display: 'ADP · Update - Information' })
    assert.deepEqual(typeParts('Payroll'), { raw: 'Payroll', area: '', label: 'Payroll', display: 'Payroll' })
    assert.deepEqual(typeParts('  '), { raw: '', area: '', label: 'Other', display: 'Other' })
  })

  it('a row the server sent with only the raw type is still shown as the hotline shows it', () => {
    const r = row({ type: { raw: 'Schedule - Call Off' } })
    assert.equal(r.type.display, 'Schedule · Call Off')
    assert.equal(r.type.area, 'Schedule')
  })

  it('tints the pill by area: Schedule blue, ADP and Payroll purple, Operations amber, Attendance red, Other gray', () => {
    const tint = (raw: string, route = '') => typeTint({ type: typeParts(raw), route })
    assert.equal(tint('Schedule - Call Off'), 'blue')
    assert.equal(tint('ADP - Pay Stubs'), 'lavender')
    assert.equal(tint('Payroll'), 'lavender')
    assert.equal(tint('Operations - Vehicle Issue'), 'amber')
    assert.equal(tint('Other - General Requests'), 'slate')
    assert.equal(tint('Not specified in transcript'), 'slate')
    assert.equal(tint('Van Calendar', 'vehicle'), 'amber')
    assert.equal(typeTint({ type: { raw: '', area: '', label: 'Attendance · Late Show', display: 'Attendance · Late Show' }, route: '' }), 'danger')
    assert.equal(areaOf({ raw: '', area: '', label: 'x', display: 'Incident · Minor injury' }), 'Incident')
    assert.equal(typeTint({ type: { raw: '', area: '', label: 'x', display: 'Incident · Minor injury' }, route: '' }), 'amber')
  })
})

describe('support desk model — the answer read defensively', () => {
  it('reads a whole answer', () => {
    const b = boardFrom(rawBoard())
    assert.equal(b.rows.length, 1)
    assert.equal(b.viewer.can_decide, true)
    assert.equal(b.test_mode.on, true)
    assert.equal(b.directors.length, 2)
    assert.equal(b.automations.punch, null, 'an unreadable switch stays unknown, never off')
    assert.equal(b.automations.late_show, false)
    assert.equal(b.unreadRows, 0)
    assert.deepEqual(AUTO_PARTS.length, 9)
  })

  it('a row without a ref is counted as unread, never drawn as another', () => {
    const b = boardFrom(rawBoard([rawRow(), { source: 'queue' }, 'junk', null]))
    assert.equal(b.rows.length, 1)
    assert.equal(b.unreadRows, 3)
  })

  it('an unknown tone reads pending; an unreadable test mode reads on', () => {
    assert.equal(row({ status: { word: 'Odd', tone: 'sparkly' } }).status.tone, 'pending')
    assert.equal(boardFrom(rawBoard([], { test_mode: { on: false, readable: false, why: 'x' } })).test_mode.on, true)
    assert.equal(boardFrom({}).test_mode.on, false)
    assert.equal(boardFrom(null).rows.length, 0)
  })

  it('keeps the Scheduling part and the ADP part', () => {
    const r = row({
      ref: 'SF0123456789', source: 'scheduling', kind: 'time_off',
      sched: { flow_id: 'SF0123456789', state: 'waiting', item_id: 'SI0000000001', words: ['approve', 'decline'], seats: [{ seat: 'director', state: 'waiting', to: ['Ty Bond'], by: '', at: '', note: '' }] },
      adp: { state: 'ready', field: 'email', words: 'Add a@b.co to Joan’s e-mails', proof: 'ABCDEF0123', why: '' },
    })
    assert.equal(r.sched?.item_id, 'SI0000000001')
    assert.deepEqual(r.sched?.seats[0].to, ['Ty Bond'])
    assert.equal(r.adp?.state, 'ready')
    assert.equal(r.adp?.proof, 'ABCDEF0123')
    assert.equal(row({ adp: { state: 'nonsense' } }).adp?.state, 'refused', 'an ADP state not known is never read as applied')
  })
})

describe('support desk model — search, completed, sort', () => {
  const rows = boardFrom(rawBoard([
    rawRow(),
    rawRow({ ref: 'HQ6EEF063DEE', date: '9/16/2026', requestor: { name: 'Angel Fiber', uid: '' }, type: { raw: 'Payroll' }, description: 'Missing paycheck for last week', route: 'payroll' }),
    rawRow({ ref: 'HQ82D0D7C86E', date: '2026-09-18', requestor: { name: '', uid: '' }, type: { raw: 'Other - General Requests' }, description: 'Caller reached voicemail and left no details.', completed: true, status: { word: 'Resolved', tone: 'resolved' } }),
    rawRow({ ref: 'SE00AA11BB22', source: 'event', kind: 'late_show', date: '2026-09-30T12:10:00Z', type: { raw: '', area: 'Attendance', label: 'Late Show', display: 'Attendance · Late Show' }, requestor: { name: 'Maria Lopez', uid: '' }, description: 'BM4060 · 8A-4P' }),
  ])).rows

  it('the search matches the ref, the requestor, the type as shown and as filed, and the description, any case', () => {
    assert.equal(SEARCH_PLACEHOLDER, 'Search ID, requestor, type or description')
    const q = (s: string) => visibleRows(rows, { query: s, completed: true, dir: 'desc' }).map((r) => r.ref)
    assert.deepEqual(q('hq6eef'), ['HQ6EEF063DEE'])
    assert.deepEqual(q('angel'), ['HQ6EEF063DEE'])
    assert.deepEqual(q('Operations · Vehicle'), ['HQ5EF1CB5F25'])
    assert.deepEqual(q('operations - vehicle'), ['HQ5EF1CB5F25'])
    assert.deepEqual(q('PAYCHECK'), ['HQ6EEF063DEE'])
    assert.deepEqual(q('late show'), ['SE00AA11BB22'])
    assert.equal(matches(rows[0], ''), true)
  })

  it('completed rows are left out unless asked for', () => {
    const open = visibleRows(rows, { query: '', completed: false, dir: 'desc' }).map((r) => r.ref)
    assert.ok(!open.includes('HQ82D0D7C86E'))
    assert.ok(visibleRows(rows, { query: '', completed: true, dir: 'desc' }).some((r) => r.ref === 'HQ82D0D7C86E'))
  })

  it('sorts by the date, newest first by default, and the other way round; a M/D/YYYY day sorts as its day', () => {
    const desc = visibleRows(rows, { query: '', completed: true, dir: 'desc' }).map((r) => r.date)
    assert.deepEqual(desc, ['2026-09-30T12:10:00Z', '2026-09-18', '9/16/2026', '2026-01-27T15:04:00Z'])
    const asc = visibleRows(rows, { query: '', completed: true, dir: 'asc' }).map((r) => r.date)
    assert.deepEqual(asc, [...desc].reverse())
  })

  it('says the date in Ohio words; a day is a day; a blank requestor is an unknown caller', () => {
    assert.equal(dateWords('2026-09-18T18:24:00Z'), 'Sep 18, 2026 2:24 PM')
    assert.equal(dateWords('2026-09-18'), 'Sep 18, 2026')
    assert.equal(dateWords('9/16/2026'), 'Sep 16, 2026')
    assert.equal(dateWords('2026-09-18T02:30:00Z'), 'Sep 17, 2026 10:30 PM', 'the Ohio day, not the UTC one')
    assert.equal(dateWords('not a date'), 'not a date')
    assert.equal(dateWords(''), '—')
    assert.equal(requestorName(rows[2]), UNKNOWN_CALLER)
  })
})

describe('support desk model — paint, figures and sources', () => {
  it('each status tone has its icon', () => {
    assert.equal(statusLook('new').icon, 'dot')
    assert.equal(statusLook('pending').icon, 'clock')
    assert.equal(statusLook('waiting').icon, 'clock')
    assert.equal(statusLook('warning').icon, 'triangle-alert')
    assert.equal(statusLook('important').icon, 'flag')
    assert.equal(statusLook('approved').icon, 'check')
    assert.equal(statusLook('denied').icon, 'x')
    for (const t of ['resolved', 'aware', 'closed'] as const) assert.equal(statusLook(t).icon, 'check-circle')
    assert.match(statusLook('warning').className, /danger/)
    assert.match(statusPill('warning'), /danger/)
  })

  it('the figures are the server\'s', () => {
    assert.deepEqual(countChips({ counts: { open: 4, waiting_on_me: 2, warnings: 1, completed: 9 } }).map((c) => `${c.label} ${c.n}`),
      ['Open 4', 'Waiting on you 2', 'Warnings 1'])
  })

  it('a source that could not be read is said, and the empty table never says "no requests" then', () => {
    const b = boardFrom(rawBoard([], { sources: [{ key: 'queue', state: 'ready', why: '', count: 0 }, { key: 'scheduling', state: 'unreadable', why: "Scheduling's houses are not set up yet" }] }))
    assert.deepEqual(sourceLines(b).map((l) => l.text), ['Scheduling could not be read — Scheduling\'s houses are not set up yet. Its requests are not listed.'])
    assert.match(emptyLine(b, false), /sources that answered/)
    const whole = boardFrom(rawBoard([]))
    assert.equal(emptyLine(whole, false), 'No open requests.')
    assert.equal(emptyLine(whole, true), 'Nothing matches the search.')
  })
})

describe('support desk model — the panel\'s buttons', () => {
  const NONE = { approve: false, deny: false, resolve: false, aware: false, redirect: false, why: '' }
  const verdicts = (r: Row) => panelButtons(r).buttons.map((b) => `${b.verdict}${b.on ? '' : ':off'}`)

  it('a request always has its four answers — Approve, Deny, Resolved, Redirect — pressable where `may` offers them', () => {
    assert.deepEqual(panelButtons(row()), { buttons: [{ verdict: 'approve', on: true }, { verdict: 'deny', on: true },
      { verdict: 'resolve', on: true }, { verdict: 'redirect', on: true }], why: '' })
    assert.deepEqual(VERDICTS.filter((v) => v !== 'aware').map((v) => VERDICT_WORDS[v].label), ['Approve', 'Deny', 'Resolved', 'Redirect'])
    assert.deepEqual(naturalVerdicts({ kind: 'request', source: 'queue' }), ['approve', 'deny', 'resolve', 'redirect'])
    assert.deepEqual(naturalVerdicts({ kind: 'adp', source: 'queue' }), ['approve', 'deny', 'resolve', 'redirect'])
  })

  it('the master on a request: the four drawn, Approve and Deny greyed with the server\'s reason', () => {
    const why = 'Only the directors approve or deny.'
    const r = row({ may: { ...NONE, resolve: true, redirect: true, why } })
    assert.deepEqual(verdicts(r), ['approve:off', 'deny:off', 'resolve', 'redirect'])
    assert.equal(panelButtons(r).why, why)
  })

  it('a warning is I\'m aware alone; an incident Resolved and Redirect (and I\'m aware while unmarked)', () => {
    assert.deepEqual(verdicts(row({ may: { ...NONE, aware: true }, kind: 'late_show', source: 'event' })), ['aware'])
    assert.deepEqual(verdicts(row({ may: { ...NONE, resolve: true, redirect: true, aware: true }, kind: 'incident', source: 'event' })),
      ['resolve', 'redirect', 'aware'])
    assert.deepEqual(naturalVerdicts({ kind: 'punch', source: 'event' }), ['aware'])
    assert.deepEqual(naturalVerdicts({ kind: 'incident', source: 'event' }), ['resolve', 'redirect'])
  })

  it('a Scheduling row keeps Scheduling\'s two; offered nothing, they are greyed with the server\'s reason', () => {
    const why = 'Waiting on Ty Bond, Brittany Anderson — the first answer decides'
    const b = panelButtons(row({ source: 'scheduling', kind: 'time_off', may: { ...NONE, why } }))
    assert.deepEqual(b, { buttons: [{ verdict: 'approve', on: false }, { verdict: 'deny', on: false }], why })
    assert.deepEqual(verdicts(row({ source: 'scheduling', kind: 'time_off', may: { ...NONE, approve: true, deny: true } })), ['approve', 'deny'])
  })

  it('a closed row with nothing offered draws no button', () => {
    assert.deepEqual(panelButtons(row({ completed: true, may: NONE })).buttons, [])
  })

  it('reads `may.redirect`, the people to redirect to, and a history line\'s "to"', () => {
    assert.equal(row().may.redirect, true)
    assert.equal(row({ may: { approve: true } }).may.redirect, false, 'absent is not offered')
    const b = boardFrom(rawBoard([rawRow()], { people: [...PEOPLE, { uid: '', name: 'No Id' }, { uid: 'U1', name: '' }, 'junk'] }))
    assert.deepEqual(b.people.map((p) => p.uid), ['USR_RB', 'USR_AN', 'USR_B08C57743A1E'], 'an entry without an id and a name is no choice')
    assert.deepEqual(boardFrom(rawBoard([], { people: undefined })).people, [])
    const r = row({ history: [{ at: '2026-10-01T15:00:00Z', by: 'Ty Bond', verdict: 'redirected', note: 'Please call her', via: 'support-desk', to: 'Ann Roe' },
      { at: '2026-10-01T16:00:00Z', by: 'Ann Roe', verdict: 'approved', note: '', via: 'support-desk' }] })
    assert.deepEqual(r.history.map(historyHead), [{ verdict: 'Redirected to Ann Roe', by: 'Ty Bond' }, { verdict: 'Approved', by: 'Ann Roe' }])
    assert.equal(r.history[1].to, undefined)
    assert.equal(verdictWord('redirected'), 'Redirected')
  })

  it('the people search keeps every name holding each word typed, in any case', () => {
    assert.deepEqual(searchPeople(PEOPLE, 'an').map((p) => p.name), ['Regina Bowman', 'Ann Roe', 'Brittany Anderson'])
    assert.deepEqual(searchPeople(PEOPLE, 'SON').map((p) => p.name), ['Brittany Anderson'])
    assert.deepEqual(searchPeople(PEOPLE, '  ROE ann ').map((p) => p.name), ['Ann Roe'])
    assert.deepEqual(searchPeople(PEOPLE, ''), PEOPLE)
    assert.deepEqual(searchPeople(PEOPLE, 'zz'), [])
  })

  it('the seat of a redirected request is read defensively', () => {
    const s = seatFrom({ ok: true, row: rawRow(), people: PEOPLE, people_why: 'One name is worn twice.',
      viewer: { uid: 'USR_AN', name: 'Ann Roe', is_director: false, can_decide: false } })
    assert.equal(s.row?.ref, 'HQ5EF1CB5F25')
    assert.deepEqual([s.people.length, s.people_why, s.viewer.uid, s.viewer.can_decide], [3, 'One name is worn twice.', 'USR_AN', false])
    assert.deepEqual(seatFrom(null), { row: null, people: [], people_why: '',
      viewer: { uid: '', name: '', is_master: false, is_director: false, is_lead: false, can_decide: false } })
    assert.equal(seatFrom({ row: { nope: 1 } }).row, null)
  })

  it('a redirect\'s toast says it was redirected, in the server\'s words', () => {
    assert.deepEqual(decideToast('redirect', { changed: true, said: 'Redirected to Ann Roe — it waits in their My Work.' }),
      { type: 'success', title: 'Redirected', body: 'Redirected to Ann Roe — it waits in their My Work.' })
    assert.equal(decideToast('resolve', { changed: true, said: 'Resolved.' }).title, 'Resolved — recorded')
  })

  it('an answer\'s row replaces the held one; a toast says what the server said', () => {
    const b = boardFrom(rawBoard())
    const next = answerRow({ ok: true, changed: true, said: 'Approved.', row: rawRow({ status: { word: 'Approved', tone: 'approved' }, completed: true }) })
    assert.ok(next)
    const after = replaceRow(b, next!)
    assert.equal(after.rows.length, 1)
    assert.equal(after.rows[0].status.word, 'Approved')
    assert.equal(answerRow({ ok: true }), null)
    assert.deepEqual(decideToast('approve', { changed: true, said: 'Approved.' }), { type: 'success', title: 'Approve — recorded', body: 'Approved.' })
    assert.equal(decideToast('deny', { changed: false, said: 'Already denied by Ty Bond.' }).type, 'info')
  })

  it('a 409 is a conflict; history words read plainly; an address opens a ref', () => {
    assert.equal(isConflict(Object.assign(new Error('Already approved'), { status: 409 })), true)
    assert.equal(isConflict(new Error('x')), false)
    assert.equal(verdictWord('refused_auto'), 'Not applied automatically')
    assert.equal(verdictWord('aware'), 'Aware')
    assert.equal(openRefOf(new URLSearchParams('ref=HQ5EF1CB5F25-2')), 'HQ5EF1CB5F25-2')
    assert.equal(openRefOf(new URLSearchParams('ref=<script>')), '')
  })

  it('the ADP block says each state, never "applied" for one refused', () => {
    assert.match(adpLine({ state: 'off', field: '', words: '', proof: '', why: '' }), /off in Settings/)
    assert.equal(adpLine({ state: 'refused', field: '', words: '', proof: '', why: 'the caller line is shared' }), 'The caller line is shared.')
    assert.match(adpLine({ state: 'applied', field: 'address', words: '', proof: '', why: '' }), /ADP still needs the change/)
  })
})
