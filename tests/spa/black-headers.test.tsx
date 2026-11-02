/**
 * THE BLACK HEADER on Technology Command Center and on Release Users: each
 * renders, each carries its OWN app's figures, a read that failed shows a dash
 * and its sentence instead of a 0, and Release Users' header lives behind the
 * same master badge that governs the page — and never prints a credential.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import TechnologyHero from '@/pages/features/technology/TechnologyHero'
import {
  technologyFigures, type TechDocsListing, type TechEngRow, type TechProject, type TechRead,
} from '@/pages/features/technology/technologyModel'
import ReleaseUsersHero from '@/pages/features/releaseusers/ReleaseUsersHero'
import {
  releaseBand, releaseFigures, type DirectoryRead, type ReleaseDirectoryRow,
} from '@/pages/features/releaseusers/releaseUsersModel'
import ReleaseUsersPage from '@/pages/features/releaseusers/ReleaseUsersPage'
import {
  announceAudience, announceView, blockedSentence, heldSentence, readReleaseRefusal, releaseReportView,
  runAnnouncement, type AnnouncePagePayload, type AnnounceResult,
} from '@/pages/features/releaseusers/releaseReport'
import { gasAction } from '@/features/hiring/shared'

// the band animates, and framer-motion reaches for the window on mount
for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const flat = (html: string) => html.replace(/<!-- -->/g, '')
/** how many FIGURES print the em dash — the sentences under them may hold one too */
const dashedFigures = (html: string) => (html.match(/>—<\/p>/g) ?? []).length

const READY: TechRead = { state: 'ready' }
const LOADING: TechRead = { state: 'loading' }
const FAILED: TechRead = { state: 'failed', why: 'the slice gave no answer' }

function project(over: Partial<TechProject> = {}): TechProject {
  return { id: 'PRJ_1', name: 'One', status: 'live', file_count: 3, size_bytes: 2048, assessed: 'yes', ...over }
}

const ENG: TechEngRow[] = [
  { id: 'm', kind: 'meta', open_gaps: 4, audit_date: 'Sep 2026', state: 'Steady' },
  { id: 'i1', kind: 'issue', severity: 'P1', title: 'One' },
  { id: 'i2', kind: 'issue', severity: 'P2', title: 'Two' },
]

const LISTING: TechDocsListing = {
  configured: true, folder_name: 'Technology', updated_at: '2026-09-20T10:00:00.000Z',
  files: [{ id: 'f1', name: 'a.pdf', size_bytes: 1024 }, { id: 'f2', name: 'b.md', size_bytes: 1024 }],
}

const techInput = (over: Partial<Parameters<typeof technologyFigures>[0]> = {}) => technologyFigures({
  projects: [project(), project({ id: 'PRJ_2', name: 'Two', status: 'archived', file_count: 0, size_bytes: 0, assessed: '', manual: 'yes' })],
  projectsRead: READY,
  eng: ENG,
  engRead: READY,
  listing: LISTING,
  docsRead: READY,
  ...over,
})

const techHero = (figures: ReturnType<typeof technologyFigures>, failed = false) =>
  flat(renderToString(createElement(TechnologyHero, {
    figures, folderName: 'Technology', failed, refreshing: false, onRetry: () => {},
  })))

