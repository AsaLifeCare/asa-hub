/** Production Actions — the go-live runbook's statuses, figures and overlay; pure. */

export const PRODUCTION_ACTION_HANDLERS = ['banner', 'link', 'form_close'] as const
export type HandlerId = (typeof PRODUCTION_ACTION_HANDLERS)[number]

export type Phase = 'before' | 'at' | 'after'
export type Status = 'done' | 'failed' | 'needs' | 'ready' | 'rehearsed' | 'waiting'
export type HouseWord = 'fresh' | 'stale' | 'unreadable' | 'missing' | 'pending'

export type HouseState = {
  key: string
  label: string
  book: string
  tab: string
  rows: number
  read_at: string
  state: HouseWord
  why: string
}

export type TestSwitch = { on: boolean; readable: boolean; word: string; why: string }

export type PAction = {
  id: string
  createdAt: string
  updatedAt: string
  updated_by: string
  number: string
  phase: string
  title: string
  system: string
  kind: string
  handler: string
  params: string
  how: string
  link: string
  requires: string
  effect: string
  enabled: string
  params_obj: Record<string, unknown> | null
  params_error?: string
  def_sha: string
}

export type PRun = {
  id: string
  createdAt: string
  updatedAt?: string
  action_id: string
  number: string
  title: string
  act: string
  result: string
  expect: string
  test_mode: string
  dial: string
  by_email: string
  by_name: string
  client_id: string
  def_sha: string
  preview_sha: string
  target: string
  detail: string
  undoes: string
  mock_row_id: string
  tenant?: string
  has_undo: boolean
}

export type RunbookView = {
  house: { actions: HouseState; runs: HouseState }
  actions?: PAction[]
  runs?: PRun[]
  runs_total?: number
  test_mode?: TestSwitch
  as_of: string
}

export type Invariant = { id: string; ok: boolean; words: string }

export type PreviewItem = {
  action_id: string
  number?: string
  title?: string
  kind?: string
  handler?: string
  def_sha?: string
  test_mode?: string
  mode?: 'rehearse' | 'real'
  preview_sha?: string
  state?: string
  target?: string
  words?: string[]
  untouched?: string[]
  invariants?: Invariant[]
  problems: string[]
  ok?: boolean
  how?: string
  link?: string
  requires?: string
}

export type PreviewAnswer = { test_mode: string; mode: 'rehearse' | 'real'; items: Record<string, PreviewItem> }

export const PHASES: { id: Phase; label: string; blurb: string; idle: string }[] = [
  { id: 'before', label: 'Before go-live', blurb: 'Done while test mode is still on.', idle: '' },
  { id: 'at', label: 'At go-live', blurb: 'The moment test mode goes off — each waits for a click.',
    idle: 'starts when test mode goes off' },
  { id: 'after', label: 'After go-live', blurb: 'Once the platform carries the traffic.', idle: 'after test mode goes off' },
]

export const STATUS_META: Record<Status, { label: string; tint: 'mint' | 'danger' | 'amber' | 'blue' | 'lavender' | 'slate' }> = {
  done: { label: 'Done', tint: 'mint' },
  ready: { label: 'Ready', tint: 'blue' },
  rehearsed: { label: 'Rehearsed', tint: 'lavender' },
  waiting: { label: 'Waiting', tint: 'slate' },
  needs: { label: 'Needs you', tint: 'amber' },
  failed: { label: 'Failed', tint: 'danger' },
}

export const STATUS_ORDER: Status[] = ['done', 'ready', 'rehearsed', 'waiting', 'needs', 'failed']

export const HANDLER_LABEL: Record<HandlerId, string> = {
  banner: 'Write a banner on a tab',
  link: 'Open a link',
  form_close: 'Close a Google Form',
}

export const BANNER_TEXT = 'Asa LifeCare Systems are Online, go there for this kind of request: https://asamylife.asalifecare.com/'

export function readablyOff(sw: TestSwitch | null | undefined): boolean {
  return !!sw && sw.readable === true && sw.on === false
}

