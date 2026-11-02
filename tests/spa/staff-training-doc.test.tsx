/**
 * STAFF · File training document: the Actions item next to Assign Training, the one right panel's mode, the course
 * picker by the catalogue's requirement id named with its Employee Database column, and the four certificate doors
 * — filed, then read by the decoder and the record read side by side, the date confirmed (and confirmed again against
 * what a 409 says the record holds), the record read again once it is written — answered here at `fetch` with each
 * door's envelope. A paper filed earlier is continued from, never filed again. The filed paper opens centred in the
 * platform's viewer, never in the panel.
 */
import { after, afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { usePlatformDoc } from '@/lib/platformDoc'
import { useFileViewerStore } from '@/stores/useFileViewerStore'
import { useToastStore } from '@/stores/useToastStore'
import StaffPanel from '@/pages/features/staffprofiles/StaffPanel'
import { ActionsMenu } from '@/pages/features/staffprofiles/StaffActions'
import {
  ACTION_GROUPS, FILE_DOC_LABEL, complianceOf, courseWords, filingCourses, kindWords, panelLabel, panelOf, panelParam, panelTitle,
  paperDay, paperOf, paperSeen, readRefusal, rosterOf, sharePayloadFor, waitingPapers, type StaffAsk, type StaffCompliance,
} from '@/pages/features/staffprofiles/staffModel'
import { forgetStaffReads, type ReadState } from '@/pages/features/staffprofiles/useStaffRead'
import { PaperChooser, PaperResult } from '@/pages/features/staffprofiles/TrainingDocForm'
import {
  HEIC_UNREAD, NEXT_PASS, PAPER_IDLE, openPaper, paperRefusal, paperWarning, useTrainingPaper, type PaperState,
} from '@/pages/features/staffprofiles/trainingPaper'
import { mountHook } from './react-host'

// motion mounts its projection nodes against the window; a panel drawn whole reaches them
for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))
const noop = () => {}

const ROW = rosterOf({ staff: [{ key: 'adamlaurent', name: 'Adam Laurent', status: 'active', role: 'DSP' }] }).staff[0]
const SHARE = sharePayloadFor(ROW, 'profile')
const FILE_ASK: StaffAsk = { kind: 'filedoc', course: '' }

/** The Compliance read as StaffProfiles.gs answers it now: each course and credential with where its paper files. */
const RAW_COMPLIANCE = {
  training: [
    { id: 'dodd', label: 'DODD 8-Hour', state: 'due_soon', expires: '2026-10-20',
      filing: { req_id: 'dodd', master_header: 'DODD 8-Hour Exp', date_role: 'expires', files: true, confirm_why: '' } },
    { id: 'cpr', label: 'CPR / First Aid', state: 'expired', expires: '2026-01-01',
      filing: { req_id: 'cpr', master_header: 'CPR Exp Date', date_role: 'expires', files: true, confirm_why: '' } },
    { id: 'med1', label: 'Med Delivery 1', state: 'no_date',
      filing: { req_id: 'med1', master_header: 'Med 1 Exp Date', date_role: 'expires', files: true,
                confirm_why: 'Med Delivery dates are written by the MAIS registry check, not here.' } },
    { id: 'money', label: 'Money Management', state: 'no_date',
      filing: { req_id: '', master_header: '', date_role: '', files: false, confirm_why: '' } },
  ],
  credentials: [
    { id: 'driver_license', label: "Driver's license", state: 'current', expires: '2027-06-30',
      filing: { req_id: 'driver_license', master_header: 'License Exp Date', date_role: 'expires', files: true, confirm_why: '' } },
    { id: 'nurse_aide', label: 'Nurse Aide / STNA', state: 'na',
      filing: { req_id: 'nurse_aide', master_header: '', date_role: '', files: false, confirm_why: 'HR records this one.' } },
  ],
}
const COMPLIANCE = complianceOf(RAW_COMPLIANCE)

const ready = (data: StaffCompliance): ReadState<StaffCompliance> => ({ status: 'ready', data, error: '', refreshing: false })
/** A picked file as the chooser reads it: its name, type and size. */
const fileLike = (name: string, type: string) => ({ name, type, size: 2048, lastModified: 0 }) as unknown as File

