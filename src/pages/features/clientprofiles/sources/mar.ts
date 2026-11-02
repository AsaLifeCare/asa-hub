// Clients › Medication › Administration: the doors (ClientSourceMar.gs) and the model that turns their answer into…
// Everything here is clinical: it is read live from the master-only doors, never from a slice.
import { useCallback, useEffect, useRef, useState } from 'react'
import { gasAction } from '@/features/hiring/shared'
import { usePlatformDoc } from '@/lib/platformDoc'
import { clientPackOr } from '../clientReads'
import { unknownActionWords } from '../clientViewer'

/* ---------- the doors ---------- */

export const MAR_ACTIONS = { read: 'clientSourceMar', doc: 'clientSourceMarDocFile' } as const

/** A part Python built: it says when the MARS lane last listed the drive (Apps Script's answer never does). */
export const keptByPython = (part: unknown): boolean => 'swept_at' in obj(obj(obj(part).tabs).papers)

/** The relay's pack for the client first when Python built it (its part is this door's own answer), else the door. */
export const readMar = (client: string) =>
  clientPackOr(client, 'mar', () => gasAction<unknown>('clientSourceMar', { client }), keptByPython)

export type MarDigest = { text: string; state: string; chars: number; hasText: boolean }
export type MarDocAnswer = { id: string; name: string; mime: string; size: number; exported: boolean; b64: string; digest?: unknown }

export const readMarDoc = (client: string, fileId: string) =>
  gasAction<MarDocAnswer>('clientSourceMarDocFile', { client, file_id: fileId })

export const readMarText = (client: string, fileId: string) =>
  gasAction<unknown>('clientSourceMarDocFile', { client, file_id: fileId, part: 'text' })

/* ---------- the answer ---------- */

export type MarView = 'papers' | 'passes' | 'errors'

export const MAR_VIEWS: readonly { id: MarView; label: string }[] = [
  { id: 'papers', label: 'MARS papers' },
  { id: 'passes', label: 'eMAR passes' },
  { id: 'errors', label: 'MAR errors' },
]

export type MarRow = { id: string; record: string; date: string; time: string; details: string; status: string }

/** `ocrState` is the kept reading (read, pending, failed), '' while the store does not hold the paper yet. */
export type PaperRow = MarRow & {
  fileId: string; title: string; month: string; kind: string; mime: string; sizeBytes: number; folder: string
  modifiedTime: string; indexedAt: string; digestState: string; hasText: boolean; textChars: number
  ocrState: string; ocrError: string; ocrNextTryAt: string; ocrReadAt: string
}

// `schedule` is only a due clock; a whole date-time in the eMAR's pass-time column is `passTime`, already read…
export type PassRow = MarRow & {
  reason: string; schedule: string; passTime: string; scheduleAsWritten: string; dose: string; form: string; prn: boolean
  prnReason: string; prnTime: string; prnTimeAsWritten: string; givenBy: string; signedAs: string; withheld: string
  comment: string; instructions: string; bloodPressure: string; bloodSugar: string; quantityRemaining: string
  sourceStatus: string; dateAsWritten: string; dateFrom: string; dateFixed: boolean; dateUnsure: boolean; sourceRow: string
}

/** `matchedBy` is key, name or initials; `filedAs` is the initials a row the audit files only under them carries. */
export type ErrorRow = MarRow & {
  flags: string[]; kinds: string[]; marks: string[]; problem: string; passTime: string; notes: string; staff: string
  passer: string; reading: string; endDate: string; dateAsWritten: string; source: string; matchedBy: string; filedAs: string
}

// One tab: `kpis` is null when the source could not be read — its `why` says so, and no zero is drawn.
export type MarTabData<R> = {
  rows: R[]; kpis: Record<string, number | string> | null; statuses: string[]; why: string; asOf: string; indexedAt: string
  sweptAt: string; initials: string; initialsWhy: string
}

