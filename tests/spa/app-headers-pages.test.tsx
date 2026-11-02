/**
 * THE BLACK HEADERS, WIRED: the screens under them tell the same truth.
 *
 * app-headers.test.tsx hands figures straight to each header. That cannot see
 * the fault that matters most — a page whose own read failed, handing the
 * header (or the card beside it) an empty array that prints as "0" or as
 * "nothing on file". So here every read is answered at `fetch` with the
 * door's own envelope — refused, partial, or never landing — the page's own
 * hook runs under real React (react-host), and the screen is drawn whole by
 * react-dom/server from what that hook holds. The question is always the same:
 * does any unread value reach the screen as a zero or as an empty record?
 */
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { invalidateAll } from '@/lib/apiCache'
import { HERO_DASH } from '@/lib/appHero'
import { useAuthStore } from '@/auth/useAuthStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { useContextStore } from '@/stores/useContextStore'
import { DrAppointmentsScreen, useDrAppointmentsReads } from '@/pages/features/clientops/DrAppointmentsPage'
import MyCertsCard, { CERTS_NO_NAME, useMyCerts } from '@/pages/features/myasa/MyCertsCard'
import MyAsaPage from '@/pages/features/myasa/MyAsaPage'
import { loadLayout } from '@/pages/features/myasa/layout'
import MailHero from '@/pages/features/mail/MailHero'
import { mailboxHeroFigures, mailboxHeroRead, usePlatformMailbox } from '@/pages/features/mail/usePlatformMailbox'
import RenderSheetHero, {
  openSheetFigures, renderSheetFigures, tabRowsLabel, type GridInfo, type TabInfo,
} from '@/pages/features/rendersheet/RenderSheetHero'
import GuardianPage, {
  guardianOverall, readSnapshotIndex, snapshotCheckState, type CheckState,
} from '@/pages/features/guardian/GuardianPage'
import BoardTemplate from '@/engine/templates/BoardTemplate'
import DocumentsTemplate from '@/engine/templates/documents'
import type { TemplateProps, TemplateRows } from '@/engine/PageRenderer'
import type { PageSchema } from '@/engine/types'
import { mountHook } from './react-host'

/* ---------- drawing ------------------------------------------------------- */

/** motion reaches for the window's event hooks while a screen is drawn whole */
function draw(node: ReactNode): string {
  const g = globalThis as unknown as Record<string, unknown>
  const held = { add: g.addEventListener, remove: g.removeEventListener }
  g.addEventListener = held.add ?? (() => {})
  g.removeEventListener = held.remove ?? (() => {})
  try {
    return renderToString(createElement(MemoryRouter, null, node)).replace(/<!-- -->/g, '')
  } finally {
    g.addEventListener = held.add
    g.removeEventListener = held.remove
  }
}