/* ---------- the action and the panel ---------- */

describe('the action and the panel', () => {
  it('"File training document" sits in the Performance group, next to Assign Training, and names a panel mode', () => {
    assert.deepEqual(ACTION_GROUPS[0].label, 'Performance')
    assert.deepEqual(ACTION_GROUPS[0].items.map((i) => i.label), ['New HR Issue', 'Add Note', 'Assign Training', FILE_DOC_LABEL])
    assert.equal(FILE_DOC_LABEL, 'File training document')
    const item = ACTION_GROUPS[0].items[3]
    assert.ok('ask' in item && item.ask.kind === 'filedoc')
    const menu = draw(<ActionsMenu favorite={false} onPick={noop} onFavorite={noop} />)
    assert.ok(menu.includes('data-action="filedoc"') && menu.includes('File training document'))
    for (const ask of [FILE_ASK, { kind: 'filedoc', course: 'cpr' }] as StaffAsk[]) {
      assert.deepEqual(panelOf(panelParam(ask)), ask, panelParam(ask))
    }
    assert.equal(panelParam({ kind: 'filedoc', course: 'cpr' }), 'filedoc~cpr')
    assert.equal(panelLabel(FILE_ASK), 'Training Document')
    assert.equal(panelTitle(FILE_ASK, 'Adam Laurent'), 'File training document · Adam Laurent')
  })

  it('the panel is the SidePanel aside — never a dialog — holding the course picker, the drop zone and Review draft', () => {
    const html = draw(<StaffPanel ask={FILE_ASK} row={ROW} share={SHARE} onClose={noop} />)
    assert.match(html, /<aside aria-label="Training Document"/)
    assert.ok(!html.includes('aria-modal') && !html.includes('role="dialog"'), 'no modal')
    assert.ok(html.includes('File training document · Adam Laurent'))
    assert.ok(html.includes('data-filedoc-form=""') && html.includes('data-filedoc-course=""'))
    assert.ok(html.includes('Drop the file here'), 'an image or a PDF is dropped or picked')
    assert.ok(html.includes('data-press="review"') && html.includes('Review draft'))
    assert.ok(html.includes('sm:w-[384px]') && !html.includes('xl:w-['), 'the standard width')
  })
})

/* ---------- the picker and the paper ---------- */