export type MarAnswer = {
  client: { clientKey: string; name: string }
  papers: MarTabData<PaperRow>
  passes: MarTabData<PassRow>
  errors: MarTabData<ErrorRow>
  degraded: boolean
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const strs = (v: unknown): string[] => list(v).map(str).filter(Boolean)

function baseOf(o: Obj): MarRow {
  return { id: str(o.id), record: str(o.record), date: str(o.date), time: str(o.time), details: str(o.details), status: str(o.status) }
}

function paperOf(v: unknown): PaperRow {
  const o = obj(v)
  return {
    ...baseOf(o), fileId: str(o.file_id), title: str(o.title), month: str(o.month), kind: str(o.kind), mime: str(o.mime),
    sizeBytes: num(o.size_bytes), folder: str(o.folder), modifiedTime: str(o.modified_time), indexedAt: str(o.indexed_at),
    digestState: str(o.digest_state), hasText: o.has_text === true, textChars: num(o.text_chars),
    ocrState: str(o.ocr_state), ocrError: str(o.ocr_error), ocrNextTryAt: str(o.ocr_next_try_at),
    ocrReadAt: str(o.ocr_read_at),
  }
}

function passOf(v: unknown): PassRow {
  const o = obj(v)
  return {
    ...baseOf(o), reason: str(o.reason), schedule: str(o.schedule), passTime: str(o.pass_time),
    scheduleAsWritten: str(o.schedule_as_written), dose: str(o.dose), form: str(o.form), prn: o.prn === true,
    prnReason: str(o.prn_reason), prnTime: str(o.prn_time), prnTimeAsWritten: str(o.prn_time_as_written),
    givenBy: str(o.given_by), signedAs: str(o.signed_as), withheld: str(o.withheld), comment: str(o.comment),
    instructions: str(o.instructions), bloodPressure: str(o.blood_pressure), bloodSugar: str(o.blood_sugar),
    quantityRemaining: str(o.quantity_remaining), sourceStatus: str(o.source_status), dateAsWritten: str(o.date_as_written),
    dateFrom: str(o.date_from), dateFixed: o.date_fixed === true, dateUnsure: o.date_unsure === true, sourceRow: str(o.source_row),
  }
}

function errorOf(v: unknown): ErrorRow {
  const o = obj(v)
  return {
    ...baseOf(o), flags: strs(o.flags), kinds: strs(o.kinds), marks: strs(o.marks), problem: str(o.problem),
    passTime: str(o.pass_time), notes: str(o.notes), staff: str(o.staff), passer: str(o.passer), reading: str(o.reading),
    endDate: str(o.end_date), dateAsWritten: str(o.date_as_written), source: str(o.source), matchedBy: str(o.matched_by),
    filedAs: str(o.filed_as),
  }
}

function tabOf<R>(v: unknown, row: (x: unknown) => R): MarTabData<R> {
  const o = obj(v)
  const why = str(o.why)
  const k = obj(o.kpis)
  const kpis: Record<string, number | string> = {}
  for (const [key, val] of Object.entries(k)) kpis[key] = typeof val === 'number' ? val : str(val)
  return {
    rows: list(o.rows).map(row), kpis: why && !Object.keys(kpis).length ? null : kpis, statuses: strs(o.statuses), why,
    asOf: str(o.as_of), indexedAt: str(o.indexed_at), sweptAt: str(o.swept_at), initials: str(o.initials),
    initialsWhy: str(o.initials_why),
  }
}

/** The door's answer as the tab draws it; anything missing is empty, never invented. */
export function marOf(raw: unknown): MarAnswer {
  const o = obj(raw)
  const t = obj(o.tabs)
  const c = obj(o.client)
  return {
    client: { clientKey: str(c.client_key), name: str(c.name) },
    papers: tabOf(t.papers, paperOf),
    passes: tabOf(t.passes, passOf),
    errors: tabOf(t.errors, errorOf),
    degraded: o.degraded === true,
  }
}

/* ---------- the words ---------- */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December']

/** 2025-08-14 → Aug 14, 2025; '' for anything that is not a day. */
export function dayWords(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.slice(0, 10))
  if (!m) return ''
  return `${MONTHS[Number(m[2]) - 1]?.slice(0, 3) ?? ''} ${Number(m[3])}, ${m[1]}`
}

/** 2026-08 or 2026-08-01 → August 2026. */
export function monthWords(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso)
  return m && MONTHS[Number(m[2]) - 1] ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ''
}

/** An ISO instant → Oct 18, 2026 at 9:05 AM, in New York's time; '' for anything that is not one. */
export function instantWords(iso: string): string {
  const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? new Date(iso) : null
  if (!at || Number.isNaN(at.getTime())) return ''
  const part = (o: Intl.DateTimeFormatOptions) => at.toLocaleString('en-US', { timeZone: 'America/New_York', ...o })
  return `${part({ month: 'short', day: 'numeric', year: 'numeric' })} at ${part({ hour: 'numeric', minute: '2-digit' })}`
}

/** 20:05 → 8:05 PM. */
export function clockWords(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m) return hhmm
  const h = Number(m[1])
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

