// FLOW · ACTIONS — ONE LINE PER PERSON, AND THE NEXT STEP ON IT.
// The actions were wrong: this is not a group of logs, it has to record the NEXT STEP for each person — organised…
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  ArrowRight, CheckCircle2, ChevronRight, Circle, CircleAlert, ClipboardCheck, Clock, GitBranch, Cpu, Loader2, Upload, UserPlus,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import DragPerson from '@/components/shared/DragPerson'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { gasAction } from '@/features/hiring/shared'
import InterviewScorecardModal from '@/features/hiring/InterviewScorecardModal'
import { TableDocUploadModal } from '@/features/hiring/TableActionButtons'
import { invalidate } from '@/lib/apiCache'
import { noteWrite } from '@/lib/snapshotClient'
import { toast } from '@/stores/useToastStore'
import {
  type ChecklistItem, type CrossingPerson, type CrossingQueue,
  type FlowRow, type JourneyLine, type UnfinishedApplication,
  usePhases, openConditions, stageItems,
} from './shared'
import { conditionDef, type ConditionDef, type ConditionFamily } from './conditions'

// The flow every card on this board is walking.
const FLOW_NAME = 'Hiring Pipeline'

// THE OPEN-ACTIONS COLUMNS, declared once and shared by the header and every row — the tables have to be ALIGNED.
const ACTIONS_GRID = 'grid grid-cols-[14px_minmax(0,92px)_minmax(0,180px)_minmax(0,1fr)_110px] items-center gap-x-2.5 lg:grid-cols-[14px_minmax(0,100px)_minmax(0,200px)_minmax(0,1fr)_110px_120px_minmax(0,96px)]'

const FAMILY_LABEL: Record<ConditionFamily, string> = {
  asset: 'Document',
  decision: 'Decision',
  report: 'Report',
  event: 'Scheduling',
  action: 'Action',
}

type Person = {
  row: FlowRow
  /** Open items of the phase they are STANDING IN — the next steps. */
  next: ChecklistItem[]
  /** Open items left behind in earlier phases: shown, never counted as next. */
  behind: ChecklistItem[]
  attention: string[]
}

// THE STATUS COLUMN'S ONE WORD, from what the row already knows.
function rowStatus(p: Person): { word: string; title: string; tone: string } {
  if (p.attention.length) {
    return { word: 'Needs you', tone: 'text-warning',
             title: p.attention[0] }
  }
  const head = p.next[0] ?? p.behind[0] ?? null
  if (head?.status === 'missing') {
    return { word: 'Missing', tone: 'text-danger',
             title: `${head.label} is not on file` }
  }
  return { word: 'Waiting', tone: 'text-text-3',
           title: 'Nothing is wrong — the phase is waiting on the step beside it' }
}

// THE ACTION COLUMN: what KIND of thing the next step needs, without opening the row.
function rowAction(p: Person): { word: string; title: string } {
  const head = p.next[0] ?? p.behind[0] ?? null
  const def: ConditionDef | null = head ? conditionDef(head.id) : null
  if (!def) {
    return head
      ? { word: '—', title: 'This one has no dictionary entry yet — open the row for what is known' }
      : { word: '—', title: 'Nothing is open: what this person needs is in the Status column' }
  }
  return { word: FAMILY_LABEL[def.family],
           title: def.machine
             ? `${FAMILY_LABEL[def.family]} — a machine owns this one; it is watched and collected, never dispatched by hand`
             : `${FAMILY_LABEL[def.family]} — open the row to see how it gets resolved` }
}

