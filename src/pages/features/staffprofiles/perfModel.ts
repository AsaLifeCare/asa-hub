// PERFORMANCE — the shape StaffProfiles.gs staffProfilePerformance answers, its views and its pill words.
// Pure and tolerant: a figure the answer does not carry is null and drawn as "—" or "Not connected yet", never as a…
import type { PillMeta, PillTint } from './staffModel'

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
const str = (v: unknown): string => (v == null || typeof v === 'object' ? '' : String(v).trim())
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const int = (v: unknown): number => num(v) ?? 0
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec) : [])

export const PERF_VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'training', label: 'Training & Certifications' },
  { id: 'documentation', label: 'Documentation' },
  { id: 'hr', label: 'HR & Conduct' },
  { id: 'notes', label: 'Notes' },
] as const

export type PerfView = (typeof PERF_VIEWS)[number]['id']

export const perfViewOf = (v: string | null | undefined): PerfView => PERF_VIEWS.find((x) => x.id === v)?.id ?? 'overview'

export type AttStatus = 'present' | 'worked' | 'tardy' | 'call_out' | 'ncns' | 'sent_home' | 'time_off' | 'no_punch'
const ATT_STATUSES: AttStatus[] = ['present', 'worked', 'tardy', 'call_out', 'ncns', 'sent_home', 'time_off', 'no_punch']

export type AttRow = {
  date: string
  house: string
  status: AttStatus
  scheduledStart: string
  scheduledEnd: string
  actualStart: string
  actualEnd: string
  notice: string
  details: string
  source: string
}

export type PerfCourse = {
  id: string
  label: string
  scope: string
  state: string
  completed: string
  expires: string
  provider: string
  note: string
  /** the requirement a paper is filed under for this course; '' when none is */
  reqId: string
}

export type TrainingRequest = { id: string; priority: string; details: string; by: string; at: string; self: boolean }

export type DocArea = {
  id: string
  label: string
  source: string
  connected: boolean
  expected: number
  complete: number
  late: number
  missing: number
  onTime: number
  rate: number | null
  why: string
}

export type DocException = { date: string; area: string; status: string; source: string; details: string; mark: string }

/** The areas whose missing record a person may mark concluded (app/staff.py DOC_MARK_AREAS). */
export const DOC_MARK_AREAS = ['daily_notes', 'time_tracking']

/** A PSI record missing that a mark may conclude. */
export const concludable = (x: DocException): boolean => x.status === 'missing' && DOC_MARK_AREAS.includes(x.area)

export type HrStatus = 'under_review' | 'resolved' | 'open'

export type HrRow = {
  date: string
  title: string
  description: string
  category: string
  severity: string
  decision: string
  action: string
  outcome: string
  nextReview: string
  termination: string
  status: HrStatus
}

export type NeedRow = { title: string; area: string; status: string; date: string; tone: PillTint }

export type PerfActivity = { at: string; kind: string; title: string; detail: string }

export type ScorePart = { id: string; label: string; value: number; weight: number }

export type Performance = {
  windowDays: number
  builtAt: string
  score: { value: number | null; parts: ScorePart[]; formula: string }
  attendance: {
    connected: { schedule: boolean; scheduling: boolean; punches: boolean; calloffs: boolean }
    counts: { present: number; worked: number; tardy: number; callOuts: number; ncns: number; other: number; noPunch: number; scheduled: number }
    reliability: number | null
    tardyMinutes: number
    rows: AttRow[]
  }
  training: {
    mandatory: PerfCourse[]
    valueAdd: PerfCourse[]
    requests: TrainingRequest[]
    windowDays: number | null
    mandatoryCurrent: number
    mandatoryPct: number | null
    valueAddCurrent: number
    valueAddAreas: number
    connected: boolean
    why: string
  }
  documentation: { areas: DocArea[]; exceptions: DocException[]; rate: number | null }
  hr: { connected: boolean; why: string; rows: HrRow[]; open: number }
  needs: NeedRow[]
  activity: PerfActivity[]
  why: string
  degraded: boolean
}

const TONES: PillTint[] = ['mint', 'amber', 'danger', 'slate', 'blue', 'lavender']

const courseOf = (x: Rec): PerfCourse => ({
  id: str(x.id), label: str(x.label), scope: str(x.scope), state: str(x.state).toLowerCase(), completed: str(x.completed),
  expires: str(x.expires), provider: str(x.provider), note: str(x.note), reqId: str(x.req_id),
})