export function testWord(sw: TestSwitch | null | undefined): 'on' | 'off' | 'unreadable' {
  if (!sw || !sw.readable) return 'unreadable'
  return sw.on ? 'on' : 'off'
}

export function phaseActive(phase: string, sw: TestSwitch | null | undefined): boolean {
  return phase === 'before' || readablyOff(sw)
}

export function isEnabled(a: Pick<PAction, 'enabled'>): boolean {
  return !['no', 'false', '0', 'off'].includes(String(a.enabled ?? '').trim().toLowerCase())
}

export function handlerKnown(a: Pick<PAction, 'handler'>): boolean {
  return (PRODUCTION_ACTION_HANDLERS as readonly string[]).includes(String(a.handler ?? '').trim())
}

export function runnable(a: PAction): boolean {
  return a.kind === 'automatic' && handlerKnown(a) && !!a.params_obj && !a.params_error
}

function numberParts(n: string): (string | number)[] {
  return String(n ?? '').trim().toLowerCase().split(/(\d+)/).filter((p) => p !== '')
    .map((p) => (/^\d+$/.test(p) ? Number(p) : p))
}

export function compareNumber(a: string, b: string): number {
  const x = numberParts(a), y = numberParts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (i >= x.length) return -1
    if (i >= y.length) return 1
    const p = x[i], q = y[i]
    if (typeof p === 'number' && typeof q === 'number') { if (p !== q) return p - q; continue }
    if (typeof p === 'number') return -1
    if (typeof q === 'number') return 1
    if (p !== q) return p < q ? -1 : 1
  }
  return 0
}

function oldestFirst(a: PRun, b: PRun): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function runsFor(id: string, runs: PRun[] | undefined): PRun[] {
  return (runs ?? []).filter((r) => r.action_id === id).sort(oldestFirst)
}

export type Effective = {
  done: boolean
  doneBy: PRun | null
  failed: boolean
  rehearsed: boolean
  last: PRun | null
}

export function effective(a: PAction, runs: PRun[] | undefined): Effective {
  const out: Effective = { done: false, doneBy: null, failed: false, rehearsed: false, last: null }
  for (const r of runsFor(a.id, runs)) {
    if (r.act !== 'save') out.last = r
    if (r.act === 'run') {
      if (r.result === 'ok' || r.result === 'noop') { out.done = true; out.doneBy = r; out.failed = false }
      else if (r.result === 'failed' || r.result === 'refused') out.failed = true
    } else if (r.act === 'mark') {
      out.done = true; out.doneBy = r; out.failed = false
    } else if (r.act === 'unmark') {
      out.done = false; out.doneBy = null
    } else if (r.act === 'undo' && r.result === 'ok' && out.doneBy && r.undoes === out.doneBy.id) {
      out.done = false; out.doneBy = null
    } else if (r.act === 'rehearse' && r.result === 'ok' && r.def_sha === a.def_sha) {
      out.rehearsed = true
    }
  }
  return out
}

export function historyRead(view: RunbookView | null | undefined): view is RunbookView & { runs: PRun[] } {
  return !!view?.runs
}

export function cardStatus(a: PAction, view: RunbookView | null | undefined): Status | null {
  return historyRead(view) ? statusOf(a, view.runs, view.test_mode) : null
}

export function statusOf(a: PAction, runs: PRun[] | undefined, sw: TestSwitch | null | undefined): Status {
  const e = effective(a, runs)
  if (e.done) return 'done'
  if (e.failed) return 'failed'
  const active = phaseActive(a.phase, sw)
  if (a.kind !== 'automatic' && a.kind !== 'manual') return 'needs'
  if (a.kind === 'automatic' && !runnable(a)) return 'needs'
  if (a.kind === 'manual') return active ? 'needs' : 'waiting'
  if (readablyOff(sw)) return active ? 'ready' : 'waiting'
  return e.rehearsed ? 'rehearsed' : 'waiting'
}

export type PhaseGroup = { phase: (typeof PHASES)[number]; actions: PAction[] }

