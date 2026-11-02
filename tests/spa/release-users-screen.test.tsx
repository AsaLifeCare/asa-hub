/**
 * RELEASE USERS, THE SCREEN'S OWN READS AND ITS REPORT CARD.
 *
 *   · a rearm that failed is never drawn as a success because the letter
 *     left, and never says "nothing was changed" when cells were not put back;
 *   · a directory that did not answer is never "0 people" or "answered
 *     nobody" — it says so, with the way to ask again;
 *   · the situation on screen is always the picked person's: a late answer
 *     for somebody else never lands under this row, and an unreadable one
 *     says so instead of asking to pick a person.
 *
 * The reads are mounted by React's client renderer against the door answered
 * at `fetch`; the pieces of the screen are drawn by react-dom/server over what
 * the reads returned.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString } from 'react-dom/server'
import {
  PersonPicker, ReleaseReportCard, SituationPlaceholder, directoryCountLine, rearmFailedLine,
  usePersonSituation, useReleaseDirectory,
} from '@/pages/features/releaseusers/ReleaseUsersPage'
import { mountHook } from './react-host'

/** The words a reader sees, in order. */
function words(html: string): string {
  return html
    .replace(/<!-- -->/g, '')
    .split(/<[^>]+>/)
    .map((t) => t.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim())
    .filter(Boolean)
    .join(' ')
}

const noop = () => {}

describe('the card after a press', () => {
  const rearmFailed = {
    cleared: [], outcome: 'rearm_failed' as const, rearm_error: 'Service Spreadsheets timed out',
    legs: ['email'], why: [],
  }

  it('a rearm that failed after the letter left is not a success, and says the temporary password does not work', () => {
    const html = renderToString(<ReleaseReportCard report={{ ...rearmFailed, emailed: true, restored: false }} />)
    const text = words(html)
    assert.match(text, /The invite reached them, but the account could not be rearmed/)
    assert.match(text, /The invite already reached them, and the temporary password it names does not work until a Release succeeds/)
    assert.match(text, /Some cells could not be put back — check their row before anybody signs in/)
    assert.match(text, /What the write said: Service Spreadsheets timed out/)
    assert.doesNotMatch(text, /nothing was changed/)
    assert.doesNotMatch(text, /on its way/)
    assert.doesNotMatch(html, /bg-tint-mint/, 'never the green of a release that worked')
    assert.match(html, /bg-danger\/10/)
  })

  it('a rearm that failed with every cell put back says their own password still works', () => {
    const html = renderToString(<ReleaseReportCard report={{ ...rearmFailed, emailed: false, restored: true }} />)
    const text = words(html)
    assert.match(text, /^The account could not be rearmed/)
    assert.match(text, /every cell was put back — their own password still works/)
    assert.doesNotMatch(text, /already reached them/)
    assert.doesNotMatch(text, /nothing was changed/)
    assert.doesNotMatch(html, /bg-tint-mint/)
    assert.match(html, /bg-tint-amber/)
  })

  it('a rearm that failed without saying whether the cells went back is unknown, never "put back"', () => {
    assert.match(rearmFailedLine(undefined), /was not told — check their row/)
    const html = renderToString(<ReleaseReportCard report={{ ...rearmFailed, emailed: true }} />)
    assert.match(words(html), /whether every cell was put back was not told/)
    assert.match(html, /bg-danger\/10/)
  })

  it('a refusal still says nothing was changed, and a release that worked lists what it cleared', () => {
    const refused = words(renderToString(<ReleaseReportCard report={{
      cleared: [], emailed: false, outcome: 'refused', blocked_by: 'situation_off',
    }} />))
    assert.match(refused, /Refused — nothing was changed: the invite situation/)
    assert.match(refused, /nothing was changed on the account/)
    const sent = renderToString(<ReleaseReportCard report={{
      cleared: ['last-login record cleared'], emailed: true, outcome: 'sent', sessions_ended: null,
    }} />)
    assert.match(words(sent), /Released — the invite is on its way last-login record cleared/)
    assert.match(words(sent), /Sessions ended: — the sessions tab could not be read/)
    assert.match(sent, /bg-tint-mint/)
  })
})