describe('Technology Command Center — the black header', () => {
  it('sits on the kit\'s one dark surface and names the app', () => {
    const html = techHero(techInput())
    assert.ok(html.includes('bg-detail-hero'), 'the header paints the platform\'s dark surface')
    assert.ok(html.includes('Technology command center'), 'the eyebrow names this app')
    assert.ok(html.includes('Technology'), 'the folder the listing named rides the eyebrow')
  })

  it('carries this app\'s own four figures, read from its own three reads', () => {
    const f = techInput()
    assert.equal(f.projects.value, 2)
    assert.equal(f.files.value, 3)
    assert.equal(f.gaps.value, 4)
    assert.equal(f.documents.value, 2)
    assert.match(f.projects.sub, /1 assessed · 1 hand-tracked/)
    assert.match(f.gaps.sub, /2 issues listed · audit Sep 2026/)

    const html = techHero(f)
    for (const label of ['Projects tracked', 'Project files', 'Open gaps', 'Documents on file']) {
      assert.ok(html.includes(label), `${label} is drawn`)
    }
  })

  it('a failed read is a dash and a sentence, never a 0', () => {
    const f = techInput({ projects: [], projectsRead: FAILED, eng: [], engRead: FAILED, listing: null, docsRead: FAILED })
    assert.equal(f.projects.value, null)
    assert.equal(f.files.value, null)
    assert.equal(f.gaps.value, null)
    assert.equal(f.documents.value, null)
    assert.match(f.projects.sub, /could not be read/)
    assert.match(f.note, /unknown, not zero/)

    const html = techHero(f, true)
    assert.equal(dashedFigures(html), 4, "all four figures print the dash")
    assert.ok(!/>0</.test(html), 'a read that refused never prints a 0')
    assert.ok(html.includes('Try again'), 'a failed read offers the read again')
  })

  it('a read still in flight is a dash too, and says so', () => {
    const f = techInput({ projects: null, projectsRead: LOADING, eng: null, engRead: LOADING, listing: null, docsRead: LOADING })
    assert.equal(f.projects.value, null)
    assert.match(f.projects.sub, /Reading the portfolio/)
    assert.match(f.documents.sub, /Listing the technology folder/)
    assert.equal(f.band.length, 0, 'nothing read is nothing to draw a band from')
  })

  it('an unconfigured folder is named as such, not counted as zero documents', () => {
    const f = techInput({ listing: { configured: false, reason: 'no folder id is set' }, docsRead: READY })
    assert.equal(f.documents.value, null)
    assert.match(f.documents.sub, /no folder id is set/)
  })

  it('a folder that did not answer is a dash and its reason — never a measured 0', () => {
    // the relay's own shape for a Drive listing that threw: configured, a reason, no files
    const listing: TechDocsListing = { configured: true, reason: 'the folder did not answer (HttpError)', files: [] }
    const f = techInput({ listing, docsRead: READY })
    assert.equal(f.documents.value, null)
    assert.match(f.documents.sub, /the folder did not answer \(HttpError\)/)
    assert.match(f.note, /the document folder could not be read/)
    const html = techHero(f, true)
    assert.ok(!/>0</.test(html), 'the header prints no 0 for a listing that failed')
    assert.equal(dashedFigures(html), 1, 'only the documents figure is a dash')
  })

  it('a listing whose root never answered is a dash, and so are the project files cut from it', () => {
    // the relay's shape when the root folder's own listing threw: a reason and no files
    const listing: TechDocsListing = { configured: true, reason: 'the folder listing failed (HttpError)', files: [] }
    const f = techInput({ listing, docsRead: READY, projects: [project({ file_count: 0, size_bytes: 0 })] })
    assert.equal(f.documents.value, null)
    assert.match(f.documents.sub, /the folder listing failed \(HttpError\)/)
    assert.equal(f.files.value, null, 'a total of 0 files from a walk that failed is not a count')
    assert.match(f.files.sub, /could not be read/)
    const html = techHero(f, true)
    assert.ok(!/>0</.test(html), 'no measured 0 anywhere in the header')
  })

  it('a partial listing is a floor: its count stands, marked as "at least", with the reason', () => {
    const listing: TechDocsListing = { ...LISTING, partial: true, partial_reason: '1 of 3 folder listing(s) failed (HttpError)' }
    const f = techInput({ listing, docsRead: READY })
    assert.equal(f.documents.value, 2)
    assert.equal(f.documents.atLeast, true)
    assert.match(f.documents.sub, /^at least — 1 of 3 folder listing\(s\) failed \(HttpError\)/)
    assert.equal(f.files.atLeast, true, 'the project files come from the same walk')
    assert.match(f.note, /only partly listed .* a floor, not the total/)
    const html = techHero(f)
    assert.ok(html.includes('>2+<'), 'the figure itself says it is a floor')
    const whole = techHero(techInput())
    assert.ok(!whole.includes('+<'), 'a complete listing prints its plain count')
  })

  it('the screen carries the relay\'s partial mark through to the listing', () => {
    const page = read('src/pages/features/technology/TechnologyPage.tsx')
    assert.ok(page.includes('partial: meta?.partial === true'))
    assert.ok(page.includes('partial_reason: meta?.partial_reason'))
    assert.ok(page.includes('Part of the technology folder could not be listed'))
  })

  it('the screen reads a failed listing as failed, and keeps rows from a last read labelled', () => {
    const page = read('src/pages/features/technology/TechnologyPage.tsx')
    assert.ok(page.includes("'the listing carried no folder record'"), 'an answer with no folder record is a failed read')
    assert.ok(page.includes("meta.configured !== false && String(meta.reason ?? '').trim()"),
      'a folder record carrying a reason is a failed read')
    assert.ok(page.includes('these are the rows from the last read'), 'stale rows say what they are')
  })

  it('the status band partitions the portfolio — every project in exactly one slice', () => {
    const f = techInput()
    assert.equal(f.band.reduce((n, b) => n + b.n, 0), 2)
    assert.deepEqual(f.band.map((b) => b.label).sort(), ['Archived', 'Live'])
  })

  it('an empty portfolio that WAS read keeps its zero — that one is a measurement', () => {
    const f = techInput({ projects: [], projectsRead: READY })
    assert.equal(f.projects.value, 0)
    assert.match(f.projects.sub, /Nothing on the portfolio yet/)
  })
})