/** What each person is waiting on, in the order the screen reads them. */
function peopleWithWork(rows: FlowRow[]): Person[] {
  const out: Person[] = []
  for (const r of rows) {
    const open = openConditions(r)
    const inPhase = new Set(stageItems(r).map((c) => c.id))
    const next = open.filter((c) => inPhase.has(c.id))
    const behind = open.filter((c) => !inPhase.has(c.id))
    // THE THINGS THAT ARE NOT CONDITIONS BUT ARE STILL WORK.
    const attention: string[] = []
    if (r.urgency && r.urgency !== 'none') {
      attention.push(r.urgency === 'red'
        ? `Needs a decision${r.urgencyWhy ? ` — ${r.urgencyWhy}` : ''}`
        : `Running late${r.urgencyWhy ? ` — ${r.urgencyWhy}` : ''}`)
    }
    if (r.lastReply?.unread) {
      attention.push(`${r.lastReply.unread} unread repl${r.lastReply.unread === 1 ? 'y' : 'ies'}${r.lastReply.body ? ` — “${r.lastReply.body.slice(0, 90)}”` : ''}`)
    }
    if (r.optedOut) attention.push('Opted out of texts — no message may leave for them')
    if (r.parked?.notices) {
      attention.push(`Parked at Ready to start — the deciders have been told ${r.parked.notices} time${r.parked.notices === 1 ? '' : 's'}`)
    }
    const resumeItem = (r.checklist ?? []).find((c) => c.id === 'resume')
    if (resumeItem && (resumeItem.status === 'done' || resumeItem.status === 'auto') && r.resumeScorecard == null) {
      attention.push('Resume on file and not scored — one tap on the board scores it; the nota never gates')
    }
    if (next.length || behind.length || attention.length) out.push({ row: r, next, behind, attention })
  }
  // The people something is WRONG for first, then by how long they have stood where they are — the oldest work is…
  out.sort((a, b) =>
    (b.attention.length ? 1 : 0) - (a.attention.length ? 1 : 0) ||
    (b.row.daysInStage ?? 0) - (a.row.daysInStage ?? 0) ||
    a.row.name.localeCompare(b.row.name))
  return out
}

// One condition, opened: the truth it waits for and how it is resolved here.
const DECISION_ITEMS = new Set(['resume-decision', 'advance-decision'])
const SCORECARD_ITEMS = new Set(['interview-scorecard', 'interview-recommendation'])
const REPORT_ITEMS = new Set(['ai-report', 'transcript', 'screen-details'])

function ConditionControls({ item, row, onDone }: {
  item: ChecklistItem
  row: FlowRow
  onDone: () => void
}) {
  const [busy, setBusy] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [scorecardOpen, setScorecardOpen] = useState(false)

  const run = async (what: string, action: string, payload: Record<string, unknown>, said: string) => {
    if (busy) return
    setBusy(what)
    try {
      const d = await gasAction<Record<string, unknown>>(action, payload, { timeoutMs: 120000 })
      // A RECEIPT IS NOT A RESULT — the relay answers {accepted:true} on a slow write, and celebrating that is how…
      const receipt = !!d?.accepted && d?.value === undefined && d?.sent === undefined
      toast({
        type: 'success',
        title: said,
        body: receipt
          ? 'The platform accepted it; the card updates as soon as the sheet answers.'
          : 'Recorded — the card follows the sheet, not the press.',
      })
      invalidate('candidates'); noteWrite('candidates')
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Nothing was written', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy(''); setConfirming(false) }
  }

  const btn = 'inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40'

  if (SCORECARD_ITEMS.has(item.id)) {
    return (
      <span className="mt-2 flex flex-wrap items-center gap-1.5">
        <button onClick={() => setScorecardOpen(true)} className={btn}
                title="Signed by the interviewer: name, score, comments and the recommendation — a Decline there ends the run">
          <ClipboardCheck size={11} /> Scorecard
        </button>
        <span className="text-[11px] text-text-3">Advance, Hold or Decline is signed there.</span>
        <InterviewScorecardModal
          open={scorecardOpen}
          onOpenChange={setScorecardOpen}
          candidateId={row.id}
          candidateName={row.name}
          onSaved={() => { invalidate('candidates'); noteWrite('candidates'); onDone() }}
        />
      </span>
    )
  }

  if (DECISION_ITEMS.has(item.id)) {
    return (
      <span className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => void run('adv', 'setDecision', { candidate_id: row.id, checkpoint: item.id, value: 'Advance' }, `${item.label}: Advance`)}
          disabled={!!busy}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[12px] font-semibold text-on-primary disabled:opacity-40"
        >
          {busy === 'adv' ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Advance
        </button>
        {confirming ? (
          <>
            <span className="text-[11.5px] text-text-2">End {row.name}&rsquo;s process?</span>
            <button onClick={() => setConfirming(false)} className={btn}>Cancel</button>
            <button
              onClick={() => void run('dec', 'setDecision', { candidate_id: row.id, checkpoint: item.id, value: 'Decline' }, `${item.label}: Declined`)}
              disabled={!!busy}
              className="inline-flex items-center gap-1 rounded-md bg-danger px-2.5 py-1 text-[12px] font-semibold text-on-primary disabled:opacity-40"
            >
              {busy === 'dec' ? <Loader2 size={11} className="animate-spin" /> : <Circle size={11} />} Decline
            </button>
          </>
        ) : (
          <button onClick={() => setConfirming(true)} disabled={!!busy} className={btn}>Decline</button>
        )}
      </span>
    )
  }

  if (item.id === 'cjis') {
    return (
      <span className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => void run('ask', 'hiringCjisRequestSend', { candidate_id: row.id }, 'The background check was asked for')}
          disabled={!!busy}
          title="Letter and text to Arthur — the ask book bounds how often it may repeat"
          className={btn}
        >
          {busy === 'ask' ? <Loader2 size={11} className="animate-spin" /> : <Clock size={11} />} Request it
        </button>
        <span className="text-[11px] text-text-3">A file lands on the card, not here.</span>
      </span>
    )
  }

  if (REPORT_ITEMS.has(item.id)) {
    return (
      <span className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => void run('gen', 'screenAnalyze', { candidate_id: row.id }, 'The screen is being read')}
          disabled={!!busy}
          title="The same analyzer the real lane runs: it reads the transcript and writes the report, the details and the score"
          className={btn}
        >
          {busy === 'gen' ? <Loader2 size={11} className="animate-spin" /> : <Cpu size={11} />} Generate
        </button>
        <span className="text-[11px] text-text-3">Needs a transcript on the record.</span>
      </span>
    )
  }
  return null
}