/* ---------- the door, answered at fetch ---------- */

type Env = { status: number; data?: unknown; message?: string }
type Pending = { id: string; answer: (env: Env) => void }

let directoryDoor: 'up' | 'down' | 'empty' = 'down'
let statusDoor: 'held' | 'down' = 'held'
const pending: Pending[] = []

const ROWS = [
  { id: 'u-ann', email: 'ann@x.org', display_name: 'Ann Roe', role: 'staff', active: true, armed: true },
  { id: 'u-bo', email: 'bo@x.org', display_name: 'Bo Lee', role: 'staff', active: true, armed: false },
]

const situationOf = (id: string) => ({
  user_id: id, email: `${id}@x.org`, display_name: id, role: 'staff', types: [], director: false,
  active: true, armed: true, must_change: false, last_login: '', marks: {}, will_clear: [],
})

const reply = (env: Env) => new Response(JSON.stringify(env), { status: 200, headers: { 'content-type': 'application/json' } })

function answerFor(id: string, env: Env): void {
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i].id === id) {
      pending[i].answer(env)
      pending.splice(i, 1)
    }
  }
}

const realFetch = globalThis.fetch
before(() => {
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const raw = String(init?.body ?? '').replace(/^body=/, '')
    const sent = JSON.parse(decodeURIComponent(raw)) as { action: string; payload?: { user_id?: string } }
    if (sent.action === 'usersList') {
      return reply(directoryDoor === 'down' ? { status: 500, message: 'usersList timed out' }
        : { status: 200, data: directoryDoor === 'empty' ? [] : ROWS })
    }
    if (sent.action === 'releaseUserStatus') {
      const id = String(sent.payload?.user_id ?? '')
      if (statusDoor === 'down') return reply({ status: 500, message: 'Sheet quota exceeded' })
      return new Promise<Response>((resolve) => {
        pending.push({ id, answer: (env) => resolve(reply(env)) })
      })
    }
    return reply({ status: 404, message: `no ${sent.action} here` })
  }) as typeof fetch
})
after(() => { globalThis.fetch = realFetch })