/** The DATE cell: a paper is a month; a pass is its day and the clock it was recorded at. */
export function dateCell(view: MarView, row: MarRow): string {
  if (!row.date) return view === 'passes' && row.time ? `No day · ${clockWords(row.time)}` : 'No date'
  if (view === 'papers') return monthWords(row.date)
  return row.time ? `${dayWords(row.date)} · ${clockWords(row.time)}` : dayWords(row.date)
}

export type Tone = 'mint' | 'danger' | 'amber' | 'slate' | 'blue' | 'lavender'

const TONES: Record<string, Tone> = {
  Latest: 'mint', Earlier: 'slate', Undated: 'amber',
  Recorded: 'mint', 'Not given': 'danger', Discontinued: 'slate', Breakdown: 'lavender',
  Missed: 'danger', 'Wrong day': 'amber', Unavailable: 'amber', 'No staff': 'amber', Controlled: 'blue', Marked: 'slate',
  'Not flagged': 'slate',
}

export const statusTone = (status: string): Tone => TONES[status] ?? 'slate'

export type Kpi = { label: string; value: string }

const count = (k: Record<string, number | string>, key: string) => String(num(k[key]))
const rowsWord = (n: number) => `${n} row${n === 1 ? '' : 's'}`

/** The cards over a table — none when the source could not be read, so a failure is never drawn as zeros. */
export function kpiCards(view: MarView, tab: MarTabData<unknown>): Kpi[] {
  const k = tab.kpis
  if (!k) return []
  if (view === 'papers') {
    return [
      { label: 'Papers on file', value: count(k, 'papers') },
      { label: 'Months covered', value: count(k, 'months') },
      { label: 'Newest paper', value: monthWords(str(k.latest)) || '—' },
    ]
  }
  if (view === 'passes') {
    return [
      { label: 'Passes', value: count(k, 'passes') },
      { label: 'Recorded', value: count(k, 'recorded') },
      { label: 'Not given', value: count(k, 'not_given') },
      { label: 'Last pass', value: dayWords(str(k.last)) || '—' },
    ]
  }
  return [
    { label: 'Audited errors', value: count(k, 'errors') },
    { label: 'Missed', value: count(k, 'missed') },
    { label: 'Wrong day', value: count(k, 'wrong_day') },
    { label: 'Latest error', value: dayWords(str(k.latest)) || '—' },
  ]
}

/** The line under the cards: how far each source reaches, as the door measured it. */
export function asOfLine(view: MarView, tab: MarTabData<unknown>): string {
  if (tab.why || !tab.kpis) return ''
  if (view === 'papers') {
    const newest = monthWords(tab.asOf)
    const swept = instantWords(tab.sweptAt)
    const indexed = dayWords(tab.indexedAt)
    if (!newest && !swept && !indexed) return ''
    return [newest ? `The newest MARS paper on the platform is ${newest}` : '',
      swept ? `the client folders are checked for new papers by themselves, last on ${swept}`
        : indexed ? `the client folders were last indexed on ${indexed}` : ''].filter(Boolean).join('; ') + '.'
  }
  if (view === 'passes') {
    const fixed = num(tab.kpis.dates_fixed)
    const taken = num(tab.kpis.days_from_pass_time)
    return [tab.asOf ? `As of ${dayWords(tab.asOf)} — the newest pass the eMAR log holds; the paper MARs are the record since.` : '',
      fixed ? `${fixed} day${fixed === 1 ? '' : 's'} read back day-first from the eMAR's own text.` : '',
      taken ? `${taken} day${taken === 1 ? '' : 's'} taken from the eMAR's pass-time column, where the date cell holds only a time.` : '',
    ].filter(Boolean).join(' ')
  }
  const byInitials = num(tab.kpis.by_initials)
  const held = num(tab.kpis.initials_held)
  return [tab.asOf ? `As of ${dayWords(tab.asOf)} — the newest error the audit holds.` : '',
    byInitials ? `${rowsWord(byInitials)} filed only under the initials ${tab.initials} ${byInitials === 1 ? 'is' : 'are'} ` +
      'counted here: no other client, and nobody else the records name, has those initials.' : '',
    held ? `${rowsWord(held)} filed only under the initials ${tab.initials} ${held === 1 ? 'is' : 'are'} not counted: ` +
      `${tab.initialsWhy}.` : '',
  ].filter(Boolean).join(' ')
}

export const EMPTY_LINE: Record<MarView, string> = {
  papers: 'No MARS paper is on file for this client.',
  passes: 'The eMAR pass log holds no pass for this client.',
  errors: 'The MAR errors audit names no error for this client.',
}