function ConditionCard({ item, name, row, onDone, onOpenPipeline }: {
  item: ChecklistItem
  name: string
  /** The person, so a control can name them and write to their card. */
  row?: FlowRow
  /** Told after any write, so the page re-reads instead of guessing. */
  onDone?: () => void
  onOpenPipeline: () => void
}) {
  const def = conditionDef(item.id)
  const [uploadOpen, setUploadOpen] = useState(false)
  const navigate = useNavigate()
  const afford = def?.affordances ?? []
  // The same small button ConditionControls wears, so a card carrying both reads as one set of doors rather than…
  const btn = 'inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40'
  return (
    <div className="border-l-2 border-primary/40 pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold text-text-1">{item.label}</span>
        {def && (
          <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-bold', TINT_BG.slate, TINT_FG.slate)}>
            {FAMILY_LABEL[def.family]}
          </span>
        )}
        {item.owner && <span className="text-[11.5px] text-text-3">{item.owner}</span>}
        {def?.machine && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-text-3" title="A machine owns this one — it is watched and collected, never dispatched by hand.">
            <Cpu size={11} /> the platform does this
          </span>
        )}
      </div>

      {def ? (
        <>
          <p className="mt-1.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-text-3">Required truth</p>
          <p className="text-[12.5px] leading-[1.55] text-text-2">{def.truth}</p>

          <p className="mt-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-text-3">How this gets resolved</p>
          <ol className="mt-0.5 space-y-1">
            {def.how.map((h, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] leading-[1.55] text-text-2">
                <span className="mt-[3px] grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  {i + 1}
                </span>
                <span>{h}</span>
              </li>
            ))}
          </ol>

          <p className="mt-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-text-3">Where it lives</p>
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            {def.resources.map((r) => (
              <span key={r} className={cn('rounded-md px-2 py-0.5 text-[11.5px]', TINT_BG.blue, TINT_FG.blue)}>{r}</span>
            ))}
          </div>
        </>
      ) : (
        // An id nobody has defined yet draws honestly rather than inventing a sentence about somebody's hiring.
        <p className="mt-1.5 text-[12.5px] italic leading-[1.55] text-text-3">
          Nothing has been written about what this condition needs. The card on the board is
          what decides it today.
        </p>
      )}

      {row && onDone && <ConditionControls item={item} row={row} onDone={onDone} />}

      {/* The drawer's affordances, on the card: an owed document takes the
          same upload modal the card has always opened, and a packet points
          at the Onboarding app where the portal actually lives. 'decide' and
          'request' mount nothing here — ConditionControls above already is
          those doors, and two buttons onto one act is the lesson the Action
          column already carries. */}
      {row && (afford.includes('upload') || afford.includes('open-onboarding')) && (
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          {afford.includes('upload') && (
            <button
              onClick={() => setUploadOpen(true)}
              title={`Upload the ${item.label.toLowerCase()} for ${name} — it files on the record and lands in the document folders`}
              className={btn}
            >
              <Upload size={11} /> Upload
            </button>
          )}
          {afford.includes('open-onboarding') && (
            <button
              onClick={() => navigate('/app/onboarding/steps')}
              title="Open it in the Onboarding app"
              className={btn}
            >
              Onboarding <ArrowRight size={11} />
            </button>
          )}
        </span>
      )}

      {row && (
        <TableDocUploadModal
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          row={{ id: row.id, name: row.name, email: row.email, stage: row.stage }}
          item={uploadOpen ? { id: item.id, label: item.label, status: item.status, stage: item.stage } : null}
          onUploaded={() => { invalidate('candidates'); noteWrite('candidates'); onDone?.() }}
        />
      )}

      <button
        onClick={onOpenPipeline}
        className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-primary"
        title={`Resolve it on ${name}’s card — everything is resolvable there`}
      >
        Open in Kanban <GitBranch size={11} />
      </button>
    </div>
  )
}