describe('the course picker and the paper', () => {
  it('the courses as Compliance lists them, then the credentials, by the catalogue\'s requirement id and named with the Master column', () => {
    const list = filingCourses(COMPLIANCE)
    assert.deepEqual(list.map((c) => [c.group, c.reqId, courseWords(c)]), [
      ['Training', 'dodd', 'DODD 8-Hour — DODD 8-Hour Exp'],
      ['Training', 'cpr', 'CPR / First Aid — CPR Exp Date'],
      ['Training', 'med1', 'Med Delivery 1 — Med 1 Exp Date'],
      ['Credentials', 'driver_license', "Driver's license — License Exp Date"],
    ], 'a course the catalogue does not file under and a registry check take no paper')
    assert.equal(list[2].confirmWhy, 'Med Delivery dates are written by the MAIS registry check, not here.')
    const older = filingCourses(complianceOf({ training: [{ id: 'cpr', label: 'CPR / First Aid', state: 'current', expires: '2027-01-01' }],
      credentials: [{ id: 'driver_license', label: "Driver's license", state: 'current' }] }))
    assert.deepEqual(older.map((c) => [c.reqId, courseWords(c)]), [['cpr', 'CPR / First Aid']],
      'an answer from before the filing keeps a course under its own id, never a credential')
    assert.deepEqual(filingCourses(null), [])
  })

  it('an image or a PDF up to 15MB — what the certificate door stores', () => {
    assert.equal(paperRefusal({ name: 'card.pdf', size: 10, type: 'application/pdf' }), '')
    assert.equal(paperRefusal({ name: 'card.JPG', size: 10, type: 'image/jpeg' }), '')
    assert.equal(paperRefusal({ name: 'photo.heic', size: 10, type: '' }), '', 'a phone photo the browser cannot name')
    assert.match(paperRefusal({ name: 'card.docx', size: 10, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      /nothing else is filed/)
    assert.match(paperRefusal({ name: 'page.svg', size: 10, type: 'image/svg+xml' }), /nothing else is filed/)
    assert.match(paperRefusal({ name: 'big.pdf', size: 16 * 1024 * 1024, type: 'application/pdf' }), /up to 15MB/)
    assert.equal(paperRefusal({ name: 'empty.pdf', size: 0, type: 'application/pdf' }), 'The file is empty.')
  })

  it('a HEIC photo is filed, and warned of before it is: the decoder reads no HEIC for its dates', () => {
    for (const f of [{ name: 'IMG_0412.HEIC', type: '' }, { name: 'card', type: 'image/heic' }, { name: 'card.heif', type: 'image/heif' }]) {
      assert.equal(paperWarning(f), HEIC_UNREAD, f.name)
    }
    assert.equal(paperWarning({ name: 'card.jpg', type: 'image/jpeg' }), '')
    assert.equal(paperWarning({ name: 'card.pdf', type: 'application/pdf' }), '')
    const html = draw(<PaperChooser name="Adam Laurent" compliance={ready(COMPLIANCE)} onRetry={noop} courses={filingCourses(COMPLIANCE)}
      course={filingCourses(COMPLIANCE)[1]} onCourse={noop} paper={fileLike('IMG_0412.HEIC', '')} refused=""
      onPick={noop} onClear={noop} armed={false} busy={false} error="" onFile={noop} onDisarm={noop} onCancel={noop} />)
    assert.ok(html.includes('data-filedoc-heic=""') && html.includes('the decoder cannot read it for its dates'))
  })

  it('the reading\'s kind in the decoder\'s own words, else its key spelled out', () => {
    assert.equal(kindWords(paperOf({ read_kind: 'cpr_first_aid', read_kind_words: 'CPR / First Aid card' })), 'CPR / First Aid card')
    assert.equal(kindWords(paperOf({ read_kind: 'tb_test_result' })), 'Tb test result')
    assert.equal(kindWords(paperOf({})), '')
  })

  it('the papers filed and not yet confirmed are offered to continue from — only under a course confirmed here', () => {
    const c = complianceOf({ ...RAW_COMPLIANCE, papers: [
      { id: 'UP9', person: 'Adam Laurent', cert: 'CPR / First Aid', name: 'cpr-card.jpg', at: '2026-09-28T14:00:00Z', req_id: 'cpr',
        read_state: 'read' },
      { id: 'UP8', person: 'Adam Laurent', cert: 'Med Delivery 1', name: 'med.pdf', at: '2026-09-27T14:00:00Z', req_id: 'med1' },
      { id: 'UP7', person: 'Adam Laurent', cert: 'Money Management', name: 'money.pdf', at: '2026-09-26T14:00:00Z', req_id: 'money' },
      { id: '', person: 'Adam Laurent', cert: 'CPR / First Aid', name: 'no-id.jpg', req_id: 'cpr' },
    ] })
    const courses = filingCourses(c)
    const waiting = waitingPapers(c.papers, courses)
    assert.deepEqual(waiting.map((w) => [w.paper.id, w.course.reqId]), [['UP9', 'cpr']],
      'a Med Delivery paper has no confirmation here, and a course the catalogue does not file takes none')
    assert.deepEqual(waitingPapers(COMPLIANCE.papers, filingCourses(COMPLIANCE)), [], 'an answer with no papers offers none')
    const html = draw(<PaperChooser name="Adam Laurent" compliance={ready(c)} onRetry={noop} courses={courses} course={null}
      waiting={waiting} onResume={noop} onCourse={noop} paper={null} refused="" onPick={noop} onClear={noop} armed={false}
      busy={false} error="" onFile={noop} onDisarm={noop} onCancel={noop} />)
    assert.ok(html.includes('data-filedoc-waiting=""') && html.includes('Filed, waiting for a confirmed date'))
    assert.ok(html.includes('data-resume-paper="UP9"') && html.includes('cpr-card.jpg') && html.includes('Continue'))
    assert.ok(!html.includes('data-resume-paper="UP8"'))
  })

  it('a picker with no course says why, and the button says it is filing while the file is sent', () => {
    const none = complianceOf({ ...RAW_COMPLIANCE, training: [{ id: 'cpr', label: 'CPR / First Aid', state: 'expired',
      filing: { req_id: '', master_header: '', date_role: '', files: false, confirm_why: '' } }], credentials: [],
    why: 'the requirements catalogue could not be read (Sheets answered 500)', degraded: true })
    const html = draw(<PaperChooser name="Adam Laurent" compliance={ready(none)} onRetry={noop} courses={filingCourses(none)}
      course={null} onCourse={noop} paper={null} refused="" onPick={noop} onClear={noop} armed={false} busy={false} error=""
      onFile={noop} onDisarm={noop} onCancel={noop} />)
    assert.ok(html.includes('data-filedoc-none=""') &&
      html.includes('No course here takes a paper: the requirements catalogue could not be read (Sheets answered 500).'))
    const cpr = filingCourses(COMPLIANCE)[1]
    const busy = draw(<PaperChooser name="Adam Laurent" compliance={ready(COMPLIANCE)} onRetry={noop} courses={filingCourses(COMPLIANCE)}
      course={cpr} onCourse={noop} paper={fileLike('cpr.pdf', 'application/pdf')} refused="" onPick={noop}
      onClear={noop} armed={false} busy error="" onFile={noop} onDisarm={noop} onCancel={noop} />)
    const button = /<button[^>]*data-press="review"[^>]*>.*?<\/button>/.exec(busy)?.[0] ?? ''
    assert.ok(/\sdisabled=""/.test(button) && button.includes('Filing…') && !button.includes('Review draft'), button)
    assert.ok(!draw(<PaperChooser name="Adam Laurent" compliance={ready(COMPLIANCE)} onRetry={noop} courses={filingCourses(COMPLIANCE)}
      course={null} onCourse={noop} paper={null} refused="" onPick={noop} onClear={noop} armed={false} busy={false} error=""
      onFile={noop} onDisarm={noop} onCancel={noop} />).includes('data-filedoc-none'), 'a picker with courses says nothing')
  })

  it('the date written is the settled reading\'s — its expiry, or the paper\'s own day for a record that keeps it', () => {
    const read = paperOf({ id: 'UP9', read_state: 'read', issued_on: '2026-04-17', expires_on: '2028-04-17', read_confidence: 93 })
    assert.equal(paperDay(read, 'expires'), '2028-04-17')
    assert.equal(paperDay(read, 'issued'), '2026-04-17')
    assert.equal(paperDay(read, ''), '2028-04-17')
    const unsure = paperOf({ id: 'UP9', read_state: 'unread', expires_on: '2028-04-17', read_why: 'not sure enough' })
    assert.equal(paperDay(unsure, 'expires'), '', 'an unsettled reading fills in nothing')
    assert.equal(paperSeen(unsure, 'expires'), '2028-04-17', '…and is offered instead')
    assert.equal(paperDay(null, 'expires'), '')
  })
})

/* ---------- the four doors ---------- */

type Env = { status: number; data?: unknown; message?: string }

describe('the four doors, in order', () => {
  const realFetch = globalThis.fetch
  let calls: { action: string; payload: Record<string, unknown> }[] = []
  let answer: (action: string, payload: Record<string, unknown>) => Env | Promise<Env> = () => ({ status: 200, data: {} })
  before(() => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      let env: { action?: string; payload?: Record<string, unknown> } = {}
      try { env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) } catch { env = {} }
      // a write's stale-copy notice (the slices certUploadConfirm invalidates) is not a door
      if (!env.action) return new Response('{}')
      calls.push({ action: env.action, payload: env.payload ?? {} })
      return new Response(JSON.stringify(await answer(env.action, env.payload ?? {})))
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })
  afterEach(() => {
    calls = []
    answer = () => ({ status: 200, data: {} })
    forgetStaffReads()
    useFileViewerStore.getState().closeFile()
    useToastStore.setState({ toasts: [] })
  })

  const FILED = { id: 'UP9', person: 'Adam Laurent', cert: 'CPR / First Aid', name: 'cpr-card.jpg', req_id: 'cpr', read_state: 'pending' }
  const READ = { ...FILED, read_state: 'read', read_kind: 'cpr_first_aid', issued_on: '2026-04-17', expires_on: '2028-04-17',
    read_confidence: 93, read_why: '' }
  const RECORD = { id: 'UP9', person: 'Adam Laurent', req_id: 'cpr', date_source: 'CPR Exp Date', date_role: 'expires',
    record: '2026-01-01', record_why: '', confirm: { allowed: true, why: '' } }
  const doors = (over: Record<string, (p: Record<string, unknown>) => Env | Promise<Env>> = {}) =>
    (action: string, payload: Record<string, unknown>): Env | Promise<Env> => {
    if (over[action]) return over[action](payload)
    if (action === 'certDocUpload') return { status: 200, data: FILED }
    if (action === 'certDocRead') return { status: 200, data: READ }
    if (action === 'certUploadRecord') return { status: 200, data: RECORD }
    if (action === 'certUploadConfirm') {
      return { status: 200, data: { id: 'UP9', req_id: 'cpr', date_source: 'CPR Exp Date', confirmed_on: payload.date,
        message: `The record now holds ${String(payload.date)}; the status follows at the next check.` } }
    }
    return { status: 404, message: 'Unknown action.' }
  }
  const PAPER = { filename: 'cpr-card.jpg', mime: 'image/jpeg', base64: 'QUJD' }
  const mount = () => mountHook((p: { key: string; name: string }) => useTrainingPaper(p), { key: ROW.key, name: ROW.name })
  /** Both reads a filed paper starts have answered. */
  const settled = (s: PaperState) => s.phase === 'ready' && s.record.status === 'ready'
  const result = (state: PaperState, date = '2028-04-17') => draw(<PaperResult name="Adam Laurent" course={null} state={state}
    role="expires" date={date} onDate={noop} onReadAgain={noop} onReadRecord={noop} onConfirm={noop} onOpen={noop} opening={false}
    onDone={noop} />)
  /** A door held open until the test lets it answer. */
  const held = () => {
    let open: () => void = () => {}
    const gate = new Promise<void>((r) => { open = r })
    return { gate, open: () => open() }
  }

  it('certDocUpload, then certDocRead and certUploadRecord, then certUploadConfirm, each with the payload the door reads', async () => {
    // the Master keeps a confirmed day as a date cell, answered back as an instant
    let written = ''
    answer = doors({
      certUploadRecord: () => ({ status: 200, data: { ...RECORD, record: written || RECORD.record } }),
      certUploadConfirm: (p) => {
        written = `${String(p.date)}T04:00:00.000Z`
        return { status: 200, data: { id: 'UP9', req_id: 'cpr', confirmed_on: p.date,
          message: `The record now holds ${String(p.date)}; the status follows at the next check.` } }
      },
    })
    const h = mount()
    h.run(() => { void h.current.file('cpr', PAPER) })
    assert.equal(h.current.state.phase, 'filing')
    await h.settle(() => settled(h.current.state))
    const s = h.current.state
    assert.deepEqual([s.phase, s.filed?.id, s.reading?.readState, s.waiting, s.record.value, s.record.dateSource],
      ['ready', 'UP9', 'read', '', '2026-01-01', 'CPR Exp Date'])
    assert.equal(paperDay(s.reading, s.record.dateRole), '2028-04-17', 'the expiry read is the date offered')
    h.run(() => { void h.current.confirm('2028-04-17') })
    await h.settle(() => !!h.current.state.confirmedOn && h.current.state.record.status === 'ready')
    assert.deepEqual(calls.map((c) => [c.action, c.payload]), [
      ['certDocUpload', { person: 'Adam Laurent', req_id: 'cpr', filename: 'cpr-card.jpg', mime: 'image/jpeg', base64: 'QUJD' }],
      ['certDocRead', { id: 'UP9' }],
      ['certUploadRecord', { id: 'UP9' }],
      ['certUploadConfirm', { id: 'UP9', date: '2028-04-17', expected: '2026-01-01' }],
      ['certUploadRecord', { id: 'UP9' }],
    ], 'the record is read again once it is written')
    const done = h.current.state
    assert.deepEqual([done.confirmedOn, done.record.value, done.said?.tone], ['2028-04-17', '2028-04-17T04:00:00.000Z', 'success'],
      'what the record holds is what it answers, never the day that was sent')
    assert.match(done.said?.text ?? '', /The record now holds 2028-04-17/)
    const drawn = result(done)
    assert.ok(drawn.includes('Holds now: Apr 17, 2028') && !drawn.includes('T04:00'), 'an instant is drawn as its day')
    h.run(() => { void h.current.confirm('2028-04-18') })
    await h.settle(() => calls.filter((c) => c.action === 'certUploadConfirm').length === 2 && !h.current.state.confirming)
    assert.deepEqual(calls.filter((c) => c.action === 'certUploadConfirm')[1].payload,
      { id: 'UP9', date: '2028-04-18', expected: '2028-04-17T04:00:00.000Z' }, 'a second confirmation carries the record\'s own witness')
    assert.equal(h.current.state.said?.tone, 'success')
    h.unmount()
  })

  it('the record is read beside the decoder: the date can be typed while a reading still takes its minutes', async () => {
    const reading = held()
    answer = doors({ certDocRead: async () => { await reading.gate; return { status: 200, data: READ } } })
    const h = mount()
    h.run(() => { void h.current.file('cpr', PAPER) })
    await h.settle(() => h.current.state.record.status === 'ready')
    const mid = h.current.state
    assert.deepEqual([mid.phase, mid.record.value, mid.record.allowed], ['reading', '2026-01-01', true])
    const drawn = result(mid)
    assert.ok(drawn.includes('Reading the dates…') && drawn.includes('data-confirm-date=""') && drawn.includes('data-confirm-paper=""'))
    reading.open()
    await h.settle(() => settled(h.current.state))
    assert.equal(h.current.state.reading?.readState, 'read')
    h.unmount()
  })

  it('a record that could not be read is read again from the panel — the paper already filed is not filed again', async () => {
    let records = 0
    answer = doors({
      certUploadRecord: () => (++records === 1 ? { status: 503, message: 'The requirements catalogue could not be read just now — nothing was written.' }
        : { status: 200, data: RECORD }),
    })
    const h = mount()
    h.run(() => { void h.current.file('cpr', PAPER) })
    await h.settle(() => h.current.state.phase === 'ready' && h.current.state.record.status === 'failed')
    const failed = h.current.state
    const drawn = result(failed)
    assert.ok(drawn.includes('Holds now: could not be read') && drawn.includes('data-read-record=""') &&
      drawn.includes('Read the record again') && !drawn.includes('data-confirm-paper'))
    h.run(() => h.current.reloadRecord())
    await h.settle(() => h.current.state.record.status === 'ready')
    assert.equal(h.current.state.record.value, '2026-01-01')
    assert.deepEqual(calls.map((c) => c.action), ['certDocUpload', 'certDocRead', 'certUploadRecord', 'certUploadRecord'])
    h.unmount()
  })

  it('a paper filed earlier is continued from: read and its record read, never filed again', async () => {
    answer = doors()
    const h = mount()
    const earlier = paperOf({ id: 'UP5', person: 'Adam Laurent', cert: 'CPR / First Aid', name: 'cpr-old.jpg', req_id: 'cpr',
      at: '2026-09-20T10:00:00Z', read_state: 'read' })
    h.run(() => { void h.current.resume(earlier) })
    assert.deepEqual([h.current.state.phase, h.current.state.filed?.id], ['reading', 'UP5'])
    await h.settle(() => settled(h.current.state))
    assert.deepEqual(calls.map((c) => [c.action, c.payload]), [['certDocRead', { id: 'UP5' }], ['certUploadRecord', { id: 'UP5' }]])
    h.run(() => { void h.current.confirm('2028-04-17') })
    await h.settle(() => !!h.current.state.confirmedOn)
    assert.deepEqual(calls.filter((c) => c.action === 'certUploadConfirm').map((c) => c.payload),
      [{ id: 'UP5', date: '2028-04-17', expected: '2026-01-01' }])
    assert.ok(!calls.some((c) => c.action === 'certDocUpload'))
    h.unmount()
  })

  it('a 409 shows what the record holds now, and the next confirmation is checked against it', async () => {
    let tries = 0
    answer = doors({
      certUploadConfirm: (p) => (++tries === 1
        ? { status: 409, message: 'The record now holds "2027-02-02", not what was shown — nothing was written.', data: { current: '2027-02-02' } }
        : { status: 200, data: { confirmed_on: p.date, message: `The record now holds ${String(p.date)}.` } }),
    })
    const h = mount()
    h.run(() => { void h.current.file('cpr', PAPER) })
    await h.settle(() => settled(h.current.state))
    h.run(() => { void h.current.confirm('2028-04-17') })
    await h.settle(() => h.current.state.said !== null)
    const moved = h.current.state
    assert.deepEqual([moved.moved, moved.record.value, moved.said?.tone, moved.confirmedOn], ['2027-02-02', '2027-02-02', 'danger', ''])
    const drawn = result(moved)
    assert.ok(drawn.includes('Holds now: Feb 02, 2027') && drawn.includes('data-record-moved=""'))
    assert.ok(drawn.includes('The record changed to “Feb 02, 2027”') && drawn.includes('Confirm against “Feb 02, 2027”'))
    const instant = result({ ...moved, moved: '2027-02-02T05:00:00.000Z', record: { ...moved.record, value: '2027-02-02T05:00:00.000Z' } })
    assert.ok(instant.includes('Confirm against “Feb 2, 2027”') && !instant.includes('T05:00'),
      'a date cell the record answers as an instant is drawn as its day, never the raw instant')
    h.run(() => { void h.current.confirm('2028-04-17') })
    await h.settle(() => !!h.current.state.confirmedOn)
    const confirms = calls.filter((c) => c.action === 'certUploadConfirm').map((c) => c.payload)
    assert.deepEqual(confirms, [{ id: 'UP9', date: '2028-04-17', expected: '2026-01-01' }, { id: 'UP9', date: '2028-04-17', expected: '2027-02-02' }])
    assert.equal(h.current.state.moved, null)
    h.unmount()
  })

  it('a reading that waits for the next pass says so; Read again asks the decoder again; the record is still shown', async () => {
    let reads = 0
    answer = doors({
      certDocRead: () => (++reads === 1
        ? { status: 200, data: { ...FILED, read_why: 'The file could not be read just now — it is read again within minutes.' } }
        : { status: 200, data: READ }),
    })
    const h = mount()
    h.run(() => { void h.current.file('cpr', PAPER) })
    await h.settle(() => settled(h.current.state))
    const waiting = h.current.state
    assert.equal(waiting.waiting, 'The file could not be read just now — it is read again within minutes.')
    assert.equal(waiting.record.allowed, true, 'the date can still be typed from the paper')
    const drawn = result(waiting, '')
    assert.ok(drawn.includes(NEXT_PASS.slice(0, 40)) && drawn.includes('data-read-again=""'))
    h.run(() => h.current.readAgain())
    await h.settle(() => h.current.state.reading?.readState === 'read')
    assert.deepEqual(calls.map((c) => c.action), ['certDocUpload', 'certDocRead', 'certUploadRecord', 'certDocRead'])
    assert.equal(h.current.state.waiting, '')
    h.unmount()
  })

  it('a door that fails while reading waits for the next pass in its own words', async () => {
    answer = doors({ certDocRead: () => ({ status: 503, message: 'The reading could not be kept on the ledger just now — the document is read again within minutes.' }) })
    const h = mount()
    h.run(() => { void h.current.file('cpr', PAPER) })
    await h.settle(() => settled(h.current.state))
    assert.match(h.current.state.waiting, /^The dates could not be read just now: The reading could not be kept on the ledger/)
    h.unmount()
  })

  it('a refused filing files nothing and reads nothing, and says why', async () => {
    answer = doors({ certDocUpload: () => ({ status: 400, message: 'HR records this one. Nothing was filed.' }) })
    const h = mount()
    h.run(() => { void h.current.file('sam', PAPER) })
    await h.settle(() => h.current.state.phase === 'idle' && !!h.current.state.error)
    assert.equal(h.current.state.error, 'HR records this one. Nothing was filed.')
    assert.deepEqual(calls.map((c) => c.action), ['certDocUpload'])
    h.unmount()
  })

  it('the filed paper opens centred in the platform\'s viewer from certDocFile\'s bytes — never in the panel', async () => {
    answer = (action) => (action === 'certDocFile'
      ? { status: 200, data: { id: 'UP9', name: 'cpr-card.pdf', mime: 'application/pdf', size: 4, b64: 'JVBERg==' } }
      : { status: 404, message: 'Unknown action.' })
    const h = mountHook(() => usePlatformDoc(readRefusal), {})
    h.run(() => openPaper(h.current, 'UP9', { title: 'CPR / First Aid', subtitle: 'Adam Laurent · filed document' }))
    await h.settle(() => !!useFileViewerStore.getState().file && h.current.opening === '')
    const f = useFileViewerStore.getState().file
    assert.match(f?.url ?? '', /^blob:/)
    assert.deepEqual([f?.title, f?.subtitle], ['CPR / First Aid', 'Adam Laurent · filed document'])
    assert.deepEqual(calls.map((c) => [c.action, c.payload]), [['certDocFile', { id: 'UP9' }]])
    h.unmount()
  })
})