/** The line an empty table says; the audit's rows held back under the client's initials are never an empty audit. */
export function emptyLine(view: MarView, tab: MarTabData<unknown>): string {
  const held = num(tab.kpis?.initials_held)
  if (view !== 'errors' || !held) return EMPTY_LINE[view]
  return `The MAR errors audit names no error by this client's key or name; ${rowsWord(held)} filed only under the ` +
    `initials ${tab.initials} ${held === 1 ? 'is' : 'are'} not attributed here: ${tab.initialsWhy}.`
}

/** Search over what the row says; the status filter is exact, and an error matches any kind it names. */
export function filterMarRows<R extends MarRow>(rows: R[], query: string, status: string): R[] {
  const q = query.trim().toLowerCase()
  return rows.filter((r) => {
    const kinds = (r as Partial<ErrorRow>).kinds ?? []
    if (status && r.status !== status && !kinds.includes(status)) return false
    if (!q) return true
    return [r.record, r.details, r.status, r.date, dayWords(r.date), monthWords(r.date)].join(' ').toLowerCase().includes(q)
  })
}

/** Rows drawn at a time; the rest arrive with "Show more". */
export const PAGE = 50

export const NOT_PUBLISHED = 'The server did not recognise this read: Administration answers once the platform release ' +
  'that carries it is live.'

/** "Unknown action." is a door shut to this account, or to the master a deployment without it. */
export function readRefusal(error: string): string {
  return unknownActionWords(error, NOT_PUBLISHED) ?? (error || 'The read did not answer.')
}

/* ---------- a paper, its digest and its whole OCR text ---------- */

export function digestOf(raw: unknown): MarDigest {
  const o = obj(raw)
  return { text: str(o.text), state: str(o.state), chars: num(o.chars), hasText: o.has_text === true }
}

/** `readAt` is when the MARS lane read the paper, '' when the text came from the drive's copy instead. */
export type MarText = { text: string; chars: number; truncated: boolean; readAt: string }

export function textOf(raw: unknown): MarText {
  const o = obj(raw)
  return { text: str(o.text), chars: num(o.chars), truncated: o.truncated === true, readAt: str(o.read_at) }
}

// A MARS paper in the platform's centred viewer, its bytes through the client's own door and made a blob URL that…
export function usePaperOpener(client: string) {
  const doc = usePlatformDoc(readRefusal)
  const [digests, setDigests] = useState<Record<string, MarDigest>>({})
  const open = (paper: Pick<PaperRow, 'fileId' | 'title' | 'record'>) => doc.open(paper.fileId, async () => {
    const got = await readMarDoc(client, paper.fileId)
    setDigests((d) => ({ ...d, [paper.fileId]: digestOf(got?.digest) }))
    return got
  }, { title: paper.title || paper.record, subtitle: 'Clients · MARS paper' })
  return { opening: doc.opening, digests, open }
}

export type PaperOpener = ReturnType<typeof usePaperOpener>

/* ---------- the panel, as the page's address carries it ---------- */

export type MarAsk = { kind: 'paper'; id: string } | { kind: 'pass'; id: string } | { kind: 'error'; id: string }

/** 'paper~<id>', 'pass~<id>' or 'error~<id>'. */
export function marPanelParam(ask: MarAsk | null): string {
  return ask ? `${ask.kind}~${ask.id}` : ''
}

export function marPanelOf(v: string | null | undefined): MarAsk | null {
  const m = /^(paper|pass|error)~(.+)$/.exec(String(v ?? ''))
  return m ? { kind: m[1] as 'paper' | 'pass' | 'error', id: m[2] } : null
}

export type AskState<T> = { status: 'idle' | 'loading' | 'ready' | 'failed'; data: T | null; error: string }

/** A read that runs when asked (the whole OCR text, asked as its panel opens); asking again reads again. */
export function useAsked<T>(load: () => Promise<unknown>, shape: (raw: unknown) => T): AskState<T> & { ask: () => void } {
  const [state, setState] = useState<AskState<T>>({ status: 'idle', data: null, error: '' })
  const [tick, setTick] = useState(0)
  const loadRef = useRef(load)
  const shapeRef = useRef(shape)
  useEffect(() => {
    loadRef.current = load
    shapeRef.current = shape
  })
  useEffect(() => {
    if (!tick) return
    let live = true
    loadRef.current().then((raw) => {
      if (live) setState({ status: 'ready', data: shapeRef.current(raw), error: '' })
    }).catch((err: unknown) => {
      if (live) setState((s) => ({ status: 'failed', data: s.data, error: err instanceof Error ? err.message : String(err) }))
    })
    return () => { live = false }
  }, [tick])
  const ask = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading', error: '' }))
    setTick((t) => t + 1)
  }, [])
  return { ...state, ask }
}
