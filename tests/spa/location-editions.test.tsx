/**
 * LOCATIONS · THE EDITIONS — each edit control drawn only for the viewer whose edition it is (Settings → Editions), and
 * every edition's Apply followed by the strip that says where the write landed: each step marked only when its
 * server said so, a refusal's words in the panel, and the page read again after the write.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import type { HouseRow } from '@/pages/features/houses/houseModel'
import { QUEUED_WORDS } from '@/lib/readCache'
import {
  APPLY_IDLE, appliedEverywhere, applySummary, overlayOf, runApply, serverSteps, type ApplyDeps, type ApplyState,
  type SheetSettled,
} from '@/pages/features/locations/locationApply'
import ApplyStrip from '@/pages/features/locations/ApplyStrip'
import { LocationViewerContext, viewerCan, type LocationViewer, type ReadState } from '@/pages/features/locations/useLocation'
import { ActionsMenu } from '@/pages/features/locations/LocationActions'
import LocationPanel from '@/pages/features/locations/LocationPanel'
import { DocumentsView } from '@/pages/features/locations/tabs/Documents'
import { StaffView } from '@/pages/features/locations/tabs/Staff'
import { OverviewView } from '@/pages/features/locations/tabs/Overview'
import { SuppliesView } from '@/pages/features/locations/tabs/Supplies'
import { addableClients, clientIdentity } from '@/pages/features/locations/locationLanes'
import { SHELL_SHOWN, primeShellHides } from '@/lib/myWorkHides'

// the parts Settings › My Work can hide are drawn as the master's own session sees them
primeShellHides(SHELL_SHOWN)
import {
  NOT_OPEN, actionGroupsFor, assetDraft, assetEditFields, documentsOf, driveLinkProblem, houseDocProblem, houseDocuments,
  houseOwnDoc, housePhotoProblem, notesOf, overviewOf, panelOf, panelParam, panelTitle, sharePayloadFor, staffOf, suppliesOf,
  type PanelAsk,
} from '@/pages/features/locations/locationModel'

// motion mounts its projection nodes against the window; a panel drawn whole reaches them
for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))
const as = (viewer: LocationViewer, node: ReactNode) =>
  draw(<LocationViewerContext.Provider value={viewer}>{node}</LocationViewerContext.Provider>)
const noop = () => {}
const ready = <T,>(data: T): ReadState<T> => ({ status: 'ready', data, error: '', refreshing: false })
const who = (editions: LocationViewer['editions']): LocationViewer => ({ writes: false, cut: false, editions })

const H: HouseRow = {
  id: 'NW4045', code: 'NW4045', label: 'CAN - NW - NW4045', title: 'Arlington', city: 'Canton', active: true,
  address: '908 Arlington Ave NW, Canton, OH 44708', photo: { src: '', source: '' }, managers: [], leads: [],
  clients: [{ name: 'Kenny Marsh', client_id: 'C1', client_key: 'kennymarsh' }], client_count: 1, staff: [], staff_source: '',
  week_notes: [], sources: [],
  policies: [{ title: 'Company Policies', url: 'https://drive.google.com/file/d/policy0xxxxx/view', audience: 'all' }],
}

/* ---------- the Apply run ---------- */

const ANSWER = {
  incident: { id: 'r9' },
  steps: [{ id: 'sheet', label: 'Sheet', landed: true, words: 'A new row on the estate\'s UIs and MUIs sheet.' },
          { id: 'cache', label: 'Kept caches', landed: true, words: 'The house\'s incidents, read again.' }],
  slices: ['uiIncidents'], mirror: [], app: 'locations',
}

const OVERLAID = {
  written: ['region'], refused: [],
  steps: [{ id: 'json', label: 'JSON overlay', landed: true, words: 'Laid on the relay\'s JSON overlay and into houses.' }],
  slices: [], mirror: [], app: 'locations',
  overlay: { ids: ['Eabc'], ahead: 2, slices: ['houses'], per_min: 40, at: '2026-10-07T15:00:00.000Z' },
}

function deps(over: Partial<ApplyDeps> & { heard?: ApplyDeps['heard'] } = {}): ApplyDeps {
  return {
    heard: async (name) => name === 'app:locations' || name === 'uiIncidents',
    notify: async (names) => names,
    live: () => true,
    now: () => Date.parse('2026-10-07T15:00:00Z'),
    ...over,
  }
}