export function performanceOf(raw: unknown): Performance {
  const o = rec(raw)
  const sc = rec(o.score)
  const at = rec(o.attendance)
  const ac = rec(at.connected)
  const c = rec(at.counts)
  const tr = rec(o.training)
  const doc = rec(o.documentation)
  const hr = rec(o.hr)
  return {
    windowDays: num(o.window_days) ?? 90,
    builtAt: str(o.built_at),
    score: {
      value: num(sc.value),
      parts: list(sc.parts).map((p) => ({ id: str(p.id), label: str(p.label), value: int(p.value), weight: int(p.weight) })),
      formula: str(sc.formula),
    },
    attendance: {
      connected: { schedule: ac.schedule === true, scheduling: ac.scheduling === true, punches: ac.punches === true, calloffs: ac.calloffs === true },
      counts: {
        present: int(c.present), worked: int(c.worked), tardy: int(c.tardy), callOuts: int(c.call_outs), ncns: int(c.ncns),
        other: int(c.other), noPunch: int(c.no_punch), scheduled: int(c.scheduled),
      },
      reliability: num(at.reliability),
      tardyMinutes: num(at.tardy_minutes) ?? 5,
      rows: list(at.rows).map((r) => ({
        date: str(r.date), house: str(r.house),
        status: ATT_STATUSES.includes(str(r.status) as AttStatus) ? str(r.status) as AttStatus : 'no_punch',
        scheduledStart: str(r.scheduled_start), scheduledEnd: str(r.scheduled_end), actualStart: str(r.actual_start),
        actualEnd: str(r.actual_end), notice: str(r.notice), details: str(r.details), source: str(r.source),
      })).filter((r) => r.date),
    },
    training: {
      mandatory: list(tr.mandatory).map(courseOf),
      valueAdd: list(tr.value_add).map(courseOf),
      requests: list(tr.requests).map((q) => ({
        id: str(q.id), priority: str(q.priority).toLowerCase() || 'normal', details: str(q.details), by: str(q.by), at: str(q.at),
        self: q.self === true,
      })),
      windowDays: num(tr.window_days),
      mandatoryCurrent: int(tr.mandatory_current),
      mandatoryPct: num(tr.mandatory_pct),
      valueAddCurrent: int(tr.value_add_current),
      valueAddAreas: int(tr.value_add_areas),
      connected: tr.connected === true,
      why: str(tr.why),
    },
    documentation: {
      areas: list(doc.areas).map((a) => ({
        id: str(a.id), label: str(a.label), source: str(a.source), connected: a.connected === true, expected: int(a.expected),
        complete: int(a.complete), late: int(a.late), missing: int(a.missing), onTime: int(a.on_time), rate: num(a.rate), why: str(a.why),
      })),
      exceptions: list(doc.exceptions).map((x) => ({
        date: str(x.date), area: str(x.area), status: str(x.status).toLowerCase(), source: str(x.source), details: str(x.details),
        mark: str(x.mark),
      })),
      rate: num(doc.rate),
    },
    hr: {
      connected: hr.connected === true,
      why: str(hr.why),
      open: int(hr.open),
      rows: list(hr.rows).map((r) => ({
        date: str(r.date), title: str(r.title), description: str(r.description), category: str(r.category), severity: str(r.severity),
        decision: str(r.decision), action: str(r.action), outcome: str(r.outcome), nextReview: str(r.next_review),
        termination: str(r.termination),
        status: (['under_review', 'resolved', 'open'] as const).find((s) => s === str(r.status)) ?? 'open',
      })),
    },
    needs: list(o.needs).map((n) => ({
      title: str(n.title), area: str(n.area), status: str(n.status), date: str(n.date),
      tone: TONES.includes(str(n.tone) as PillTint) ? str(n.tone) as PillTint : 'amber',
    })).filter((n) => n.title),
    activity: list(o.activity).map((a) => ({ at: str(a.at), kind: str(a.kind), title: str(a.title), detail: str(a.detail) }))
      .filter((a) => a.at && a.title),
    why: str(o.why),
    degraded: o.degraded === true,
  }
}

/* ---------- words and pills ---------- */

export const ATT_META: Record<AttStatus, PillMeta> = {
  present: { label: 'Present', tint: 'mint' },
  worked: { label: 'Worked', tint: 'mint' },
  tardy: { label: 'Tardy', tint: 'amber' },
  call_out: { label: 'Call-Out', tint: 'danger' },
  ncns: { label: 'No Call / No Show', tint: 'danger' },
  sent_home: { label: 'Sent Home', tint: 'slate' },
  time_off: { label: 'Time Off', tint: 'blue' },
  no_punch: { label: 'No Punch', tint: 'slate' },
}

const COURSE_META: Record<string, PillMeta> = {
  current: { label: 'Current', tint: 'mint' },
  due_soon: { label: 'Due Soon', tint: 'amber' },
  expired: { label: 'Expired', tint: 'danger' },
  overdue: { label: 'Overdue', tint: 'danger' },
  owed: { label: 'Owed', tint: 'amber' },
  renewal_assigned: { label: 'Renewal Assigned', tint: 'blue' },
  in_review: { label: 'In Review', tint: 'lavender' },
  no_date: { label: 'No Date', tint: 'slate' },
  not_on_file: { label: 'Not on File', tint: 'slate' },
  unread: { label: 'Not Read', tint: 'slate' },
}

export const courseMeta = (state: string): PillMeta => COURSE_META[state] ?? { label: state || 'Unknown', tint: 'slate' }

const DOC_META: Record<string, PillMeta> = {
  late: { label: 'Late', tint: 'amber' },
  missing: { label: 'Missing', tint: 'danger' },
  returned: { label: 'Returned', tint: 'lavender' },
  incomplete: { label: 'Incomplete', tint: 'amber' },
  concluded: { label: 'Concluded', tint: 'mint' },
}

export const docMeta = (status: string): PillMeta => DOC_META[status] ?? { label: status || 'Exception', tint: 'slate' }

export const DOC_AREA_WORDS: Record<string, string> = {
  daily_notes: 'Daily notes', time_tracking: 'Time tracking', incidents: 'Incident documentation',
}

export const HR_META: Record<HrStatus, PillMeta> = {
  under_review: { label: 'Under Review', tint: 'amber' },
  resolved: { label: 'Resolved', tint: 'mint' },
  open: { label: 'Open', tint: 'slate' },
}

export const HR_SEVERITIES = ['Coaching', 'Verbal warning', 'Written warning', 'Final warning'] as const
export const HR_CATEGORIES = ['Conflict', 'Dress code', 'Attendance', 'Conduct', 'Documentation', 'Other compliance'] as const

/** '08:00' → '8:00 AM'; anything else as written. */
export function clockWords(v: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
  if (!m) return v
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

export const spanWords = (a: string, b: string): string => [a, b].filter(Boolean).map(clockWords).join(' – ')

export const pct = (v: number | null): string => (v === null ? '—' : `${v}%`)
