// STAFF PERFORMANCE — the DSP analysis, drawn like the client Unique page — the DSP analysis interface mirrors the…
// Two screens in one route — the route being wherever this page is mounted (ABSORBED into Workforce Compliance; it…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import {
  AlarmClock, ArrowLeft, BadgeCheck, Car, ClipboardList, Download, GraduationCap,
  Loader2, Mail, MessageSquarePlus, Phone, RefreshCw, Search, Share2, ShieldAlert, Sparkles, Users,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import PageHeader from '@/components/shared/PageHeader'
import ScreenSwitcher from '@/pages/features/employeetracker/ScreenSwitcher'
import { gasAction } from '@/features/hiring/shared'
import { useAuthStore } from '@/auth/useAuthStore'
import { share } from '@/stores/useShareStore'
import { exportRows, type ExportColumn } from '@/lib/exportTable'
import { toast } from '@/stores/useToastStore'
import { keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { ohioDateTime } from '@/lib/ohio'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { cn } from '@/lib/utils'

type BoardRow = {
  emp_id: string
  name: string
  status: string
  phone: string
  email: string
  hire_date: string
  attendance_90d: number
  attendance_all: number
  incidents: number
  incidents_major: number
  certs_expired: number
  certs_expiring: number
  grade: number
}

type Profile = {
  staff: { emp_id: string; name: string; status: string; phone: string; email: string;
           hire_date: string; driver: string; hs_diploma: string }
  attendance: { date: string; kind: string; notes: string; by: string }[]
  incidents: { date: string; type: string; severity: string; category: string;
               summary: string; action: string; status: string }[]
  notes: { at: string; category: string; text: string }[]
  certs: { cert: string; expires: string; status: string }[]
  grade: { value: number; parts: { label: string; count: number; cut: number }[]; ai: number | null }
  ai: { summary: string; tags: string[]; made_at: string }
  // the record moved past the kept AI paragraph — staffPerfEvaluate runs in the background (absent on old kept…
  ai_stale?: boolean
}

/** The profile as plain text — the share sheet's copy/e-mail body. */
function profileText(p: Profile): string {
  const s = p.staff
  const lines: string[] = [
    `${s.name} — Direct Support Professional`,
    [s.status && `Status: ${s.status}`, s.hire_date && `Hired: ${s.hire_date}`,
     s.phone && `Phone: ${formatPhoneDisplay(s.phone)}`, s.email && `E-mail: ${s.email}`,
     s.driver && `Driver: ${s.driver}`, s.hs_diploma && `HS diploma: ${s.hs_diploma}`]
      .filter(Boolean).join(' · '),
    `Grade: ${p.grade.value}/10${p.grade.ai != null ? ` (AI: ${p.grade.ai})` : ''}`,
  ]
  if (p.grade.parts.length) {
    lines.push(p.grade.parts.map((x) => `${x.cut} for ${x.count} ${x.label}`).join('; '))
  }
  if (p.ai.summary) lines.push('', p.ai.summary)
  if (p.ai.tags.length) lines.push(p.ai.tags.map((t) => `• ${t}`).join('\n'))
  if (p.attendance.length) {
    lines.push('', `ATTENDANCE (${p.attendance.length}):`)
    for (const r of p.attendance.slice(0, 30)) lines.push(`${r.date} — ${r.kind}${r.notes ? ` — ${r.notes}` : ''}`)
  }
  if (p.incidents.length) {
    lines.push('', `INCIDENTS (${p.incidents.length}):`)
    for (const r of p.incidents.slice(0, 30)) lines.push(`${r.date} [${r.type}/${r.severity}] ${r.summary}`)
  }
  if (p.certs.length) {
    lines.push('', 'CERTIFICATIONS:', p.certs.map((c) => `${c.cert} (${c.status})`).join(', '))
  }
  if (p.notes.length) {
    lines.push('', `NOTES (${p.notes.length}):`)
    for (const r of p.notes.slice(0, 20)) lines.push(`${r.at.slice(0, 10)} — ${r.text}`)
  }
  return lines.join('\n')
}

/** The profile flattened for a real CSV — one row per record entry. */
const PROFILE_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'section', label: 'Section' },
  { key: 'date', label: 'Date' },
  { key: 'kind', label: 'Kind' },
  { key: 'detail', label: 'Detail' },
  { key: 'extra', label: 'Extra' },
]
function profileExportRows(p: Profile): Record<string, string>[] {
  const s = p.staff
  const rows: Record<string, string>[] = [
    { section: 'fact', date: s.hire_date, kind: 'staff', detail: s.name,
      extra: [s.status, s.phone && formatPhoneDisplay(s.phone), s.email].filter(Boolean).join(' · ') },
    { section: 'fact', date: '', kind: 'grade',
      detail: `${p.grade.value}/10`, extra: p.grade.ai != null ? `AI ${p.grade.ai}` : '' },
  ]
  for (const r of p.attendance) rows.push({ section: 'attendance', date: r.date, kind: r.kind, detail: r.notes, extra: r.by })
  for (const r of p.incidents) rows.push({ section: 'incident', date: r.date, kind: `${r.type}/${r.severity}`, detail: r.summary, extra: r.action })
  for (const r of p.notes) rows.push({ section: 'note', date: r.at.slice(0, 10), kind: r.category, detail: r.text, extra: '' })
  for (const c of p.certs) rows.push({ section: 'cert', date: c.expires, kind: c.status, detail: c.cert, extra: '' })
  return rows
}