/* ---------- the result, drawn ---------- */

describe('the result in the panel', () => {
  const filed = paperOf({ id: 'UP9', person: 'Adam Laurent', cert: 'CPR / First Aid', name: 'cpr-card.jpg', read_state: 'pending' })
  const base: PaperState = { ...PAPER_IDLE, filed, phase: 'ready' }
  const result = (state: PaperState, date = '') => draw(<PaperResult name="Adam Laurent" course={null} state={state} role="expires"
    date={date} onDate={noop} onReadAgain={noop} onReadRecord={noop} onConfirm={noop} onOpen={noop} opening={false} onDone={noop} />)

  it('"Reading the dates…" while the decoder reads', () => {
    const html = result({ ...base, phase: 'reading' })
    assert.ok(html.includes('Reading the dates…') && html.includes('data-paper-reading="reading"'))
    assert.ok(html.includes('data-open-paper=""') && html.includes('View document'))
  })

  it('the reading, the record and the date to confirm, prefilled and editable', () => {
    const reading = paperOf({ id: 'UP9', person: 'Adam Laurent', cert: 'CPR / First Aid', name: 'cpr-card.jpg', read_state: 'read',
      read_kind: 'cpr_first_aid', read_kind_words: 'CPR / First Aid card', issued_on: '2026-04-17', expires_on: '2028-04-17',
      read_confidence: 93 })
    const html = result({ ...base, reading, record: { status: 'ready', dateSource: 'CPR Exp Date', dateRole: 'expires', value: '2026-01-01',
      why: '', allowed: true } }, '2028-04-17')
    assert.ok(html.includes('data-paper-reading="read"') && html.includes('data-paper-kind="">CPR / First Aid card'))
    assert.ok(html.includes('data-paper-confidence="">93 of 100'))
    assert.ok(html.includes('Employee Database · CPR Exp Date') && html.includes('Holds now: Jan 01, 2026'))
    assert.ok(!html.includes('data-read-record'), 'a record that was read offers no second read')
    assert.match(html, /<input type="date"[^>]*data-confirm-date=""[^>]*value="2028-04-17"/)
    assert.ok(html.includes('Expiry date') && html.includes('Confirm this date'))
    const button = /<button[^>]*data-confirm-paper=""[^>]*>/.exec(html)?.[0] ?? ''
    assert.ok(button && !/\sdisabled=""/.test(button), 'the button is live')
    const typedNothing = result({ ...base, reading, record: { status: 'ready', dateSource: 'CPR Exp Date', dateRole: 'expires',
      value: '2026-01-01', why: '', allowed: true } }, '')
    assert.match(/<button[^>]*data-confirm-paper=""[^>]*>/.exec(typedNothing)?.[0] ?? '', /\sdisabled=""/, 'no day, no confirmation')
  })

  it('a requirement whose date is not confirmed here says why, and offers no confirmation', () => {
    const html = result({ ...base, record: { status: 'ready', dateSource: 'Med 1 Exp Date', dateRole: 'expires', value: '', allowed: false,
      why: 'Med Delivery dates are written by the MAIS registry check, not here.' } })
    assert.ok(html.includes('Med Delivery dates are written by the MAIS registry check, not here.'))
    assert.ok(!html.includes('data-confirm-paper'))
  })
})
