// TALENT PIPELINE — the scoreboard and the candidate profile.
// Every résumé is analysed and turned into a grade and facts about the person, the résumé is always shown INSIDE…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  AlertTriangle, ArrowLeft, FileText, GraduationCap, Loader2, Mail, MapPin,
  Phone, RefreshCw, Search, ShieldCheck, Sparkles, UserPlus, X,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import PageHeader from '@/components/shared/PageHeader'
import { api } from '@/lib/api'
import { invalidate } from '@/lib/apiCache'
import { noteWrite } from '@/lib/snapshotClient'
import { gasAction } from '@/features/hiring/shared'
import { useAuthStore } from '@/auth/useAuthStore'
import { openFile } from '@/stores/useFileViewerStore'
import { toast } from '@/stores/useToastStore'
import { keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { cn } from '@/lib/utils'

type TpRow = {
  candidate_id: string
  name: string
  phone: string
  email: string
  city: string
  status: string
  resume_link: string
  composite_score: string
  skills: string
  certs: string
  experience: string
  job_history: string
  years: string
  flags: string[]
  decision: string
  summary: string
  cjis: string
  cjis_report: string
  certifications: string
  screen_result: string
  screen_qualification: string
  screen_date: string
  screened_by: string
  // CAN THIS PERSON ENTER THE HIRING PROCESS, and if not WHY — answered by the server's own predicate…
  cross_ok?: boolean
  cross_why?: string
}

const DECISION_CHIP: Record<string, string> = {
  Advance: 'bg-tint-mint text-tint-fg-mint',
  Review: 'bg-tint-amber text-tint-fg-amber',
  Reject: 'bg-tint-pink text-tint-fg-pink',
}

// A NOTA — the grade was the one thing missing.
function notaOf(composite: string): number | null {
  const n = parseFloat(composite)
  if (Number.isNaN(n)) return null
  return Math.max(0, Math.min(10, Math.round((n / 12) * 100) / 10))
}
const notaChip = (g: number) =>
  g >= 8 ? 'bg-tint-mint text-tint-fg-mint' : g >= 6 ? 'bg-tint-amber text-tint-fg-amber' : 'bg-tint-pink text-tint-fg-pink'

export default function TalentPipelinePage({ embedded = false, onAdd, onPersonOpen }: {
  // TRUE when this screen is a VIEW of the unified Hiring page rather than its own route.
  embedded?: boolean
  // THE ENTRY DOOR BELONGS TO THE ROSTER, NOT TO THE PAGE — the buttons stay on Talents, where a person is picked.
  onAdd?: () => void
  // Told whenever somebody's profile opens or closes inside this view so the Views chooser and Talents can leave…
  onPersonOpen?: (open: boolean) => void
} = {}) {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const [params] = useSearchParams()
  // Embedded, the open person is local state — navigating would walk out of the Hiring page.
  const [localPerson, setLocalPerson] = useState('')
  const person = embedded ? localPerson : (params.get('person') ?? '')
  const openPerson = (id: string) => {
    setLocalPerson(id)
    onPersonOpen?.(!!id)
  }
  const [rows, setRows] = useState<TpRow[] | null>(() => readKept<TpRow[]>('asa:tp:board'))
  const [migrated, setMigrated] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)

  const load = useCallback(() => {
    // THE SLICE FIRST.
    const generation = keptGeneration()
    api.list<TpRow>('talentPool')
      .then((r) => {
        setRows(r ?? [])
        keepIfCurrent('asa:tp:board', r ?? [], generation)
        setMigrated((r ?? []).length > 0)
        setError(null)
      })
      .catch((e) => { if (!rows) setError(e instanceof Error ? e.message : 'The pipeline did not answer.') })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kept-copy: paint first, refresh behind
  }, [])
  useEffect(() => { load() }, [load])

  // THE TWO PRESSES ON A STORE ROW.
  const [rowBusy, setRowBusy] = useState('')
  const afterWrite = () => {
    invalidate('talentPool'); invalidate('candidates')
    noteWrite('talentPool'); noteWrite('candidates')
    load()
  }
  const bringIn = async (r: TpRow) => {
    if (rowBusy) return
    setRowBusy(r.candidate_id)
    try {
      const d = await gasAction<{ moved?: boolean; matched_existing?: boolean }>(
        'talentCrossIn', { tp_candidate_id: r.candidate_id }, { timeoutMs: 120000 })
      // A receipt is not a result: only `moved` or `matched_existing` is one.
      if (!d.moved && !d.matched_existing) {
        toast({ type: 'danger', title: 'Not confirmed', body: 'Nothing was written. Press again in a moment.' })
      } else {
        toast({
          type: 'success',
          title: d.matched_existing ? 'Already on the board' : `${r.name} is in the process`,
          body: d.matched_existing
            ? 'Their notas crossed onto the card that already existed — no second row was made.'
            : 'They start at New with their notas and their background check, and no machine was woken.',
        })
      }
      afterWrite()
    } catch (e) {
      toast({ type: 'danger', title: 'Not brought in', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setRowBusy('') }
  }
  const removeFromStore = async (r: TpRow) => {
    if (rowBusy) return
    setRowBusy(r.candidate_id)
    try {
      await gasAction('talentPoolArchive',
        { tp_candidate_id: r.candidate_id, archived: true, reason: r.cross_why || '' },
        { timeoutMs: 120000 })
      toast({
        type: 'success',
        title: `${r.name} left the store`,
        body: 'Nothing was deleted — the row is archived with their nota and their screen, and it can be put back.',
      })
      afterWrite()
    } catch (e) {
      toast({ type: 'danger', title: 'Not removed', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setRowBusy('') }
  }

  const runMigrate = () => {
    setMoving(true)
    void gasAction<{ added: Record<string, number> }>('talentPipelineMigrate', {}, { timeoutMs: 300000 })
      .then((d) => {
        const total = Object.values(d.added ?? {}).reduce((a, b) => a + b, 0)
        toast({
          type: 'success',
          title: total ? `${total} rows moved onto our sheets` : 'Nothing new to move',
          body: 'New legacy rows also arrive on their own — the platform syncs hourly.',
        })
        load()
      })
      .catch((e) => toast({ type: 'danger', title: 'The move did not run', body: e instanceof Error ? e.message : 'Try again.' }))
      .finally(() => setMoving(false))
  }

  if (person) {
    const row = (rows ?? []).find((r) => r.candidate_id === person)
    return (
      <CandidateProfile
        row={row ?? null}
        loading={rows === null}
        onBack={embedded ? () => openPerson('') : undefined}
        // EMBEDDED, THE TOP-RIGHT CORNER BELONGS TO SOMEBODY ELSE — Add to pipeline, the Views chooser and Talents…
        inset={embedded}
      />
    )
  }
  return (
    <Board
      rows={rows} migrated={migrated} error={error} moving={moving}
      isAdmin={isAdmin} onMigrate={runMigrate} embedded={embedded}
      onOpenPerson={embedded ? openPerson : undefined}
      onAdd={onAdd}
      rowBusy={rowBusy} onBring={bringIn} onRemove={removeFromStore}
    />
  )
}

/* ================= the board ================= */

// ONE declaration of the roster's columns, shared by the header and every row so the table reads ALIGNED.
const TP_GRID = 'grid grid-cols-[auto_minmax(0,1.4fr)_60px_minmax(0,104px)_minmax(0,96px)_minmax(0,1fr)_minmax(0,150px)_minmax(0,1.3fr)] gap-x-3'

/** How many people the store draws at once. */
const TALENT_PAGE = 50

// THE LAST COLUMN IS A DECISION, NOT A LABEL: whoever may come in MUST get a PIPELINE button, and whoever may not…
function CrossCell({ row, busy, onBring, onRemove }: {
  row: TpRow
  busy: boolean
  onBring: () => void
  onRemove: () => void
}) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn() }
  if (row.cross_ok) {
    return (
      <button
        onClick={stop(onBring)}
        disabled={busy}
        title={row.cross_why || 'They enter at New with their nota and their background check'}
        className="inline-flex w-full items-center justify-center gap-1 truncate rounded-md bg-primary px-2 py-1 text-[11.5px] font-semibold text-on-primary disabled:opacity-40"
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <UserPlus size={11} />} Pipeline
      </button>
    )
  }
  return (
    <button
      onClick={stop(onRemove)}
      disabled={busy}
      title={row.cross_why
        ? `${row.cross_why} — removing archives the row; nothing is deleted and it can be put back`
        : 'Removing archives the row; nothing is deleted and it can be put back'}
      className="inline-flex w-full items-center justify-center gap-1 truncate rounded-md border border-border px-2 py-1 text-[11.5px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40"
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />} Remove
    </button>
  )
}