const STATUS_CHIP: Record<string, string> = {
  Active: 'bg-tint-mint text-tint-fg-mint',
  Pending: 'bg-tint-amber text-tint-fg-amber',
  Terminated: 'bg-surface-3 text-text-3',
}

const CERT_CHIP: Record<string, string> = {
  current: 'bg-tint-mint text-tint-fg-mint',
  expiring: 'bg-tint-amber text-tint-fg-amber',
  expired: 'bg-tint-pink text-tint-fg-pink',
}

/** THE NOTA'S COLOUR — one rule everywhere: 8+ mint, 6+ amber, under 6 pink. */
const gradeChip = (g: number) =>
  g >= 8 ? 'bg-tint-mint text-tint-fg-mint' : g >= 6 ? 'bg-tint-amber text-tint-fg-amber' : 'bg-tint-pink text-tint-fg-pink'

/** the client Unique page's chip rhythm — a rotating tint per tag */
const TAG_TINTS = [
  'bg-tint-blue text-tint-fg-blue',
  'bg-tint-mint text-tint-fg-mint',
  'bg-tint-amber text-tint-fg-amber',
  'bg-tint-pink text-tint-fg-pink',
  'bg-tint-lavender text-tint-fg-lavender',
  'bg-tint-peach text-tint-fg-peach',
]

export default function StaffPerformancePage({ embedded = false }: { embedded?: boolean } = {}) {
  const [params] = useSearchParams()
  const person = params.get('person') ?? ''
  return person ? <PersonView empId={person} /> : <BoardView embedded={embedded} />
}

// WHERE THIS SCREEN IS STANDING.
function useBoardPath(): string {
  return useLocation().pathname
}

/* ================= the board ================= */

