/**
 * RELEASE USERS, the browser's half: the welcome marks a release clears must
 * stay cleared on a browser that held an unsynced copy, and the screen's
 * sentences come from the words the backend gave. The Apps Script half runs
 * in tools/test-release-users.mjs.
 */
import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FIRST_LOGIN_KEYS, RELEASED_KEY, dirtySinceOf, dropReleasedMarks, nextDirtyStamp } from '@/lib/prefsRelease'
import {
  announceAudience, announceView, blockedSentence, everybodyAlreadyTold, heldSummary, releaseReportView,
  runAnnouncement, type AnnounceResult,
} from '@/pages/features/releaseusers/releaseReport'
import { directoryReadOf } from '@/pages/features/releaseusers/releaseUsersModel'

const RELEASED = '2026-09-24T21:00:00.000Z'
const before = Date.parse(RELEASED) - 60_000
const after = Date.parse(RELEASED) + 60_000

describe('a stale browser stands down to a release', () => {
  beforeEach(() => localStorage.clear())

  it('drops only the released person from a copy older than the release', () => {
    localStorage.setItem('asa-tour-seen', JSON.stringify(['u-other', 'u-rin']))
    localStorage.setItem('asa-playground-intro-seen', JSON.stringify(['u-rin']))
    const touched = dropReleasedMarks({ [RELEASED_KEY]: RELEASED }, 'u-rin', before)
    assert.deepEqual(touched, ['asa-tour-seen', 'asa-playground-intro-seen'])
    assert.deepEqual(JSON.parse(localStorage.getItem('asa-tour-seen') ?? ''), ['u-other'])
    assert.deepEqual(JSON.parse(localStorage.getItem('asa-playground-intro-seen') ?? ''), [])
  })

  it('keeps a mark made after the release — the tour really ran here', () => {
    localStorage.setItem('asa-tour-seen', JSON.stringify(['u-rin']))
    assert.deepEqual(dropReleasedMarks({ [RELEASED_KEY]: RELEASED }, 'u-rin', after), [])
    assert.deepEqual(JSON.parse(localStorage.getItem('asa-tour-seen') ?? ''), ['u-rin'])
  })

  it('a stamp too old to say when it began is treated as older than the release', () => {
    localStorage.setItem('asa-myworld-intro-seen', JSON.stringify(['u-rin']))
    assert.deepEqual(dropReleasedMarks({ [RELEASED_KEY]: RELEASED }, 'u-rin', null), ['asa-myworld-intro-seen'])
  })

  it('without a release stamp nothing changes', () => {
    localStorage.setItem('asa-tour-seen', JSON.stringify(['u-rin']))
    assert.deepEqual(dropReleasedMarks({}, 'u-rin', before), [])
    assert.deepEqual(dropReleasedMarks({ [RELEASED_KEY]: 'not a date' }, 'u-rin', before), [])
    assert.deepEqual(JSON.parse(localStorage.getItem('asa-tour-seen') ?? ''), ['u-rin'])
  })

  it('a value that is not a list is left as it is', () => {
    localStorage.setItem('asa-tour-seen', 'mint')
    assert.deepEqual(dropReleasedMarks({ [RELEASED_KEY]: RELEASED }, 'u-rin', before), [])
    assert.equal(localStorage.getItem('asa-tour-seen'), 'mint')
  })

  it('names the same three marks the backend clears', () => {
    assert.deepEqual(FIRST_LOGIN_KEYS, ['asa-tour-seen', 'asa-playground-intro-seen', 'asa-myworld-intro-seen'])
  })
})

describe('the dirty stamp remembers the OLDEST unsynced change', () => {
  it('keeps the first moment across later changes by the same person', () => {
    const first = nextDirtyStamp(null, 'u-rin', 1000)
    const second = nextDirtyStamp(first, 'u-rin', 5000)
    assert.equal(dirtySinceOf(second), 1000)
    assert.equal((JSON.parse(second) as { at: number }).at, 5000)
  })

  it('starts over for somebody else, or after a malformed stamp', () => {
    const theirs = nextDirtyStamp(null, 'u-other', 1000)
    assert.equal(dirtySinceOf(nextDirtyStamp(theirs, 'u-rin', 5000)), 5000)
    assert.equal(dirtySinceOf(nextDirtyStamp('{broken', 'u-rin', 7000)), 7000)
  })

  it('a stamp written before `since` existed cannot say', () => {
    assert.equal(dirtySinceOf(JSON.stringify({ uid: 'u-rin', at: 1000 })), null)
    assert.equal(dirtySinceOf(null), null)
  })
})