/** The figures a header printed, in the stat type the kit reserves for them. */
const stats = (html: string): string[] =>
  [...html.matchAll(/font-stat[^"]*"[^>]*>([^<]*)</g)].map((m) => m[1])

/** One header figure by its label: what it printed, and the line under it. */
function figure(html: string, label: string): { value: string; note: string } | null {
  const at = html.indexOf(`>${label}</span>`)
  if (at === -1) return null
  const before = html.slice(0, at)
  const value = [...before.matchAll(/>([^<>]*)<\/span>/g)].pop()?.[1] ?? ''
  const note = /^[^<]*<\/span><span[^>]*>([^<]*)</.exec(html.slice(at + label.length + 1))?.[1] ?? ''
  return { value, note }
}

/* ---------- the doors, answered at fetch ---------------------------------- */

type Sent = { resource?: string; action?: string; payload?: Record<string, unknown> }
type Answer = (sent: Sent) => unknown | Promise<unknown>
let answer: Answer = () => ({ status: 404, message: 'nothing here' })
const realFetch = globalThis.fetch
before(() => {
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    // the snapshot index is not there: every read goes to the live door
    if (init?.method !== 'POST') return new Response('', { status: 404 })
    const sent = JSON.parse(decodeURIComponent(String(init.body).slice('body='.length))) as Sent
    const envelope = await answer(sent)
    return new Response(JSON.stringify(envelope), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
})
after(() => {
  globalThis.fetch = realFetch
})
beforeEach(() => invalidateAll())
afterEach(() => {
  answer = () => ({ status: 404, message: 'nothing here' })
  invalidateAll()
})

const ok = (data: unknown) => ({ status: 200, data })
const down = (message: string) => ({ status: 500, message })
/** a door that never answers — the read stays in flight for the whole test */
const never = () => new Promise<never>(() => {})

/** Ohio's today plus n days, as the sheets write a day. */
function ohioDayPlus(n: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const [y, m, d] = today.split('-').map(Number)
  const at = new Date(y, m - 1, d + n, 12)
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

/* ---------- Dr Appointments ----------------------------------------------- */

const ROSTER = [
  { id: 'r1', client: 'Ann Roe', dr_name: 'Dr Pell', active_or_discontinued: 'Active', next_visit: ohioDayPlus(-5) },
  { id: 'r2', client: 'Ben Left', dr_name: 'Dr Moss', active_or_discontinued: 'Active', next_visit: ohioDayPlus(9) },
]
const VISITS = [
  { id: 'v1', client_name: 'Ann Roe', dr_name: 'Dr Pell', appointment_date: ohioDayPlus(3) },
]

describe('Dr Appointments — an unread visits door is never an empty book', () => {
  async function reads(visits: Answer, roster: Answer = () => ok(ROSTER)) {
    answer = (sent) => (sent.resource === 'drVisits' ? visits(sent) : sent.resource === 'drAppointments' ? roster(sent) : down('?'))
    const h = mountHook(() => useDrAppointmentsReads(), {})
    return h
  }

  it('a failed visits read stays null beside its failure — never an empty array', async () => {
    const h = await reads(() => down('The visits sheet did not answer'))
    await h.settle(() => h.current.rows !== null && h.current.visitsFailed)
    const r = h.current
    h.unmount()
    assert.equal(r.visitsFailed, true)
    assert.equal(r.visits, null)

    const html = draw(<DrAppointmentsScreen reads={r} />)
    // the header's booked figure is a dash, and says which door
    assert.equal(stats(html)[0], HERO_DASH)
    assert.match(html, /unknown — the visits door did not answer/)
    // the section under it carries no count, and no "empty book"
    assert.match(html, /Booked appointments · —/)
    assert.equal(/Booked appointments · \d/.test(html), false)
    assert.match(html, /The booked visits could not be read/)
    assert.equal(html.includes('Nothing on the books'), false)
    // and the ops strip that summed it as 0 is gone
    assert.equal(html.includes('Booked next 14 days'), false)
    assert.equal(html.includes('Overdue (active)'), false)
  })

  it('a visits read still in flight prints no count either', async () => {
    const h = await reads(never)
    await h.settle(() => h.current.rows !== null)
    const r = h.current
    h.unmount()
    assert.equal(r.visits, null)
    assert.equal(r.visitsFailed, false)
    const html = draw(<DrAppointmentsScreen reads={r} />)
    assert.equal(stats(html)[0], HERO_DASH)
    assert.match(html, /Booked appointments · —/)
    assert.equal(html.includes('Nothing on the books'), false)
  })

  it('a roster that failed leaves the booked count its own door returned', async () => {
    const h = await reads(() => ok(VISITS), () => down('The roster sheet did not answer'))
    await h.settle(() => h.current.error !== null && h.current.visits !== null)
    const r = h.current
    h.unmount()
    const html = draw(<DrAppointmentsScreen reads={r} />)
    assert.deepEqual(stats(html), ['1', HERO_DASH, HERO_DASH])
    assert.match(html, /The doctor roster could not be read/)
  })

  it('a client focus narrows the header the way it narrows the list, and is named', async () => {
    const benLater = { id: 'v2', client_name: 'Ben Left', dr_name: 'Dr Moss', appointment_date: ohioDayPlus(20) }
    const h = await reads(() => ok([...VISITS, benLater]))
    await h.settle(() => h.current.rows !== null && h.current.visits !== null)
    const r = h.current
    h.unmount()
    const ben = { type: 'client' as const, id: 'Ben Left', name: 'Ben Left' }
    useContextStore.setState({ focus: ben })
    // renderToString reads a zustand store's INITIAL state (its server snapshot); the page must see the live one
    Object.assign(useContextStore.getInitialState(), { focus: ben })
    try {
      const html = draw(<DrAppointmentsScreen reads={r} />)
      assert.match(html, /Dr appointments · focused on Ben Left/)
      // the header's three counts: the focused roster row is not overdue, and the booked visit inside two weeks belongs to the other client
      assert.deepEqual(stats(html).slice(0, 3), ['0', '0', '1'])
      assert.match(html, /1 roster row on file · 0 discontinued/)
    } finally {
      useContextStore.setState({ focus: null })
      Object.assign(useContextStore.getInitialState(), { focus: null })
    }
  })

  it('a visits door that answered empty is a measured zero, and says so', async () => {
    const h = await reads(() => ok([]))
    await h.settle(() => h.current.rows !== null && h.current.visits !== null)
    const r = h.current
    h.unmount()
    const html = draw(<DrAppointmentsScreen reads={r} />)
    assert.equal(stats(html)[0], '0')
    assert.match(html, /Booked appointments · 0/)
    assert.match(html, /Nothing on the books/)
    // one overdue roster row, counted in the header only
    assert.equal(stats(html)[1], '1')
  })
})

/* ---------- My asa. — the certifications ---------------------------------- */

const CERTS = [
  { id: 'c1', personName: 'Ann Roe', certName: 'CPR', status: 'valid', expiresAt: '2031-01-01' },
  { id: 'c2', personName: 'Mo Lee', certName: 'First Aid', status: 'expired', expiresAt: '2024-01-01' },
]
/** the card asks the tracker's own door (Certs.gs certTrackerList), never the generic list */
const tracker = (sent: Sent) => sent.action === 'certTrackerList' && sent.payload?.view === 'certs'
const trackerRows = (rows: unknown[]) => ok({ rows, scope: 'all', self: '' })

describe('My asa. — the certifications card follows its read', () => {
  const who = (id: string, name: string) => ({ id, name })
  const mount = (p: { id: string; name: string }) =>
    mountHook(({ id, name }: { id: string; name: string }) => useMyCerts(id, name), p)

  it('a failed read is said on the card and offered again — never "no certifications on file"', async () => {
    answer = (sent) => (tracker(sent) ? down('The certifications sheet did not answer') : down('?'))
    const h = mount(who('u1', 'Ann Roe'))
    await h.settle(() => h.current.read !== 'loading')
    const { certs, read } = h.current
    h.unmount()
    assert.equal(read, 'failed')
    assert.deepEqual(certs, [])
    const html = draw(<MyCertsCard certs={certs} read={read} onRetry={() => {}} />)
    assert.match(html, /The certifications could not be read — this is not an empty record/)
    assert.match(html, /Try again/)
    assert.equal(html.includes('No certifications on file'), false)
  })

  it('a read in flight claims nothing', () => {
    answer = never
    const h = mount(who('u1', 'Ann Roe'))
    const { certs, read } = h.current
    h.unmount()
    assert.equal(read, 'loading')
    const html = draw(<MyCertsCard certs={certs} read={read} onRetry={() => {}} />)
    assert.match(html, /Reading the certifications…/)
    assert.equal(html.includes('No certifications on file'), false)
    assert.equal(html.includes('on file</'), false)
  })

  it('a read that landed and found nothing is the one place "no certifications" is said', async () => {
    answer = (sent) => (tracker(sent) ? trackerRows(CERTS) : down('?'))
    const h = mount(who('u9', 'Cy Nobody'))
    await h.settle(() => h.current.read !== 'loading')
    const { certs, read } = h.current
    h.unmount()
    assert.equal(read, 'ready')
    const html = draw(<MyCertsCard certs={certs} read={read} onRetry={() => {}} />)
    assert.match(html, /No certifications on file under your name yet/)
  })

  it('no name to match the sheet against settles as a failure that says so — never "reading" for ever', async () => {
    let asked = 0
    answer = (sent) => {
      if (tracker(sent)) asked++
      return ok(CERTS)
    }
    const h = mount(who('u1', ''))
    await h.settle(() => false)
    const { certs, read, reason } = h.current
    h.unmount()
    assert.equal(read, 'failed')
    assert.equal(reason, CERTS_NO_NAME)
    assert.deepEqual(certs, [])
    // nothing to match against, so nothing was asked
    assert.equal(asked, 0)
    const html = draw(<MyCertsCard certs={certs} read={read} reason={reason} onRetry={() => {}} />)
    assert.match(html, /could not be read — there is no name to match the certifications sheet against/)
    assert.equal(html.includes('Reading the certifications'), false)
    assert.equal(html.includes('No certifications on file'), false)
    // asking again cannot supply a name, so no door is offered
    assert.equal(html.includes('Try again'), false)
  })

  it('a new identity is "reading" at once, and a failed read for it never shows the last person’s', async () => {
    answer = (sent) => (tracker(sent) ? trackerRows(CERTS) : down('?'))
    const h = mount(who('u1', 'Ann Roe'))
    await h.settle(() => h.current.read === 'ready')
    assert.deepEqual(h.current.certs.map((c) => c.certName), ['CPR'])

    // the visit opens and the sheet stops answering
    invalidateAll()
    answer = (sent) => (tracker(sent) ? down('The certifications sheet did not answer') : down('?'))
    h.rerender(who('m2', 'Mo Lee'))
    // before anything lands: nothing of Ann's under Mo's name
    assert.equal(h.current.read, 'loading')
    assert.deepEqual(h.current.certs, [])
    await h.settle(() => h.current.read !== 'loading')
    const { certs, read } = h.current
    h.unmount()
    assert.equal(read, 'failed')
    assert.deepEqual(certs, [])
  })

  it('an own answer is shown whole — the rows are keyed by the roster name, not the name the account shows', async () => {
    // "Annie" is linked to the roster row "Ann Able"; the server answers her rows and no one else's
    const own = [
      { id: 'a1', personName: 'Ann Able', certName: 'CPR', status: 'valid', expiresAt: '2031-01-01' },
      { id: 'a2', personName: 'Ann Able', certName: 'DODD 8-Hour', status: 'expiring', expiresAt: '2026-11-01' },
    ]
    answer = (sent) => (tracker(sent) ? ok({ rows: own, scope: 'own', self: 'Ann Able' }) : down('?'))
    const h = mount(who('u1', 'Annie'))
    await h.settle(() => h.current.read !== 'loading')
    const { certs, read } = h.current
    h.unmount()
    assert.equal(read, 'ready')
    assert.deepEqual(certs.map((c) => c.certName), ['CPR', 'DODD 8-Hour'])
    const html = draw(<MyCertsCard certs={certs} read={read} onRetry={() => {}} />)
    assert.equal(html.includes('No certifications on file'), false)
    assert.match(html, /2 on file/)
  })

  it('the master’s whole tracker is still matched by the name shown', async () => {
    answer = (sent) => (tracker(sent) ? ok({ rows: CERTS, scope: 'all', self: '' }) : down('?'))
    const h = mount(who('u1', 'Mo Lee'))
    await h.settle(() => h.current.read !== 'loading')
    const { certs } = h.current
    h.unmount()
    assert.deepEqual(certs.map((c) => c.certName), ['First Aid'])
  })

  it('a refusal about this account says why, and is never "no certifications on file"', async () => {
    answer = (sent) => (tracker(sent)
      ? { status: 403, scope: 'own', message: 'Your account is not linked to a roster row and your name is not on the staff roster.' }
      : down('?'))
    const h = mount(who('u1', 'Zed Gone'))
    await h.settle(() => h.current.read !== 'loading')
    const { certs, read, reason } = h.current
    h.unmount()
    assert.equal(read, 'failed')
    assert.equal(reason, 'Your account is not linked to a roster row and your name is not on the staff roster')
    const html = draw(<MyCertsCard certs={certs} read={read} reason={reason} onRetry={() => {}} />)
    assert.match(html, /could not be read — Your account is not linked to a roster row/)
    assert.equal(html.includes('No certifications on file'), false)
  })
})

describe('My asa. — visiting somebody draws only what was read for them', () => {
  const heldAuth = useAuthStore.getState().user
  after(() => {
    useAuthStore.setState({ user: heldAuth } as never)
    useMemberStore.setState({ currentMemberId: '', memberName: '', memberRole: '', memberTypes: [] } as never)
    Object.assign(useAuthStore.getInitialState(), { user: heldAuth })
    Object.assign(useMemberStore.getInitialState(), { currentMemberId: '', memberName: '' })
  })

  it('the header counts no bookmarks, cards or numbers of the viewer’s under the visited name', () => {
    useAuthStore.setState({
      user: { id: 'u1', name: 'Ann Roe', email: 'ann@x', types: [], role: 'manager', phones: [{ number: '+15550100', label: 'mobile' }] },
    } as never)
    useMemberStore.setState({ currentMemberId: 'm2', memberName: 'Mo Lee', memberRole: 'staff', memberTypes: [] } as never)
    // renderToString reads a zustand store's INITIAL state (its server snapshot); the page must see the live one
    Object.assign(useAuthStore.getInitialState(), { user: useAuthStore.getState().user })
    Object.assign(useMemberStore.getInitialState(), {
      currentMemberId: 'm2', memberName: 'Mo Lee', memberRole: 'staff', memberTypes: [],
    })
    const html = draw(<MyAsaPage />)
    assert.match(html, /Mo Lee’s corner/)
    assert.equal(html.includes('Bookmarks kept'), false)
    assert.equal(html.includes('Cards on this page'), false)
    assert.equal(/\d+ numbers? on the account/.test(html), false)
    // the profile card does not invite the viewer to add a phone to somebody else
    assert.equal(html.includes('Add your phone'), false)
    assert.match(html, /not read for a visit/)
    // nothing has been read yet: the card reads, the figures are dashes
    assert.equal(html.includes('No certifications on file'), false)
    assert.deepEqual(stats(html).slice(0, 2), [HERO_DASH, HERO_DASH])
  })

  it('a client’s own corner counts the cards the grid draws, and no certifications it never shows', () => {
    const client = { id: 'uC', name: 'Cy Client', email: 'cy@x', types: [], role: 'client', phones: [] }
    useAuthStore.setState({ user: client } as never)
    useMemberStore.setState({ currentMemberId: '', memberName: '', memberRole: '', memberTypes: [] } as never)
    Object.assign(useAuthStore.getInitialState(), { user: client })
    Object.assign(useMemberStore.getInitialState(), { currentMemberId: '', memberName: '' })
    const stored = loadLayout('uC').cards
    const drawn = stored.filter((c) => c.kind === 'indicator' || !['master', 'certifications'].includes(c.id))
    // the default page carries the certifications card; a client's grid leaves it out
    assert.ok(drawn.length < stored.length)

    const html = draw(<MyAsaPage />)
    assert.equal(html.includes('My certifications'), false)
    assert.equal(html.includes('Certifications on file'), false)
    assert.equal(html.includes('Needing a date soon'), false)
    assert.equal(figure(html, 'Cards on this page')?.value, String(drawn.length))
    assert.match(html, new RegExp(`${drawn.length} cards on your page`))
    assert.equal(/certifications? on your name/.test(html), false)
  })
})

/* ---------- Mail — inbox and Sent, each with its own verdict --------------- */

const SENT_ROW = { id: 's1', from_name: 'Hub', from_addr: 'hub@x', to: 'ann@x', subject: 'Hi', date: '2030-01-01', snippet: 'hi', unread: false }
const INBOX_ROW = { ...SENT_ROW, id: 'i1', unread: true }

describe('Mail — an inbox nobody read is never "0 unread"', () => {
  const mount = (nonce = 0) =>
    mountHook(({ n }: { n: number }) => usePlatformMailbox(true, '1', n), { n: nonce })
  const isSent = (sent: Sent) => sent.action === 'platformMailInbox' && sent.payload?.box === 'sent'

  it('the inbox failing while Sent answers fails the header — its figures are unknown, never "0 unread"', async () => {
    answer = (sent) => isSent(sent)
      ? ok({ address: 'hub@x', threads: [SENT_ROW] })
      : down('The mailserver refused the login.')
    const h = mount()
    await h.settle(() => !h.current.loading)
    const m = h.current
    h.unmount()
    assert.equal(m.error, '')
    assert.match(m.inboxFailed, /refused the login/)
    assert.deepEqual(m.items.map((t) => t.box), ['sent'])
    // no address is claimed for a mailbox whose inbox did not answer
    assert.equal(m.address, '')

    const html = draw(<MailHero read={mailboxHeroRead(m)} figures={mailboxHeroFigures(m)} />)
    assert.deepEqual(stats(html), [HERO_DASH, HERO_DASH, HERO_DASH, HERO_DASH])
    assert.match(html, /The inbox did not answer \(The mailserver refused the login\); only Sent was read/)
    assert.equal(/Unread in the inbox[\s\S]{0,40}>0</.test(html), false)
  })

  it('a retry that answers clears the failure it was pressed for', async () => {
    answer = () => down('The mailserver did not answer.')
    const h = mount(0)
    await h.settle(() => !h.current.loading)
    assert.match(h.current.error, /did not answer/)
    assert.equal(mailboxHeroRead(h.current).state, 'failed')

    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    answer = async (sent) => {
      await gate
      return isSent(sent) ? ok({ address: 'hub@x', threads: [SENT_ROW] }) : ok({ address: 'hub@x', threads: [INBOX_ROW] })
    }
    h.rerender({ n: 1 })
    // the read is under way: no stale failure over it
    assert.equal(h.current.error, '')
    assert.equal(mailboxHeroRead(h.current).state, 'loading')
    release()
    await h.settle(() => !h.current.loading)
    const m = h.current
    h.unmount()
    assert.equal(m.error, '')
    assert.equal(mailboxHeroRead(m).state, 'ready')
    const html = draw(<MailHero read={mailboxHeroRead(m)} figures={mailboxHeroFigures(m)} />)
    assert.deepEqual(stats(html), ['2', '1', '1', HERO_DASH])
  })

  it('both folders failing shows no mail at all — not the last mailbox’s threads', async () => {
    answer = (sent) => isSent(sent) ? ok({ address: 'hub@x', threads: [SENT_ROW] }) : ok({ address: 'hub@x', threads: [INBOX_ROW] })
    const h = mount(0)
    await h.settle(() => !h.current.loading)
    assert.equal(h.current.items.length, 2)
    invalidateAll()
    answer = () => down('The mailserver did not answer.')
    h.rerender({ n: 1 })
    await h.settle(() => !h.current.loading)
    const m = h.current
    h.unmount()
    assert.match(m.error, /did not answer/)
    assert.deepEqual(m.items, [])
  })
})

/* ---------- the schema-driven headers count what the page holds ------------ */

describe('the engine’s header counts the rows the template is drawing', () => {
  // The templates mount dnd-kit and a real table; this harness draws no DOM,
  // so the wiring is held by its source: the header must be fed the rows the
  // template reports, and each row-keeping template must report them.
  const src = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')

  it('PageRenderer counts the reported rows of THIS read, and hands the template the reporter', () => {
    const page = src('src/engine/PageRenderer.tsx')
    assert.match(page, /heroFigures\(heroSpec, heroRows, heroRead\)/)
    assert.match(page, /heroSpec\.sentence\(heroRows\)/)
    assert.match(page, /shown\.from === data \? shown\.report\.rows : data/)
    assert.match(page, /<Template [^>]*onRows=\{heroSpec \? onRows : undefined\}/)
  })

  it('the board reports its own cards — after a drag, an add or a delete', () => {
    assert.match(src('src/engine/templates/BoardTemplate.tsx'), /onRows\?\.\(\{ rows: records as unknown/)
  })

  it('the board never reports the last read’s cards under the next read', () => {
    const schema = { id: 'board', type: 'board', title: 'Task Board', dataSource: { resource: 'tasks' }, config: {} } as PageSchema
    const config = { stageField: 'column', stages: [{ id: 'backlog', label: 'Backlog', tint: 'lavender' }] }
    // PageRenderer hands a new reporter with every read, and tags what it hears with that read
    const heard: { from: unknown[]; ids: string[] }[] = []
    const props = (data: Record<string, unknown>[]): TemplateProps => ({
      config, data, schema, onRows: (r) => heard.push({ from: data, ids: r.rows.map((x) => String(x.id)) }),
    })
    const first = [{ id: 'a', column: 'backlog' }]
    const second = [{ id: 'b', column: 'backlog' }, { id: 'c', column: 'backlog' }]
    const h = mountHook((p: TemplateProps) => BoardTemplate(p), props(first))
    h.rerender(props(second))
    h.unmount()
    assert.ok(heard.some((r) => r.from === second), 'the next read was reported')
    for (const r of heard) {
      assert.deepEqual(r.ids, (r.from as { id: string }[]).map((x) => x.id), 'a report counts only the read it is tagged with')
    }
  })

  it('the documents library reports the records behind its documents, and names a focus', () => {
    const schema = { id: 'library', type: 'documents', title: 'ISP Library', dataSource: { resource: 'isps' }, config: {} } as PageSchema
    const config = {
      docMap: { title: 'client_name', sections: [{ heading: 'Allergies', field: 'allergies', keepEmpty: true }] },
      scopeBy: 'title',
    }
    const records = [
      { id: 'p1', client_name: 'Ann Roe', allergies: 'Penicillin', isp_year: '2025' },
      { id: 'p2', client_name: 'Ben Left', allergies: '', isp_year: '2026' },
    ]
    const heard: TemplateRows[] = []
    const h = mountHook((p: TemplateProps) => DocumentsTemplate(p), {
      config, data: records, schema, onRows: (r: TemplateRows) => heard.push(r),
    })
    const all = heard[heard.length - 1]
    // the records themselves — the fields the ISP header reads — not the documents drawn from them
    assert.deepEqual(all.rows, records)
    assert.equal(all.scope, undefined)

    const ben = { type: 'client' as const, id: 'Ben Left', name: 'Ben Left' }
    try {
      h.run(() => useContextStore.setState({ focus: ben }))
      const focused = heard[heard.length - 1]
      assert.deepEqual(focused.rows, [records[1]])
      assert.equal(focused.scope, 'Ben Left')
    } finally {
      h.run(() => useContextStore.setState({ focus: null }))
      h.unmount()
    }
  })

  it('the documents library reports after its own edits, adds and deletes', () => {
    const lib = src('src/engine/templates/documents/index.tsx')
    assert.match(lib, /onRows\?\.\(\{ rows: heldRows, scope: focusName \|\| undefined \}\)/)
    // the records carry the saved edit, and the list is the library's after deletes and drafts
    assert.match(lib, /recordOf\.set\(doc\.id, recordPatches\[String\(r\.id\)\] \?\? r\)/)
    assert.match(lib, /return scopedDocs\.map\(\(d\) => recordOf\.get\(d\.id\)/)
  })

  it('the sheet reports its rows after edits and focus, before the reader’s search', () => {
    const sheet = src('src/engine/templates/sheet/index.tsx')
    assert.match(sheet, /onRows\?\.\(\{ rows: scopedRows, scope: focusName \|\| undefined \}\)/)
    // the search and the ordering start from the scoped rows, never the other way round
    assert.match(sheet, /let out = \[\.\.\.scopedRows\]/)
  })
})

/* ---------- Render Sheet — a sheet never opened adds nothing --------------- */

describe('Render Sheet — the total counts only the sheets the list opened', () => {
  const tabs: TabInfo[] = [
    { key: 'shifts', tab: 'shifts', source: 'hub', rows: 10, cols: 4, alive: true },
    // never opened: the engine keeps a 0 on the wire beside alive:false — not a count
    { key: 'diseases', tab: 'diseases', source: 'hub', rows: 0, cols: 0, alive: false },
    { key: 'lnk_x', tab: 'Gone', source: 'linked', rows: 0, cols: 0, alive: false },
    { key: 'lnk_y', tab: 'Kept', source: 'linked', rows: 5, cols: 2, alive: true },
    // a hub row from an older engine carries no alive flag and a real count
    { key: 'projects', tab: 'projects', source: 'hub', rows: 3, cols: 2 },
  ]
  const shiftsGrid: GridInfo = { tab: 'shifts', header: ['a', 'b', 'c', 'd'], rows: Array(10).fill([]), truncated: false }
  const open = { ...openSheetFigures(tabs[0], shiftsGrid, false), openReadOnly: false, canEdit: true }

  it('a dead sheet stays out of the total and is named beside it', () => {
    const f = renderSheetFigures(tabs, open)
    assert.equal(f.rows, 18)
    assert.equal(f.uncounted, 2)
    const html = draw(<RenderSheetHero read={{ state: 'ready' }} figures={f} />)
    assert.equal(stats(html)[1], '18')
    assert.match(html, /2 sheets could not be opened — not in this total/)
    assert.equal(html.includes('counted off every sheet on the list'), false)
  })

  it('a dead sheet’s chip shows the dash, never a 0', () => {
    assert.deepEqual(tabs.map(tabRowsLabel), ['10', HERO_DASH, HERO_DASH, '5', '3'])
  })

  it('a list where nothing could be opened has no total at all', () => {
    const f = renderSheetFigures(tabs.filter((t) => t.alive === false), open)
    assert.equal(f.rows, null)
    const html = draw(<RenderSheetHero read={{ state: 'ready' }} figures={f} />)
    assert.equal(stats(html)[1], HERO_DASH)
    assert.match(html, /no sheet on the list could be opened to count/)
  })

  it('an estate sheet is built in, not added by link', () => {
    const withEstate: TabInfo[] = [
      ...tabs,
      { key: 'est_uimui', tab: 'Asa | UIs and MUIs - UIs and MUIs', source: 'linked', rows: 7, cols: 3, alive: true },
    ]
    const f = renderSheetFigures(withEstate, open)
    assert.equal(f.linked, 2)
    const html = draw(<RenderSheetHero read={{ state: 'ready' }} figures={f} />)
    assert.match(html, /4 built-ins · 2 added by link/)
    // "added by link" is a phrase, not a noun to pluralise
    assert.doesNotMatch(html, /added by links/)
  })

  it('a registry that could not be read leaves the list’s size unknown and keeps the linked sheets out of the total', () => {
    const builtins = tabs.filter((t) => t.source === 'hub')
    const f = renderSheetFigures(builtins, open, true)
    const html = draw(<RenderSheetHero read={{ state: 'ready' }} figures={f} onRetry={() => {}} />)
    const size = figure(html, 'Sheets on the list')
    assert.equal(size?.value, HERO_DASH)
    assert.match(size?.note ?? '', /the linked spreadsheets could not be listed · 3 built-ins here/)
    assert.match(figure(html, 'Rows across them')?.note ?? '', /the linked spreadsheets could not be listed — not in this total/)
    assert.match(html, /Try again/)
    assert.equal(html.includes('counted off every sheet on the list'), false)
    assert.equal(/\d+ sheets on the list/.test(html), false)
  })

  describe('the open sheet counts from the read that opened it', () => {
    const big: TabInfo = { key: 'hiring', tab: 'hiring', source: 'hub', rows: 4000, cols: 3, alive: true }
    const trimmed: GridInfo = { tab: 'hiring', header: ['a', 'b', 'c'], rows: Array(1000).fill([]), truncated: true }

    it('a trimmed grid takes the sheet’s own count from the list, not the rows it drew', () => {
      const o = openSheetFigures(big, trimmed, false)
      assert.equal(o.openRows, 4000)
      const html = draw(<RenderSheetHero read={{ state: 'ready' }}
        figures={renderSheetFigures([big], { ...o, openReadOnly: false, canEdit: true })} />)
      assert.equal(figure(html, 'Rows in the open sheet')?.value, '4,000')
      assert.match(figure(html, 'Rows in the open sheet')?.note ?? '', /hiring · 3 columns · the first 1,000 drawn/)
    })

    it('a trimmed grid the list could not count is a dash, never the 1,000 it drew', () => {
      const o = openSheetFigures({ ...big, rows: 0, alive: false }, trimmed, false)
      assert.equal(o.openRows, null)
      const html = draw(<RenderSheetHero read={{ state: 'ready' }}
        figures={renderSheetFigures([big], { ...o, openReadOnly: false, canEdit: true })} />)
      assert.equal(figure(html, 'Rows in the open sheet')?.value, HERO_DASH)
      assert.match(html, /the first 1,000 drawn; the list could not count the rest/)
    })

    it('a grid read that failed says it failed, never "has not answered yet"', () => {
      const o = openSheetFigures(big, null, true)
      assert.equal(o.openRead, 'failed')
      const html = draw(<RenderSheetHero read={{ state: 'ready' }}
        figures={renderSheetFigures([big], { ...o, openReadOnly: false, canEdit: true })} onRetry={() => {}} />)
      const shown = figure(html, 'Rows in the open sheet')
      assert.equal(shown?.value, HERO_DASH)
      assert.match(shown?.note ?? '', /unknown — hiring could not be read/)
      assert.equal(html.includes('has not answered yet'), false)
      assert.match(html, /Try again/)
    })

    it('a grid still in flight is pending, and a missing tab is not an empty one', () => {
      const pending = draw(<RenderSheetHero read={{ state: 'ready' }}
        figures={renderSheetFigures([big], { ...openSheetFigures(big, null, false), openReadOnly: false, canEdit: true })} />)
      assert.match(pending, /hiring has not answered yet/)
      const missing: TabInfo = { key: 'diseases', tab: 'diseases', source: 'hub', rows: 0, cols: 0, alive: false }
      const empty = openSheetFigures(missing, { tab: 'diseases', header: [], rows: [], truncated: false }, false)
      assert.equal(empty.openRows, null)
      const html = draw(<RenderSheetHero read={{ state: 'ready' }}
        figures={renderSheetFigures([missing], { ...empty, openReadOnly: false, canEdit: true })} />)
      assert.equal(figure(html, 'Rows in the open sheet')?.value, HERO_DASH)
      assert.match(html, /diseases could not be opened, or does not exist yet/)
    })
  })
})

/* ---------- Guardian — the snapshot check that could not run --------------- */

describe('Guardian — a snapshot index that did not answer is a check that could not run', () => {
  it('the index read comes back as no answer, never as an empty index', async () => {
    // this file's fetch answers every GET with a 404
    assert.equal(await readSnapshotIndex(), null)
    assert.equal(snapshotCheckState(null), 'unknown')
  })

  it('no index answer keeps the shield off green even when every other check is green', () => {
    const green: CheckState[] = ['ok', 'ok', 'ok', 'ok', 'ok', 'ok']
    assert.equal(guardianOverall([...green, snapshotCheckState(null)], ['unknown', 'unknown']), 'unknown')
    assert.equal(
      guardianOverall([...green, snapshotCheckState({ total: 3, stale: [], missing: [] })], ['unknown', 'unknown']),
      'ok',
    )
  })

  it('the screen prints the dash and says the index did not answer — header and card alike', async () => {
    const h = mountHook(() => GuardianPage(), {})
    await h.settle(() => draw(h.current).includes('snapshot index did not answer'))
    const html = draw(h.current)
    h.unmount()
    const slices = figure(html, 'Snapshot slices cached')
    assert.equal(slices?.value, HERO_DASH)
    assert.match(slices?.note ?? '', /the browser’s own snapshot index did not answer/)
    assert.equal(/0 stale · 0 with errors/.test(html), false)
    assert.match(html, /The snapshot index did not answer, so this check could not run/)
    assert.equal(html.includes('slices cached,'), false)
    // the shield does not read "healthy" over a check that could not run
    assert.equal(html.includes('Everything is healthy'), false)
  })
})