async function run(send: () => Promise<unknown>, d: ApplyDeps = deps(), reread: () => Promise<unknown> = async () => [])
  : Promise<{ got: unknown; seen: ApplyState[]; last: ApplyState; asked: number }> {
  const seen: ApplyState[] = []
  let asked = 0
  const got = await runApply({ send, reread: async () => { asked++; return reread() }, onState: (s) => seen.push(s), deps: d })
  return { got, seen, last: seen[seen.length - 1], asked }
}

const states = (s: ApplyState) => s.steps.map((x) => `${x.id}:${x.state}`).join(' ')

describe('an edition\'s Apply', () => {
  it('runs through every place the write lands, marking each only as its server answers, then says done', async () => {
    const { got, seen, last, asked } = await run(async () => ANSWER)
    assert.deepEqual(got, { answer: ANSWER })
    assert.equal(states(last), 'sheet:landed cache:landed slices:landed ring:landed page:landed')
    assert.equal(last.phase, 'done')
    assert.ok(appliedEverywhere(last))
    assert.equal(applySummary(last), 'Applied everywhere this page reads.')
    assert.equal(asked, 1, 'the page is read again once')
    assert.ok(seen.some((s) => s.phase === 'running' && s.steps.some((x) => x.state === 'running')), 'the strip moves while it waits')
    assert.match(last.steps[0].words, /UIs and MUIs/, 'the door\'s own words')
    assert.match(last.steps[2].words, /Rebuilt: uiIncidents/)
  })

  it('a refusal stops the run with its words, and no later step is ever claimed', async () => {
    const { got, last, asked } = await run(async () => { throw new Error('Somebody else wrote this note. Nothing was written.') })
    assert.deepEqual(got, { refusal: 'Somebody else wrote this note. Nothing was written.' })
    assert.equal(last.phase, 'refused')
    assert.equal(states(last), 'sheet:failed cache:waiting slices:waiting ring:waiting page:waiting')
    assert.equal(last.refusal, 'Somebody else wrote this note. Nothing was written.')
    assert.equal(asked, 0)
    assert.equal(applySummary(last), 'Not applied.')
  })

  it('an engine older than the screen: the sheet holds it, the caches are owed — never claimed', async () => {
    const { last } = await run(async () => ({ written: ['details'], refused: [] }))
    assert.equal(states(last), 'sheet:landed cache:owed slices:skipped ring:landed page:landed')
    assert.ok(!appliedEverywhere(last))
    assert.match(applySummary(last), /kept caches is still on the way/)
  })

  it('no ring heard, a closed live line, a slice queued but not rebuilt, one the relay did not take: each owed, with why', async () => {
    const d = deps({
      heard: async () => false,
      live: () => false,
      notify: async (names) => names.filter((n) => n === 'clients'),
    })
    const { last } = await run(async () => ({ ...ANSWER, slices: ['clients', 'houses_x'], mirror: ['houses'] }), d)
    assert.equal(states(last), 'sheet:landed cache:landed slices:owed ring:owed page:landed')
    assert.match(last.steps[3].words, /live line is closed/)
    assert.match(last.steps[2].words, /Queued, not rebuilt yet: clients/)
    assert.match(last.steps[2].words, /did not take: houses_x/)
    assert.match(last.steps[2].words, /the houses list is built from the mirror's copy/)
  })

  it('a change only the mirror carries says so; a change no slice carries says that', async () => {
    const mirror = await run(async () => ({ ...ANSWER, slices: [], mirror: ['houses'] }))
    assert.equal(mirror.last.steps[2].state, 'owed')
    assert.match(mirror.last.steps[2].words, /follows on its next pass/)
    const none = await run(async () => ({ ...ANSWER, slices: [] }))
    assert.equal(none.last.steps[2].state, 'skipped')
  })

  it('a write the relay\'s ledger holds is owed, not landed; a page that could not be read again is said', async () => {
    const queued = await run(async () => ({ accepted: true, queued: true }))
    assert.equal(states(queued.last), 'sheet:owed cache:owed slices:owed ring:landed page:landed')
    assert.equal(queued.last.steps[0].words, QUEUED_WORDS)
    const failed = await run(async () => ANSWER, deps(), async () => { throw new Error('the relay is restarting') })
    assert.equal(failed.last.steps[4].state, 'failed')
    assert.match(failed.last.steps[4].words, /the relay is restarting/)
  })

  it('an edit the relay\'s overlay took: JSON, slices, ring and page at once; the sheet queued, then written', async () => {
    const hold: { tell?: (id: string, s: SheetSettled) => void; stops: number } = { stops: 0 }
    const refetched: string[][] = []
    const d = deps({
      refetch: async (names) => { refetched.push(names) },
      settled: (_ids, fn) => { hold.tell = fn; return () => { hold.stops++ } },
    })
    const seen: ApplyState[] = []
    let kept: (() => void) | null = null
    const got = await runApply({ send: async () => OVERLAID, reread: async () => [], onState: (s) => seen.push(s), deps: d,
      keep: (stop) => { kept = stop } })
    let last = seen[seen.length - 1]
    assert.deepEqual(got, { answer: OVERLAID })
    assert.equal(states(last), 'json:landed cache:landed slices:landed ring:landed page:landed sheet:owed')
    assert.equal(last.phase, 'done', 'the panel may close once the JSON holds it')
    assert.match(last.steps[5].words, /^Queued \(2 ahead\).*40 writes a minute/)
    assert.equal(applySummary(last), 'Applied — every read shows it now; the sheet write is queued.')
    assert.deepEqual(refetched, [['houses']])
    assert.ok(kept, 'the page holds the listener, to end it with the strip')
    hold.tell?.('Eabc', { state: 'written', words: '' })
    last = seen[seen.length - 1]
    assert.equal(last.steps[5].state, 'landed')
    assert.match(last.steps[5].words, /^Written to the sheet at/)
    assert.ok(appliedEverywhere(last))
    assert.equal(overlayOf(ANSWER), null, 'a door\'s own answer is not the overlay\'s')
  })

  it('a queued edit the platform refuses later: the strip turns to the server\'s words, whichever comes first', async () => {
    const hold: { tell?: (id: string, s: SheetSettled) => void } = {}
    const later: SheetSettled[] = []
    const seen: ApplyState[] = []
    await runApply({ send: async () => OVERLAID, reread: async () => [], onState: (s) => seen.push(s),
      deps: deps({ refetch: async () => {}, settled: (_ids, fn) => { hold.tell = fn; return () => {} } }),
      later: (s) => later.push(s) })
    const words = 'validation 409: That house row has changed since it was opened — reload the house.'
    hold.tell?.('Eabc', { state: 'refused', words })
    hold.tell?.('Eabc', { state: 'refused', words: '' })
    const last = seen[seen.length - 1]
    assert.equal(last.phase, 'refused')
    assert.equal(last.refusal, words, 'a bare frame after the words never wipes them')
    assert.equal(last.steps[5].state, 'failed')
    assert.equal(applySummary(last), 'Not applied.')
    assert.equal(later.length, 2)
    const html = draw(<ApplyStrip state={last} onAgain={noop} />)
    assert.match(html, /data-apply-refusal="">validation 409: That house row has changed/)
  })

  it('reads the door\'s own steps; anything else says nothing', () => {
    assert.deepEqual(serverSteps(ANSWER).steps.map((s) => s.id), ['sheet', 'cache'])
    assert.deepEqual(serverSteps({ written: [] }), { steps: [], slices: [], mirror: [], app: '' })
    assert.deepEqual(serverSteps(null).slices, [])
  })

  it('the strip: a bar that moves, each step with its word, Done once it is over, the refusal\'s words — never a dialog', async () => {
    assert.equal(draw(<ApplyStrip state={APPLY_IDLE} />), '')
    const { seen, last } = await run(async () => ANSWER)
    const moving = draw(<ApplyStrip state={seen.find((s) => s.steps.some((x) => x.state === 'running'))!} onDone={noop} />)
    assert.match(moving, /data-apply-strip="running"/)
    assert.match(moving, /role="status"/)
    assert.match(moving, /data-apply-bar=/)
    assert.doesNotMatch(moving, /data-apply-done/)
    const done = draw(<ApplyStrip state={last} onDone={noop} />)
    for (const id of ['sheet', 'cache', 'slices', 'ring', 'page']) assert.match(done, new RegExp(`data-apply-step="${id}" data-state="landed"`))
    assert.match(done, /data-apply-done=""/)
    const refused = await run(async () => { throw new Error('Not a current client of NW4045.') })
    const html = draw(<ApplyStrip state={refused.last} onAgain={noop} />)
    assert.match(html, /data-apply-refusal="">Not a current client of NW4045\./)
    assert.match(html, /data-apply-again=""/)
    for (const h of [moving, done, html]) assert.ok(!h.includes('role="dialog"') && !h.includes('aria-modal'))
  })

  it('Settings › My Work hides the progress panel from everyone but the master: one line while it works, the refusal still said', async () => {
    primeShellHides({ ...SHELL_SHOWN, apply_progress: true })
    try {
      const { seen } = await run(async () => ANSWER)
      const moving = draw(<ApplyStrip state={seen.find((s) => s.steps.some((x) => x.state === 'running'))!} onDone={noop} />)
      assert.match(moving, /data-apply-quiet=""/)
      assert.match(moving, /Applying…/)
      assert.doesNotMatch(moving, /data-apply-step=|data-apply-bar=/)
      const refused = await run(async () => { throw new Error('Not a current client of NW4045.') })
      const html = draw(<ApplyStrip state={refused.last} onAgain={noop} />)
      assert.match(html, /data-apply-refusal="">Not a current client of NW4045\./)
      assert.match(html, /data-apply-again=""/)
    } finally {
      primeShellHides(SHELL_SHOWN)
    }
  })
})

/* ---------- who is offered which edit ---------- */

describe('each edit control is drawn for its own edition alone', () => {
  it('the master makes every edition; anybody else only what the server named; a cut view none', () => {
    assert.ok(viewerCan({ writes: true, cut: false }, 'locations.clientsAdd'), 'a section drawn outside the page is the master\'s')
    const v = who(['locations.documents'])
    assert.equal(viewerCan(v, 'locations.documents'), true)
    assert.equal(viewerCan(v, 'locations.house'), false)
    assert.equal(viewerCan({ writes: false, cut: true, editions: ['locations.documents'] }, 'locations.documents'), false)
  })

  it('Actions offers only the items of the editions the viewer makes', () => {
    const html = as(who(['locations.incidents']), <ActionsMenu onPick={noop} />)
    assert.match(html, /data-action="incident"/)
    assert.doesNotMatch(html, /data-action="notes"|data-action="repair"/)
    assert.deepEqual(actionGroupsFor(() => false), [])
  })

  it('Documents: the two buttons on the right and a remove beside each of the house\'s own documents — never a company document or an ISP', () => {
    const docs = ready(documentsOf({
      policies: [{ title: 'Company Policies', drive_id: 'policy0xxxxx' }],
      isps: [{ client: 'Kenny Marsh', isp_doc_id: 'ispdoc000001', isp_doc_name: 'Kenny ISP' }],
      guidebook: { folder_name: 'NW4045 - Arlington', files: [{ id: 'guide0000001', name: 'Arlington Guidebook', guide: true }] },
    }))
    const opener = { opening: '', open: noop }
    const edits = draw(<DocumentsView house={H} docs={docs} doc={opener} onRetry={noop} onAsk={noop} />)
    assert.match(edits, /data-doc-link-open=""/)
    assert.match(edits, /Add from Drive link/)
    assert.match(edits, /data-doc-upload-open=""/)
    assert.match(edits, /data-doc-remove-open="guide0000001"/)
    assert.doesNotMatch(edits, /data-doc-remove-open="policy0xxxxx"|data-doc-remove-open="ispdoc000001"/)
    const plain = draw(<DocumentsView house={H} docs={docs} doc={opener} onRetry={noop} />)
    assert.doesNotMatch(plain, /data-doc-link-open|data-doc-upload-open|data-doc-remove-open/)
    const rows = houseDocuments(H, docs.data)
    assert.deepEqual(rows.filter(houseOwnDoc).map((d) => d.fileId), ['guide0000001'])
  })

  it('Staff: the people taken off are listed; Put back only for the Staff edition', () => {
    const staff = ready(staffOf({ clients: [], staff: [{ name: 'Noah Reed', first_day: '2025-01-06', last_day: '2026-09-23' }],
      removed: [{ key: 'avastone', name: 'Ava Stone', by: 'Boss', at: '2026-10-06T12:00:00Z' }] }))
    const opener = { opening: '', open: noop }
    const can = as(who(['locations.staffRemove']), <StaffView house={H} staff={staff} onAsk={noop} doc={opener} onRetry={noop} />)
    assert.match(can, /data-staff-off="Ava Stone"/)
    assert.match(can, /data-staff-back-open="Ava Stone"/)
    const cannot = as(who([]), <StaffView house={H} staff={staff} onAsk={noop} doc={opener} onRetry={noop} />)
    assert.match(cannot, /data-staff-off="Ava Stone"/)
    assert.doesNotMatch(cannot, /data-staff-back-open/)
  })

  it('Associated clients: Add clients only for its edition, and a client just added shows before the slice catches up', () => {
    const overview = ready(overviewOf({ clients: [{ client_key: 'kennymarsh', name: 'Kenny Marsh' }, { client_key: 'newbie', name: 'New Bie' }] }))
    const notes = ready(notesOf({ notes: [] }))
    const view = (v: LocationViewer) => as(v, <OverviewView house={H} overview={overview} notes={notes}
      onAsk={noop} onRetryOverview={noop} onRetryNotes={noop} />)
    const can = view(who(['locations.clientsAdd']))
    assert.match(can, /data-clients-add-open=""/)
    assert.match(can, /New Bie/)
    const cannot = view(who(['locations.house']))
    assert.doesNotMatch(cannot, /data-clients-add-open/)
    assert.doesNotMatch(cannot, /New Bie/, 'without the edition the list is the slice\'s, as before')
    assert.match(cannot, /data-edit-house=""|House Details/)
  })

  it('every edition\'s panel is shut to a viewer without it, and open with it', () => {
    const share = sharePayloadFor(H, 'overview', null)
    const asks: [PanelAsk, string, LocationViewer['editions']][] = [
      [{ kind: 'doc-link' }, 'data-doc-link=""', ['locations.documents']],
      [{ kind: 'doc-upload' }, 'data-doc-upload=""', ['locations.documents']],
      [{ kind: 'clients-add' }, 'data-clients-add=""', ['locations.clientsAdd']],
      [{ kind: 'staff-back', name: 'Ava Stone' }, 'data-staff-back="Ava Stone"', ['locations.staffRemove']],
      [{ kind: 'incident' }, 'data-incident-form=""', ['locations.incidents']],
      [{ kind: 'repair' }, 'data-repair-form=""', ['locations.house']],
      [{ kind: 'asset-add' }, 'data-asset-add=""', ['locations.assets']],
      [{ kind: 'asset', id: 'r2' }, 'data-edit-panel="asset"', ['locations.assets']],
      [{ kind: 'house-photo' }, 'data-house-photo-panel=""', ['locations.house']],
    ]
    for (const [ask, mark, editions] of asks) {
      const shut = as(who([]), <LocationPanel ask={ask} house={H} share={share} onAsk={noop} onClose={noop} />)
      assert.ok(shut.includes(NOT_OPEN) && !shut.includes(mark), `${ask.kind}: shut without its edition`)
      const open = as(who(editions), <LocationPanel ask={ask} house={H} share={share} onAsk={noop} onClose={noop} />)
      assert.ok(open.includes(mark) && !open.includes(NOT_OPEN), `${ask.kind}: open with it`)
      assert.ok(!open.includes('role="dialog"') && !open.includes('aria-modal'), `${ask.kind}: the side panel, never a dialog`)
    }
  })

  it('the house photo panel is titled by the house alone and says nothing under the picture', () => {
    assert.equal(panelTitle({ kind: 'house-photo' }, { title: '38TH - ABD2005' }), "38TH - ABD2005's photo")
    const share = sharePayloadFor(H, 'overview', null)
    const html = as(who(['locations.house']), <LocationPanel ask={{ kind: 'house-photo' }} house={H} share={share} onAsk={noop} onClose={noop} />)
    assert.ok(html.includes('data-house-photo-panel=""') && !html.includes("kept on the platform") && !html.includes('stays on file'), html)
  })

  it('the new panels ride the address and come back the same', () => {
    const asks: PanelAsk[] = [{ kind: 'doc-link' }, { kind: 'doc-upload' }, { kind: 'doc-remove', id: 'guide0000001' },
      { kind: 'clients-add' }, { kind: 'staff-back', name: 'Ava Stone' }, { kind: 'asset', id: 'r2' }, { kind: 'asset-add' },
      { kind: 'house-photo' }]
    for (const a of asks) assert.deepEqual(panelOf(panelParam(a)), a)
  })

  it('House assets: Add asset and a row\'s edit only for the assets edition; the house edition keeps the supplies', () => {
    const supplies = ready(suppliesOf({ ledger_ready: true, consumables: [],
      assets: [{ id: 'r2', item: 'Fridge', address: '908 Arlington Ave NW', current_condition: 'Good' }] }))
    const can = as(who(['locations.assets']), <SuppliesView supplies={supplies} onAsk={noop} onRetry={noop} />)
    assert.match(can, /data-asset-add-open=""/)
    assert.match(can, /data-asset="r2" class="cursor-pointer/)
    assert.doesNotMatch(can, /Record count/, 'the counts stay the house edition\'s')
    const house = as(who(['locations.house']), <SuppliesView supplies={supplies} onAsk={noop} onRetry={noop} />)
    assert.doesNotMatch(house, /data-asset-add-open/)
    assert.match(house, /Record count/)
    assert.match(house, /Set par level/)
  })

  it('the house photo: a picture the house takes, and its asset fields with the house locked', () => {
    assert.equal(housePhotoProblem({ name: 'front.jpg', size: 1000, type: 'image/jpeg' }), '')
    assert.match(housePhotoProblem({ name: 'front.gif', size: 1000, type: 'image/gif' }), /JPEG, PNG or WebP/)
    assert.match(housePhotoProblem({ name: 'big.png', size: 6 * 1024 * 1024, type: 'image/png' }), /larger than 5 MB/)
    const fields = assetEditFields({ id: 'r2', item: 'Fridge', address: '908 Arlington Ave NW' })
    assert.deepEqual(fields.map((f) => [f.key, !!f.lockedBy]), [['address', true], ['item', false],
      ['current_condition', false], ['est_expiration_year', false], ['cost_to_replace', false], ['replacement_frequency', false]])
    assert.equal(assetDraft({ item: '  ' }), 'Name the item.')
    assert.deepEqual(assetDraft({ item: 'Washer', cost_to_replace: ' 600 ' }), { item: 'Washer', cost_to_replace: '600' })
  })
})

describe('what an edition is handed to work with', () => {
  it('the clients offered to add: current, placed in no house — never a client of any house by code or by street', () => {
    const rows = [
      { client_key: 'k1', name: 'Kay Here', house: 'NW4045', home_address: '', status: 'active' },
      { client_key: 'k2', name: 'Street Match', house: '', home_address: '12 Briar Way, Canton', status: 'active' },
      { client_key: 'k3', name: 'Free One', house: '', home_address: '1 Elsewhere St', status: '' },
      { client_key: 'k4', name: 'Gone One', house: '', home_address: '', status: 'inactive' },
      { client_key: 'k5', name: 'Labelled', house: 'CAN - BW - BW1001', home_address: '', status: 'active' },
    ].map(clientIdentity)
    const offered = addableClients(rows, [{ code: 'BW1001', address: '12 Briar Way, Canton, OH' }, { code: 'NW4045', address: '908 Arlington Ave NW' }])
    assert.deepEqual(offered.map((c) => c.client_key), ['k3'])
  })

  it('a Drive link to one file, and a file the house keeps', () => {
    assert.equal(driveLinkProblem('https://drive.google.com/file/d/abcdefghijk123/view'), '')
    assert.match(driveLinkProblem('https://drive.google.com/drive/folders/abcdefghijk'), /folder/)
    assert.match(driveLinkProblem('hello'), /not a Google Drive link/)
    assert.equal(houseDocProblem({ name: 'Plan.docx', size: 1000 }), '')
    assert.match(houseDocProblem({ name: 'run.exe', size: 10 }), /Not a document/)
    assert.match(houseDocProblem({ name: 'big.pdf', size: 16 * 1024 * 1024 }), /larger than 15 MB/)
  })
})