/* ───────────────────────── Release Users ───────────────────────── */

function person(over: Partial<ReleaseDirectoryRow> = {}): ReleaseDirectoryRow {
  return { id: 'u1', email: 'one@asalifecare.com', display_name: 'One', role: 'staff',
           active: true, armed: true, last_login: '2026-09-01T00:00:00.000Z', ...over }
}

const ROSTER: ReleaseDirectoryRow[] = [
  person(),
  person({ id: 'u2', email: 'two@asalifecare.com', display_name: 'Two', last_login: '' }),
  person({ id: 'u3', email: 'three@asalifecare.com', display_name: 'Three', armed: false, last_login: '' }),
  person({ id: 'u4', email: 'four@asalifecare.com', display_name: 'Four', active: false }),
]

const relFigures = (over: Partial<Parameters<typeof releaseFigures>[0]> = {}) => releaseFigures({
  users: ROSTER, read: { state: 'ready' } as DirectoryRead, announceable: 7, awayFromHome: false, ...over,
})

const relHero = (figures: ReturnType<typeof releaseFigures>, failed = false) =>
  flat(renderToString(createElement(ReleaseUsersHero, {
    figures, loading: false, failed, onRetry: () => {},
  })))

describe('Release Users — the black header', () => {
  it('sits on the same dark surface and names its own door', () => {
    const html = relHero(relFigures())
    assert.ok(html.includes('bg-detail-hero'))
    assert.ok(html.includes('Release users'))
    assert.ok(html.includes('the master&#x27;s door') || html.includes('the master’s door'))
  })

  it('carries the directory\'s own figures, not another app\'s', () => {
    const f = relFigures()
    assert.equal(f.directory.value, 4)
    assert.equal(f.never.value, 1, 'armed, active and never signed in')
    assert.equal(f.unarmed.value, 1, 'active with no password yet')
    assert.equal(f.announceable.value, 7)
    const html = relHero(f)
    for (const label of ['In this directory', 'Never signed in', 'Waiting to be armed', 'Enabled apps']) {
      assert.ok(html.includes(label), `${label} is drawn`)
    }
  })

  it('a failed directory read is a dash and its sentence', () => {
    const f = relFigures({ users: [], read: { state: 'failed', why: 'the door timed out' } })
    assert.equal(f.directory.value, null)
    assert.equal(f.never.value, null)
    assert.equal(f.unarmed.value, null)
    assert.match(f.directory.sub, /the door timed out/)
    assert.match(f.note, /unknown — not zero/)
    const html = relHero(f, true)
    assert.equal(dashedFigures(html), 3, "the three read figures print a dash")
    assert.ok(html.includes('Try again'))
  })

  it('away from headquarters the header says whose directory this is', () => {
    assert.match(relFigures({ awayFromHome: true }).note, /belongs to the place you are standing in/)
  })

  it('a roster painted from the cache says it is the last read, and keeps saying so when the refresh fails', () => {
    const cached = relFigures({ read: { state: 'cached' } })
    assert.equal(cached.directory.value, 4, 'the cached roster still counts')
    assert.match(cached.directory.sub, /as last read — refreshing/)
    const stale = relFigures({ read: { state: 'stale', why: 'the door timed out' } })
    assert.equal(stale.directory.value, 4, 'a failed refresh does not turn the last read into dashes')
    assert.match(stale.unarmed.sub, /as last read — the refresh failed/)
    assert.match(stale.note, /could not be read again \(the door timed out\)/)
    const html = relHero(stale, true)
    assert.equal(dashedFigures(html), 0)
    assert.ok(html.includes('Try again'))
  })

  it('enabled apps are called enabled — the announcement refuses an app with no badges', () => {
    const f = relFigures()
    assert.match(f.announceable.sub, /enabled on this workspace/)
    assert.match(f.announceable.sub, /no badges on the access matrix announces nothing/)
    assert.ok(!relHero(f).includes('Apps to announce'))
  })

  it('the band partitions the roster — one account, one slice', () => {
    const band = releaseBand(ROSTER)
    assert.equal(band.reduce((n, b) => n + b.n, 0), ROSTER.length)
    assert.deepEqual(band.map((b) => [b.key, b.n]), [['live', 1], ['never', 1], ['unarmed', 1], ['inactive', 1]])
  })

  it('never prints a credential — only whether an account has one', () => {
    const html = relHero(relFigures())
    for (const word of ['FIRST_USER_PASSWORD', 'first password', 'first-time password', 'shared password']) {
      assert.ok(!html.includes(word), `the header never says "${word}"`)
    }
    // "No password yet" is a state of the account, and the only shape the word may take here
    for (const m of html.match(/[Pp]assword.{0,4}/g) ?? []) {
      assert.match(m, /^password yet$/i, `"${m}" is more than a state`)
    }
    const src = read('src/pages/features/releaseusers/ReleaseUsersHero.tsx') +
      read('src/pages/features/releaseusers/releaseUsersModel.ts')
    assert.ok(!src.includes('FIRST_USER_PASSWORD'), 'nor does its source reach for the shared one')
  })

  it('respects the badge that governs the page: no master, no header', () => {
    const before = useAuthStore.getState().user
    try {
      useAuthStore.setState({ user: { id: 'u9', email: 'staff@asalifecare.com', display_name: 'Staff',
                                      role: 'staff', isMaster: false } as never })
      const html = flat(renderToString(createElement(MemoryRouter, null, createElement(ReleaseUsersPage))))
      assert.ok(!html.includes('bg-detail-hero'), 'a non-master never sees the band')
      assert.ok(html.includes('Release Users is the master'), 'they meet the empty state instead')
    } finally {
      useAuthStore.setState({ user: before })
    }
  })
})