function Board({ rows, migrated, error, moving, isAdmin, onMigrate, embedded, onOpenPerson, onAdd,
                rowBusy, onBring, onRemove }: {
  rows: TpRow[] | null
  migrated: boolean
  error: string | null
  moving: boolean
  isAdmin: boolean
  onMigrate: () => void
  // See the page's own prop: the unified Hiring page floats its Views chooser over this header's right corner, so…
  embedded?: boolean
  // Given when this board is a VIEW: opening somebody stays on this page instead of navigating to the absorbed…
  onOpenPerson?: (candidateId: string) => void
  /** The entry door, when the host offers one. */
  onAdd?: () => void
  // The last column's two presses — the page owns the writes, this draws them, so one place invalidates and one…
  rowBusy: string
  onBring: (r: TpRow) => void
  onRemove: (r: TpRow) => void
}) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  /** the RICH drawer, restored — it carried a great deal of information */
  const [openRow, setOpenRow] = useState<TpRow | null>(null)
  const needle = q.trim().toLowerCase()
  // HOW THE LIST IS ORDERED — A-Z, Z-A and random are all available.
  const [sort, setSort] = useState<'nota' | 'az' | 'za' | 'random'>('nota')
  const [seed, setSeed] = useState(1)
  const view = useMemo(() => {
    const kept = (rows ?? []).filter((r) =>
      !needle || [r.name, r.city, r.decision, r.status, r.screen_result]
        .some((v) => String(v ?? '').toLowerCase().includes(needle)))
    if (sort === 'az') return kept.slice().sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'za') return kept.slice().sort((a, b) => b.name.localeCompare(a.name))
    if (sort === 'random') {
      // A stable hash of the id and the seed: same seed, same order, every render — no Math.random() in a body that…
      const key = (id: string) => {
        let h = seed * 2654435761
        for (let i = 0; i < id.length; i++) h = (h ^ id.charCodeAt(i)) * 16777619 >>> 0
        return h
      }
      return kept.slice().sort((a, b) => key(a.candidate_id) - key(b.candidate_id))
    }
    return kept
  }, [rows, needle, sort, seed])

  // FIFTY AT A TIME — pagination needs a limit on people, and 50 is it.
  const [page, setPage] = useState(0)
  // Adjusted DURING render, not in an effect: an effect would paint page four of the old list once before…
  const listKey = `${needle}|${sort}|${seed}`
  const [pageKey, setPageKey] = useState(listKey)
  if (pageKey !== listKey) { setPageKey(listKey); setPage(0) }
  const pages = Math.max(1, Math.ceil(view.length / TALENT_PAGE))
  const at = Math.min(page, pages - 1)
  const paged = useMemo(
    () => view.slice(at * TALENT_PAGE, at * TALENT_PAGE + TALENT_PAGE),
    [view, at])

  return (
    <div>
      <PageHeader
        title="Talent Pipeline"
        subtitle="The analyzed résumés — scores, red flags, screens and decisions. New legacy rows sync in hourly."
        inset={embedded}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {onAdd && (
              <button
                onClick={onAdd}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary"
              >
                <UserPlus size={14} /> Add to pipeline
              </button>
            )}
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5">
              <Search size={14} className="shrink-0 text-text-3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search candidates…"
                className="h-9 w-[190px] bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3"
              />
            </div>
            {/* Nota stays the default — the only order that means something. */}
            <select
              value={sort}
              onChange={(e) => {
                const next = e.target.value as typeof sort
                setSort(next)
                if (next === 'random') setSeed((s) => s + 1)
              }}
              title="How the list is ordered"
              className="h-9 rounded-md border border-border bg-surface px-2 text-[12.5px] font-semibold text-text-2"
            >
              <option value="nota">Nota — highest first</option>
              <option value="az">Name A–Z</option>
              <option value="za">Name Z–A</option>
              <option value="random">Random</option>
            </select>
            {sort === 'random' && (
              <button
                onClick={() => setSeed((s) => s + 1)}
                title="Shuffle again — the order holds still until you ask"
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2"
              >
                <RefreshCw size={14} /> Shuffle
              </button>
            )}
            {isAdmin && (
              <button
                onClick={onMigrate}
                disabled={moving}
                title="Copy the legacy workbook's rows onto our sheets now — the hourly sync does this on its own"
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-60"
              >
                {moving ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {moving ? 'Moving…' : migrated ? 'Sync now' : 'Bring the record in'}
              </button>
            )}
          </div>
        }
      />

      {error ? (
        <Card className="mt-5 p-6 text-center text-[13px] text-text-2">{error}</Card>
      ) : rows === null ? (
        <p className="mt-6 flex items-center gap-2 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading the pipeline…
        </p>
      ) : rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing migrated yet"
            body={isAdmin
              ? 'Press "Bring the record in" — the legacy pipeline\'s candidates, résumé analyses and phone screens are copied onto our own sheets; after that the platform syncs new rows hourly on its own.'
              : 'An admin brings the legacy record in first; the scoreboard fills from there.'}
          />
        </div>
      ) : (
        <Card padded={false} className="mt-5 overflow-hidden">
          {/* THE SAME CONTENT, IN COLUMNS — the same facts, but ALIGNED in
              the table. Every fact was here
              already; they simply flowed like a sentence, so no two rows lined
              up and the eye re-found each fact on every line. Nothing was
              dropped: the flags, the screen and the CJIS all have a column of
              their own now. The grid is declared ONCE and shared by the header
              and the rows — two lists of widths is how a header slides off its
              own table. */}
          <div className={cn(TP_GRID, 'hidden border-b border-border/60 px-4 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-text-3 md:grid')}>
            <span />
            <span>Candidate</span>
            <span className="text-right">Nota</span>
            <span>Decision</span>
            <span>Screen</span>
            <span>Background check</span>
            <span>Where</span>
            <span>Into hiring</span>
          </div>
          {pages > 1 && (
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-1.5">
              <span className="text-[11.5px] text-text-3">
                {at * TALENT_PAGE + 1}–{Math.min(view.length, at * TALENT_PAGE + TALENT_PAGE)} of {view.length}
              </span>
              <span className="ml-auto flex items-center gap-1">
                <button onClick={() => setPage(Math.max(0, at - 1))} disabled={at === 0}
                  className="rounded-md border border-border px-2 py-0.5 text-[12px] font-semibold text-text-2 disabled:opacity-40">
                  Back
                </button>
                <span className="px-1 text-[11.5px] tabular-nums text-text-3">{at + 1}/{pages}</span>
                <button onClick={() => setPage(Math.min(pages - 1, at + 1))} disabled={at >= pages - 1}
                  className="rounded-md border border-border px-2 py-0.5 text-[12px] font-semibold text-text-2 disabled:opacity-40">
                  Next
                </button>
              </span>
            </div>
          )}
          <div className="divide-y divide-border/60">
            {paged.map((r) => (
              // A ROW IS NO LONGER A <button>, because it now CONTAINS buttons — a PIPELINE press for whoever may…
              <div
                key={r.candidate_id}
                role="button"
                tabIndex={0}
                onClick={() => setOpenRow(r)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenRow(r) } }}
                className={cn(TP_GRID, 'w-full cursor-pointer items-center px-4 py-2 text-left transition-colors hover:bg-surface-2')}
              >
                {/* avatar and name sit in two grid tracks, so each carries its
                    own grip — merging them would collapse a column */}
                <DragPerson name={r.name} id={r.candidate_id} type="staff" subtitle={r.status} className="shrink-0">
                  <Avatar name={r.name} size="xs" />
                </DragPerson>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[13px] font-semibold text-text-1" title={r.name}>
                    <DragPerson name={r.name} id={r.candidate_id} type="staff" subtitle={r.status}>{r.name}</DragPerson>
                  </span>
                  {r.flags.length > 0 && (
                    <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-tint-fg-amber" title={r.flags.join(', ')}>
                      <AlertTriangle size={11} />{r.flags.length}
                    </span>
                  )}
                </span>
                <span className="flex items-center justify-end gap-1.5">
                  {notaOf(r.composite_score) !== null ? (
                    <span className={cn('rounded-md px-2 py-0.5 text-[13px] font-bold tabular-nums', notaChip(notaOf(r.composite_score)!))}>
                      {notaOf(r.composite_score)!.toFixed(1)}
                    </span>
                  ) : <ScoreDot score={r.composite_score} />}
                </span>
                <span className="min-w-0">
                  {r.decision ? (
                    <span className={cn('inline-block max-w-full truncate rounded-full px-1.5 py-px text-[10.5px] font-semibold align-middle',
                      DECISION_CHIP[r.decision] ?? 'bg-surface-2 text-text-3')} title={r.decision}>
                      {r.decision}
                    </span>
                  ) : <span className="text-[11px] text-text-3">—</span>}
                </span>
                <span className="truncate text-[11.5px] text-text-3" title={r.screen_result}>
                  {r.screen_result || '—'}
                </span>
                <span className="truncate text-[11.5px] text-text-3" title={r.cjis}>{r.cjis || '—'}</span>
                <span className="truncate text-[11px] text-text-3" title={`${r.city}${r.status ? ` · ${r.status}` : ''}`}>
                  {r.city || '—'}{r.status ? ` · ${r.status}` : ''}
                </span>
                {/* THE COLUMN ANSWERS WITH A PRESS, NOT A SENTENCE: whoever
                    may come in MUST get a PIPELINE button, whoever may not
                    gets a REMOVE button, and whoever is removed goes to the
                    archive.

                    The two are exclusive because they answer the same
                    question: this person either belongs in the process, or
                    they do not belong in the store either. The refusal still
                    travels — as the button's own title — because "why not"
                    is the fact somebody needs before removing anybody. */}
                <CrossCell
                  row={r}
                  busy={rowBusy === r.candidate_id}
                  onBring={() => onBring(r)}
                  onRemove={() => onRemove(r)}
                />
              </div>
            ))}
          </div>
        </Card>
      )}

      {openRow && (
        <CandidateDrawer
          row={openRow}
          onClose={() => setOpenRow(null)}
          onFullProfile={() => {
            const id = openRow.candidate_id
            setOpenRow(null)
            if (onOpenPerson) onOpenPerson(id)
            else navigate(`/app/talent-pipeline/scores?person=${encodeURIComponent(id)}`)
          }}
        />
      )}
    </div>
  )
}

