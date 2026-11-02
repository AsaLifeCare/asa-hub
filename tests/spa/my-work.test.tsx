/**
 * MY WORK · Actions & Requests: the manifest, the screen drawn whole, and its one read.
 *
 * Whose rows these are is decided by the relay; the screen is held to what it promises with them —
 * open is green, resolved hides until asked, every detail opens, a source that did not answer says so,
 * and nothing is filtered by person here.
 */
import { after, afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { badgeAllowsApp } from '@/lib/badgeAccess'
import { useMemberStore } from '@/stores/useMemberStore'
import { myWorkManifests } from '@/registry/apps-mywork'
import { appManifests } from '@/registry/apps'
import * as model from '@/pages/features/mywork/myWorkModel'
import DecisionPanel, { decisionPress } from '@/components/shared/DecisionPanel'
import {
  DECIDE_TEST_MODE, DUE_TONE_CLASS, STATUS_PILL, actionCell, decidePayload, decideToast, decisionView, emptyWords, heroFiguresOf,
  myWorkPath, sourceLines, timeOffRefOf, timeOffRequestRef, unanswered,
  type ActionRow, type MyWorkView, type RequestRow, type SourceHead,
} from '@/pages/features/mywork/myWorkModel'
import MyWorkPage, {
  ActionsCard, DecideCell, MyWorkScreen, RequestsCard, VISIT_SENTENCE, VisitNotice, useDecide, useMyWorkPage,
} from '@/pages/features/mywork/MyWorkPage'
import { useToastStore } from '@/stores/useToastStore'
import { UploadAssetBody, uploadRefusal } from '@/pages/features/mywork/UploadAssetSheet'
import { MY_WORK_IDLE, useMyWork, type MyWorkState } from '@/pages/features/mywork/useMyWork'
import { mountHook } from './react-host'
import { SHELL_HIDDEN, primeShellHides } from '@/lib/myWorkHides'

// the screens below draw their test mode warnings, as Settings › My Work shows them when the switch says so
primeShellHides({ ...SHELL_HIDDEN, test_mode_warnings: false })

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: React.ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))

const head = (key: string, label: string, over: Partial<SourceHead> = {}): SourceHead => ({
  key, label, state: 'ready', why: '', as_of: '', count: 1, hidden: 0, capped: false, stale_why: '', note: '', ...over,
})

function act(id: string, over: Partial<ActionRow> = {}): ActionRow {
  return {
    id, source: 'requirements', due: '2026-09-22', due_tone: 'overdue', due_why: '', condition: `Condition ${id}`,
    flow: 'Training renewal', phase: 'Expired', family: 'credential',
    action: { label: 'Upload asset', kind: 'upload', app: '', page: '', href: '', certs: ['DODD 8-Hour'], upload_for: 'Ann Roe' },
    action_why: '', details: [{ label: 'Evidence', value: 'DODD 8-hour certificate' }], ...over,
  }
}

function req(id: string, over: Partial<RequestRow> = {}): RequestRow {
  return {
    id, source: 'time_off', ref: `REF-${id}`, request: `Request ${id}`, submitted: '2026-09-23', submitted_why: '',
    status: { class: 'open', word: 'Waiting on the house manager' },
    details: [{ label: 'Dates', value: 'Mon 10/5 - Wed 10/7' }, { label: 'Filed', value: 'By telephone' }],
    link: { app: 'timeoff', page: 'requests', href: '/app/timeoff/requests?ref=TO1', label: 'Open in Time Off' }, ...over,
  }
}

function view(over: Partial<MyWorkView> = {}): MyWorkView {
  return {
    scope: { mode: 'own', why: '', person: '' },
    me: { name: 'Ann Roe', key_why: '' },
    actions: { sources: [head('requirements', 'Compliance requirements')], rows: [act('a1')], note: '' },
    requests: {
      sources: [head('time_off', 'Time off'), head('house_repairs', 'House repairs', {
        state: 'not_attributable', count: null, structural: true,
        why: 'House repair requests keep no reporter column, so none can be shown as yours.',
      })],
      rows: [req('r1'), req('r2', { status: { class: 'resolved', word: 'Approved' }, ref: 'REF-OLD' })],
      note: '',
    },
    totals: { actions: 1, overdue: 1, open_requests: 1, resolved: 1 },
    read_at: '2026-09-25T12:00:00Z',
    ...over,
  }
}

const ready = (v: MyWorkView): MyWorkState => ({ ...MY_WORK_IDLE, status: 'ready', data: v, readAt: Date.parse('2026-09-25T12:00:00Z') })
const opensAll = () => true
const opensNone = () => false
const noop = () => {}
const screen = (s: MyWorkState, opens: (a: string) => boolean = opensAll) =>
  draw(<MyWorkScreen state={s} person="" onPerson={noop} onRetry={noop} opens={opens} onUpload={noop} />)

describe('the app', () => {
  it('is "My Work", id my-work, page "Actions & Requests" — and sits in the registry', () => {
    const app = myWorkManifests[0]
    assert.equal(app.id, 'my-work')
    assert.equal(app.name, 'My Work')
    assert.equal(app.pages.length, 1)
    assert.equal(app.pages[0].id, 'actions')
    assert.equal(app.pages[0].title, 'Actions & Requests')
    assert.equal(appManifests.filter((m) => m.id === 'my-work').length, 1)
  })

  it('ships no App Control row: staff with an empty matrix cannot open it, the master can', () => {
    const staff = { role: 'staff', types: ['STAFF'], isMaster: false }
    assert.equal(badgeAllowsApp('my-work', staff, {}), false)
    assert.equal(badgeAllowsApp('my-work', { ...staff, role: 'admin', types: ['ADMIN'] }, { crm: ['ADMIN'] }), false)
    assert.equal(badgeAllowsApp('my-work', { role: 'admin', types: [], isMaster: true }, {}), true)
    const hits: string[] = []
    for (const dir of ['apps-script', 'tools']) {
      for (const f of readdirSync(resolve(ROOT, dir))) {
        if (!/\.(gs|py|mjs|js|json)$/.test(f) || f === 'test-my-work.py') continue
        const text = readFileSync(join(resolve(ROOT, dir), f), 'utf8')
        if (/app_badge_access[^\n]{0,200}my-work|my-work[^\n]{0,200}app_badge_access/.test(text)) hits.push(f)
      }
    }
    assert.deepEqual(hits, [])
  })

  it('is routed to its own screen', () => {
    const routes = readFileSync(resolve(ROOT, 'src/pages/AppRoutePage.tsx'), 'utf8')
    assert.match(routes, /'my-work\/actions': MyWorkPage/)
  })
})