/* ─────────── the release lane: each answer in its own words ─────────── */

/** The door's envelope, answered at `fetch` — gasAction runs as it ships. */
async function refusalFor(envelope: Record<string, unknown>): Promise<unknown> {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify(envelope), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch
  try {
    await gasAction('releaseUser', { user_id: 'USR_1' })
    return null
  } catch (e) {
    return e
  } finally {
    globalThis.fetch = realFetch
  }
}

describe('Release Users — what a release reports', () => {
  it('a 409 that changed nothing is a refusal asking for a second answer — never a rearm', async () => {
    // the send door refused before the rearm: status 409, `cleared: []`, the brake by name
    const e = await refusalFor({ status: 409, message: 'Nothing reached "Rin": … Nothing was changed.',
      data: { user_id: 'USR_1', cleared: [], emailed: false, held: false, outcome: 'refused',
              test_mode: 'unknown', blocked_by: 'test_mode_unreadable', legs: [], why: ['unreadable'] } })
    const r = readReleaseRefusal(e)
    assert.equal(r.kind, 'blocked')
    if (r.kind !== 'blocked') return
    const view = releaseReportView(r.report)
    assert.match(view.headline, /^Refused — nothing was changed: the test-mode switch could not be read/)
    assert.equal(view.lockedOut, false)
  })

  it('an invite switched off refuses in its own words', async () => {
    const e = await refusalFor({ status: 409, message: 'Nothing reached "Rin"',
      data: { user_id: 'USR_1', cleared: [], emailed: false, held: false, outcome: 'refused',
              blocked_by: 'situation_off', legs: [], why: ['switched off'] } })
    const r = readReleaseRefusal(e)
    assert.ok(r.kind === 'blocked' && /switched off in Smart Comms/.test(releaseReportView(r.report).headline))
  })

  it('a 502 that carries what it cleared (a backend published before every answer was 200) is a rearm', async () => {
    const e = await refusalFor({ status: 502, message: 'The account was rearmed, but nothing could be sent',
      data: { user_id: 'USR_1', cleared: ['password reset to the shared first password, password-change gate armed'],
              emailed: false, held: false, legs: [], why: ['email: the provider would not answer'] } })
    const r = readReleaseRefusal(e)
    assert.equal(r.kind, 'rearmed')
    if (r.kind !== 'rearmed') return
    const view = releaseReportView(r.report)
    assert.equal(view.headline, 'Rearmed, and nothing could be sent')
    assert.equal(view.lockedOut, true)
    assert.equal(view.tone, 'amber')
  })

  it('a 502 that cleared nothing, or any other refusal, is a failure and never "Rearmed"', async () => {
    const empty = readReleaseRefusal(await refusalFor({ status: 502, message: 'down', data: { cleared: [] } }))
    assert.equal(empty.kind, 'failed')
    const bare = readReleaseRefusal(await refusalFor({ status: 500, message: 'The users tab has no "salt" column' }))
    assert.equal(bare.kind, 'failed')
    if (bare.kind === 'failed') assert.match(bare.message, /no "salt" column/)
    const undone = readReleaseRefusal(await refusalFor({ status: 500, message: 'could not be rearmed',
      data: { cleared: [], emailed: true, outcome: 'rearm_failed' } }))
    assert.equal(undone.kind, 'rearm_failed')
    if (undone.kind === 'rearm_failed') {
      // the invite left, so the card says so — a first password that does not work is not a success
      assert.equal(releaseReportView(undone.report).headline,
        'The invite reached them, but the account could not be rearmed')
      assert.notEqual(releaseReportView(undone.report).tone, 'mint')
    }
  })

  it('a rearm nobody was told about is amber and says so — the calm colour is for a pause', () => {
    const view = releaseReportView({ cleared: ['password reset'], emailed: false, held: true,
                                     held_reason: 'rehearsal', released_anyway: true })
    assert.equal(view.tone, 'amber')
    assert.equal(view.lockedOut, true)
    assert.match(view.headline, /held by test mode/)
    const sent = releaseReportView({ cleared: ['password reset'], emailed: true, outcome: 'sent' })
    assert.equal(sent.tone, 'mint')
    assert.equal(sent.lockedOut, false)
  })
})