function BoardView({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate()
  const boardPath = useBoardPath()
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  // KEPT COPY — the board was painfully slow, so the board paints instantly from the last read and refreshes behind.
  const [rows, setRows] = useState<BoardRow[] | null>(() => readKept<BoardRow[]>('asa:perf:board'))
  const [migrated, setMigrated] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  // when the PRECOMPUTED board (perf_board, T13) was last built — the answer carries the stamp so the screen can…
  const [computedAt, setComputedAt] = useState('')
  const [recomputing, setRecomputing] = useState(false)
  const [q, setQ] = useState('')

  // the board is built by Python at every read, off the copy: the last answer kept here paints while it comes
  const load = useCallback(() => {
    // a read still in flight at a sign-out or a crossing keeps nothing (lib/kept)
    const generation = keptGeneration()
    gasAction<{ rows: BoardRow[]; migrated: boolean; computed_at?: string }>('staffPerfList', {}, { timeoutMs: 120000 })
      .then((d) => {
        setRows(d.rows ?? [])
        keepIfCurrent('asa:perf:board', d.rows ?? [], generation)
        setMigrated(d.migrated !== false)
        setComputedAt(d.computed_at ?? '')
        setError(null)
      })
      .catch((e) => { setError((prev) => prev ?? (e instanceof Error ? e.message : 'The board did not answer.')) })
  }, [])
  useEffect(() => { load() }, [load])

  const runRecompute = () => {
    setRecomputing(true)
    void gasAction<{ rows: number; computed_at: string; stored: boolean }>('staffPerfRecompute', {}, { timeoutMs: 300000 })
      .then((d) => {
        toast({
          type: 'success',
          title: `Board recomputed — ${d.rows} row${d.rows === 1 ? '' : 's'}`,
          body: d.stored ? 'Stored; every next open answers instantly.' : 'Too large to store — the board keeps computing live.',
        })
        load()
      })
      .catch((e) => toast({ type: 'danger', title: 'The recompute did not run', body: e instanceof Error ? e.message : 'Try again.' }))
      .finally(() => setRecomputing(false))
  }

  const runMigrate = () => {
    setMoving(true)
    void gasAction<{ added: Record<string, number> }>('staffPerfMigrate', {}, { timeoutMs: 300000 })
      .then((d) => {
        const total = Object.values(d.added ?? {}).reduce((a, b) => a + b, 0)
        toast({
          type: 'success',
          title: total ? `${total} rows moved onto our sheets` : 'Nothing new to move',
          body: Object.entries(d.added ?? {}).map(([t, n]) => `${t.replace('perf_', '')}: ${n}`).join(' · '),
        })
        load()
      })
      .catch((e) => toast({ type: 'danger', title: 'The move did not run', body: e instanceof Error ? e.message : 'Try again.' }))
      .finally(() => setMoving(false))
  }

  const needle = q.trim().toLowerCase()
  const view = useMemo(() => (rows ?? []).filter((r) =>
    !needle || r.name.toLowerCase().includes(needle) || r.status.toLowerCase().includes(needle)),
  [rows, needle])

  // EMBEDDED, THIS SCREEN IS A TAB AND NOT A PAGE — the Staff Performance app becomes part of Behavior Support.
  const actions = (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5">
              <Search size={14} className="shrink-0 text-text-3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search staff…"
                className="h-9 w-[190px] bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3"
              />
            </div>
            {isAdmin && (
              <button
                onClick={runRecompute}
                disabled={recomputing}
                title="Rebuild the precomputed board from the perf_* tabs right now — the hourly service clock does the same on its own"
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-60"
              >
                {recomputing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {recomputing ? 'Recomputing…' : 'Recompute'}
              </button>
            )}
            {isAdmin && (
              <button
                onClick={runMigrate}
                disabled={moving}
                title="Copy the old platform's Master Data (roster, call-offs, HR, client incidents, daily notes, cert dates) onto our own sheets — idempotent, only new rows land"
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-60"
              >
                {moving ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {moving ? 'Moving…' : migrated ? 'Sync from Master' : 'Bring the data in'}
              </button>
            )}
            {/* LAST, ON THE RIGHT — the standing rule for this control,
                set on the tracker and holding everywhere: the thing that
                changes WHERE YOU ARE ends the row, and everything that only
                acts on the screen you are already looking at comes before it.
                It is also not optional here: Workforce Compliance took its
                pages off the sidebar rail, so a screen without this dropdown is
                a room with no door. */}
            {!embedded && <ScreenSwitcher />}
          </div>
  )

  return (
    <div>
      {embedded ? (
        <div className="mb-4 flex justify-end">{actions}</div>
      ) : (
        <PageHeader
          title="Staff Performance"
          subtitle="Every DSP's record on our own sheets — attendance, incidents, certifications, and the AI's read."
          actions={actions}
        />
      )}

      {/* the store's honesty: WHEN these numbers were computed, Ohio clock */}
      {computedAt && (
        <p className="mt-2 text-[11.5px] text-text-3">Board computed {ohioDateTime(computedAt)}</p>
      )}

      {error && !rows ? (
        <Card className="mt-5 p-6 text-center text-[13px] text-text-2">{error}</Card>
      ) : rows === null ? (
        <p className="mt-6 flex items-center gap-2 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading the board…
        </p>
      ) : rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing migrated yet"
            body={isAdmin
              ? 'Press "Bring the data in" — the old platform\'s Master Data (roster, call-offs, HR record, incidents, notes, certification dates) is copied onto our own sheets, and the analysis starts from there.'
              : 'An admin brings the data in from the old platform first; the board fills from there.'}
          />
        </div>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {view.map((r) => (
            <button
              key={r.emp_id}
              onClick={() => navigate(`${boardPath}?person=${encodeURIComponent(r.emp_id)}`)}
              className="rounded-lg border border-border bg-surface p-3.5 text-left shadow-1 transition-all hover:border-border-strong hover:shadow-2"
            >
              <div className="flex items-center gap-2.5">
                {/* the card opens the profile on click; the portrait and the
                    name also travel to the tracker (native dragstart, so the
                    two gestures never fight) */}
                <DragPerson
                  name={r.name}
                  id={r.emp_id}
                  subtitle="Direct Support Professional"
                  className="min-w-0 flex-1 items-center gap-2.5"
                >
                  <Avatar name={r.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="clamp-1 block text-[13.5px] font-semibold text-text-1">{r.name}</span>
                    </span>
                    <span className="text-[11px] text-text-3">{r.hire_date ? `Since ${r.hire_date}` : r.email || '—'}</span>
                  </span>
                </DragPerson>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold', STATUS_CHIP[r.status] ?? 'bg-surface-2 text-text-3')}>
                  {r.status || '—'}
                </span>
              </div>
              {/* THE NOTA up front, and the lights SAY what they mean — an
                  OK beside a red and a yellow explains nothing on its own */}
              <div className="mt-3 flex items-center gap-2">
                <span className={cn('rounded-md px-2 py-0.5 text-[15px] font-bold tabular-nums', gradeChip(r.grade))}>
                  {Number.isFinite(r.grade) ? r.grade.toFixed(1) : '—'}
                </span>
                <span className="min-w-0 flex-1 text-[11px] leading-4 text-text-3">
                  <span className="block">
                    <AlarmClock size={10} className="mr-1 inline" />
                    {r.attendance_90d} call-off{r.attendance_90d === 1 ? '' : 's'} in 90d ({r.attendance_all} ever)
                    {r.incidents > 0 && <> · <ShieldAlert size={10} className="mr-0.5 inline" />{r.incidents} incident{r.incidents === 1 ? '' : 's'}{r.incidents_major ? ` (${r.incidents_major} major)` : ''}</>}
                  </span>
                  <span className="block">
                    <GraduationCap size={10} className="mr-1 inline" />
                    {r.certs_expired > 0 || r.certs_expiring > 0
                      ? `${r.certs_expired ? `${r.certs_expired} cert${r.certs_expired === 1 ? '' : 's'} expired` : ''}${r.certs_expired && r.certs_expiring ? ' · ' : ''}${r.certs_expiring ? `${r.certs_expiring} expiring soon` : ''}`
                      : 'certifications current'}
                  </span>
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ================= the person, Unique-style ================= */

function PersonView({ empId }: { empId: string }) {
  const navigate = useNavigate()
  const boardPath = useBoardPath()
  const [profile, setProfile] = useState<Profile | null>(() => readKept<Profile>(`asa:perf:${empId}`))
  const [busy, setBusy] = useState(profile === null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [noting, setNoting] = useState(false)

  // The model runs OFF the read (the LLM inside the read lane blew the relay's patient budget and the screen…
  const evaluate = useCallback((refresh?: boolean) => {
    const generation = keptGeneration()
    void gasAction<{ summary: string; tags: string[]; grade: number | null; made_at: string; fresh: boolean }>(
      'staffPerfEvaluate', refresh ? { emp_id: empId, refresh: true } : { emp_id: empId },
      { timeoutMs: 120000 })
      .then((d) => {
        if (!d.summary) return
        setProfile((p) => {
          if (!p) return p
          const merged: Profile = {
            ...p,
            ai: { summary: d.summary, tags: d.tags ?? [], made_at: d.made_at },
            grade: { ...p.grade, ai: d.grade },
            ai_stale: false,
          }
          keepIfCurrent(`asa:perf:${empId}`, merged, generation)
          return merged
        })
      })
      .catch(() => { /* the kept paragraph stands; the next open retries */ })
      .finally(() => setRefreshing(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per person
  }, [empId])

  const load = useCallback(() => {
    const generation = keptGeneration()
    gasAction<Profile>('staffPerfProfile', { emp_id: empId }, { timeoutMs: 60000 })
      .then((d) => {
        setProfile(d)
        keepIfCurrent(`asa:perf:${empId}`, d, generation)
        setError(null)
        if (d.ai_stale) evaluate()
      })
      .catch((e) => { if (!profile) setError(e instanceof Error ? e.message : 'The profile did not answer.') })
      .finally(() => { setBusy(false); setRefreshing(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kept copy semantics: load per person
  }, [empId, evaluate])
  useEffect(() => { load() }, [load])

  const addNote = () => {
    const t = noteText.trim()
    if (!t || noting) return
    setNoting(true)
    void gasAction('staffPerfNoteAdd', { emp_id: empId, text: t })
      .then(() => { setNoteText(''); load() })
      .catch((e) => toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' }))
      .finally(() => setNoting(false))
  }

  // THE TWO FORMS THE PORT LEFT BEHIND (gap survey §5): the old platform's Log Absence and Add Incident.
  const [absence, setAbsence] = useState<{ date: string; kind: string; notes: string } | null>(null)
  const [incident, setIncident] = useState<{ severity: string; summary: string; category: string } | null>(null)
  const [writing, setWriting] = useState(false)
  const logAbsence = async () => {
    if (!absence || writing) return
    setWriting(true)
    try {
      await gasAction('staffPerfAbsenceAdd',
        { emp_id: empId, date: absence.date, kind: absence.kind, notes: absence.notes.trim() })
      setAbsence(null)
      toast({ type: 'success', title: 'Absence logged' })
      load()
    } catch (e) {
      toast({ type: 'danger', title: 'Not logged', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setWriting(false) }
  }
  const addIncident = async () => {
    if (!incident || writing) return
    if (incident.summary.trim().length < 5) {
      toast({ type: 'warning', title: 'Describe it first', body: 'A few words on what happened.' })
      return
    }
    setWriting(true)
    try {
      await gasAction('staffPerfIncidentAdd',
        { emp_id: empId, severity: incident.severity, summary: incident.summary.trim(),
          category: incident.category.trim() })
      setIncident(null)
      toast({ type: 'success', title: 'Incident recorded' })
      load()
    } catch (e) {
      toast({ type: 'danger', title: 'Not recorded', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setWriting(false) }
  }

  if (error && !profile) {
    return (
      <div>
        <BackBar onBack={() => navigate(boardPath)} />
        <Card className="mt-4 p-6 text-center text-[13px] text-text-2">{error}</Card>
      </div>
    )
  }
  if (!profile) {
    return (
      <div>
        <BackBar onBack={() => navigate(boardPath)} />
        <p className="mt-6 flex items-center gap-2 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Assembling the profile…
        </p>
      </div>
    )
  }

  const s = profile.staff
  return (
    <div>
      <BackBar onBack={() => navigate(boardPath)} />

      {/* ── header — the Unique page's hero, our person ── */}
      <Card className="mb-4 mt-3 flex flex-wrap items-center gap-4 p-4">
        <DragPerson name={s.name} id={s.emp_id} subtitle="Direct Support Professional" className="shrink-0">
          <Avatar name={s.name} size="lg" />
        </DragPerson>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="flex items-center gap-2 text-[18px] font-bold text-text-1">
              <DragPerson name={s.name} id={s.emp_id} subtitle="Direct Support Professional">
                {s.name}
              </DragPerson>
            </h1>
            <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-bold', STATUS_CHIP[s.status] ?? 'bg-surface-2 text-text-3')}>
              {s.status || '—'}
            </span>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12.5px] text-text-3">
            <span>Direct Support Professional</span>
            {s.hire_date && <span>Since {s.hire_date}</span>}
            {s.phone && <span className="flex items-center gap-1"><Phone size={11} /> {formatPhoneDisplay(s.phone)}</span>}
            {s.email && <span className="flex items-center gap-1"><Mail size={11} /> {s.email}</span>}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {/* Share/Download the profile: the one
              share sheet every app uses — e-mail in-platform, copy,
              download, print; never a browser dialog. */}
          <button
            onClick={() => profile && share({
              title: s.name,
              subtitle: 'Direct Support Professional — Staff Performance',
              text: profileText(profile),
              appHref: `${boardPath}?person=${encodeURIComponent(s.emp_id)}`,
              rows: profileExportRows(profile),
              columns: PROFILE_EXPORT_COLUMNS,
              filename: `${s.name.replace(/\s+/g, '-')}-profile`,
              icon: 'id-card',
            })}
            disabled={!profile}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-60"
          >
            <Share2 size={13} /> Share
          </button>
          <button
            onClick={() => profile && exportRows(`${s.name.replace(/\s+/g, '-')}-performance-profile`,
              PROFILE_EXPORT_COLUMNS, profileExportRows(profile), 'csv')}
            disabled={!profile}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-60"
          >
            <Download size={13} /> Download
          </button>
          <button
            onClick={() => { setIncident(null); setAbsence(absence ? null : { date: new Date().toISOString().slice(0, 10), kind: 'absence', notes: '' }) }}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 hover:bg-surface-2"
          >
            Log absence
          </button>
          <button
            onClick={() => { setAbsence(null); setIncident(incident ? null : { severity: 'low', summary: '', category: '' }) }}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 hover:bg-surface-2"
          >
            Add incident
          </button>
          <button
            onClick={() => { setRefreshing(true); load(); evaluate(true) }}
            disabled={refreshing}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-60"
          >
            {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
          </button>
        </div>
      </Card>

      {absence && (
        <Card className="mb-4 flex flex-wrap items-end gap-2.5 p-4">
          <label className="grid gap-1 text-[11.5px] font-semibold text-text-2">Date
            <input type="date" value={absence.date}
              onChange={(e) => setAbsence({ ...absence, date: e.target.value })}
              className="h-9 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-text-1 outline-none focus:border-primary" />
          </label>
          <label className="grid gap-1 text-[11.5px] font-semibold text-text-2">Kind
            <select value={absence.kind}
              onChange={(e) => setAbsence({ ...absence, kind: e.target.value })}
              className="h-9 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-text-1 outline-none focus:border-primary">
              {['absence', 'late', 'no-show', 'left-early', 'excused'].map((k) => <option key={k}>{k}</option>)}
            </select>
          </label>
          <label className="grid min-w-[220px] flex-1 gap-1 text-[11.5px] font-semibold text-text-2">Notes
            <input value={absence.notes} placeholder="Optional context"
              onChange={(e) => setAbsence({ ...absence, notes: e.target.value })}
              className="h-9 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-text-1 outline-none focus:border-primary" />
          </label>
          <button onClick={() => void logAbsence()} disabled={writing}
            className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary disabled:opacity-50">
            {writing ? 'Saving…' : 'Log it'}
          </button>
        </Card>
      )}

      {incident && (
        <Card className="mb-4 flex flex-wrap items-end gap-2.5 p-4">
          <label className="grid gap-1 text-[11.5px] font-semibold text-text-2">Severity
            <select value={incident.severity}
              onChange={(e) => setIncident({ ...incident, severity: e.target.value })}
              className="h-9 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-text-1 outline-none focus:border-primary">
              {['low', 'medium', 'high', 'critical'].map((s2) => <option key={s2}>{s2}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[11.5px] font-semibold text-text-2">Category
            <input value={incident.category} placeholder="e.g. documentation"
              onChange={(e) => setIncident({ ...incident, category: e.target.value })}
              className="h-9 w-40 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-text-1 outline-none focus:border-primary" />
          </label>
          <label className="grid min-w-[240px] flex-1 gap-1 text-[11.5px] font-semibold text-text-2">What happened
            <input value={incident.summary} placeholder="A sentence on the incident"
              onChange={(e) => setIncident({ ...incident, summary: e.target.value })}
              className="h-9 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-text-1 outline-none focus:border-primary" />
          </label>
          <button onClick={() => void addIncident()} disabled={writing}
            className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary disabled:opacity-50">
            {writing ? 'Saving…' : 'Record it'}
          </button>
        </Card>
      )}

      {/* ── THE NOTA — the number, and the arithmetic under it ── */}
      <Card className="mb-4 flex flex-wrap items-center gap-4 p-4">
        <div className={cn('grid h-[72px] w-[72px] shrink-0 place-items-center rounded-xl', gradeChip(profile.grade?.value ?? 10))}>
          <span className="text-[26px] font-bold tabular-nums">{(profile.grade?.value ?? 10).toFixed(1)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-text-1">
            Grade {(profile.grade?.value ?? 10).toFixed(1)} / 10
            {profile.grade?.ai !== null && profile.grade?.ai !== undefined &&
              Math.abs(profile.grade.ai - profile.grade.value) >= 0.1 && (
              <span className="ml-2 text-[12px] font-semibold text-text-3">
                · the AI argues {profile.grade.ai.toFixed(1)} (its reason is in the evaluation below)
              </span>
            )}
          </p>
          {(profile.grade?.parts?.length ?? 0) > 0 ? (
            <ul className="mt-1 space-y-0.5 text-[12px] leading-4 text-text-3">
              {profile.grade.parts.map((x) => (
                <li key={x.label}>
                  <span className="font-semibold tabular-nums text-tint-fg-pink">{x.cut}</span>
                  {' '}for {x.count} {x.label}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[12px] text-text-3">A clean record — nothing subtracted from 10.</p>
          )}
        </div>
      </Card>

      {/* ── the evaluation — the AI arguing over OUR facts ── */}
      <Card className="mb-4 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Sparkles size={14} className="text-tint-fg-lavender" />
          <h2 className="text-[13.5px] font-bold text-text-1">The evaluation</h2>
        </div>
        {busy && !profile.ai.summary ? (
          <p className="flex items-center gap-2 text-[13px] text-text-3"><Loader2 size={13} className="animate-spin" /> Reading the record…</p>
        ) : profile.ai.summary ? (
          <>
            <p className="text-[13px] leading-[1.6] text-text-2">{profile.ai.summary}</p>
            {profile.ai.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {profile.ai.tags.map((t, i) => (
                  <span key={t} className={cn('rounded-full px-2.5 py-1 text-[11.5px] font-semibold', TAG_TINTS[i % TAG_TINTS.length])}>
                    {t}
                  </span>
                ))}
              </div>
            )}
            <p className="mt-2.5 text-[10.5px] text-text-3">
              Assembled from the migrated record only — re-made when the record changes or on Refresh.
              Sources: Master Data (migrated).
            </p>
          </>
        ) : (
          <p className="text-[13px] italic text-text-3">
            Not enough on file for a written read — the record below is everything the platform holds.
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* ── left rail: the facts and the lights ── */}
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Personal details</h3>
            <dl className="space-y-2 text-[12.5px]">
              <FactRow icon={<Users size={12} />} label="Employee id" value={s.emp_id.replace(/^EMP_/, '#')} />
              <FactRow icon={<BadgeCheck size={12} />} label="Status" value={s.status || '—'} />
              <FactRow icon={<ClipboardList size={12} />} label="Hired" value={s.hire_date || 'Not on file'} />
              <FactRow icon={<Phone size={12} />} label="Phone" value={s.phone ? formatPhoneDisplay(s.phone) : 'Not on file'} />
              <FactRow icon={<Mail size={12} />} label="E-mail" value={s.email || 'Not on file'} />
              <FactRow icon={<Car size={12} />} label="Driver" value={s.driver || 'Not on file'} />
              <FactRow icon={<GraduationCap size={12} />} label="HS diploma" value={s.hs_diploma || 'Not on file'} />
            </dl>
          </Card>

          <Card className="p-4">
            <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Certifications</h3>
            {profile.certs.length === 0 ? (
              <p className="text-[12.5px] italic text-text-3">None on the migrated record.</p>
            ) : (
              <div className="space-y-1.5">
                {profile.certs.map((c) => (
                  <div key={c.cert} className="flex items-center gap-2 text-[12.5px]">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', {
                      current: 'bg-tint-fg-mint', expiring: 'bg-tint-fg-amber', expired: 'bg-tint-fg-pink',
                    }[c.status] ?? 'bg-surface-3')} />
                    <span className="min-w-0 flex-1 text-text-1">{c.cert}</span>
                    <span className={cn('shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold', CERT_CHIP[c.status] ?? 'bg-surface-2 text-text-3')}>
                      {c.status === 'current' ? (c.expires || 'current') : `${c.status} · ${c.expires}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ── the record ── */}
        <div className="space-y-4">
          <Card padded={false} className="overflow-hidden">
            <SectionHead title={`Attendance · ${profile.attendance.length}`} />
            {profile.attendance.length === 0 ? (
              <p className="px-4 py-5 text-center text-[12.5px] italic text-text-3">No call-offs or lates on the record.</p>
            ) : (
              <div className="divide-y divide-border/60">
                {profile.attendance.slice(0, 25).map((a, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2">
                    <span className="w-[92px] shrink-0 text-[12px] font-semibold tabular-nums text-text-1">{a.date || '—'}</span>
                    <span className="shrink-0 rounded-full bg-tint-amber px-1.5 py-px text-[10.5px] font-semibold text-tint-fg-amber">{a.kind || 'Call off'}</span>
                    <span className="min-w-0 flex-1 text-[12px] text-text-3">{a.notes}</span>
                    {/* the manager who logged the call-off is a person too */}
                    {a.by && <span className="text-[10.5px] text-text-3">by <DragPerson name={a.by}>{a.by}</DragPerson></span>}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card padded={false} className="overflow-hidden">
            <SectionHead title={`Incidents · ${profile.incidents.length}`} />
            {profile.incidents.length === 0 ? (
              <p className="px-4 py-5 text-center text-[12.5px] italic text-text-3">Nothing on the incident record.</p>
            ) : (
              <div className="divide-y divide-border/60">
                {profile.incidents.slice(0, 20).map((x, i) => (
                  <div key={i} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-semibold tabular-nums text-text-1">{x.date || '—'}</span>
                      <span className={cn('rounded-full px-1.5 py-px text-[10.5px] font-semibold',
                        x.severity === 'Major' ? 'bg-tint-pink text-tint-fg-pink' : 'bg-tint-blue text-tint-fg-blue')}>
                        {x.type}{x.severity ? ` · ${x.severity}` : ''}
                      </span>
                      {x.category && <span className="text-[11px] text-text-3">{x.category}</span>}
                      <span className="ml-auto text-[10.5px] uppercase tracking-wide text-text-3">{x.status}</span>
                    </div>
                    <p className="mt-1 text-[12.5px] leading-5 text-text-2">{x.summary}</p>
                    {x.action && <p className="mt-0.5 text-[11.5px] text-text-3">Action: {x.action}</p>}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card padded={false} className="overflow-hidden">
            <SectionHead title={`Notes · ${profile.notes.length}`} />
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
              <MessageSquarePlus size={14} className="shrink-0 text-text-3" />
              <input
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addNote() }}
                placeholder="Write a manager note — lands on the record, signed by you"
                className="h-8 min-w-0 flex-1 bg-transparent text-[12.5px] text-text-1 outline-none placeholder:text-text-3"
              />
              <button
                onClick={addNote}
                disabled={noting || !noteText.trim()}
                className="flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11.5px] font-semibold text-on-primary disabled:opacity-50"
              >
                {noting ? <Loader2 size={11} className="animate-spin" /> : null} Add
              </button>
            </div>
            {profile.notes.length === 0 ? (
              <p className="px-4 py-5 text-center text-[12.5px] italic text-text-3">No notes yet.</p>
            ) : (
              <div className="divide-y divide-border/60">
                {profile.notes.slice(0, 20).map((n, i) => (
                  <div key={i} className="px-4 py-2">
                    <div className="flex items-center gap-2 text-[11px] text-text-3">
                      {n.category && <span className="rounded bg-surface-2 px-1.5 text-[10.5px] font-semibold uppercase">{n.category}</span>}
                      <span>{n.at}</span>
                    </div>
                    <p className="mt-0.5 text-[12.5px] leading-5 text-text-2">{n.text}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-text-3 hover:text-text-1">
      <ArrowLeft size={13} /> Staff Performance
    </button>
  )
}

function SectionHead({ title }: { title: string }) {
  return (
    <p className="border-b border-border px-4 py-2.5 text-[12.5px] font-bold text-text-1">{title}</p>
  )
}

function FactRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-text-3">{icon}</span>
      <span className="w-[86px] shrink-0 text-text-3">{label}</span>
      <span className="min-w-0 flex-1 break-words text-text-1">{value}</span>
    </div>
  )
}