describe('My Requests', () => {
  it('draws Open in GREEN, never the info blue', () => {
    const html = draw(<RequestsCard view={view()} mass={false} opens={opensAll} initiallyShowResolved={false} />)
    assert.match(html, /data-status="open"[^>]*>Open</)
    assert.ok(html.includes('--status-green-soft') && html.includes('text-[var(--status-green)]'))
    assert.ok(!/--info|text-info|bg-info|tint-blue/.test(html), 'no blue on an open request')
    assert.equal(STATUS_PILL.open.includes('status-green'), true)
  })

  it('hides resolved requests until Show resolved, and the label counts them', () => {
    const hidden = draw(<RequestsCard view={view()} mass={false} opens={opensAll} initiallyShowResolved={false} />)
    assert.ok(!hidden.includes('REF-OLD'))
    assert.match(hidden, /Show resolved \(1\)/)
    const shown = draw(<RequestsCard view={view()} mass={false} opens={opensAll} initiallyShowResolved />)
    assert.ok(shown.includes('REF-OLD') && shown.includes('>Approved<'))
    const allResolved = view({ requests: { ...view().requests, rows: [view().requests.rows[1]] } })
    assert.match(draw(<RequestsCard view={allResolved} mass={false} opens={opensAll} initiallyShowResolved={false} />),
      /Every request on record is resolved — tick Show resolved/)
  })

  it('a collapsed row shows no detail; an open row shows every label and value, with aria-expanded', () => {
    const closed = draw(<RequestsCard view={view()} mass={false} opens={opensAll} initiallyShowResolved={false} />)
    assert.ok(!closed.includes('By telephone'))
    assert.match(closed, /aria-expanded="false"/)
    const open = draw(<RequestsCard view={view()} mass={false} opens={opensAll} initiallyShowResolved={false} initiallyOpen={['r1']} />)
    for (const d of view().requests.rows[0].details) {
      assert.ok(open.includes(`>${d.label}<`) && open.includes(`>${d.value}<`), d.label)
    }
    assert.match(open, /aria-expanded="true"/)
    // a time off is never a visit to Time Off: it opens here, in Time Off's own panel
    assert.ok(!open.includes('href="/app/timeoff') && !open.includes('Open in Time Off'))
    const support = view({ requests: { ...view().requests, rows: [req('r1', { source: 'hotline', ref: 'HQ1',
      link: { app: 'support-desk', page: 'requests', href: '/app/support-desk/requests?ref=HQ1', label: 'Open in Support Requests' } })] } })
    assert.ok(draw(<RequestsCard view={support} mass={false} opens={opensAll} initiallyShowResolved={false} initiallyOpen={['r1']} />)
      .includes('Open in Support Requests'))
    const shut = draw(<RequestsCard view={support} mass={false} opens={opensNone} initiallyShowResolved={false} initiallyOpen={['r1']} />)
    assert.ok(!shut.includes('Open in Support Requests'), 'a link into an app that does not open is never drawn')
  })

  it('a time off request opens in the operator\'s layout right here — Open, never "Open in Time Off"', () => {
    const v = view({ requests: { ...view().requests, rows: [req('time_off:TO1A2B3C4D5E', { ref: 'TO1A2B3C4D5E' })] } })
    for (const opens of [opensAll, opensNone]) {
      const html = draw(<RequestsCard view={v} mass={false} opens={opens} initiallyShowResolved={false}
        initiallyOpen={['time_off:TO1A2B3C4D5E']} />)
      assert.ok(html.includes('data-time-off-open="TO1A2B3C4D5E"') && />Open<\/button>/.test(html))
      assert.ok(!html.includes('href="/app/timeoff') && !html.includes('Open in Time Off'))
    }
    assert.equal(timeOffRequestRef({ id: 'time_off:TO1A2B3C4D5E', ref: 'to1a2b3c4d5e', link: null }), 'TO1A2B3C4D5E')
    assert.equal(timeOffRequestRef({ id: 'hotline:HQ1', ref: 'HQ1', link: null }), '')
    assert.equal(timeOffRequestRef({ id: 'time_off:x', ref: 'not a ref', link: null }), '')
  })

  it('a source that could not be read says so, and the card never claims there are no requests', () => {
    const v = view({ requests: {
      sources: [head('hotline', 'Phone requests', { state: 'unreadable', count: null, why: 'the lane did not answer' })],
      rows: [], note: '',
    } })
    const html = draw(<RequestsCard view={v} mass={false} opens={opensAll} initiallyShowResolved={false} />)
    assert.ok(html.includes('Phone requests could not be read: the lane did not answer'))
    assert.ok(!html.includes('You have no requests on record.'))
    assert.equal(emptyWords('requests', v.requests.sources, false), '')
  })

  it('house repairs say why none can be yours; that alone does not withhold the empty sentence', () => {
    const v = view({ requests: { ...view().requests, rows: [] } })
    const html = draw(<RequestsCard view={v} mass={false} opens={opensAll} initiallyShowResolved={false} />)
    assert.ok(html.includes('House repairs: House repair requests keep no reporter column, so none can be shown as yours.'))
    assert.ok(html.includes('You have no requests on record.'))
    const untied = [head('time_off', 'Time off', { state: 'not_attributable', count: null, why: 'your name is shared' })]
    assert.equal(emptyWords('requests', untied, false), '', 'a source that could not be tied to you is not an empty one')
  })

  it('a blank submitted date is the dash and its sentence', () => {
    const v = view({ requests: { ...view().requests, rows: [req('r9', { submitted: '', submitted_why: 'The source keeps no readable date for it.' })] } })
    const html = draw(<RequestsCard view={v} mass={false} opens={opensAll} initiallyShowResolved={false} />)
    assert.ok(html.includes('—<span') && html.includes('The source keeps no readable date for it.'))
  })

  it('a blank REQUEST ID is the dash and its sentence, never a bare dash', () => {
    const v = view({ requests: { ...view().requests, rows: [
      req('r7', { ref: '', ref_why: 'The call-off book keeps no id for this row.' }),
      req('r8', { ref: '' }),
    ] } })
    const html = draw(<RequestsCard view={v} mass={false} opens={opensAll} initiallyShowResolved={false} />)
    assert.ok(html.includes('The call-off book keeps no id for this row.'))
    assert.ok(html.includes(`—<span class="block text-[11px] leading-[1.4] text-text-3">${model.NO_REF_WHY}</span>`),
      'a row the relay sent without a reason still gets one')
    assert.deepEqual(model.refWords({ ref: 'TO1', ref_why: '' }), { text: 'TO1', why: '' })
    assert.deepEqual(model.refWords({ ref: '  ' }), { text: '—', why: model.NO_REF_WHY })
  })
})