function announce(over: Partial<AnnounceResult>): AnnounceResult {
  return { app_id: 'cal', title: 'Calendar', eligible: 10, sent: 0, held: 0, failed: 0, done: true, resume: 0, ...over }
}

describe('Release Users — what the announcement reports', () => {
  it('a letter a switch held is its own number, never a refusal, and says the press is made again', () => {
    const v = announceView(announce({ held: 10 }))
    assert.equal(v.tone, 'info')
    // nothing sends those letters by itself: the switch may be test mode, the sending switch or a recording row
    assert.ok(v.parts.some((p) => /^10 held by a switch/.test(p) && /press Announce again once it is off/.test(p)))
    assert.ok(!v.parts.some((p) => /they go when test mode is off/.test(p)), 'no promise that they go by themselves')
    assert.ok(!v.parts.some((p) => /refused/.test(p)))
  })

  it('a morning debt is said whenever the run left one, even with no quiet hold on the last page', () => {
    // page one sent eight, page two landed in the window and was owed to the morning list
    const v = announceView(announce({ sent: 8, held_quiet: 0, quiet_owed: true }))
    assert.equal(v.tone, 'info', 'somebody is still owed')
    assert.notEqual(v.toast, 'success')
    assert.ok(v.parts.some((p) => /the rest is owed to the morning pass after 08:00/.test(p)))
    assert.match(v.title, /8 sent, the rest owed to the morning pass/)
    assert.match(announceAudience(announce({ sent: 8, quiet_owed: true }), 'Calendar'),
      /the rest is owed to the morning pass/)
  })

  it('an opt-out is not a hold, and is never told a switch releases it', () => {
    const v = announceView(announce({ sent: 9, declined: 1 }))
    assert.equal(v.tone, 'mint', 'everybody who can still be told was told')
    assert.ok(v.parts.some((p) => p === '1 asked not to be contacted'))
    assert.ok(!v.parts.some((p) => /test mode/.test(p)))
  })

  it('a quiet hold says the morning, and a night run owed to the morning list says nobody was written to', () => {
    const mid = announceView(announce({ sent: 8, held_quiet: 2, quiet_owed: true }))
    assert.ok(mid.parts.some((p) => /2 held by the quiet window — owed to the morning pass/.test(p)))
    assert.ok(!mid.parts.some((p) => /test mode/.test(p)))
    const night = announceView({ app_id: 'cal', title: 'Calendar', quiet_owed: true, sent: 0, held: 0, failed: 0, done: true, resume: 0 })
    assert.equal(night.title, 'Held by the quiet window — it goes out after 08:00')
    assert.match(announceAudience({ app_id: 'cal', title: 'Calendar', quiet_owed: true, sent: 0, held: 0, failed: 0, done: true, resume: 0 }, 'Calendar'),
      /Nobody was written to about Calendar yet/)
  })

  it('an unread opt-out list is said as unread, never as an opt-out', () => {
    const v = announceView(announce({ sent: 9, unchecked: 1 }))
    assert.ok(v.parts.some((p) => /the opt-out list could not be read/.test(p)))
    assert.equal(v.tone, 'info', 'that person is still owed')
  })

  it('a run that stopped before the end of the roster is a warning, never "Announced"', () => {
    const v = announceView(announce({ sent: 30, done: false }))
    assert.equal(v.toast, 'warning')
    assert.match(v.title, /stopped before the end of the roster/)
    assert.ok(!/^Announced/.test(v.title))
  })

  it('refusals are said, and a situation switched off mid-run stops it', () => {
    const refused = announceView(announce({ sent: 5, failed: 2 }))
    assert.equal(refused.tone, 'amber')
    assert.ok(refused.parts.includes('2 refused by the transport'))
    const stopped = announceView(announce({ sent: 1, stopped: 'the situation `app_release_announced` is switched off' }))
    assert.equal(stopped.tone, 'amber')
    assert.match(stopped.title, /^Stopped — /)
  })

  it('the page runs the one paged run these cases drive', () => {
    const page = read('src/pages/features/releaseusers/ReleaseUsersPage.tsx')
    assert.ok(/runAnnouncement\(\s*\(payload\) => gasAction<AnnounceResult>\('appReleaseAnnounce', payload\)/.test(page))
  })
})

/* ─────────── the letter run, driven page by page ─────────── */

const BASE = { app_id: 'cal', title: 'Calendar', objective: '', again: false }

/** A backend that answers each page in turn, and remembers what it was asked. */
function pages(answers: Array<AnnounceResult | Error>) {
  const asked: AnnouncePagePayload[] = []
  const ask = async (payload: AnnouncePagePayload): Promise<AnnounceResult> => {
    asked.push(payload)
    const next = answers[asked.length - 1]
    if (next === undefined) throw new Error('asked past the last page')
    if (next instanceof Error) throw next
    return next
  }
  return { ask, asked }
}

describe('Release Users — the letter run across pages', () => {
  it('totals every count across pages and hands the earlier pages\' debt and reach to the next', async () => {
    const run = pages([
      announce({ sent: 3, held: 1, failed: 2, already_told: 1, already_sent: 1, held_quiet: 0, unchecked: 1,
                 declined: 1, done: false, resume: 40 }),
      announce({ sent: 4, held: 0, failed: 0, already_told: 2, done: true, resume: 0 }),
    ])
    const out = await runAnnouncement(run.ask, BASE)
    assert.equal(run.asked.length, 2)
    assert.equal(run.asked[1].resume, 40, 'the second page resumes where the first stopped')
    assert.equal(run.asked[1].outstanding, 1 + 0 + 1 + 2, 'held, quiet, unchecked and refused are the debt')
    assert.equal(run.asked[1].told_before, 3 + 1 + 1, 'sent, already told and already sent are the reach')
    assert.equal(out.sent, 7)
    assert.equal(out.failed, 2, 'refusals are totalled, not taken from the last page')
    assert.equal(out.already_told, 3)
    assert.equal(out.unchecked, 1)
    assert.equal(out.declined, 1)
    assert.equal(announceView(out).tone, 'amber', 'a run with refusals is never painted mint')
  })

  it('a page that does not carry the run forward ends it, instead of restarting from the first row', async () => {
    const run = pages([
      announce({ sent: 2, done: false, resume: 10 }),
      announce({ sent: 0, done: false, resume: 10 }),
      announce({ sent: 99, done: true }),
    ])
    await runAnnouncement(run.ask, BASE)
    assert.equal(run.asked.length, 2, 'the mark did not move, so nobody was written to again')
  })

  it('a later page owed to the morning keeps the addressed count and says the rest waits for 08:00', async () => {
    const run = pages([
      announce({ sent: 8, eligible: 12, matched: 14, not_released: 2, done: false, resume: 30 }),
      { app_id: 'cal', title: 'Calendar', quiet_owed: true, sent: 0, held: 0, failed: 0, done: true, resume: 0 },
    ])
    const out = await runAnnouncement(run.ask, BASE)
    assert.equal(out.eligible, 12, 'the page the window owed carries no count, so the earlier one stands')
    assert.equal(out.quiet_owed, true)
    const v = announceView(out)
    assert.equal(v.tone, 'info')
    assert.ok(v.parts.includes('12 addressed'), 'never "— addressed" after letters left')
    assert.ok(v.parts.some((p) => /the rest is owed to the morning pass after 08:00/.test(p)))
  })

  it('a later page that throws ends the run with what the earlier pages did, and its sentence', async () => {
    const run = pages([
      announce({ sent: 5, done: false, resume: 20 }),
      new Error('The Calendar announcement was not sent: the test-mode switch could not be read'),
    ])
    const out = await runAnnouncement(run.ask, BASE)
    assert.equal(out.sent, 5, 'the letters of page one left, and are said')
    assert.equal(out.done, false)
    assert.match(String(out.stopped), /test-mode switch could not be read/)
    const v = announceView(out)
    assert.equal(v.toast, 'warning')
    assert.match(v.title, /stopped before the end of the roster — 5 letter\(s\) sent/)
  })

  it('a first page that throws is the caller\'s to read — "already announced" asks its own question', async () => {
    const run = pages([new Error('The Calendar release was already announced on 2026-09-01.')])
    await assert.rejects(runAnnouncement(run.ask, BASE), /already announced/)
  })
})

describe('Release Users — an opt-out list nobody could read', () => {
  it('is said as a list that could not be read, never as a person who asked to stop', () => {
    const refused = blockedSentence('opt_out_unreadable')
    assert.match(refused, /opt-out list could not be read/)
    assert.ok(!/asked not to be contacted, and no switch/.test(refused))
    const held = heldSentence('opt_out_unreadable')
    assert.match(held, /could not be read/)
    assert.notEqual(held, heldSentence('opted_out'))
  })
})