export function grouped(actions: PAction[] | undefined): { phases: PhaseGroup[]; off: PAction[]; stray: PAction[] } {
  const all = actions ?? []
  const on = all.filter(isEnabled)
  const byNumber = (x: PAction, y: PAction) => compareNumber(x.number, y.number) || (x.id < y.id ? -1 : 1)
  return {
    phases: PHASES.map((phase) => ({ phase, actions: on.filter((a) => a.phase === phase.id).sort(byNumber) })),
    off: all.filter((a) => !isEnabled(a)).sort(byNumber),
    stray: on.filter((a) => !PHASES.some((p) => p.id === a.phase)).sort(byNumber),
  }
}

export function ago(iso: string, now: number): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function resultWord(r: PRun): string {
  if (r.act === 'rehearse') return r.result === 'ok' ? 'rehearsed' : r.result === 'refused' ? 'rehearsal refused' : 'rehearsal failed'
  if (r.act === 'run') return ({ ok: 'done', noop: 'already in place', refused: 'refused', failed: 'failed' } as Record<string, string>)[r.result] ?? r.result
  if (r.act === 'undo') return r.result === 'ok' ? 'undone' : `undo ${r.result}`
  if (r.act === 'mark') return 'marked done'
  if (r.act === 'unmark') return 'reopened'
  if (r.act === 'save') return 'saved'
  return r.act
}

export function eventLine(r: PRun, now: number): string {
  const verb = resultWord(r)
  return `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${ago(r.createdAt, now)}${r.by_name ? ` by ${r.by_name}` : ''}`
}

export function lastRun(runs: PRun[] | undefined): PRun | null {
  const acts = (runs ?? []).filter((r) => r.act === 'rehearse' || r.act === 'run' || r.act === 'undo')
  return acts.sort(oldestFirst).at(-1) ?? null
}

export type HeroFigures = {
  total: number
  ready: number
  rehearsed: number
  done: number
  waiting: number
  automaticWaiting: number
  manualWaiting: number
  band: Record<Status, number>
  test: 'on' | 'off' | 'unreadable'
  last: PRun | null
}

export function heroFigures(view: RunbookView | null | undefined): HeroFigures | null {
  if (!view || !view.actions || !view.runs) return null
  const sw = view.test_mode
  const band = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<Status, number>
  let automaticWaiting = 0, manualWaiting = 0
  const on = view.actions.filter(isEnabled)
  for (const a of on) {
    const s = statusOf(a, view.runs, sw)
    band[s]++
    if (s === 'ready' || s === 'needs') {
      if (a.kind === 'automatic') automaticWaiting++
      else manualWaiting++
    }
  }
  return {
    total: on.length,
    ready: band.ready,
    rehearsed: band.rehearsed,
    done: band.done,
    waiting: band.ready + band.needs,
    automaticWaiting,
    manualWaiting,
    band,
    test: testWord(sw),
    last: lastRun(view.runs),
  }
}

export function undoable(id: string, runs: PRun[] | undefined): PRun | null {
  const mine = runsFor(id, runs)
  const newest = mine.filter((r) => r.act === 'run' && r.result === 'ok').at(-1)
  if (!newest || !newest.has_undo) return null
  return mine.some((r) => r.act === 'undo' && r.result === 'ok' && r.undoes === newest.id) ? null : newest
}

export function openAt(view: RunbookView | null | undefined): PAction[] {
  if (!view?.actions || !historyRead(view)) return []
  return view.actions.filter((a) => isEnabled(a) && a.phase === 'at' && !effective(a, view.runs).done)
}

export function liveChanges(view: RunbookView | null | undefined): PAction[] {
  if (!view?.actions || !historyRead(view)) return []
  return view.actions.filter((a) => {
    const e = effective(a, view.runs)
    return e.done && e.doneBy?.act === 'run' && e.doneBy.result === 'ok' && e.doneBy.has_undo
  })
}

export type GoLiveBanner = { tone: 'red' | 'amber'; count: number } | null