describe('the screen says what the backend said', () => {
  it('addresses the released people and counts the rest, never "people can open this app"', () => {
    const line = announceAudience({
      app_id: 'cal', title: 'Calendar', eligible: 2, matched: 5, not_released: 3, already_told: 1,
      already_sent: 0, sent: 1, held: 0, failed: 0, done: true, resume: 0,
    }, 'Calendar')
    assert.equal(line, '2 released person/people were addressed about Calendar · 1 already told, not written ' +
      'to again · 3 badge holder(s) not yet released were not written to')
    assert.doesNotMatch(line, /can open/)
  })

  it('names each brake by the word the backend gave', () => {
    assert.match(blockedSentence('test_mode_unreadable'), /could not be read, so nothing may be sent/)
    assert.match(blockedSentence('situation_off'), /switched off in Smart Comms/)
    assert.match(blockedSentence('situation_invitation_off'), /auth_invitation.*stops every invitation/)
    assert.match(blockedSentence('password_not_named'), /does not name the password/)
    assert.match(blockedSentence('opted_out'), /asked not to be contacted/)
    assert.equal(blockedSentence('something new'), 'the letter could not reach them')
  })

  it('names each hold of an announcement by the brake that held it — the quiet window is not test mode', () => {
    const quiet = heldSummary({ held: 3, held_by: { quiet_hours: 2, rehearsal: 1 } })
    assert.match(quiet, /2 held by the quiet window — it goes out at 08:00/)
    assert.match(quiet, /1 held by test mode/)
    assert.equal(heldSummary({ held: 2 }), '2 held by a brake before it reached anybody')
    assert.equal(heldSummary({ held: 0, held_by: {} }), '')
  })

  it('names the switch that held the letters when the answer carried it, and the press stays the same', () => {
    const named = announceView(ann({ held: 3, held_by: { rehearsal: 2, send_switch_off: 1 } }))
    assert.ok(named.parts.some((p) => /^2 held by test mode/.test(p) && /1 the sending switch is off/.test(p) &&
      /press Announce again once it is off$/.test(p)), named.parts.join(' | '))
    const bare = announceView(ann({ held: 3 }))
    assert.ok(bare.parts.some((p) => /^3 held by a switch \(test mode, the sending switch or a row that records\)/.test(p)))
  })

  it('totals the switches across the pages of one run', async () => {
    const answers = [
      ann({ held: 2, held_by: { rehearsal: 2 }, done: false, resume: 10 }),
      ann({ held: 1, held_by: { rehearsal: 1 }, done: true }),
    ]
    let i = 0
    const out = await runAnnouncement(async () => answers[i++], { app_id: 'cal', title: 'Calendar', objective: '', again: false })
    assert.equal(out.held, 3)
    assert.deepEqual(out.held_by, { rehearsal: 3 })
  })

  it('a run whose record of who was told did not land is never mint, and says a later press may repeat it', () => {
    const view = announceView(ann({ sent: 4, log_written: false }))
    assert.equal(view.tone, 'amber')
    assert.match(view.title, /4 sent, but who was told could not be recorded/)
    assert.ok(view.parts.some((p) => /app_release_log\) could not be written/.test(p) &&
      /a later press may write to the same people again/.test(p)), view.parts.join(' | '))
    assert.equal(announceView(ann({ sent: 4, log_written: true })).tone, 'mint')
  })

  it('one page whose record did not land marks the whole run', async () => {
    const answers = [
      ann({ sent: 2, log_written: false, done: false, resume: 10 }),
      ann({ sent: 1, log_written: true, done: true }),
    ]
    let i = 0
    const out = await runAnnouncement(async () => answers[i++], { app_id: 'cal', title: 'Calendar', objective: '', again: false })
    assert.equal(out.sent, 3)
    assert.equal(out.log_written, false)
  })

  it('offers the re-send to everybody only when every person addressed was already told', () => {
    const all = ann({ eligible: 4, already_told: 4 })
    assert.equal(everybodyAlreadyTold(all), true)
    assert.match(announceView(all).title, /everybody it addresses was already told/)
    assert.equal(everybodyAlreadyTold(ann({ eligible: 4, already_told: 3, sent: 1 })), false)
    assert.equal(everybodyAlreadyTold(ann({ eligible: 4, already_told: 3, held: 1 })), false)
    assert.equal(everybodyAlreadyTold(ann({ eligible: 4, already_told: 4, done: false })), false)
    assert.equal(everybodyAlreadyTold(ann({ eligible: 0, already_told: 0 })), false)
  })

  it('the header reads the picker\'s directory in its own words — a dash until it answers, the last read after', () => {
    assert.deepEqual(directoryReadOf('reading', 0, ''), { state: 'loading' })
    assert.deepEqual(directoryReadOf('reading', 3, ''), { state: 'cached' })
    assert.deepEqual(directoryReadOf('ready', 0, ''), { state: 'ready' })
    assert.deepEqual(directoryReadOf('failed', 0, 'usersList timed out'), { state: 'failed', why: 'usersList timed out' })
    assert.deepEqual(directoryReadOf('failed', 3, 'usersList timed out'), { state: 'stale', why: 'usersList timed out' })
    assert.deepEqual(directoryReadOf('failed', 0, ''), { state: 'failed', why: 'the directory gave no answer' })
  })

  it('a failed rearm is never mint, and is danger unless every cell was put back', () => {
    const left = releaseReportView({ cleared: [], emailed: true, outcome: 'rearm_failed', restored: false })
    assert.equal(left.tone, 'danger')
    assert.equal(left.headline, 'The invite reached them, but the account could not be rearmed')
    assert.equal(releaseReportView({ cleared: [], emailed: false, outcome: 'rearm_failed' }).tone, 'danger')
    const back = releaseReportView({ cleared: [], emailed: false, outcome: 'rearm_failed', restored: true })
    assert.equal(back.tone, 'amber')
    assert.equal(back.headline, 'The account could not be rearmed')
  })
})

function ann(over: Partial<AnnounceResult>): AnnounceResult {
  return { app_id: 'cal', title: 'Calendar', eligible: 10, sent: 0, held: 0, failed: 0, done: true, resume: 0, ...over }
}
