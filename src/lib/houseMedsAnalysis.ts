// HOUSE SUPPLIES — THE PHARMACY'S REPORTS, READ INTO FIGURES.
// PURE: the relay's answer (`/hub-lanes/house-supplies/meds`, server/ house_meds.py) in, the hero's figures, the…

export type MedsVerdict = 'new' | 'imported' | 'duplicate' | 'held' | 'invalid' | 'failed' | 'unknown'

export type MedsPeriod = { import_id: string; start: string; end: string; file_name: string; lines: number; facility: string }
export type MedsGap = { start: string; end: string }

export type MedsPatient = {
  patid: string
  /** the PatID the resident is shown under (a confirmed `same as` folds two) */
  key: string
  group: 'house' | 'nohouse' | 'unmatched'
  house: string
  house_label: string
  client_key: string
  client_name: string
  initials: string
  match: string
  note: string
  same_as: string
  last_seen: string
  facilities: string[]
}

export type MedsRx = {
  rx_root: string
  patid: string
  patient: string
  drug: string
  physician: string
  sig: string
  date_written: string
  last_dispense: string
  dispensed_in_period: string
  qty_written: string
  qty_remaining: string
  qty_dispensed_to_date: string
  cutoff: string
  report_end: string
  first_report_end: string
  reports_seen: number
  labels: string[]
  sum_dispensed: string
  current: boolean
  maybe_same_as: string
  facility: string
}

export type MedsPreview = {
  stage_id: string
  import_id: string
  file_name: string
  source: string
  verdict: MedsVerdict
  pill: string
  reason: string
  layers: string[]
  duplicate_of: string
  start: string
  end: string
  lines: number
  lines_new: number
  patients: number
  already?: boolean
  native?: boolean
}

export type MedsLedgerRow = {
  import_id: string
  received_at: string
  source: string
  actor_label: string
  file_name: string
  stage_id: string
  outcome: MedsVerdict
  layers: string[]
  reason: string
  duplicate_of: string
  report_start: string
  report_end: string
  lines: number
  lines_new: number
  patients: number
  house_state: string
  house_error: string
  superseded_by: string
}

export type MedsView = {
  version: string
  pharmacy: string
  scope: { every_house: boolean; houses: string[]; writer: boolean; why: string }
  latest: { start: string; end: string } | null
  periods: MedsPeriod[]
  gaps: MedsGap[]
  facilities: { facility: string; from: string }[]
  summary: { reports: number; duplicates: number; held: number; invalid: number; failed: number; house_pending: number }
  patients: MedsPatient[]
  rx: MedsRx[]
  folder: { at?: string; by?: string; listed?: number; known?: number; new?: number; failed?: number;
            remaining?: number; error?: string; empty_warning?: boolean }
  sweep: { at?: string; imported?: string[]; error?: string }
  low_left: number
  period_days: number
  ledger?: MedsLedgerRow[]
  clients?: { client_key: string; name: string; house: string }[]
  staged?: MedsPreview[]
}

export type MedsFolderAnswer = {
  busy: boolean
  listed: number
  reports: number
  ignored: number
  known: number
  staged: number
  decided: MedsPreview[]
  failed: number
  remaining: number
  downloaded: number
  empty_warning: boolean
  error: string
  previews?: MedsPreview[]
}

export type MedsCommitAnswer = {
  results: MedsPreview[]
  stopped: boolean
  counts: Partial<Record<MedsVerdict, number>>
  lines_new: number
}

const DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A `YYYY-MM-DD` day → its UTC midnight; NaN for anything else. */
export function dayMs(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Number.NaN
}