// THE DRAWER — everything about one candidate, immediately, beside the list (restored; the full-page profile stays…
function CandidateDrawer({ row, onClose, onFullProfile }: {
  row: TpRow
  onClose: () => void
  onFullProfile: () => void
}) {
  const nota = notaOf(row.composite_score)
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/30" onClick={onClose}>
      <div className="scroll-thin flex h-full w-full flex-col overflow-y-auto border-l border-border bg-surface shadow-3 sm:w-[384px]" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start gap-3 border-b border-border px-4 py-3">
          {nota !== null && (
            <span className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-xl text-[18px] font-bold tabular-nums', notaChip(nota))}>
              {nota.toFixed(1)}
            </span>
          )}
          <DragPerson name={row.name} id={row.candidate_id} type="staff" subtitle={row.decision || row.city} className="shrink-0">
            <Avatar name={row.name} size="sm" />
          </DragPerson>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold text-text-1">
              <DragPerson name={row.name} id={row.candidate_id} type="staff" subtitle={row.decision || row.city}>{row.name}</DragPerson>
            </h2>
            <p className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-text-3">
              <span>{row.candidate_id}</span>
              {row.city && <span>{row.city}</span>}
              {row.phone && <span>{formatPhoneDisplay(row.phone)}</span>}
              {row.decision && (
                <span className={cn('rounded-full px-1.5 py-px text-[10px] font-semibold', DECISION_CHIP[row.decision] ?? 'bg-surface-2 text-text-3')}>
                  {row.decision}
                </span>
              )}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
            <X size={15} />
          </button>
        </header>
        <div className="space-y-4 px-4 py-4">
          <div className="grid grid-cols-5 gap-2 text-center">
            <ScoreBox label="Composite" value={row.composite_score} big />
            <ScoreBox label="Skills" value={row.skills} />
            <ScoreBox label="Certs" value={row.certs} />
            <ScoreBox label="Experience" value={row.experience} />
            <ScoreBox label="History" value={row.job_history} />
          </div>
          {nota !== null && (
            <p className="text-[11px] text-text-3">
              Nota {nota.toFixed(1)}/10 = composite {row.composite_score} over the rubric's 12.
            </p>
          )}
          {row.flags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {row.flags.map((f) => (
                <span key={f} className="flex items-center gap-1 rounded-full bg-tint-amber px-2 py-0.5 text-[11px] font-semibold text-tint-fg-amber">
                  <AlertTriangle size={10} /> {f}
                </span>
              ))}
            </div>
          )}
          {row.summary && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">The analysis wrote</p>
              <p className="text-[13px] leading-[1.6] text-text-2">{row.summary}</p>
            </div>
          )}
          <dl className="space-y-1.5 text-[12.5px]">
            {row.years && <Fact label="Years in care" value={row.years} />}
            {row.certifications && <Fact label="Certifications" value={row.certifications} />}
            {row.cjis && <Fact label="CJIS" value={row.cjis} />}
            {row.screen_result && (
              <Fact label="Phone screen" value={`${row.screen_result}${row.screen_qualification ? ` · ${row.screen_qualification}` : ''}${row.screen_date ? ` · ${row.screen_date}` : ''}${row.screened_by ? ` · by ${row.screened_by}` : ''}`} />
            )}
            {row.email && <Fact label="E-mail" value={row.email} />}
          </dl>
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            {row.resume_link && (
              <button
                onClick={() => openFile({ title: `${row.name} — résumé`, subtitle: row.candidate_id, url: row.resume_link, icon: 'file-text' })}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover"
              >
                <FileText size={14} /> View résumé
              </button>
            )}
            {row.cjis_report && (
              <button
                onClick={() => openFile({ title: `${row.name} — CJIS report`, url: row.cjis_report, icon: 'shield' })}
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2"
              >
                <ShieldCheck size={14} /> CJIS report
              </button>
            )}
            <button onClick={onFullProfile} className="ml-auto text-[12.5px] font-semibold text-primary hover:underline">
              Open full profile
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ================= the profile, Users-style ================= */

