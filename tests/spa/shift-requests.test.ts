/**
 * THE REQUESTS SCREEN'S OWN LOGIC (src/pages/features/shifts/requestsLogic.ts).
 *
 * WHAT IS WORTH HOLDING HERE, and what is deliberately not. The windows, the
 * eligibility, the overlaps and the privacy cuts are the SERVER's and are held
 * by tools/test-shift-requests.py — asserting them again in TypeScript would
 * be asserting a copy, and the copy is the bug those tests exist to prevent.
 *
 * What is the screen's own, and what these hold:
 *   · the COUNTDOWN, which is the one number on this page that is wrong the
 *     moment it is off by one and nobody can tell by looking;
 *   · the four WORDS about a shift, because the Desk's card, the calendar's
 *     cell panel and this screen all call the same function and must therefore
 *     keep saying the same thing about one night;
 *   · the CUTS, which must narrow and must never hide a row from somebody who
 *     would otherwise see it;
 *   · and WHICH BUTTONS are drawn, because a button that refuses when you
 *     press it teaches people to stop pressing.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  actionsFor, codeOf, countdown, cutsFrom, dayLabel, decidesHere, drawsHouses, filterRows, groupByDay,
  shiftStateLabel, shiftStateWord, stateGroup, timeOffDirectorsNote, visibleRows, type RequestRow, type ShiftWindow,
} from '@/pages/features/shifts/requestsLogic'

describe('the time-off tab says what the directors list says beside its rows', () => {
  it('nothing while it names somebody; its sentence while blank; unread is said, never drawn as nothing waiting', () => {
    assert.equal(timeOffDirectorsNote(undefined), '')
    assert.equal(timeOffDirectorsNote({ directors_readable: true, directors_why: '' }), '')
    // a feed without the field (a relay before it) draws no note of its own
    assert.equal(timeOffDirectorsNote({}), '')
    assert.equal(timeOffDirectorsNote({ directors_readable: true,
      directors_why: 'the Time Off house\'s Settings tab names no director — the director half waits until one is named there' }),
      'The Time Off house\'s Settings tab names no director — the director half waits until one is named there.')
    const unread = timeOffDirectorsNote({ directors_readable: false,
      directors_why: 'the Time Off house\'s directors list could not be read (its Settings tab carries no `directors` row)' })
    assert.match(unread, /^The directors list could not be read — the Time Off house's directors list could not be read/)
    assert.match(unread, /No time off request is filed or decided until it can be\.$/)
    assert.match(timeOffDirectorsNote({ directors_readable: false }), /no reason was given/)
  })
})

const T0 = Date.parse('2026-09-22T13:00:00Z')
const win = (over: Partial<ShiftWindow> = {}): ShiftWindow => ({
  kind: 'open_shift', opens_at: '2026-09-22T13:00:00Z', closes_at: '2026-09-22T13:10:00Z',
  state: 'open', seconds_left: 600, reserved: true, why: 'reserved', ...over,
})

const row = (over: Partial<RequestRow> = {}): RequestRow => ({
  id: 'SR1', kind: 'open_shift', at: '2026-09-22T13:00:00Z', house: '48TH (B)',
  location: 'CAN - 48TH (B) - ABD1711', col_iso: '2026-09-22', open_row: 'OPEN',
  shift: '8A-4P', person: 'Ann Roe', state: 'applied', why: '', via: 'app',
  decided_by: '', decided_at: '', mine: true, visible: true, ...over,
})

describe('countdown — the ten minutes somebody was actually given', () => {
  it('counts minutes AND seconds under the hour, so it never reads the same twice', () => {
    assert.equal(countdown('2026-09-22T13:09:01Z', T0).label, '9m 1s')
    assert.equal(countdown('2026-09-22T13:09:00Z', T0).label, '9m 0s')
  })
  it('counts seconds alone in the last minute', () => {
    assert.equal(countdown('2026-09-22T13:00:45Z', T0).label, '45s')
  })
  it('stops counting seconds past the hour — nobody watches a five-hour clock', () => {
    assert.equal(countdown('2026-09-22T18:00:00Z', T0).label, '5h 0m')
    assert.equal(countdown('2026-09-22T17:30:30Z', T0).label, '4h 30m')
  })
  it('a window that has ended says so, and never a negative number', () => {
    const got = countdown('2026-09-22T12:59:00Z', T0)
    assert.equal(got.label, 'closed')
    assert.equal(got.seconds, 0)
  })
  it('the last two minutes are urgent, and 2m1s is not', () => {
    assert.equal(countdown('2026-09-22T13:02:00Z', T0).urgent, true)
    assert.equal(countdown('2026-09-22T13:02:01Z', T0).urgent, false)
  })
  it('an unreadable instant draws nothing rather than NaN', () => {
    assert.equal(countdown('not a time', T0).label, '')
  })
})

describe('the four words about a shift — one spelling for three screens', () => {
  it('a reserved window names the house and the minute it opens up', () => {
    const said = shiftStateLabel('open', win())
    assert.match(said, /^Reserved for this house's staff until /)
    assert.equal(shiftStateWord('open', win()), 'Reserved')
  })
  it('an open window that is not reserved is simply open', () => {
    assert.equal(shiftStateLabel('open', win({ reserved: false })), 'Open to applications')
    assert.equal(shiftStateWord('open', win({ reserved: false })), 'Open')
  })
  it('a closed window says whose decision it is now', () => {
    assert.equal(shiftStateLabel('closed', win({ state: 'closed' })),
                 'Closed — awaiting the house manager')
    assert.equal(shiftStateWord('closed', win({ state: 'closed' })), 'Closed')
  })
  it('a shift too close to its start was never open, and says so', () => {
    assert.equal(shiftStateLabel('manager_only', win({ state: 'manager_only' })),
                 'The house manager assigns it')
  })
  it('filled outranks the window — a taken shift is never "open"', () => {
    assert.equal(shiftStateLabel('filled', win()), 'Filled')
    assert.equal(shiftStateWord('filled', win()), 'Filled')
  })
})

describe('the cuts — they narrow, and they never hide', () => {
  const rows = [
    row({ id: 'a', house: '48TH (B)', kind: 'open_shift', state: 'applied', person: 'Ann Roe' }),
    row({ id: 'b', house: 'JH', kind: 'call_off', state: 'approved', person: 'Ben Left' }),
    row({ id: 'c', house: 'JH', kind: 'swap', state: 'pending', person: 'Cy Far',
          from_staff: 'Ann Roe', to_staff: 'Cy Far' }),
    row({ id: 'd', house: '48TH (B)', kind: 'ist_approval', state: 'needs_training_approval',
          person: 'Dee Way' }),
  ]
  it('no cut at all is the whole list — a settled row is never dropped', () => {
    assert.equal(filterRows(rows, {}).length, 4)
  })
  it('by house', () => {
    assert.deepEqual(filterRows(rows, { house: 'JH' }).map((r) => r.id), ['b', 'c'])
  })
  it('by kind', () => {
    assert.deepEqual(filterRows(rows, { kind: 'swap' }).map((r) => r.id), ['c'])
  })
  it('by state, folded to the only two that matter on a long list', () => {
    assert.deepEqual(filterRows(rows, { state: 'waiting' }).map((r) => r.id), ['a', 'c', 'd'])
    assert.deepEqual(filterRows(rows, { state: 'settled' }).map((r) => r.id), ['b'])
  })
  it('search reaches the person on either side of a swap', () => {
    assert.deepEqual(filterRows(rows, { q: 'ann' }).map((r) => r.id), ['a', 'c'])
  })
  it('search is case-blind and reaches the house', () => {
    assert.deepEqual(filterRows(rows, { q: '48th' }).map((r) => r.id), ['a', 'd'])
  })
  it('two cuts are an AND', () => {
    assert.deepEqual(filterRows(rows, { house: 'JH', kind: 'call_off' }).map((r) => r.id), ['b'])
  })
  it('the choices are read off the rows, so a new house appears by itself', () => {
    assert.deepEqual(cutsFrom(rows).houses, ['48TH (B)', 'JH'])
    assert.deepEqual(cutsFrom(rows).kinds,
                     ['call_off', 'ist_approval', 'open_shift', 'swap'])
  })
  it('a pending swap counts as waiting, and a dead one as settled', () => {
    assert.equal(stateGroup('pending'), 'waiting')
    assert.equal(stateGroup('needs_training_approval'), 'waiting')
    assert.equal(stateGroup('dead'), 'settled')
    assert.equal(stateGroup('not_chosen'), 'settled')
  })
})

describe('visibility — the server cut it, and the screen keeps the cut', () => {
  it('a row that arrived marked invisible is never drawn', () => {
    const rows = [row({ id: 'mine', visible: true }), row({ id: 'theirs', visible: false })]
    assert.deepEqual(visibleRows(rows).map((r) => r.id), ['mine'])
  })
})

describe('which buttons are drawn', () => {
  const staff = { me: 'Ann Roe', manages: [] as string[], badges: ['STAFF'] }
  const hm = { me: 'Shylah Walker', manages: ['ABD1711'], badges: ['STAFF', 'HM'] }
  const admin = { me: 'Arthur Torres', manages: [] as string[], badges: ['ADMINISTRATOR'] }

  it('a person may withdraw their own application and nobody else may', () => {
    assert.equal(actionsFor(row(), staff, codeOf).withdraw, true)
    assert.equal(actionsFor(row({ person: 'Ben Left' }), staff, codeOf).withdraw, false)
  })
  it('and not once it is settled — there is nothing left to withdraw', () => {
    assert.equal(actionsFor(row({ state: 'approved' }), staff, codeOf).withdraw, false)
  })
  it('a staff member is never offered Approve', () => {
    assert.equal(actionsFor(row(), staff, codeOf).decide, false)
  })
  it('the house manager of THAT house is', () => {
    assert.equal(actionsFor(row(), hm, codeOf).decide, true)
  })
  it('and not in a house they do not manage', () => {
    const other = row({ location: 'CAN - JH - ABD2704' })
    assert.equal(actionsFor(other, hm, codeOf).decide, false)
  })
  it('an administrator decides everywhere', () => {
    assert.equal(actionsFor(row({ location: 'CAN - JH - ABD2704' }), admin, codeOf).decide, true)
  })
  it('a training approval is the house manager\'s, never the applicant\'s', () => {
    const t = row({ kind: 'ist_approval', state: 'needs_training_approval' })
    assert.equal(actionsFor(t, hm, codeOf).training, true)
    assert.equal(actionsFor(t, staff, codeOf).training, false)
  })
  // a transfer's buttons are the relay's may_* flags
  const swap = (over: Partial<RequestRow>) => row({
    id: 'HO1', kind: 'swap', state: 'pending', person: 'Cy Far',
    from_staff: 'Ann Roe', to_staff: 'Cy Far', house_manager: 'Shylah Walker',
    staff_state: 'pending', manager_state: 'pending', ...over,
  })
  it('the swap asks the side the relay says is this reader\'s, and only that side', () => {
    assert.equal(actionsFor(swap({ may_accept: true }), { ...staff, me: 'Cy Far' }, codeOf).answerSwap, 'staff')
    assert.equal(actionsFor(swap({ may_approve: true }), hm, codeOf).answerSwap, 'manager')
    // the giver is asked nothing: they already said what they wanted — they may withdraw
    const giver = actionsFor(swap({ may_withdraw: true }), staff, codeOf)
    assert.equal(giver.answerSwap, '')
    assert.equal(giver.withdrawSwap, true)
  })
  it('a name that matches is not enough — a house manager in the swap is never offered Approve', () => {
    // a house manager taking the shift gets may_accept, never may_approve
    const own = swap({ to_staff: 'Shylah Walker', may_accept: true, may_approve: false })
    assert.equal(actionsFor(own, hm, codeOf).answerSwap, 'staff')
    assert.equal(actionsFor(swap({}), hm, codeOf).answerSwap, '')
  })
  it('a side that has already answered is not asked again', () => {
    const answered = swap({ staff_state: 'accepted', may_accept: false, may_approve: true })
    assert.equal(actionsFor(answered, { ...staff, me: 'Cy Far' }, codeOf).answerSwap, 'manager')
    assert.equal(actionsFor(swap({ state: 'done', may_approve: true }), hm, codeOf).answerSwap, '')
    assert.equal(actionsFor(swap({ state: 'dead', may_withdraw: true }), staff, codeOf).withdrawSwap, false)
  })
  it('an account with no roster name is offered nothing at all', () => {
    const nobody = { me: '', manages: [] as string[], badges: [] as string[] }
    const got = actionsFor(row(), nobody, codeOf)
    assert.deepEqual(got, { withdraw: false, decide: false, training: false, answerSwap: '',
                            withdrawSwap: false })
  })
})

describe('who decides in a house — the Houses panel reads the whole company', () => {
  const hm = { manages: ['ABD1711'], badges: ['STAFF', 'HM'] }
  const admin = { manages: [] as string[], badges: ['ADMINISTRATOR'] }
  const staff = { manages: [] as string[], badges: ['STAFF'] }

  it('the house manager decides in their own house', () => {
    assert.equal(decidesHere(hm, 'CAN - 48TH (B) - ABD1711'), true)
  })
  it('AND NOT IN THE TWELVE OTHERS they can now read — the whole point of the tab', () => {
    assert.equal(decidesHere(hm, 'CAN - JH - ABD2704'), false)
    assert.equal(decidesHere(hm, 'CAN - 38TH - ABD2005'), false)
  })
  it('an administrator decides everywhere', () => {
    assert.equal(decidesHere(admin, 'CAN - JH - ABD2704'), true)
  })
  it('a caregiver decides nowhere, including where they work', () => {
    assert.equal(decidesHere(staff, 'CAN - 48TH (B) - ABD1711'), false)
  })
  it('the Houses tab is drawn for the whole company and for a house manager — by code or ticked — never a caregiver', () => {
    assert.equal(drawsHouses({ whole_company: false, manages: ['ABD1711'] }), true)
    assert.equal(drawsHouses({ whole_company: true, manages: [] }), true)
    assert.equal(drawsHouses({ whole_company: false, manages: [] }), false)
    assert.equal(drawsHouses(null), false)
  })
  it('it is the same answer actionsFor gives, so one row cannot say two things', () => {
    const here = row({ location: 'CAN - 48TH (B) - ABD1711' })
    const there = row({ location: 'CAN - JH - ABD2704' })
    assert.equal(actionsFor(here, { ...hm, me: 'Shylah Walker' }, codeOf).decide,
                 decidesHere(hm, here.location))
    assert.equal(actionsFor(there, { ...hm, me: 'Shylah Walker' }, codeOf).decide,
                 decidesHere(hm, there.location))
  })
})

describe('the house code, which is what the ** row is filed by', () => {
  it('reads the code out of either spelling of a house', () => {
    assert.equal(codeOf('CAN - 48TH (B) - ABD1711'), 'ABD1711')
    assert.equal(codeOf('ABD1711'), 'ABD1711')
    assert.equal(codeOf(''), '')
  })
})

describe('grouping and the day label', () => {
  it('newest day first, because that is what a reader looks for', () => {
    const got = groupByDay([
      row({ id: 'old', at: '2026-09-20T10:00:00Z' }),
      row({ id: 'new', at: '2026-09-22T10:00:00Z' }),
      row({ id: 'new2', at: '2026-09-22T11:00:00Z' }),
    ])
    assert.deepEqual(got.map((g) => g.day), ['2026-09-22', '2026-09-20'])
    assert.deepEqual(got[0].rows.map((r) => r.id), ['new', 'new2'])
  })
  it("today says Today, because a date somebody has to convert is skipped", () => {
    assert.equal(dayLabel('2026-09-22', '2026-09-22'), 'Today')
    assert.match(dayLabel('2026-09-23', '2026-09-22'), /Wed.*Sep 23/)
  })
})