// THE TALENT PIPELINE'S OWN QUEUE — the store, and the door out of it.
function UnfinishedSection({ rows, q }: { rows: UnfinishedApplication[]; q: string }) {
  const needle = q.trim().toLowerCase()
  const shown = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows
  const pending = rows.filter((r) => r.status === 'pending').length
  return (
    <Card className="mb-3 p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <CircleAlert size={13} className="shrink-0 text-tint-fg-amber" />
        <h2 className="text-[13px] font-bold text-text-1">Applications nobody finished</h2>
        <p className="min-w-0 flex-1 truncate text-[12px] text-text-3">
          They began the form and stopped, or said no. Nothing is sent to them automatically —
          finishing somebody else&rsquo;s application is not something a machine can do.
        </p>
        <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-bold', TINT_BG.amber, TINT_FG.amber)}>
          {pending} still out
        </span>
      </div>
      {shown.length === 0 && (
        <p className="px-3 py-3 text-[12.5px] italic text-text-3">Nothing matches that search.</p>
      )}
      <div className="divide-y divide-border/60">
        {shown.map((r) => (
          <div key={r.srid} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
            <span className="min-w-[150px] truncate text-[12.5px] font-semibold text-text-1" title={r.name}>
              {/* no candidate id exists yet — they never finished the form —
                  and the name is identity enough for the tracker */}
              <DragPerson name={r.name} type="staff" subtitle="Application never finished">{r.name}</DragPerson>
            </span>
            <span className="truncate text-[12px] text-text-3">{r.email || '—'}</span>
            <span className="truncate text-[12px] tabular-nums text-text-3">{formatPhoneDisplay(r.phone) || '—'}</span>
            {r.location && <span className="truncate text-[12px] text-text-3">{r.location}</span>}
            <span className="ml-auto flex items-center gap-2">
              <span className="text-[11px] text-text-3">started {r.applied || '—'}</span>
              <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                r.status === 'declined' ? cn(TINT_BG.pink, TINT_FG.pink) : cn(TINT_BG.amber, TINT_FG.amber))}>
                {r.status === 'declined' ? 'declined' : 'never signed'}
              </span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}

// How many of the crossing queue are drawn at once — pagination every 20 people.
const CROSSING_PAGE = 20

// A flag, not a deletion: `onCrossed` is also every condition card's `onDone`, and New Entities serves the same list.
const SHOW_CROSSING_IN_ACTIONS = false

// The queue as WORK: one line per person, one press each, twenty to a page — read by somebody walking through it.
function CrossingSection({ q, crossing, onCrossed }: {
  q: string
  crossing: CrossingQueue | null | false
  onCrossed: () => void
}) {
  const [busy, setBusy] = useState('')
  // WHAT THE DOOR SAID, KEPT ON THE ROW.
  const [refused, setRefused] = useState<Record<string, string>>({})
  // Twenty at a time.
  const [page, setPage] = useState(0)
  const needle = q.trim().toLowerCase()

  const keyOf = (p: CrossingPerson) => p.tp_candidate_id || p.srid || p.name
  const bring = async (p: CrossingPerson) => {
    if (busy) return
    setBusy(keyOf(p))
    try {
      const d = await gasAction<{ moved?: boolean; matched_existing?: boolean; accepted?: boolean }>(
        'talentCrossIn',
        // One door, two keys: a roster row travels by its legacy id, a signed application by its envelope.
        p.tp_candidate_id ? { tp_candidate_id: p.tp_candidate_id } : { srid: p.srid },
        { timeoutMs: 120000 },
      )
      // A DELIVERY RECEIPT IS NOT A RESULT — the message at the bottom said it was done when nothing at all had…
      if (!d.moved && !d.matched_existing) {
        const why = d.accepted
          ? 'The platform accepted it but has not confirmed it yet. Nothing is lost — press again in a moment and it will either be done or say why.'
          : 'The server did not confirm the crossing. Nothing was written.'
        setRefused((r) => ({ ...r, [keyOf(p)]: why }))
        toast({ type: 'danger', title: 'Not confirmed', body: why })
        onCrossed()
        return
      }
      toast({
        type: 'success',
        title: d.matched_existing ? 'Already on the board' : `${p.name} is in the process`,
        body: d.matched_existing
          ? 'Their notas crossed onto the card that already existed — no second row was made.'
          : 'They start at New with their notas and their background check, and no machine was woken.',
      })
      setRefused((r) => { const n = { ...r }; delete n[keyOf(p)]; return n })
      // THE BOARD HAS TO KNOW WITHOUT A RELOAD — a person did cross, but only a manual page refresh showed it.
      invalidate('candidates')
      noteWrite('candidates')
      onCrossed()
    } catch (e) {
      const why = e instanceof Error ? e.message : 'Try again.'
      setRefused((r) => ({ ...r, [keyOf(p)]: why }))
      toast({ type: 'danger', title: 'They did not come in', body: why })
    } finally {
      setBusy('')
    }
  }

  if (crossing === false) {
    return (
      <Card className="mb-3 p-0">
        <p className="px-3 py-3 text-[12.5px] text-warning">
          The Talent Pipeline could not be read. That is not an empty pipeline — it is a read
          that failed, and the difference matters.
        </p>
      </Card>
    )
  }
  if (crossing === null) {
    return (
      <Card className="mb-3 p-0">
        <p className="px-3 py-3 text-[12.5px] italic text-text-3">Reading the Talent Pipeline…</p>
      </Card>
    )
  }
  if (!crossing.migrated) return null

  const matching = crossing.ready.filter((p) => !needle || p.name.toLowerCase().includes(needle))
  const pages = Math.max(1, Math.ceil(matching.length / CROSSING_PAGE))
  // A search that shortens the list must not leave the reader stranded on a page that no longer exists.
  const at = Math.min(page, pages - 1)
  const ready = matching.slice(at * CROSSING_PAGE, at * CROSSING_PAGE + CROSSING_PAGE)
  const held = crossing.held ?? {}
  const heldLine = [
    crossing.duplicates_hidden ? `${crossing.duplicates_hidden} the legacy marked duplicates` : '',
    held.declined ? `${held.declined} it declined` : '',
    held.staff ? `${held.staff} who already work here` : '',
    held.review ? `${held.review} whose background check came back for review` : '',
    held.disqualified ? `${held.disqualified} disqualified` : '',
    held.unreadable ? `${held.unreadable} whose CJIS column holds no readable verdict` : '',
    crossing.already_here ? `${crossing.already_here} already on the board` : '',
  ].filter(Boolean).join(' · ')

  return (
    <Card className="mb-3 p-0">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <h2 className="text-[13px] font-bold text-text-1">Waiting in the Talent Pipeline</h2>
        <p className="min-w-0 flex-1 truncate text-[12px] text-text-3">
          The legacy roster and the signed applications nobody picked up. One press brings them in.
        </p>
        <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-bold', TINT_BG.mint, TINT_FG.mint)}>
          {crossing.ready.length}
        </span>
      </div>

      {ready.length === 0 && (
        <p className="px-3 py-4 text-[12.5px] italic text-text-3">
          {crossing.ready.length === 0
            ? 'Nobody in the pipeline can come in on their own record right now.'
            : 'Nothing matches that search.'}
        </p>
      )}

      {pages > 1 && (
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
          <span className="text-[11.5px] text-text-3">
            {at * CROSSING_PAGE + 1}–{Math.min(matching.length, at * CROSSING_PAGE + CROSSING_PAGE)} of {matching.length}
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

      {/* COLUMNS, NOT A SENTENCE PER PERSON — the items are aligned.
          The same four facts stood in a flowing line
          before, so no two rows lined up and the eye had to re-find each fact
          on every row. One grid, one header, and the widths are shared. */}
      {ready.length > 0 && (
        <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_115px_minmax(0,1.1fr)_120px_auto] items-center gap-3 border-b border-border/60 px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-text-3 sm:grid">
          <span>Candidate</span>
          <span>The legacy had them at</span>
          <span>Phone</span>
          <span>Background check</span>
          <span>Goes to</span>
          <span />
        </div>
      )}
      <div className="divide-y divide-border/60">
        {ready.map((p) => (
          <div
            key={keyOf(p)}
            className="grid grid-cols-1 items-center gap-x-3 gap-y-0.5 px-3 py-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_115px_minmax(0,1.1fr)_120px_auto]"
          >
            <span className="truncate text-[12.5px] font-semibold text-text-1" title={p.name}>
              <DragPerson name={p.name} id={p.tp_candidate_id || p.srid} type="staff" subtitle={p.legacy_status}>{p.name}</DragPerson>
              {p.nota && <span className="ml-1.5 font-normal text-text-3">nota {p.nota}</span>}
            </span>
            {/* WHERE THEY CAME FROM: the roster's own verdict, or the day
                they signed the application nobody had picked up. */}
            <span className="truncate text-[12px] text-text-2"
                  title={p.source === 'application' ? p.landing_why : p.legacy_status}>
              {p.source === 'application'
                ? `applied · signed ${p.signed_at || '—'}`
                : (p.legacy_status || '—')}
            </span>
            <span className="truncate text-[12px] tabular-nums text-text-3">{formatPhoneDisplay(p.phone) || '—'}</span>
            {/* The check IN ITS OWN WORDS — 'Verified - Clear' and 'Clear (9
                records, no exclusion matches)' are different sentences and the
                queue must not flatten them into a tick. */}
            <span className="truncate text-[12px] text-text-3" title={p.cjis}>{p.cjis || '—'}</span>
            {/* WHERE THE PRESS PUTS THEM, before it is pressed. 'Ready to
                start' is not a shortcut through hiring — it is somebody the
                company already employs, whose record closes by itself. */}
            <span
              className={cn('truncate rounded-full px-2 py-0.5 text-center text-[11px] font-bold',
                p.landing === 'ready'
                  ? cn(TINT_BG.mint, TINT_FG.mint)
                  : cn(TINT_BG.blue, TINT_FG.blue))}
              title={p.landing_why}
            >
              {p.landing === 'ready' ? 'Ready to start' : 'New'}
            </span>
            <button
              onClick={() => void bring(p)}
              disabled={!!busy}
              title="They enter at New, with their notas and their background check — no machine is woken by this"
              className="mt-1 inline-flex shrink-0 items-center justify-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[12px] font-semibold text-on-primary disabled:opacity-40 sm:mt-0"
            >
              <UserPlus size={12} /> {busy === keyOf(p) ? 'Bringing in…' : 'Bring into hiring'}
            </button>
            {refused[keyOf(p)] && (
              <span className="col-span-full text-[11.5px] text-danger">
                {refused[keyOf(p)]}
              </span>
            )}
          </div>
        ))}
      </div>

      {heldLine && (
        <p className="border-t border-border/60 px-3 py-2 text-[11.5px] leading-[1.55] text-text-3">
          Not shown: {heldLine}. Nothing was deleted — those rows stand where they always did,
          and a check that came back for review is a person somebody decides about in the open,
          never a machine.
        </p>
      )}
    </Card>
  )
}

export function ActionsSection({ rows, journey, q, onOpenPipeline, crossing, onCrossed }: {
  rows: FlowRow[]
  journey: JourneyLine[] | null | false
  q: string
  onOpenPipeline: () => void
  /** undefined = this person may not see the pipeline at all. */
  crossing?: CrossingQueue | null | false
  onCrossed?: () => void
}) {
  const [open, setOpen] = useState('')
  const { label: STAGE_LABEL, tint: STAGE_TINT } = usePhases()
  const needle = q.trim().toLowerCase()
  const people = useMemo(() => peopleWithWork(rows).filter((p) => !needle ||
    p.row.name.toLowerCase().includes(needle) ||
    p.next.some((c) => c.label.toLowerCase().includes(needle)) ||
    p.behind.some((c) => c.label.toLowerCase().includes(needle))), [rows, needle])

  return (
    <>
    {SHOW_CROSSING_IN_ACTIONS && crossing !== undefined && (
      <CrossingSection q={q} crossing={crossing} onCrossed={onCrossed ?? (() => {})} />
    )}
    {crossing && (crossing.unfinished?.length ?? 0) > 0 && (
      <UnfinishedSection rows={crossing.unfinished ?? []} q={q} />
    )}
    <Card className="p-0">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <h2 className="text-[13px] font-bold text-text-1">Open actions</h2>
        <p className="min-w-0 flex-1 truncate text-[12px] text-text-3">
          One line per person: the next step their phase is waiting on. Open it for the whole group.
        </p>
        <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-bold', TINT_BG.lavender, TINT_FG.lavender)}>
          {people.length}
        </span>
      </div>

      {people.length > 0 && (
        <div className={cn(ACTIONS_GRID, 'border-b border-border/60 px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-text-3')}>
          <span />
          <span>Status</span>
          <span>Candidate</span>
          <span>Next step</span>
          <span className="hidden lg:block">Flow</span>
          <span>Phase</span>
          <span className="hidden lg:block">Action</span>
        </div>
      )}

      {people.length === 0 && (
        <p className="px-3 py-6 text-center text-[12.5px] italic text-text-3">
          {rows.length === 0 ? 'Nobody is in the process right now.'
            : needle ? 'Nothing matches that search.'
              : 'Nothing open anywhere. Enjoy it.'}
        </p>
      )}

      <div className="divide-y divide-border/60">
        {people.map((p) => {
          const head = p.next[0] ?? p.behind[0] ?? null
          const isOpen = open === p.row.id
          const st = rowStatus(p)
          const act = rowAction(p)
          const mine = Array.isArray(journey)
            ? journey.filter((l) => l.candidate_id === p.row.id)
            : []
          return (
            <div key={p.row.id}>
              <button
                onClick={() => setOpen(isOpen ? '' : p.row.id)}
                className={cn(ACTIONS_GRID, 'w-full items-center px-3 py-2 text-left hover:bg-surface-2/50')}
              >
                <ChevronRight
                  size={14}
                  className={cn('shrink-0 text-text-3 transition-transform', isOpen && 'rotate-90')}
                />
                {/* STATUS — the icon kept, and the word it always meant. */}
                <span className={cn('flex min-w-0 items-center gap-1.5', st.tone)} title={st.title}>
                  {p.attention.length
                    ? <CircleAlert size={14} className="shrink-0" />
                    : head?.status === 'missing'
                      ? <Circle size={14} className="shrink-0" />
                      : <Clock size={14} className="shrink-0" />}
                  <span className="truncate text-[11.5px] font-semibold">{st.word}</span>
                </span>
                <span className="truncate text-[12.5px] font-semibold text-text-1" title={p.row.name}>
                  <DragPerson name={p.row.name} id={p.row.id} type="staff" subtitle={STAGE_LABEL[p.row.stage] ?? p.row.stage}>
                    {p.row.name}
                  </DragPerson>
                </span>
                {/* THE NEXT STEP, in its own column. It is the point of the
                    whole view — a person's row must say what happens next —
                    and a column is what lets the eye read fourteen of them
                    down the page instead of re-finding it on every line. */}
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate text-[12.5px] text-text-2"
                        title={head ? head.label : p.attention[0] ?? ''}>
                    {head ? head.label : p.attention[0] ?? '—'}
                  </span>
                  {p.next.length + p.behind.length > 1 && (
                    <span className="shrink-0 text-[11.5px] text-text-3">
                      +{p.next.length + p.behind.length - 1}
                    </span>
                  )}
                </span>
                <span className="hidden truncate text-[11.5px] text-text-3 lg:block">{FLOW_NAME}</span>
                <span className={cn('justify-self-start rounded-full px-2 py-0.5 text-[11px] font-bold', TINT_BG[STAGE_TINT[p.row.stage] ?? 'blue'], TINT_FG[STAGE_TINT[p.row.stage] ?? 'blue'])}>
                  {STAGE_LABEL[p.row.stage] ?? p.row.stage}
                </span>
                {/* ACTION — the KIND of thing, not a second button. The control
                    that writes lives in the opened row (movement 4); a control
                    here as well would be two doors onto one act, and the strip
                    that floats over this header has already taught that lesson
                    once. */}
                <span className="hidden truncate text-[11.5px] text-text-3 lg:block" title={act.title}>
                  {act.word}
                </span>
              </button>

              {isOpen && (
                <div className="space-y-3 border-t border-border/40 bg-surface-2/40 px-3 py-3 sm:px-10">
                  {p.attention.length > 0 && (
                    <div>
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-warning">Needs somebody now</p>
                      <ul className="mt-0.5 space-y-0.5">
                        {p.attention.map((a) => (
                          <li key={a} className="text-[12.5px] leading-[1.55] text-text-2">{a}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {p.next.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-text-3">
                        Next steps — {STAGE_LABEL[p.row.stage] ?? p.row.stage}
                      </p>
                      {p.next.map((c) => (
                        <ConditionCard key={c.id} item={c} name={p.row.name} row={p.row}
                                       onDone={onCrossed ?? (() => {})} onOpenPipeline={onOpenPipeline} />
                      ))}
                    </div>
                  )}

                  {p.behind.length > 0 && (
                    <div className="space-y-3">
                      {/* Not "next": these belong to phases they already left.
                          They are still owed and the card still says so — the
                          ladder simply stopped waiting for them. */}
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-text-3">
                        Still owed from earlier — nothing waits on these
                      </p>
                      {p.behind.map((c) => (
                        <ConditionCard key={c.id} item={c} name={p.row.name} row={p.row}
                                       onDone={onCrossed ?? (() => {})} onOpenPipeline={onOpenPipeline} />
                      ))}
                    </div>
                  )}

                  {/* THEIR RECORD, not everybody's. The journey used to sit
                      under this whole view as one wall; it belongs to the
                      person it happened to. */}
                  <div>
                    <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-text-3">
                      What the platform has already done
                    </p>
                    {journey === null && (
                      <p className="mt-0.5 text-[12px] italic text-text-3">Reading the record…</p>
                    )}
                    {journey === false && (
                      <p className="mt-0.5 text-[12px] text-warning">
                        The record could not be read. That is not an empty journey — it is a read
                        that failed, and the difference matters.
                      </p>
                    )}
                    {Array.isArray(journey) && mine.length === 0 && (
                      <p className="mt-0.5 text-[12px] italic text-text-3">
                        Nothing has been recorded for them yet.
                      </p>
                    )}
                    <ul className="mt-0.5 space-y-1">
                      {mine.slice().reverse().slice(0, 8).map((l) => (
                        <li key={l.id} className="flex items-start gap-2">
                          {l.ok
                            ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" />
                            : <CircleAlert size={13} className="mt-0.5 shrink-0 text-danger" />}
                          <span className="min-w-0 flex-1 text-[12px] leading-[1.5]">
                            <span className="text-text-1">{l.title}</span>
                            {l.rehearsal && (
                              <span className="ml-1.5 rounded bg-warning/10 px-1 text-[10.5px] font-bold text-warning">rehearsal</span>
                            )}
                            <span className="block text-[11.5px] text-text-3">{l.detail}</span>
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-text-3">
                            {l.at.replace('T', ' ').slice(0, 16)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {mine.length > 8 && (
                      <p className="mt-1 text-[11.5px] italic text-text-3">
                        The eight most recent of {mine.length} — the whole record is on their profile.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
    </>
  )
}