describe('the directory, and whether it answered', () => {
  beforeEach(() => sessionStorage.clear())

  it('a directory that did not answer twice says so, with a retry — never "0 people" or "answered nobody"', async () => {
    directoryDoor = 'down'
    const h = mountHook(() => useReleaseDirectory(true, 0), {})
    await h.settle(() => h.current.state !== 'reading')
    assert.equal(h.current.state, 'failed')
    assert.equal(h.current.why, 'usersList timed out')
    assert.deepEqual(h.current.users, [])
    const text = words(renderToString(
      <PersonPicker directory={h.current} query="" onQuery={noop} selectedId="" onPick={noop} />,
    ))
    assert.match(text, /— the directory could not be read: usersList timed out/)
    assert.match(text, /Try again/)
    assert.match(text, /— people \(the directory did not answer\)/)
    assert.doesNotMatch(text, /answered nobody/)
    assert.doesNotMatch(text, /\b0 people/)

    // asked again, and the door answers this time
    directoryDoor = 'up'
    h.run(() => h.current.retry())
    assert.equal(h.current.state, 'reading')
    await h.settle(() => h.current.state === 'ready')
    assert.equal(h.current.users.length, 2)
    const back = words(renderToString(
      <PersonPicker directory={h.current} query="" onQuery={noop} selectedId="" onPick={noop} />,
    ))
    assert.match(back, /Ann Roe/)
    assert.match(back, /2 people in this place's directory/)
    assert.doesNotMatch(back, /could not be read/)
    h.unmount()
  })

  it('a directory that answered with nobody is the one place "answered nobody" and a 0 are true', async () => {
    directoryDoor = 'empty'
    const h = mountHook(() => useReleaseDirectory(true, 0), {})
    await h.settle(() => h.current.state !== 'reading')
    assert.equal(h.current.state, 'ready')
    const text = words(renderToString(
      <PersonPicker directory={h.current} query="" onQuery={noop} selectedId="" onPick={noop} />,
    ))
    assert.match(text, /The directory answered nobody for this place\./)
    assert.match(text, /0 people in this place's directory/)
    h.unmount()
  })

  it('a list painted from this tab\'s cache is said to be that when the door then fails', async () => {
    sessionStorage.setItem('asa-users-directory-v1', JSON.stringify(ROWS))
    directoryDoor = 'down'
    const h = mountHook(() => useReleaseDirectory(true, 0), {})
    await h.settle(() => h.current.state !== 'reading')
    assert.equal(h.current.state, 'failed')
    const text = words(renderToString(
      <PersonPicker directory={h.current} query="" onQuery={noop} selectedId="" onPick={noop} />,
    ))
    assert.match(text, /The directory did not answer, so this is the last list this tab read: usersList timed out/)
    assert.match(text, /2 people in the last list this tab read — the directory did not answer/)
    h.unmount()
  })

  it('the count line is a dash until the directory has answered', () => {
    assert.equal(directoryCountLine(0, 'reading'), '— people (the directory has not answered yet)')
    assert.equal(directoryCountLine(0, 'failed'), '— people (the directory did not answer)')
    assert.equal(directoryCountLine(3, 'ready'), "3 people in this place's directory")
  })
})

describe('the situation on screen is the picked person\'s', () => {
  const situation = () => ({ status: null, reading: false, failed: '', retry: noop, refresh: async () => {} })
  /** read through a call, so an earlier assertion's narrowing does not stick to the property */
  const idOf = (s: { user_id: string } | null): string | undefined => s?.user_id

  it('nobody picked asks for a person', () => {
    const text = words(renderToString(<SituationPlaceholder selectedId="" situation={situation()} />))
    assert.match(text, /Pick a person on the left/)
  })

  it('a late answer for the person picked before never lands under the one picked now', async () => {
    statusDoor = 'held'
    const h = mountHook((id: string) => usePersonSituation(id), 'u-ann')
    h.rerender('u-bo')
    assert.equal(h.current.status, null)
    assert.equal(h.current.reading, true)

    // Ann's answer arrives while Bo is picked: nothing is drawn for her
    answerFor('u-ann', { status: 200, data: situationOf('u-ann') })
    await h.settle(() => false)
    assert.equal(h.current.status, null, 'Ann\'s answer is not Bo\'s situation')
    assert.equal(h.current.reading, true)

    answerFor('u-bo', { status: 200, data: situationOf('u-bo') })
    await h.settle(() => h.current.status !== null)
    assert.equal(idOf(h.current.status), 'u-bo')

    // and a situation already read is never shown under somebody else's row
    h.rerender('u-ann')
    assert.equal(h.current.status, null)
    assert.equal(h.current.reading, true)
    answerFor('u-ann', { status: 200, data: situationOf('u-ann') })
    await h.settle(() => h.current.status !== null)
    assert.equal(idOf(h.current.status), 'u-ann')
    h.unmount()
    pending.splice(0)
  })

  it('an unreadable situation says so for the person picked, with a retry — never "pick a person"', async () => {
    statusDoor = 'down'
    const h = mountHook((id: string) => usePersonSituation(id), 'u-ann')
    await h.settle(() => Boolean(h.current.failed))
    assert.equal(h.current.failed, 'Sheet quota exceeded')
    assert.equal(h.current.status, null)
    assert.equal(h.current.reading, false)
    const text = words(renderToString(<SituationPlaceholder selectedId="u-ann" situation={h.current} />))
    assert.match(text, /Their situation could not be read — Sheet quota exceeded/)
    assert.match(text, /Try again/)
    assert.doesNotMatch(text, /Pick a person/)

    statusDoor = 'held'
    h.run(() => h.current.retry())
    assert.equal(h.current.failed, '')
    assert.equal(h.current.reading, true)
    assert.match(words(renderToString(<SituationPlaceholder selectedId="u-ann" situation={h.current} />)),
      /Reading their situation…/)
    answerFor('u-ann', { status: 200, data: situationOf('u-ann') })
    await h.settle(() => h.current.status !== null)
    assert.equal(idOf(h.current.status), 'u-ann')
    h.unmount()
    pending.splice(0)
  })
})