describe('My Actions', () => {
  it('due tones are the danger, warning and success tokens; a blank due is the dash and its sentence', () => {
    assert.equal(DUE_TONE_CLASS.overdue, 'text-[var(--danger)]')
    assert.equal(DUE_TONE_CLASS.soon, 'text-[var(--warning)]')
    assert.equal(DUE_TONE_CLASS.later, 'text-[var(--success)]')
    const v = view({ actions: { sources: [head('requirements', 'Compliance requirements')], note: '', rows: [
      act('o'), act('s', { due: '2026-09-30', due_tone: 'soon' }), act('l', { due: '2026-10-15', due_tone: 'later' }),
      act('n', { due: '', due_tone: '', due_why: 'Nothing is on file, so there is no date to run out.' }),
    ] } })
    const html = draw(<ActionsCard view={v} mass={false} opens={opensAll} onUpload={noop} />)
    assert.match(html, /text-\[var\(--danger\)\]">Sep 22, 2026</)
    assert.match(html, /text-\[var\(--warning\)\]">Sep 30, 2026</)
    assert.match(html, /text-\[var\(--success\)\]">Oct 15, 2026</)
    assert.ok(html.includes('—<span') && html.includes('Nothing is on file, so there is no date to run out.'))
  })

  it('the action is a button where it leads somewhere open, the words where it does not, an upload in the page', () => {
    const link = act('k', { action: { label: 'Enter decision', kind: 'link', app: 'policy-acks', page: 'documents',
      href: '/app/policy-acks/documents', certs: [], upload_for: '' }, action_why: 'Policies is not open to you here — ask HR for the document.' })
    assert.deepEqual(actionCell(link, opensAll), { kind: 'link', label: 'Enter decision', href: '/app/policy-acks/documents' })
    assert.deepEqual(actionCell(link, opensNone), { kind: 'words', text: 'Policies is not open to you here — ask HR for the document.' })
    assert.deepEqual(actionCell(act('u'), opensNone), { kind: 'upload', label: 'Upload asset', certs: ['DODD 8-Hour'], uploadFor: 'Ann Roe' })
    const v = view({ actions: { sources: [head('requirements', 'Compliance requirements')], rows: [link, act('u')], note: '' } })
    const open = draw(<ActionsCard view={v} mass={false} opens={opensAll} onUpload={noop} />)
    assert.ok(open.includes('href="/app/policy-acks/documents"') && open.includes('>Enter decision<'))
    assert.ok(open.includes('data-upload="DODD 8-Hour"') && open.includes('>Upload asset<'))
    const closed = draw(<ActionsCard view={v} mass={false} opens={opensNone} onUpload={noop} />)
    assert.ok(!closed.includes('href="/app/policy-acks/documents"') && closed.includes('ask HR for the document'))
  })

  it('the upload sheet names whom it files under and refuses what the door would refuse', () => {
    const html = draw(<UploadAssetBody ask={{ certs: ['DODD 8-Hour', 'CPR / First Aid'], uploadFor: 'Ann Roe' }}
      cert="DODD 8-Hour" onCert={noop} busy={false} done={null} error="" onPick={noop} />)
    assert.ok(html.includes('Ann Roe') && html.includes('CPR / First Aid') && html.includes('Choose a file'))
    assert.equal(uploadRefusal({ name: 'a.docx', size: 10, type: 'application/msword' }), 'Images and PDFs only.')
    assert.match(uploadRefusal({ name: 'a.pdf', size: 16 * 1024 * 1024, type: 'application/pdf' }), /up to 15MB/)
    assert.equal(uploadRefusal({ name: 'a.jpg', size: 10, type: 'image/jpeg' }), '')
  })

  it('an expanded action shows its details; a collapsed one does not', () => {
    const closed = draw(<ActionsCard view={view()} mass={false} opens={opensAll} onUpload={noop} />)
    assert.ok(!closed.includes('DODD 8-hour certificate'))
    const open = draw(<ActionsCard view={view()} mass={false} opens={opensAll} onUpload={noop} initiallyOpen={['a1']} />)
    assert.ok(open.includes('>Evidence<') && open.includes('>DODD 8-hour certificate<') && /aria-expanded="true"/.test(open))
  })
})

describe('a decision answered in the page (Scheduling)', () => {
  const decideRow = (over: Partial<ActionRow> = {}) => act('scheduling:SI00000000A1', {
    source: 'scheduling', due: '2026-10-05', due_tone: 'later', condition: 'Cy Far asks to be off Mon 10/5 — 8A-4P at BM',
    flow: 'Scheduling', phase: 'Director approval', family: 'decision', action_why: '',
    action: { label: 'Approve or decline', kind: 'decide', app: 'scheduling', page: 'calendar',
      href: '/app/scheduling/calendar?house=BM4060&day=2026-10-05', certs: [], upload_for: '',
      item_id: 'SI00000000A1', words: ['Approve', 'Decline'] },
    details: [{ label: 'House', value: 'BM' }, { label: 'Day', value: 'Mon 10/5' }, { label: 'Shift', value: '8A-4P' }],
    ...over,
  })

  it('a decide target is Approve and Decline, whatever the app\'s access: the seat is the server\'s to judge', () => {
    const want = { kind: 'decide', itemId: 'SI00000000A1', approve: 'Approve', decline: 'Decline' }
    assert.deepEqual(actionCell(decideRow(), opensAll), want)
    assert.deepEqual(actionCell(decideRow(), opensNone), want)
    const noId = decideRow({ action_why: 'The item carries no id, so it cannot be answered here.' })
    noId.action = { ...noId.action!, item_id: '' }
    assert.deepEqual(actionCell(noId, opensAll), { kind: 'words', text: 'The item carries no id, so it cannot be answered here.' })
  })

  it('the row decides nothing: it says Open and opens the right panel — no Approve, no Decline, no dialog in the list', () => {
    const v = view({ actions: { sources: [head('scheduling', 'Scheduling approvals')], rows: [decideRow()], note: '' } })
    const html = draw(<ActionsCard view={v} mass={false} opens={opensNone} onUpload={noop} />)
    assert.ok(html.includes('data-decide-open="SI00000000A1"') && />Open</.test(html))
    assert.ok(!html.includes('data-decision-panel') && !/>Approve</.test(html) && !/>Decline</.test(html), 'nothing decided in the row')
    assert.ok(!html.includes('href="/app/scheduling') && !html.includes('role="dialog"') && !html.includes('Not open to you here'))
    const cell = { kind: 'decide' as const, itemId: 'SI00000000A1', approve: 'Approve', decline: 'Decline' }
    assert.ok(draw(<DecideCell cell={cell} onOpen={noop} />).includes('data-decide-open="SI00000000A1"'))
  })

  it('the right panel holds the request: its title, house, day, shift, its words, the test-mode line, then the answer', () => {
    const row = decideRow({
      details: [{ label: 'House', value: 'BM' }, { label: 'Day', value: 'Mon 10/5' }, { label: 'Shift', value: '8A-4P' },
        { label: 'Details', value: 'Cy Far asked to be off this shift.' },
        { label: 'Test mode', value: 'Made while test mode was on: its texts were held' }],
    })
    const v = view({ actions: { sources: [head('scheduling', 'Scheduling approvals')], rows: [row], note: '' } })
    const html = draw(<ActionsCard view={v} mass={false} opens={opensNone} onUpload={noop} initiallyDeciding={row.id} />)
    const panel = html.slice(html.indexOf('aria-label="Approval"'))
    assert.ok(panel.includes('data-decision-panel=""'), 'the panel is drawn')
    for (const w of ['Cy Far asks to be off Mon 10/5 — 8A-4P at BM', '>BM<', '>Mon 10/5<', '>8A-4P<', 'Cy Far asked to be off this shift.',
      'Director approval', 'Made while test mode was on']) assert.ok(panel.includes(w), w)
    assert.ok(panel.includes('data-press="approve"') && panel.includes('data-press="decline"') && panel.includes('aria-label="Note with the answer"'))
    assert.ok(!panel.includes('data-armed') && !html.includes('role="dialog"'), 'Decline is not armed until pressed; never a dialog')
  })

  it('a time off approval opens Time Off\'s own panel here, never the generic one or a link', () => {
    const row = decideRow({ id: 'time_off_decisions:TO1A2B3C4D5E:mia', flow: 'Time off approval' })
    row.action = { ...row.action!, app: 'timeoff', item_id: 'TO1A2B3C4D5E', action: 'timeOffDecide', href: '' }
    const v = view({ actions: { sources: [head('time_off', 'Time off approvals')], rows: [row], note: '' } })
    const html = draw(<ActionsCard view={v} mass={false} opens={opensNone} onUpload={noop} initiallyDeciding={row.id} />)
    assert.ok(html.includes('aria-label="Time off request"'), 'Time Off\'s panel')
    assert.ok(!html.includes('aria-label="Approval"') && !html.includes('href="/app/timeoff'))
    assert.equal(timeOffRefOf(row, actionCell(row, opensNone)), 'TO1A2B3C4D5E')
    assert.equal(timeOffRefOf(decideRow(), actionCell(decideRow(), opensNone)), '')
  })

  it('the item the relay carries is drawn whole: its title, the day in words, the seat, test mode', () => {
    const row = decideRow({ details: [] })
    row.action = { ...row.action!, item: {
      id: 'SI00000000A1', title: 'Training — Ann Roe · Tue 10/6 · 4P-12A · BM', body: 'Ann Roe has no IST at BM.',
      house_code: 'BM4060', house_label: 'BM', date: '2026-10-06', day_words: 'Tue 10/6', shift_text: '4P-12A',
      seat: 'house_manager', seat_words: 'House manager approval', test_mode: true,
    } }
    assert.deepEqual(decisionView(row), {
      title: 'Training — Ann Roe · Tue 10/6 · 4P-12A · BM',
      facts: [{ label: 'House', value: 'BM' }, { label: 'Day', value: 'Tue 10/6' }, { label: 'Shift', value: '4P-12A' }],
      body: 'Ann Roe has no IST at BM.', testMode: DECIDE_TEST_MODE, phase: 'House manager approval',
    })
  })

  it('Approve is one press; Decline arms first and sends on its second, with "Not yet" to go back — in the panel', () => {
    assert.deepEqual(decisionPress(false, 'approve'), { armed: false, send: 'approve' })
    assert.deepEqual(decisionPress(false, 'decline'), { armed: true, send: null })
    assert.deepEqual(decisionPress(true, 'decline'), { armed: false, send: 'decline' })
    assert.deepEqual(decisionPress(true, 'approve'), { armed: false, send: 'approve' })
    const html = draw(<DecisionPanel open onClose={noop} title="Request off — Cy Far" facts={[]} busy={false}
      onAnswer={noop} initiallyArmed />)
    assert.ok(html.includes('data-armed=""') && html.includes('Decline — press again') && html.includes('Not yet'))
  })

  it('the payload is the item, the word and the trimmed note; the toast is the server\'s sentence', () => {
    assert.deepEqual(decidePayload('SI1', 'decline', '  short staffed  '), { item_id: 'SI1', word: 'decline', note: 'short staffed' })
    assert.deepEqual(decidePayload('SI1', 'approve'), { item_id: 'SI1', word: 'approve', note: '' })
    assert.deepEqual(decideToast('approve', { ok: true, said: 'Approved — the shift is open at BM.' }),
      { type: 'success', title: 'Approved', body: 'Approved — the shift is open at BM.' })
    assert.deepEqual(decideToast('decline', { ok: true, said: '' }), { type: 'success', title: 'Declined', body: undefined })
    assert.deepEqual(decideToast('approve', { ok: true, changed: false, said: 'Already answered by Ty Bond.' }),
      { type: 'info', title: 'Already answered', body: 'Already answered by Ty Bond.' })
    const rows = [decideRow(), act('a2')]
    assert.deepEqual(unanswered(rows, new Set(['scheduling:SI00000000A1'])).map((r) => r.id), ['a2'])
    assert.equal(unanswered(rows, new Set()), rows)
  })

  describe('the answer', () => {
    const realFetch = globalThis.fetch
    let sent: { action: string; payload: unknown }[] = []
    let envelope: Record<string, unknown> = {}
    before(() => {
      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(decodeURIComponent(String(init?.body ?? '').replace(/^body=/, '')))
        sent.push({ action: String(body.action), payload: body.payload })
        return new Response(JSON.stringify(envelope))
      }) as typeof fetch
    })
    after(() => { globalThis.fetch = realFetch })
    afterEach(() => {
      sent = []
      useToastStore.setState({ toasts: [] })
    })

    it('Approve calls schedulingAnswer with the item, the row leaves at once, and the toast carries what was said', async () => {
      envelope = { status: 200, data: { ok: true, said: 'Approved — the shift is open at BM.', state: 'approved' } }
      const h = mountHook(() => useDecide(), {})
      let done: Promise<boolean> | null = null
      h.run(() => { done = h.current.decide('scheduling:SI00000000A1', 'SI00000000A1', 'approve', '') })
      assert.ok(h.current.answered.has('scheduling:SI00000000A1'), 'the row leaves before the answer')
      assert.equal(await done, true)
      await h.settle(() => useToastStore.getState().toasts.length > 0)
      assert.deepEqual(sent, [{ action: 'schedulingAnswer', payload: { item_id: 'SI00000000A1', word: 'approve', note: '' } }])
      assert.ok(h.current.answered.has('scheduling:SI00000000A1'))
      const t = useToastStore.getState().toasts[0]
      assert.equal(t.type, 'success')
      assert.equal(t.body, 'Approved — the shift is open at BM.')
      h.unmount()
    })

    it('a refusal brings the row back and says the server\'s words in a danger toast', async () => {
      envelope = { status: 403, message: 'Only the account this item waits on can answer it.' }
      const h = mountHook(() => useDecide(), {})
      let done: Promise<boolean> | null = null
      h.run(() => { done = h.current.decide('scheduling:SI00000000A1', 'SI00000000A1', 'decline', ' no cover ') })
      assert.equal(await done, false)
      await h.settle(() => !h.current.answered.has('scheduling:SI00000000A1'))
      assert.equal(h.current.answered.has('scheduling:SI00000000A1'), false, 'the row stays')
      assert.deepEqual(sent[0].payload, { item_id: 'SI00000000A1', word: 'decline', note: 'no cover' })
      assert.equal(h.current.refused['scheduling:SI00000000A1'], 'Only the account this item waits on can answer it.', 'the panel says it too')
      const t = useToastStore.getState().toasts[0]
      assert.equal(t.type, 'danger')
      assert.equal(t.body, 'Only the account this item waits on can answer it.')
      h.unmount()
    })
  })
})

describe('the scope, as the screen draws it', () => {
  it('the person column and the person filter appear only on a mass read', () => {
    const own = screen(ready(view()))
    assert.ok(!own.includes('>Person<') && !own.includes('All people') && own.includes('>My Actions<'))
    const massView = view({
      scope: { mode: 'mass', why: 'Signed in as the master account: every person\'s rows, each naming its person.', person: '',
        people: [{ key: 'annroe', name: 'Ann Roe', open_actions: 1, open_requests: 1 }] },
      actions: { sources: [head('requirements', 'Compliance requirements')], rows: [act('m1', { person: { key: 'annroe', name: 'Ann Roe' } }),
        act('m2', { person: { key: '', name: '' } })], note: 'Showing 600 of 812 — pick a person to see all of theirs.' },
    })
    const mass = screen(ready(massView))
    assert.ok(mass.includes('>Person<') && mass.includes('All people') && mass.includes('>Actions<') && mass.includes('Everyone'))
    assert.ok(mass.includes('Nobody is named for this'), 'a row naming nobody prints the dash and why')
    assert.ok(mass.includes('Showing 600 of 812 — pick a person to see all of theirs.'))
  })

  it('the model offers no way to filter rows by person — only the door narrows', () => {
    const names = Object.keys(model)
    assert.deepEqual(names.filter((n) => /person/i.test(n)), ['personWords'])
    assert.equal(myWorkPath('annroe'), '/erp-lanes/my-work?person=annroe')
    assert.equal(myWorkPath('a b&c'), '/erp-lanes/my-work?person=a%20b%26c')
    assert.equal(myWorkPath(''), '/erp-lanes/my-work')
  })

  it('source lines say unreadable in danger, and a ready source\'s note and stale copy in words', () => {
    const lines = sourceLines([
      head('ist', 'Client training (IST)', { state: 'unreadable', why: 'the house is empty', count: null }),
      head('hotline', 'Phone requests', { stale_why: 'Showing the copy read at 12:00.' }),
      head('requirements', 'Compliance requirements', { note: '2 background checks HR runs are not listed' }),
    ])
    assert.deepEqual(lines.map((l) => [l.tone, l.text]), [
      ['danger', 'Client training (IST) could not be read: the house is empty'],
      ['warning', 'Phone requests: Showing the copy read at 12:00.'],
      ['muted', 'Compliance requirements: 2 background checks HR runs are not listed'],
    ])
  })

  it('a ready source with a gap lists its rows, says the gap, and is never read as whole', () => {
    const gap = 'your name is shared with another account — your reads are filed under that name, so whether you ' +
      'answered 2 all-staff policies cannot be told'
    const gapped = head('policies', 'Policy acknowledgements', { gap })
    assert.deepEqual(sourceLines([gapped]).map((l) => [l.tone, l.text]), [['warning', `Policy acknowledgements: ${gap}`]])
    assert.equal(model.landed(gapped), false)
    assert.equal(model.landed(head('policies', 'Policy acknowledgements')), true)
    assert.equal(emptyWords('actions', [gapped], false), '')
    const v = view({ actions: { sources: [gapped], rows: [act('p9', { source: 'policies' })], note: '' } })
    const f = heroFiguresOf(v)
    assert.equal(f[0].value, null)
    assert.match(f[0].note, /^1 could not settle every row, so this is not a count$/)
    const html = draw(<ActionsCard view={v} mass={false} opens={opensAll} onUpload={noop} />)
    assert.ok(html.includes('Condition p9') && html.includes(`Policy acknowledgements: ${gap}`))
    const none = view({ actions: { sources: [gapped], rows: [], note: '' } })
    assert.ok(!draw(<ActionsCard view={none} mass={false} opens={opensAll} onUpload={noop} />)
      .includes('Nothing is asked of you right now.'), 'a gap is never an empty card')
    const mixed = heroFiguresOf(view({ actions: { sources: [gapped, head('ist', 'Client training (IST)', {
      state: 'unreadable', count: null, why: 'down' })], rows: [], note: '' } }))
    assert.equal(mixed[0].note, '1 source could not be read and 1 could not settle every row, so this is not a count')
  })

  it('an old mirrored copy names its day on the card, so weeks-old rows never read as current', () => {
    const copy = 'the copy read here was mirrored Sep 8, 2026 — anything filed since may not show yet'
    const lines = sourceLines([head('support_requests', 'Support requests', { copy_why: copy }), head('time_off', 'Time off')])
    assert.deepEqual(lines.map((l) => [l.tone, l.text]), [['warning', `Support requests: ${copy}`]])
    const v = view({ requests: { ...view().requests, sources: [head('support_requests', 'Support requests', { copy_why: copy })] } })
    assert.ok(draw(<RequestsCard view={v} mass={false} opens={opensAll} initiallyShowResolved={false} />)
      .includes(`Support requests: ${copy}`))
  })
})

describe('the black header', () => {
  it('stands on the kit\'s dark surface, and a failed read prints the dash, never 0', () => {
    const failed = screen({ ...MY_WORK_IDLE, status: 'failed', error: 'the relay answered 503' })
    assert.ok(failed.includes('bg-detail-hero'))
    assert.ok((failed.match(/>—</g) ?? []).length >= 4)
    assert.ok(!/font-stat[^"]*"[^>]*>0</.test(failed))
    assert.ok(failed.includes('My Work could not be read, so these figures are unknown.'))
  })

  it('a card whose source did not land blanks its figures with the reason', () => {
    const v = view({ requests: { sources: [head('hotline', 'Phone requests', { state: 'unreadable', count: null, why: 'down' })], rows: [], note: '' } })
    const f = heroFiguresOf(v)
    assert.equal(f[0].value, 1)
    assert.equal(f[2].value, null)
    assert.match(f[2].note, /1 source could not be read, so this is not a count/)
    assert.equal(f[3].value, 1)
    const html = screen(ready(v))
    assert.ok(html.includes('bg-detail-hero') && html.includes('Phone requests could not be read: down'))
  })
})

describe('the read', () => {
  const realFetch = globalThis.fetch
  let calls: { url: string; auth: string }[] = []
  let answer: (url: string) => Response = () => new Response(JSON.stringify({ status: 200, data: view() }))
  before(() => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      calls.push({ url: String(url), auth: headers.Authorization ?? '' })
      return answer(String(url))
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })
  afterEach(() => {
    calls = []
    useAuthStore.setState({ user: null, token: null } as never)
    useMemberStore.setState({ currentMemberId: '', memberName: '', memberRole: '', memberTypes: [] } as never)
  })

  it('reads its one door with the Bearer token; a person is encoded into the address', async () => {
    useAuthStore.setState({ user: { id: 'u-ann', name: 'Ann Roe', role: 'staff', types: [] }, token: 'tok-ann' } as never)
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
    const h = mountHook(() => useMyWork(true, ''), {})
    await h.settle(() => h.current.state.status === 'ready')
    assert.equal(calls[0].url, '/erp-lanes/my-work')
    assert.equal(calls[0].auth, 'Bearer tok-ann')
    h.unmount()
    calls = []
    const p = mountHook(() => useMyWork(true, 'bob bee'), {})
    await p.settle(() => p.current.state.status === 'ready')
    assert.equal(calls[0].url, '/erp-lanes/my-work?person=bob%20bee')
    p.unmount()
  })

  it('a 403 is refused with the relay\'s own reason and words, never an empty board', async () => {
    useAuthStore.setState({ user: { id: 'u-ann', name: 'Ann Roe', role: 'staff', types: [] }, token: 'tok-ann' } as never)
    answer = () => new Response(JSON.stringify({ status: 403, reason: 'scope', message: 'My Work shows only your own rows.' }))
    const h = mountHook(() => useMyWork(true, 'bobbee'), {})
    await h.settle(() => h.current.state.status === 'refused')
    assert.equal(h.current.state.reason, 'scope')
    assert.equal(h.current.state.error, 'My Work shows only your own rows.')
    assert.equal(h.current.state.data, null)
    h.unmount()
    const html = screen({ ...MY_WORK_IDLE, status: 'refused', reason: 'scope', error: 'My Work shows only your own rows.' })
    assert.ok(html.includes('My Work shows only your own rows.') && !html.includes('My Actions'))
  })

  it('a person the door refuses as out of scope is let go, and the door is read again without it', async () => {
    assert.equal(model.choiceAfter({ status: 'refused', reason: 'scope' }, 'bobbee'), '')
    assert.equal(model.choiceAfter({ status: 'refused', reason: 'badge' }, 'bobbee'), 'bobbee')
    assert.equal(model.choiceAfter({ status: 'ready', reason: '' }, 'bobbee'), 'bobbee')
    useAuthStore.setState({ user: { id: 'u-boss', name: 'The Boss', role: 'admin', types: [], isMaster: true }, token: 'tok-boss' } as never)
    answer = (url) => url.includes('?person=')
      ? new Response(JSON.stringify({ status: 403, reason: 'scope', message: 'My Work shows only your own rows.' }))
      : new Response(JSON.stringify({ status: 200, data: view() }))
    const h = mountHook(() => useMyWorkPage(), {})
    await h.settle(() => h.current.state.status === 'ready')
    calls = []
    h.run(() => h.current.setPerson('bobbee'))
    await h.settle(() => calls.some((c) => c.url.includes('?person=bobbee')) && h.current.person === ''
      && h.current.state.status === 'ready')
    assert.ok(calls.some((c) => c.url === '/erp-lanes/my-work?person=bobbee'), 'the person was asked for')
    assert.equal(h.current.person, '')
    assert.equal(h.current.state.status, 'ready', 'the next read is the own board, not the refusal forever')
    assert.equal(calls[calls.length - 1].url, '/erp-lanes/my-work')
    h.unmount()
  })

  it('an open member visit draws the sentence and reads nothing', async () => {
    useAuthStore.setState({ user: { id: 'u-boss', name: 'The Boss', role: 'admin', types: [], isMaster: true }, token: 'tok-boss' } as never)
    useMemberStore.setState({ currentMemberId: 'u-sam', memberName: 'Sam Staff', memberRole: 'staff', memberTypes: [] } as never)
    const h = mountHook(() => useMyWorkPage(), {})
    await h.settle(() => false)
    assert.equal(h.current.visiting, true)
    assert.equal(calls.length, 0)
    h.unmount()
    // the server renderer reads a store's first state, so the notice is drawn by name and the page held to it
    assert.ok(draw(<VisitNotice />).includes(VISIT_SENTENCE.replace(/'/g, '&#x27;')))
    const page = readFileSync(resolve(ROOT, 'src/pages/features/mywork/MyWorkPage.tsx'), 'utf8')
    assert.match(page, /const \{ visiting, [^}]*\} = useMyWorkPage\(\)[\s\S]*if \(visiting\) return <VisitNotice \/>/)
    assert.equal(typeof MyWorkPage, 'function')
  })
})

describe('a decision answered in the page (Transportation): the row names its own action', () => {
  const vehicleRow = (action: string) => act('vehicle_calendar:VI00000000B2', {
    source: 'vehicle_calendar', due: '2026-10-07', due_tone: 'later', condition: 'Vehicle request — Taylor Brooks',
    flow: 'Transportation', phase: 'Director approval', family: 'decision', action_why: '',
    action: { label: 'Approve or decline', kind: 'decide', app: 'vehicle-calendar', page: 'calendar', href: '/app/my-work',
      certs: [], upload_for: '', item_id: 'VI00000000B2', words: ['Approve', 'Decline'], action,
      item: { id: 'VI00000000B2', facts: [{ label: 'Vehicle', value: 'Van' }] } },
    details: [{ label: 'Vehicle', value: 'Van' }, { label: 'When', value: 'Wed Oct 7, 1:00 PM – 3:20 PM' }],
  })

  it('a known action rides the cell; one outside DECIDE_ACTIONS is words, never a door', () => {
    assert.deepEqual([...model.DECIDE_ACTIONS],
      ['schedulingAnswer', 'vehicleCalendarAnswer', 'supportDeskDecide', 'employeeLoanAnswer', 'timeOffDecide',
        'myWorkIstApprove'])
    assert.deepEqual(actionCell(vehicleRow('vehicleCalendarAnswer'), opensNone),
      { kind: 'decide', itemId: 'VI00000000B2', approve: 'Approve', decline: 'Decline', action: 'vehicleCalendarAnswer' })
    // a client training approval carries one word: Approve alone, no Decline in its panel
    const ist = vehicleRow('myWorkIstApprove')
    assert.deepEqual(actionCell({ ...ist, action: { ...ist.action!, words: ['Approve'] } }, opensNone),
      { kind: 'decide', itemId: 'VI00000000B2', approve: 'Approve', decline: '', action: 'myWorkIstApprove' })
    // a client training row to book opens My Work's own panel, never Workforce Compliance
    assert.deepEqual(actionCell({ ...ist, action: { ...ist.action!, kind: 'book', label: 'Book training',
      item: { id: 'IST1', client: 'C', staff: 'S', house: 'H', due: '2026-11-01' } } }, opensNone),
    { kind: 'book', label: 'Book training', item: { id: 'IST1', client: 'C', staff: 'S', house: 'H', due: '2026-11-01' } })
    // a time off half opens My Work's own panel, whether or not Time Off is open to the reader: never a link to it
    assert.equal(actionCell(vehicleRow('timeOffDecide'), opensNone).kind, 'decide')
    assert.deepEqual(actionCell(vehicleRow('deleteEverything'), opensAll), { kind: 'words', text: 'Not open to you here.' })
    const html = draw(<ActionsCard view={view({ actions: { sources: [head('vehicle_calendar', 'Vehicle requests')], rows: [vehicleRow('dropTables')], note: '' } })}
      mass={false} opens={opensAll} onUpload={noop} />)
    assert.ok(html.includes('Not open to you here.') && !html.includes('data-decide='))
  })

  describe('a support request redirected to the account', () => {
    const supportRow = (over: Partial<ActionRow> = {}) => act('support_desk:SN00000000C1', {
      source: 'support_desk', due: '', due_tone: '', due_why: 'A support request carries no due day.',
      condition: 'Payroll from Angel Fiber', flow: 'Support Requests', phase: 'Redirected', family: 'decision', action_why: '',
      action: { label: 'Answer the request', kind: 'decide', app: 'support-desk', page: 'requests', href: '/app/my-work',
        certs: [], upload_for: '', item_id: 'SN00000000C1', words: ['Approve', 'Deny', 'Resolved', 'Redirect'],
        action: 'supportDeskDecide',
        item: { id: 'SN00000000C1', ref: 'HQ6EEF063DEE', title: 'Payroll from Angel Fiber', note: 'Redirected by Ty Bond: Please call her back' } },
      details: [{ label: 'Request', value: 'HQ6EEF063DEE' }, { label: 'Redirected', value: 'Redirected by Ty Bond: Please call her back' }],
      ...over,
    })

    it('rides the cell as a decide through supportDeskDecide, whatever the app\'s access, and names the request it opens', () => {
      const cell = actionCell(supportRow(), opensNone)
      assert.deepEqual(cell, { kind: 'decide', itemId: 'SN00000000C1', approve: 'Approve', decline: 'Deny', action: 'supportDeskDecide' })
      assert.equal(model.seatRefOf(supportRow(), cell), 'HQ6EEF063DEE')
      const bad = supportRow()
      bad.action = { ...bad.action!, item: { id: 'SN00000000C1', ref: '<script>' } }
      assert.equal(model.seatRefOf(bad, actionCell(bad, opensNone)), '', 'a ref of any other shape opens nothing')
      assert.equal(model.seatRefOf(vehicleRow('vehicleCalendarAnswer'), actionCell(vehicleRow('vehicleCalendarAnswer'), opensNone)), '')
    })

    it('opens Support Requests\' own right panel — never Scheduling\'s Approve / Decline — and the row decides nothing', () => {
      const v = view({ actions: { sources: [head('support_desk', 'Support Requests')], rows: [supportRow()], note: '' } })
      const list = draw(<ActionsCard view={v} mass={false} opens={opensNone} onUpload={noop} />)
      assert.ok(list.includes('data-decide-open="SN00000000C1"') && !list.includes('data-verdict'))
      const html = draw(<ActionsCard view={v} mass={false} opens={opensNone} onUpload={noop} initiallyDeciding="support_desk:SN00000000C1" />)
      assert.ok(html.includes('aria-label="HQ6EEF063DEE"') && html.includes('Payroll from Angel Fiber'), 'its panel, titled by the row while it is read')
      assert.ok(!html.includes('data-decision-panel') && !html.includes('aria-label="Approval"'))
      const page = readFileSync(resolve(ROOT, 'src/pages/features/mywork/MyWorkPage.tsx'), 'utf8')
      assert.match(page, /cell\.action === 'supportDeskDecide'/, 'Approve / Decline never answers a support request')
      assert.match(page, /onAnswered=\{\(\) => \{ if \(deciding\) settle\(deciding\.id\); setDeciding\(null\) \}\}/, 'an answer takes the row off')
    })

    it('an answer in its own panel takes the row off My Work like any other', () => {
      const h = mountHook(() => useDecide(), {})
      h.run(() => h.current.settle('support_desk:SN00000000C1'))
      assert.ok(h.current.answered.has('support_desk:SN00000000C1'))
      assert.deepEqual(unanswered([supportRow(), act('a2')], h.current.answered).map((r) => r.id), ['a2'])
      h.unmount()
    })
  })

  describe('the answer', () => {
    const realFetch = globalThis.fetch
    let sent: { action: string; payload: unknown }[] = []
    before(() => {
      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(decodeURIComponent(String(init?.body ?? '').replace(/^body=/, '')))
        sent.push({ action: String(body.action), payload: body.payload })
        return new Response(JSON.stringify({ status: 200, data: { ok: true, changed: true, said: 'Approved — the Van is reserved.', state: 'scheduled' } }))
      }) as typeof fetch
    })
    after(() => { globalThis.fetch = realFetch })
    afterEach(() => {
      sent = []
      useToastStore.setState({ toasts: [] })
    })

    it('Approve on a Transportation row calls vehicleCalendarAnswer with the item and the word', async () => {
      const h = mountHook(() => useDecide(), {})
      let done: Promise<boolean> | null = null
      h.run(() => { done = h.current.decide('vehicle_calendar:VI00000000B2', 'VI00000000B2', 'approve', '', 'vehicleCalendarAnswer') })
      assert.equal(await done, true)
      await h.settle(() => useToastStore.getState().toasts.length > 0)
      assert.deepEqual(sent, [{ action: 'vehicleCalendarAnswer', payload: { item_id: 'VI00000000B2', word: 'approve', note: '' } }])
      assert.equal(useToastStore.getState().toasts[0].body, 'Approved — the Van is reserved.')
      h.unmount()
    })

    it('a row with no action still answers Scheduling\'s door', async () => {
      const h = mountHook(() => useDecide(), {})
      let done: Promise<boolean> | null = null
      h.run(() => { done = h.current.decide('scheduling:SI00000000A1', 'SI00000000A1', 'decline', 'no cover') })
      assert.equal(await done, true)
      assert.equal(sent[0].action, 'schedulingAnswer')
      h.unmount()
    })
  })
})