export function goLiveBanner(view: RunbookView | null | undefined): GoLiveBanner {
  if (!view?.actions || !historyRead(view)) return null
  const sw = view.test_mode
  if (readablyOff(sw)) {
    const open = openAt(view).length
    return open ? { tone: 'red', count: open } : null
  }
  const live = liveChanges(view).length
  return live ? { tone: 'amber', count: live } : null
}

export function runAllList(view: RunbookView | null | undefined, phase?: Phase): PAction[] {
  if (!view?.actions || !historyRead(view)) return []
  const sw = view.test_mode
  const inPhase = (a: PAction) => !phase || a.phase === phase
  const byNumber = (x: PAction, y: PAction) =>
    PHASES.findIndex((p) => p.id === x.phase) - PHASES.findIndex((p) => p.id === y.phase) || compareNumber(x.number, y.number)
  if (readablyOff(sw)) {
    return view.actions.filter((a) => isEnabled(a) && inPhase(a) && statusOf(a, view.runs, sw) === 'ready').sort(byNumber)
  }
  return view.actions
    .filter((a) => isEnabled(a) && inPhase(a) && runnable(a) && !effective(a, view.runs).done)
    .sort(byNumber)
}

export function runLabel(sw: TestSwitch | null | undefined): 'Run now' | 'Rehearse' {
  return readablyOff(sw) ? 'Run now' : 'Rehearse'
}

export function runAllLabel(sw: TestSwitch | null | undefined): 'Run all ready' | 'Rehearse all' {
  return readablyOff(sw) ? 'Run all ready' : 'Rehearse all'
}

export function rehearsalWords(sw: TestSwitch | null | undefined, many = false): string {
  const why = testWord(sw) === 'unreadable' ? 'Test mode could not be read, so it counts as on' : 'Test mode is on'
  return many ? `${why}: each writes one mock row in CommMock and touches nothing else.`
    : `${why}: this writes one mock row in CommMock and touches nothing else.`
}

export function previewFetches(a: Pick<PAction, 'kind'>): boolean {
  return a.kind === 'automatic'
}

/** Popup blockers allow a tab only inside the click, so a real link run opens its tab before Apps Script answers. */
export function opensTab(a: Pick<PAction, 'kind' | 'handler'>, sw: TestSwitch | null | undefined): boolean {
  return a.kind === 'automatic' && a.handler === 'link' && readablyOff(sw)
}

export function undoWords(handler: string, target: string): string {
  if (handler === 'form_close') {
    return `Puts ${target || 'the form'} back as it was before the run: accepting answers or closed, with its old closed message.`
  }
  return `Puts back ${target || 'the cells'}: the cells as they were before the run, with their colours and the tab colour.`
}

export function markAsks(a: Pick<PAction, 'kind'>, done: boolean): boolean {
  return done && a.kind === 'automatic'
}

export type RunPayload = { action_id: string; client_id: string; preview_sha: string; expect: 'real' | 'rehearse' }

export function runPayload(a: Pick<PAction, 'id'>, preview: Pick<PreviewItem, 'preview_sha'>,
  sw: TestSwitch | null | undefined, clientId: string): RunPayload {
  return { action_id: a.id, client_id: clientId, preview_sha: String(preview.preview_sha ?? ''),
           expect: readablyOff(sw) ? 'real' : 'rehearse' }
}