function CandidateProfile({ row, loading, onBack, inset }: {
  row: TpRow | null
  loading: boolean
  /** Keep the top-right corner clear for the page's floating chooser. */
  inset?: boolean
  // Given when this draws INSIDE the Hiring page: going back is a state change, never a navigation out of the page…
  onBack?: () => void
}) {
  const navigate = useNavigate()

  const viewResume = (r: TpRow) => {
    if (!r.resume_link) return
    // INSIDE the platform — the résumé is always shown here, never handed away; the file viewer frames Drive links…
    openFile({ title: `${r.name} — résumé`, subtitle: r.candidate_id, url: r.resume_link, icon: 'file-text' })
  }

  if (!row) {
    return (
      <div className={cn(inset && 'min-[1240px]:pr-[300px]')}>
        <button onClick={() => (onBack ? onBack() : navigate('/app/talent-pipeline/scores'))} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-text-3 hover:text-text-1">
          <ArrowLeft size={13} /> Talent Pipeline
        </button>
        <p className="mt-6 flex items-center gap-2 text-[13px] text-text-3">
          {loading ? <><Loader2 size={14} className="animate-spin" /> Reading the pipeline…</> : 'No candidate with that id on the migrated record.'}
        </p>
      </div>
    )
  }

  return (
    <div className={cn(inset && 'min-[1240px]:pr-[300px]')}>
      {/* the same lift as the candidate profile: the
          link rides its own flex row instead of a text line box, and the card
          follows it closely */}
      <div className="flex">
        <button onClick={() => (onBack ? onBack() : navigate('/app/talent-pipeline/scores'))} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold leading-[18px] text-text-3 hover:text-text-1">
          <ArrowLeft size={13} /> Talent Pipeline
        </button>
      </div>

      {/* ── header — the Users profile's shape ── */}
      <Card className="mb-4 mt-1.5 flex flex-wrap items-center gap-4 p-4">
        {notaOf(row.composite_score) !== null && (
          <span className={cn('grid h-[64px] w-[64px] shrink-0 place-items-center rounded-xl text-[22px] font-bold tabular-nums', notaChip(notaOf(row.composite_score)!))}>
            {notaOf(row.composite_score)!.toFixed(1)}
          </span>
        )}
        <DragPerson name={row.name} id={row.candidate_id} type="staff" subtitle={row.status} className="shrink-0">
          <Avatar name={row.name} size="lg" />
        </DragPerson>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[18px] font-bold text-text-1">
              <DragPerson name={row.name} id={row.candidate_id} type="staff" subtitle={row.status}>{row.name}</DragPerson>
            </h1>
            {row.decision && (
              <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-bold',
                DECISION_CHIP[row.decision] ?? 'bg-surface-2 text-text-3')}>
                {row.decision}
              </span>
            )}
            {row.status && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] font-bold text-text-3">{row.status}</span>}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12.5px] text-text-3">
            <span>{row.candidate_id}</span>
            {row.city && <span className="flex items-center gap-1"><MapPin size={11} /> {row.city}</span>}
            {row.phone && <span className="flex items-center gap-1"><Phone size={11} /> {formatPhoneDisplay(row.phone)}</span>}
            {row.email && <span className="flex items-center gap-1"><Mail size={11} /> {row.email}</span>}
          </p>
        </div>
        {row.resume_link && (
          <button
            onClick={() => viewResume(row)}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover"
          >
            <FileText size={14} /> View résumé
          </button>
        )}
      </Card>

      {/* ── the scores ── */}
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-5 gap-2 text-center">
          <ScoreBox label="Composite" value={row.composite_score} big />
          <ScoreBox label="Skills" value={row.skills} />
          <ScoreBox label="Certs" value={row.certs} />
          <ScoreBox label="Experience" value={row.experience} />
          <ScoreBox label="History" value={row.job_history} />
        </div>
        {row.flags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {row.flags.map((f) => (
              <span key={f} className="flex items-center gap-1 rounded-full bg-tint-amber px-2 py-0.5 text-[11px] font-semibold text-tint-fg-amber">
                <AlertTriangle size={10} /> {f}
              </span>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* ── facts rail ── */}
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Candidate details</h3>
            <dl className="space-y-2 text-[12.5px]">
              <FactRow icon={<GraduationCap size={12} />} label="Years in care" value={row.years || 'Not on file'} />
              <FactRow icon={<ShieldCheck size={12} />} label="CJIS" value={row.cjis || 'Not run'} />
              <FactRow icon={<Phone size={12} />} label="Phone" value={row.phone ? formatPhoneDisplay(row.phone) : 'Not on file'} />
              <FactRow icon={<Mail size={12} />} label="E-mail" value={row.email || 'Not on file'} />
            </dl>
            {row.cjis_report && (
              <button
                onClick={() => openFile({ title: `${row.name} — CJIS report`, url: row.cjis_report, icon: 'shield' })}
                className="mt-3 text-[12.5px] font-semibold text-primary hover:underline"
              >
                Open the CJIS report
              </button>
            )}
          </Card>
          {row.certifications && (
            <Card className="p-4">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Listed certifications</h3>
              <div className="flex flex-wrap gap-1.5">
                {row.certifications.split(',').map((c) => c.trim()).filter(Boolean).map((c) => (
                  <span key={c} className="rounded-full bg-tint-blue px-2 py-0.5 text-[11px] font-semibold text-tint-fg-blue">{c}</span>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* ── the record ── */}
        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles size={14} className="text-tint-fg-lavender" />
              <h2 className="text-[13.5px] font-bold text-text-1">The analysis wrote</h2>
            </div>
            {row.summary ? (
              <p className="text-[13px] leading-[1.6] text-text-2">{row.summary}</p>
            ) : (
              <p className="text-[13px] italic text-text-3">No résumé analysis on the migrated record for this person.</p>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-[13.5px] font-bold text-text-1">Phone screen</h2>
            {row.screen_result || row.screen_date ? (
              <dl className="space-y-1.5 text-[12.5px]">
                <FactRow icon={<Phone size={12} />} label="Result" value={row.screen_result || '—'} />
                {row.screen_qualification && <FactRow icon={<ShieldCheck size={12} />} label="Qualification" value={row.screen_qualification} />}
                {row.screen_date && <FactRow icon={<GraduationCap size={12} />} label="Date" value={row.screen_date} />}
                {row.screened_by && (
                  <FactRow
                    icon={<Mail size={12} />}
                    label="Screened by"
                    value={<DragPerson name={row.screened_by} type="staff" subtitle="Ran the phone screen">{row.screened_by}</DragPerson>}
                  />
                )}
              </dl>
            ) : (
              <p className="text-[12.5px] italic text-text-3">No phone screen on the record yet.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function ScoreDot({ score }: { score: string }) {
  const n = parseFloat(score)
  if (Number.isNaN(n)) return <span className="text-[11px] text-text-3">no score</span>
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums',
      n >= 10 ? 'bg-tint-mint text-tint-fg-mint' : n >= 6 ? 'bg-tint-amber text-tint-fg-amber' : 'bg-tint-pink text-tint-fg-pink')}>
      {score}
    </span>
  )
}

function ScoreBox({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className={cn('rounded-md border border-border bg-surface-2 py-2', big && 'bg-primary-soft')}>
      <p className={cn('font-bold tabular-nums text-text-1', big ? 'text-[18px]' : 'text-[15px]')}>{value || '—'}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-3">{label}</p>
    </div>
  )
}

// `value` is a NODE, not a string: a fact whose value is a person carries a draggable name, and that is an element.
function FactRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-text-3">{icon}</span>
      <span className="w-[100px] shrink-0 text-text-3">{label}</span>
      <span className="min-w-0 flex-1 break-words text-text-1">{value}</span>
    </div>
  )
}

/** a plain label/value pair — the drawer's facts */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-[110px] shrink-0 text-text-3">{label}</dt>
      <dd className="min-w-0 flex-1 text-text-1">{value}</dd>
    </div>
  )
}
