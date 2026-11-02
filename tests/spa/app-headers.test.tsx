/**
 * THE TEN APPS THAT GAINED THE PLATFORM'S BLACK HEADER.
 *
 * Three questions, asked of every one of them:
 *
 *   1. does the header draw at all, on the kit's one dark surface;
 *   2. is a figure whose read did not land an em dash with a sentence —
 *      never a 0, which would read as a measurement nobody took;
 *   3. does the app's own read reach its own figures, so the header and the
 *      screen under it cannot disagree.
 *
 * Every header is drawn whole by react-dom/server; the schema-driven three
 * are drawn through the same <AppHero> the hand-written ones mount, over the
 * rows their page declares, so the rule cannot hold in one place and not the
 * other.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import AppHero from '@/components/shared/AppHero'
import { HERO_DASH, heroFigures, heroNote, heroValue, type HeroRead, type PageHeroSpec } from '@/lib/appHero'
import { ohioToday } from '@/lib/ohio'
import { diseasesHero, ispHero, taskBoardHero } from '@/registry/appHeroes'
import { appManifests } from '@/registry/apps'
import { guardianManifests } from '@/registry/apps-guardian'
import DrAppointmentsHero from '@/pages/features/clientops/DrAppointmentsHero'
import UiReportsHero from '@/pages/features/clientops/UiReportsHero'
import RenderSheetHero from '@/pages/features/rendersheet/RenderSheetHero'
import GuardianHero from '@/pages/features/guardian/GuardianHero'
import MailHero from '@/pages/features/mail/MailHero'
import MyAsaHero from '@/pages/features/myasa/MyAsaHero'
import CommsBoardPage from '@/pages/features/comms/CommsBoardPage'

// motion mounts its projection nodes against the window; node's global has no
// event hooks, and a screen drawn whole reaches them
for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const draw = (node: ReactNode): string =>
  renderToString(createElement(MemoryRouter, null, node)).replace(/<!-- -->/g, '')

const LOADING: HeroRead = { state: 'loading' }
const FAILED: HeroRead = { state: 'failed' }
const READY: HeroRead = { state: 'ready' }

/** The figures a header printed, in the stat type the kit reserves for them. */
const stats = (html: string): string[] =>
  [...html.matchAll(/font-stat[^"]*"[^>]*>([^<]*)</g)].map((m) => m[1])

/** Every number the header shows anywhere. */
const digits = (html: string): string[] => [...html.matchAll(/>(\d[\d,]*)</g)].map((m) => m[1])

/* ---------- the rule itself ---------- */

describe('the dash rule — one module, every header', () => {
  it('an unread or failed figure is a dash with a sentence that says which', () => {
    assert.equal(heroValue(LOADING, 12), HERO_DASH)
    assert.equal(heroValue(FAILED, 12), HERO_DASH)
    assert.equal(heroValue(READY, 12), '12')
    assert.equal(heroNote(LOADING, { label: 'x', value: 12, note: 'counted' }), 'not read yet')
    assert.equal(heroNote(FAILED, { label: 'x', value: 12, note: 'counted' }), 'unknown — the read failed')
  })

  it('a measured zero is a zero; an unmeasured one is a dash', () => {
    assert.equal(heroValue(READY, 0), '0')
    assert.equal(heroValue(READY, null), HERO_DASH)
    assert.equal(heroNote(READY, { label: 'x', value: null, note: 'nothing readable' }), 'nothing readable')
  })

  it('the header stands on the kit’s one dark surface and says when a read failed', () => {
    const html = draw(
      <AppHero eyebrow="App · scope" label="App — scope" read={FAILED}
        figures={[{ label: 'Rows', value: 4, note: 'counted' }]}
        reading="Reading…" failed="The rows could not be read, so these figures are unknown — not zero."
        onRetry={() => {}} />,
    )
    assert.match(html, /bg-detail-hero/)
    assert.match(html, /aria-label="App — scope"/)
    assert.match(html, /unknown — not zero/)
    assert.match(html, /Try again/)
    // the figure keeps its place in stat type — as a dash, with no digit in it
    assert.deepEqual(stats(html), [HERO_DASH])
    assert.deepEqual(digits(html), [])
  })

  it('and nothing of the app’s own is printed while the read is in flight', () => {
    const html = draw(
      <AppHero eyebrow="App · scope" label="App — scope" read={LOADING}
        figures={[{ label: 'Rows', value: 9, note: 'counted' }]}
        reading="Reading the rows…" failed="unknown — not zero" />,
    )
    assert.match(html, /aria-busy="true"/)
    assert.match(html, /Reading the rows…/)
    assert.deepEqual(digits(html), [])
    assert.equal(html.includes(HERO_DASH), true)
  })
})

/* ---------- the schema-driven three ---------- */

/** Every spec, drawn the way <PageRenderer> draws it. */
const drawSpec = (spec: PageHeroSpec, rows: Record<string, unknown>[], read: HeroRead): string =>
  draw(
    <AppHero eyebrow={spec.eyebrow} label={spec.label} read={read}
      figures={heroFigures(spec, rows, read)} reading={spec.reading} failed={spec.failed}
      sentence={read.state === 'ready' && spec.sentence ? spec.sentence(rows) : undefined} />,
  )

// c1 and c2 hold two conditions each: four clients, ten cases
const DISEASES = [
  { name: 'Epilepsy', icdCode: 'G40.909', category: 'Neurological', clientsAffected: 6, severity: 'high',
    clientIds: ['c1', 'c2', 'c3'] },
  { name: 'Type 2 diabetes', icdCode: 'E11.9', category: 'Metabolic', clientsAffected: 3, severity: 'moderate',
    clientIds: 'c2, c4' },
  { name: 'Asthma', icdCode: '', category: 'Respiratory', clientsAffected: 1, severity: 'mild', clientIds: ['C1'] },
]

const ISPS = [
  { client_name: 'Ann Roe', isp_year: '2025', allergies: 'Penicillin', supervision_level: 'Line of sight' },
  { client_name: 'Ben Left', isp_year: '2026', allergies: '', supervision_level: '' },
]

const TASKS = [
  { id: 't1', column: 'in-progress', due: '2030-04-01', priority: 'high' },
  { id: 't2', column: 'in-progress', due: '2030-12-01', priority: 'normal' },
  { id: 't3', column: 'backlog', due: '', priority: 'low' },
  { id: 't4', column: 'done', due: '2030-01-01', priority: 'high' },
]

describe('Diseases Registry, ISP Library and Task Board — declared on the page, drawn by the engine', () => {
  it('each page carries its hero spec, so the engine has one to mount', () => {
    const page = (app: string, id: string) =>
      appManifests.find((m) => m.id === app)?.pages.find((p) => p.id === id)
    assert.equal((page('diseases', 'registry')?.config as { hero?: unknown }).hero, diseasesHero)
    assert.equal((page('isp', 'library')?.config as { hero?: unknown }).hero, ispHero)
    assert.equal((page('taskboard', 'board')?.config as { hero?: unknown }).hero, taskBoardHero)
  })

  it('Diseases Registry counts its conditions, its clients once each, and its worst grade', () => {
    const html = drawSpec(diseasesHero, DISEASES, READY)
    assert.match(html, /Diseases registry · what the conditions on file say/)
    // four distinct clients, not the ten the per-condition counts add up to
    assert.deepEqual(stats(html), ['3', '4', '1'])
    assert.match(html, /each client counted once, however many conditions · 10 cases on record/)
    assert.match(html, /Epilepsy/)
    assert.match(html, /3 conditions on file · 2 with an ICD-10 code/)
  })

  it('…a sheet that names no client is a dash, not the sum of the counts', () => {
    const rows = DISEASES.map(({ clientIds: _ids, ...r }) => r)
    const html = drawSpec(diseasesHero, rows, READY)
    assert.equal(stats(html)[1], HERO_DASH)
    assert.match(html, /no condition names its clients · 10 cases on record/)
    // a row that names nobody is said, and kept out of the distinct count
    const mixed = drawSpec(diseasesHero, [DISEASES[0], rows[1]], READY)
    assert.equal(stats(mixed)[1], '3')
    assert.match(mixed, /1 condition names no client and is not in it/)
  })

  it('…and says which conditions carry nothing readable instead of adding a zero', () => {
    const rows = [{ name: 'Epilepsy', category: 'Neurological', clientsAffected: '', severity: '' }]
    const html = drawSpec(diseasesHero, rows, READY)
    // conditions tracked is real; clients, severity and the leader are not
    assert.deepEqual(stats(html), ['1', HERO_DASH, HERO_DASH])
    assert.match(html, /no condition names its clients/)
    assert.match(html, /1 condition carries no severity/)
    assert.equal(html.includes('carry no severity'), false)
    // and the plural keeps the plural verb
    const two = drawSpec(diseasesHero, [...rows, { ...rows[0], name: 'Asthma' }], READY)
    assert.match(two, /2 conditions carry no severity/)
    assert.match(html, /no condition names a client count/)
  })

  it('ISP Library counts plans and clients, and refuses to read a blank allergy field as "none"', () => {
    const html = drawSpec(ispHero, ISPS, READY)
    assert.deepEqual(stats(html), ['2', '2', '1'])
    assert.match(html, /1 plan leaves the field blank — blank is not “none”/)
    assert.match(html, /2026/)
    assert.match(html, /2 service plans on file · 1 states a supervision level/)
    // one plan, one verb: never "1 plan name no client" or "1 plan carry no year"
    const loose = drawSpec(ispHero, [ISPS[0], { ...ISPS[1], client_name: '', isp_year: '' }], READY)
    assert.match(loose, /1 plan names no client/)
    assert.match(loose, /1 plan carries no year/)
  })

  it('Task Board counts what is open, what is late and what is next', () => {
    const html = drawSpec(taskBoardHero, TASKS, READY)
    // open, past their date, due within seven days
    assert.equal(stats(html)[0], '3')
    assert.match(html, /In progress/)
    assert.match(html, /2 open cards waiting there/)
    assert.match(html, /3 open cards · 1 marked high or urgent/)
  })

  it('…late and next are counted on Ohio’s day, and urgent presses as much as high', () => {
    const today = ohioToday()
    const shift = (n: number): string => {
      const [y, m, d] = today.split('-').map(Number)
      const at = new Date(y, m - 1, d + n, 12)
      return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
    }
    const board = [
      { id: 'late', column: 'in-progress', due: shift(-3), priority: 'urgent' },
      { id: 'soon', column: 'review', due: shift(2), priority: 'high' },
      { id: 'today', column: 'review', due: today, priority: 'normal' },
      { id: 'later', column: 'backlog', due: shift(30), priority: 'low' },
      { id: 'undated', column: 'backlog', due: '', priority: 'normal' },
      { id: 'done-late', column: 'done', due: shift(-10), priority: 'urgent' },
    ]
    const html = drawSpec(taskBoardHero, board, READY)
    // open, past their date (a done card is never late), due within seven days (today counts)
    assert.deepEqual(stats(html), ['5', '1', '2'])
    assert.match(html, /1 open card carries no date/)
    assert.match(html, /counted on Ohio’s day/)
    assert.match(html, /5 open cards · 2 marked high or urgent/)
  })

  it('…and a board whose open cards carry no date cannot count what is due', () => {
    const html = drawSpec(taskBoardHero, [{ id: 't1', column: 'backlog', due: '' }], READY)
    assert.equal(stats(html)[1], HERO_DASH)
    assert.equal(stats(html)[2], HERO_DASH)
    assert.equal(html.includes('counted on Ohio’s day'), false)
    assert.equal((html.match(/no open card carries a readable date/g) ?? []).length, 2)
  })

  it('…and a board whose cards name no column is unmeasured, not empty', () => {
    const html = drawSpec(taskBoardHero, [{ id: 't1', column: '', due: '' }], READY)
    assert.equal(stats(html)[0], HERO_DASH)
    assert.match(html, /no card names a column/)
    assert.match(html, /nothing open on the board/)
  })

  it('every one of the three prints dashes, and no digit at all, when its read failed', () => {
    for (const spec of [diseasesHero, ispHero, taskBoardHero]) {
      const html = drawSpec(spec, [], FAILED)
      assert.deepEqual(digits(html), [], spec.label)
      assert.match(html, /unknown — not zero/, spec.label)
      assert.match(html, /unknown — the read failed/, spec.label)
    }
  })
})

/* ---------- the tenth app already had one ---------- */

describe('Comms — the rehearsal board came with the black header', () => {
  it('draws it on the same dark surface, and counts nothing before the board lands', () => {
    const html = draw(<CommsBoardPage />)
    assert.match(html, /bg-detail-hero/)
    assert.match(html, /Threads on the board/)
    // before the read lands the count is withheld, not printed as 0
    assert.match(html, /reading the board…/)
    assert.equal(/Threads on the board<\/p>[\s\S]{0,200}?>0</.test(html), false)
  })
})

/* ---------- the badge the page already carries ---------- */

describe('a header is an opening surface, never a second door', () => {
  it('the hero rides in the PAGE’s config, so no app’s audience moved to make room for it', () => {
    const audience = (id: string) => appManifests.find((m) => m.id === id)?.audience
    assert.deepEqual(audience('diseases'), ['client'])
    assert.deepEqual(audience('isp'), ['staff', 'client'])
    assert.deepEqual(audience('taskboard'), ['all', 'admin', 'manager'])
    // Guardian registers itself rather than sitting in appManifests
    assert.deepEqual(guardianManifests[0].audience, ['admin'])
    // and the specs live under config, where the engine reads them
    for (const [app, page, spec] of [
      ['diseases', 'registry', diseasesHero], ['isp', 'library', ispHero], ['taskboard', 'board', taskBoardHero],
    ] as const) {
      const manifest = appManifests.find((m) => m.id === app)
      assert.equal(manifest?.pages.find((p) => p.id === page)?.config.hero, spec)
      assert.equal((manifest as unknown as Record<string, unknown>).hero, undefined)
    }
  })

  it('Render Sheet’s header repeats the server’s own edit verdict rather than deciding one', () => {
    const base = {
      tabs: 3, linked: 0, registryUnread: false, rows: 10, uncounted: 0,
      openTab: 'hub', openRows: 10, openCols: 3, openRead: 'ready' as const, openTruncated: false, openShown: 10,
      openReadOnly: false,
    }
    assert.match(draw(<RenderSheetHero read={READY} figures={{ ...base, canEdit: true }} />), /Allowed/)
    assert.match(
      draw(<RenderSheetHero read={READY} figures={{ ...base, canEdit: false }} />),
      /your badge opens these sheets to read/,
    )
  })
})

/* ---------- the bespoke seven ---------- */

describe('Dr Appointments — two doors, two verdicts', () => {
  const figures = {
    total: 12, active: 10, clients: 8, dated: 6, overdue: 2,
    next: 'May 2, 2030', nextWhen: 'Ann Roe · in 4 days',
  }

  it('the booked figure is a dash when the visits door did not answer, while the roster still counts', () => {
    const html = draw(
      <DrAppointmentsHero read={READY} figures={figures} visitsRead={FAILED} visits={null} />,
    )
    assert.equal(stats(html)[0], HERO_DASH)
    assert.match(html, /unknown — the visits door did not answer/)
    assert.equal(stats(html)[1], '2')
    assert.match(html, /12 roster rows on file · 2 discontinued/)
  })

  it('a roster where no active row carries a date cannot say nothing is overdue', () => {
    const html = draw(
      <DrAppointmentsHero read={READY} figures={{ ...figures, dated: 0, overdue: 0, next: '', nextWhen: '' }}
        visitsRead={READY} visits={{ soon: 0, undated: 0 }} />,
    )
    assert.equal(stats(html)[0], '0')
    assert.equal(stats(html)[1], HERO_DASH)
    assert.match(html, /no active row carries a readable next visit/)
    assert.match(html, /nothing ahead on the roster/)
  })

  it('a roster that did not answer leaves the booked count its own door returned', () => {
    const html = draw(
      <DrAppointmentsHero read={FAILED} figures={null} visitsRead={READY} visits={{ soon: 2, undated: 0 }}
        onRetry={() => {}} />,
    )
    assert.deepEqual(stats(html), ['2', HERO_DASH, HERO_DASH])
    assert.match(html, /The doctor roster could not be read/)
  })

  it('and a roster that did not answer prints no number at all', () => {
    const html = draw(
      <DrAppointmentsHero read={FAILED} figures={null} visitsRead={FAILED} visits={null} />,
    )
    assert.deepEqual(digits(html), [])
    assert.match(html, /The doctor roster could not be read, so these figures are unknown — not zero/)
  })
})

describe('UI Reports — a window needs dates in it', () => {
  const figures = {
    total: 9, dated: 7, last30: 3, clients: 5,
    topCategory: 'Medication error', topCategoryRows: 4, uncategorised: 1, medication: 4,
  }

  it('counts the reports it read, and names the scope it counted them in', () => {
    const html = draw(<UiReportsHero read={READY} figures={figures} scope="Ann Roe" />)
    assert.match(html, /UI reports · Ann Roe/)
    assert.deepEqual(stats(html), ['9', '3', '4'])
    assert.match(html, /Medication error/)
    assert.match(html, /9 reports on file · 5 clients named/)
  })

  it('no readable date means the thirty-day window is a dash, not a quiet month', () => {
    const html = draw(<UiReportsHero read={READY} figures={{ ...figures, dated: 0, last30: 0 }} />)
    assert.equal(stats(html)[1], HERO_DASH)
    assert.match(html, /no report carries a readable date/)
  })

  it('and a failed read prints dashes with the sentence', () => {
    const html = draw(<UiReportsHero read={FAILED} figures={null} onRetry={() => {}} />)
    assert.deepEqual(digits(html), [])
    assert.match(html, /The unusual incidents could not be read, so these figures are unknown — not zero/)
  })
})

describe('Render Sheet — the list’s own counts, and the badge the server gave', () => {
  const figures = {
    tabs: 6, linked: 2, registryUnread: false, rows: 4210, uncounted: 0,
    openTab: 'hiring', openRows: 812, openCols: 24, openRead: 'ready' as const, openTruncated: false, openShown: 812,
    openReadOnly: false, canEdit: true,
  }

  it('repeats what the sheet list said, including whether this badge may type', () => {
    const html = draw(<RenderSheetHero read={READY} figures={figures} />)
    assert.deepEqual(stats(html), ['6', '4,210', '812'])
    assert.match(html, /Allowed/)
    assert.match(html, /double-click a cell/)
  })

  it('a badge that may not edit is told so, and the engine’s own ledger is named', () => {
    const html = draw(
      <RenderSheetHero read={READY} figures={{ ...figures, canEdit: false, openReadOnly: true }} />,
    )
    assert.match(html, /Read-only/)
    assert.match(html, /your badge opens these sheets to read/)
  })

  it('a list with no row counts leaves the total unmeasured rather than summing zeroes', () => {
    const html = draw(
      <RenderSheetHero read={READY} figures={{ ...figures, rows: null, uncounted: 6 }} />,
    )
    assert.equal(stats(html)[1], HERO_DASH)
    assert.match(html, /no sheet on the list could be opened to count/)
  })

  it('and a list that did not answer prints no number', () => {
    const html = draw(<RenderSheetHero read={FAILED} figures={null} onRetry={() => {}} />)
    assert.deepEqual(digits(html), [])
    assert.match(html, /The sheet list could not be read, so these figures are unknown — not zero/)
  })
})

describe('Guardian — a check that could not run is never green', () => {
  const figures = {
    checks: 9, failing: 1, watching: 3, green: 5, waiting: 2,
    slices: 48, slicesRead: 'ready' as const, stale: 2, errored: 0, build: '2311', buildRead: 'ready' as const,
  }

  it('bands the checks the way the cards below are banded, and names what has not answered', () => {
    const html = draw(<GuardianHero read={READY} figures={figures} />)
    assert.deepEqual(stats(html), ['1', '3', '48', '1', '3', '5'])
    assert.match(html, /2 checks have not answered yet — grey is never green/)
    assert.match(html, /2311/)
    assert.match(html, /1 check failing/)
  })

  it('a snapshot index that did not answer is a dash, not zero slices', () => {
    const html = draw(<GuardianHero read={READY} figures={{ ...figures, slices: null, slicesRead: 'failed' }} />)
    assert.equal(stats(html)[2], HERO_DASH)
    assert.match(html, /the browser’s own snapshot index did not answer/)
  })

  it('…and one still being read says so, never that it failed', () => {
    const html = draw(<GuardianHero read={READY}
      figures={{ ...figures, slices: null, slicesRead: 'pending', build: '', buildRead: 'pending' }} />)
    assert.equal(stats(html)[2], HERO_DASH)
    assert.match(html, /the snapshot index is not read yet/)
    assert.equal(html.includes('did not answer'), false)
    assert.match(html, /the relay is not read yet/)
    assert.equal(html.includes('the relay named no build'), false)
    const down = draw(<GuardianHero read={READY} figures={{ ...figures, build: '', buildRead: 'failed' }} />)
    assert.match(down, /the relay did not answer/)
  })

  it('and before the checks run there is no figure at all', () => {
    const html = draw(<GuardianHero read={LOADING} figures={null} />)
    assert.deepEqual(digits(html), [])
    assert.match(html, /Running the checks…/)
  })
})

describe('Mail — a refused mailbox has no figures, not four zeroes', () => {
  const figures = { threads: 34, unread: 5, mailboxes: 3, address: 'asa-hub@asaop.org', folders: 7 }

  it('counts the read it made, and names the mailbox it read', () => {
    const html = draw(<MailHero read={READY} figures={figures} />)
    assert.deepEqual(stats(html), ['34', '5', '3', '7'])
    assert.match(html, /asa-hub@asaop\.org/)
    assert.match(html, /34 threads read · 5 unread/)
  })

  it('an account the mailserver refuses gets the sentence and no figure — and no promise of delivery', () => {
    const html = draw(<MailHero read={READY} figures={figures} denied />)
    assert.deepEqual(digits(html), [])
    assert.match(html, /this account does not open the platform mailbox/)
    assert.match(html, /Compose still works/)
    // test mode holds hand-written letters, so the screen never swears they go out
    assert.equal(/it is real/.test(html), false)
  })

  it('a Sent that did not answer leaves the thread count unmeasured, the inbox’s figures standing', () => {
    const html = draw(<MailHero read={READY} figures={{ ...figures, sentFailed: true }} />)
    assert.deepEqual(stats(html), [HERO_DASH, '5', '3', '7'])
    assert.match(html, /Sent did not answer — the inbox alone is not the count/)
    assert.match(html, /5 unread in the inbox · Sent did not answer/)
  })

  it('and a mailbox that did not answer says the figures are unknown', () => {
    const html = draw(
      <MailHero read={{ state: 'failed', reason: 'the login was refused' }} figures={null} onRetry={() => {}} />,
    )
    assert.deepEqual(digits(html), [])
    assert.match(html, /The platform mailbox did not answer, so these figures are unknown — not zero/)
    assert.match(html, /the login was refused/)
  })
})

describe('My asa. — the person’s own numbers, and the one read that can fail', () => {
  const figures = { certs: 4, expiring: 1, expired: 0, bookmarks: 6, cards: 5, emails: 2, phones: 1 }

  it('counts the certifications on this name beside what the browser already holds', () => {
    const html = draw(<MyAsaHero figures={figures} certsRead="ready" who="Ann Roe" visiting={false} />)
    assert.deepEqual(stats(html), ['4', '1', '6', '5'])
    assert.match(html, /My asa\. · your corner/)
    assert.match(html, /5 cards on your page · 4 certifications on your name/)
    assert.match(html, /2 addresses · 1 number on the account/)
    assert.doesNotMatch(html, /addresss/)
    const one = draw(<MyAsaHero figures={{ ...figures, emails: 1, phones: 0 }} certsRead="ready" who="Ann Roe" visiting={false} />)
    assert.match(one, /1 address · 0 numbers on the account/)
  })

  it('a certifications read that failed leaves those two figures dashes — never "no certifications"', () => {
    const html = draw(<MyAsaHero figures={figures} certsRead="failed" who="Ann Roe" visiting={false}
      onRetry={() => {}} />)
    const shown = stats(html)
    assert.equal(shown[0], HERO_DASH)
    assert.equal(shown[1], HERO_DASH)
    // the browser's own figures are still real
    assert.equal(shown[2], '6')
    assert.equal(shown[3], '5')
    assert.match(html, /unknown — the certifications could not be read/)
    assert.match(html, /The certifications did not answer/)
    // the header offers the read again, though the page itself is standing
    assert.match(html, /Try again/)
  })

  it('while the certifications are in flight, those two figures are dashes that say so', () => {
    const html = draw(<MyAsaHero figures={{ ...figures, certs: 0, expiring: 0 }} certsRead="loading" who="Ann Roe"
      visiting={false} />)
    const shown = stats(html)
    assert.deepEqual(shown.slice(0, 2), [HERO_DASH, HERO_DASH])
    assert.match(html, /not read yet/)
    assert.equal(html.includes('nothing on your name'), false)
  })

  it('no name to match the sheet against is said, and no retry is offered for it', () => {
    const html = draw(<MyAsaHero figures={figures} certsRead="failed"
      certsReason="there is no name to match the certifications sheet against" who="" visiting={false} />)
    assert.deepEqual(stats(html).slice(0, 2), [HERO_DASH, HERO_DASH])
    assert.match(html, /unknown — there is no name to match the certifications sheet against/)
    assert.equal(html.includes('did not answer'), false)
    assert.equal(html.includes('Try again'), false)
  })

  it('a client’s corner draws no certifications card, so the header counts none', () => {
    const html = draw(<MyAsaHero figures={figures} certsRead="ready" certsShown={false} who="Cy Client"
      visiting={false} />)
    assert.equal(html.includes('Certifications on file'), false)
    assert.equal(html.includes('Needing a date soon'), false)
    assert.deepEqual(stats(html), ['6', '5'])
    assert.match(html, /5 cards on your page/)
    assert.equal(html.includes('on your name'), false)
  })

  it('and somebody else’s corner counts only what was read for that person', () => {
    const html = draw(<MyAsaHero figures={{ ...figures, phones: 0, emails: 1 }} certsRead="ready" who="Mo Lee"
      visiting />)
    assert.match(html, /Mo Lee’s corner/)
    assert.match(html, /nothing here is yours to change/)
    // the visited person's certifications, and nothing of the viewer's browser
    assert.deepEqual(stats(html), ['4', '1'])
    assert.equal(html.includes('Bookmarks kept'), false)
    assert.equal(html.includes('Cards on this page'), false)
    // a visit carries no number list: never "0 numbers on the account"
    assert.equal(/\d+ numbers? on the account/.test(html), false)
    assert.match(html, /not read for a visit/)
  })
})