export function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** "Aug 15" */
export function fmtDay(iso: string): string {
  const ms = dayMs(iso)
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** "Aug 15 – Aug 29, 2026" or "Dec 22, 2025 – Jan 5, 2026" */
export function span(start: string, end: string): string {
  const a = dayMs(start), b = dayMs(end)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'no period'
  const ya = new Date(a).getUTCFullYear(), yb = new Date(b).getUTCFullYear()
  return ya === yb
    ? `${fmtDay(start)} – ${fmtDay(end)}, ${yb}`
    : `${fmtDay(start)}, ${ya} – ${fmtDay(end)}, ${yb}`
}

/** "Feb 2026" */
export function monthOf(iso: string): string {
  const ms = dayMs(iso)
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** A number the pharmacy wrote, or null when the cell was blank. */
export function qty(text: string): number | null {
  const t = String(text ?? '').trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export type Band = 'plenty' | 'low' | 'none' | 'ending'

// Where one current prescription sits on the hero's band.
export function bandOf(rx: MedsRx, latest: MedsView['latest'], lowLeft: number): Band | null {
  if (latest && rx.cutoff && rx.cutoff >= latest.start && rx.cutoff <= latest.end) return 'ending'
  const left = qty(rx.qty_remaining)
  if (left === null) return null
  if (left <= 0) return 'none'
  if (left <= lowLeft) return 'low'
  return 'plenty'
}

/** "Ends Sep 2" · "Ended Aug 20" · '' */
export function cutoffWords(cutoff: string, todayIso: string): string {
  if (!cutoff) return ''
  return cutoff < todayIso ? `Ended ${fmtDay(cutoff)}` : `Ends ${fmtDay(cutoff)}`
}

/** "none left" at 0, the number otherwise, '—' when blank. */
export function leftWords(rx: MedsRx): string {
  const left = qty(rx.qty_remaining)
  if (left === null) return '—'
  return left <= 0 ? 'none left' : String(left)
}

export type HeroFigures = {
  latest: { ageDays: number; span: string; overdue: boolean; due: string } | null
  onRecord: { count: number; clients: number; houses: number }
  low: { count: number; none: number }
  reports: { count: number; expected: number; missing: number; duplicates: number; since: string }
  band: Record<Band, number>
  facilitySwitch: string
}

/** Every figure the hero draws, from one answer. `todayIso` is the viewer's day. */
export function heroFigures(view: MedsView, todayIso: string): HeroFigures {
  const lowLeft = view.low_left || 7
  const current = view.rx.filter((r) => r.current)
  const byKey = new Map(view.patients.map((p) => [p.key, p]))
  const clients = new Set(current.map((r) => r.patient))
  const houses = new Set(current.map((r) => byKey.get(r.patient)).filter((p) => p && p.group === 'house').map((p) => p!.house))
  const band: Record<Band, number> = { plenty: 0, low: 0, none: 0, ending: 0 }
  let low = 0, none = 0
  for (const r of current) {
    const b = bandOf(r, view.latest, lowLeft)
    if (b) band[b] += 1
    const left = qty(r.qty_remaining)
    if (left !== null && left <= lowLeft) {
      low += 1
      if (left <= 0) none += 1
    }
  }
  let latest: HeroFigures['latest'] = null
  if (view.latest) {
    const end = dayMs(view.latest.end)
    const today = dayMs(todayIso)
    const ageDays = Math.max(0, Math.round((today - end) / DAY))
    const due = isoOf(end + (view.period_days + 1) * DAY)
    latest = { ageDays, span: span(view.latest.start, view.latest.end), overdue: ageDays > view.period_days + 1, due }
  }
  const periods = [...view.periods].sort((a, b) => a.start.localeCompare(b.start))
  const facilitySwitch = view.facilities.length > 1
    ? `${view.facilities.map((f) => f.facility).join(' → ')}, ${monthOf(view.facilities[view.facilities.length - 1].from)}`
    : ''
  return {
    latest,
    onRecord: { count: current.length, clients: clients.size, houses: houses.size },
    low: { count: low, none },
    reports: {
      count: periods.length,
      expected: periods.length + view.gaps.length,
      missing: view.gaps.length,
      duplicates: view.summary.duplicates,
      since: periods[0]?.start ?? '',
    },
    band,
    facilitySwitch,
  }
}

export type RxFilter = { house: string; client: string; drug: string; lowOnly: boolean; current: boolean }

/** The prescriptions a filter keeps, current ones by default. */
export function filterRx(view: MedsView, f: RxFilter): MedsRx[] {
  const byKey = new Map(view.patients.map((p) => [p.key, p]))
  const needle = f.drug.trim().toUpperCase()
  const lowLeft = view.low_left || 7
  return view.rx.filter((r) => {
    if (f.current && !r.current) return false
    const p = byKey.get(r.patient)
    if (f.house && (p?.house ?? '') !== f.house) return false
    if (f.client && r.patient !== f.client) return false
    if (needle && !r.drug.toUpperCase().includes(needle) && !r.labels.some((l) => l.toUpperCase().includes(needle))) {
      return false
    }
    if (f.lowOnly) {
      const left = qty(r.qty_remaining)
      if (left === null || left > lowLeft) return false
    }
    return true
  })
}

export type RxGroup = {
  id: string
  title: string
  kind: MedsPatient['group']
  clients: { patient: MedsPatient; rx: MedsRx[] }[]
}

// House, then client, then prescriptions — "Not matched to a client" and "No house" last, for the every-house…
export function groupRx(view: MedsView, rx: MedsRx[]): RxGroup[] {
  const byKey = new Map(view.patients.map((p) => [p.key, p]))
  const groups = new Map<string, RxGroup>()
  for (const r of rx) {
    const p = byKey.get(r.patient)
    if (!p) continue
    const id = p.group === 'house' ? `h:${p.house}` : p.group
    const title = p.group === 'house' ? (p.house_label || p.house)
      : p.group === 'nohouse' ? 'No house' : 'Not matched to a client'
    const g = groups.get(id) ?? { id, title, kind: p.group, clients: [] }
    groups.set(id, g)
    let c = g.clients.find((x) => x.patient.key === p.key)
    if (!c) { c = { patient: p, rx: [] }; g.clients.push(c) }
    c.rx.push(r)
  }
  const order = { house: 0, nohouse: 1, unmatched: 2 }
  const out = [...groups.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.title.localeCompare(b.title))
  for (const g of out) {
    g.clients.sort((a, b) => (a.patient.client_name || a.patient.patid).localeCompare(b.patient.client_name || b.patient.patid))
    for (const c of g.clients) c.rx.sort((a, b) => a.drug.localeCompare(b.drug))
  }
  return out
}

/** A patient as a person reads them: the client's name, or PatID + initials. */
export function patientLabel(p: MedsPatient): string {
  return p.client_name || `PatID ${p.patid}${p.initials ? ` · ${p.initials}` : ''}`
}

export type StripCell = { start: string; end: string; state: 'imported' | 'missing' | 'held' | 'future' }

// 15-day cells from the first report (or `from`) to today: imported, missing or held.
export function periodStrip(view: MedsView, todayIso: string, from = ''): StripCell[] {
  const periods = [...view.periods].sort((a, b) => a.start.localeCompare(b.start))
  const first = from || periods[0]?.start
  if (!first) return []
  const step = (view.period_days || 15) * DAY
  const today = dayMs(todayIso)
  const held = (view.ledger ?? []).filter((l) => l.outcome === 'held' && l.report_start)
  const cells: StripCell[] = []
  for (let s = dayMs(first); s <= today && cells.length < 200; s += step) {
    const start = isoOf(s), end = isoOf(s + step - DAY)
    const imported = periods.some((p) => p.start <= end && start <= p.end)
    const isHeld = !imported && held.some((l) => l.report_start <= end && start <= l.report_end)
    const future = s + step - DAY >= today && !imported
    cells.push({ start, end, state: imported ? 'imported' : isHeld ? 'held' : future ? 'future' : 'missing' })
  }
  return cells
}

/** What the commit bar says about a batch of previews. */
export function batchWords(previews: MedsPreview[]): { newCount: number; newLines: number; recorded: number; label: string; note: string } {
  const fresh = previews.filter((p) => p.verdict === 'new')
  const recorded = previews.filter((p) => p.verdict === 'duplicate' || p.verdict === 'held' || p.verdict === 'invalid').length
  const newLines = fresh.reduce((n, p) => n + (p.lines_new || p.lines || 0), 0)
  const label = fresh.length
    ? `Import ${fresh.length} new report${fresh.length === 1 ? '' : 's'} (${newLines.toLocaleString()} lines)`
    : 'Nothing new in this batch'
  const note = recorded
    ? `${recorded} file${recorded === 1 ? ' is' : 's are'} already on file or refused and recorded — ${recorded === 1 ? 'it' : 'they'} will not be read again.`
    : ''
  return { newCount: fresh.length, newLines, recorded, label, note }
}