export function newClientId(): string {
  return `pa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function runFailed(r: PRun | null | undefined): boolean {
  return !r || r.result === 'failed' || r.result === 'refused'
}

export type SequenceStep<T> = { item: T; run: PRun | null; error: string }

/** Runs one at a time, stops at the first failure, and says what ran. */
export async function runSequence<T>(items: T[], runOne: (item: T) => Promise<PRun>): Promise<{
  ran: SequenceStep<T>[]
  stopped: SequenceStep<T> | null
}> {
  const ran: SequenceStep<T>[] = []
  for (const item of items) {
    let step: SequenceStep<T>
    try {
      const run = await runOne(item)
      step = { item, run, error: runFailed(run) ? (run?.detail || 'it did not run') : '' }
    } catch (err) {
      step = { item, run: null, error: err instanceof Error ? err.message : String(err) }
    }
    ran.push(step)
    if (step.error) return { ran, stopped: step }
  }
  return { ran, stopped: null }
}

export function previewBlock(item: PreviewItem | null | undefined): string {
  if (!item) return 'Preview it first.'
  if (item.problems?.length) return item.problems[0]
  const bad = (item.invariants ?? []).find((i) => !i.ok)
  return bad ? bad.words : ''
}

/* ---- the overlay: a write shows at once, and survives a reload until the relay serves it ---- */

export const OVERLAY_KEY = 'asa-pa-overlay'
export const OVERLAY_TTL_MS = 30 * 60 * 1000

export type Overlay = { runs: { run: PRun; at: number }[]; actions: { action: PAction; at: number }[] }

export const EMPTY_OVERLAY: Overlay = { runs: [], actions: [] }

export function loadOverlay(): Overlay {
  try {
    const raw = sessionStorage.getItem(OVERLAY_KEY)
    if (!raw) return { runs: [], actions: [] }
    const got = JSON.parse(raw) as Partial<Overlay>
    return { runs: Array.isArray(got.runs) ? got.runs : [], actions: Array.isArray(got.actions) ? got.actions : [] }
  } catch {
    return { runs: [], actions: [] }
  }
}

export function saveOverlay(o: Overlay): void {
  try {
    if (!o.runs.length && !o.actions.length) sessionStorage.removeItem(OVERLAY_KEY)
    else sessionStorage.setItem(OVERLAY_KEY, JSON.stringify(o))
  } catch {
    /* a private window keeps the answer on screen until the next read */
  }
}

export function withRun(o: Overlay, run: PRun, now: number): Overlay {
  return { ...o, runs: [...o.runs.filter((x) => x.run.id !== run.id), { run, at: now }] }
}

export function withAction(o: Overlay, action: PAction, now: number): Overlay {
  return { ...o, actions: [...o.actions.filter((x) => x.action.id !== action.id), { action, at: now }] }
}

const SHOWN_FIELDS = ['number', 'phase', 'title', 'system', 'kind', 'handler', 'params', 'how', 'link', 'requires',
  'effect', 'enabled'] as const

/** def_sha leaves out the title, number and words, so the served row must match every field a card shows. */
export function servedAction(saved: PAction, served: PAction | undefined): boolean {
  if (!served) return false
  if (served.updatedAt && saved.updatedAt && served.updatedAt > saved.updatedAt) return true
  return SHOWN_FIELDS.every((k) => String(served[k] ?? '').trim() === String(saved[k] ?? '').trim())
}

export function pruneOverlay(o: Overlay, view: RunbookView | null | undefined, now: number): Overlay {
  const served = new Set((view?.runs ?? []).map((r) => r.id))
  const rows = new Map((view?.actions ?? []).map((a) => [a.id, a]))
  return {
    runs: o.runs.filter((x) => now - x.at < OVERLAY_TTL_MS && !served.has(x.run.id)),
    actions: o.actions.filter((x) => now - x.at < OVERLAY_TTL_MS && !servedAction(x.action, rows.get(x.action.id))),
  }
}

export function mergeOverlay(view: RunbookView | null, o: Overlay): RunbookView | null {
  if (!view) return view
  if (!o.runs.length && !o.actions.length) return view
  const out: RunbookView = { ...view }
  if (view.runs) {
    const have = new Set(view.runs.map((r) => r.id))
    const extra = o.runs.map((x) => x.run).filter((r) => !have.has(r.id))
    out.runs = [...extra, ...view.runs].sort((a, b) => -oldestFirst(a, b))
  }
  if (view.actions) {
    const replaced = new Map(o.actions.map((x) => [x.action.id, x.action]))
    const kept = view.actions.map((a) => replaced.get(a.id) ?? a)
    const added = o.actions.map((x) => x.action).filter((a) => !view.actions!.some((v) => v.id === a.id))
    out.actions = [...kept, ...added]
  }
  return out
}
