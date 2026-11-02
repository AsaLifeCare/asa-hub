// HIRING — ONE page, every view.
// Pipeline and Flow are merged into a single page with a views switch, on the Clients pattern; the Pipeline itself…
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, RefreshCw, Search, UserPlus } from 'lucide-react'
import PageRenderer from '@/engine/PageRenderer'
import EmptyState from '@/components/shared/EmptyState'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { isAllowedWith, useBadgeRulesVersion } from '@/lib/appAccess'
import { useEffectiveRole } from '@/lib/effectiveUser'
import { api } from '@/lib/api'
import { gasAction } from '@/features/hiring/shared'
import InterviewScorecardModal from '@/features/hiring/InterviewScorecardModal'
import AddToPipelineModal from './AddToPipelineModal'
import ArchivePage from './ArchivePage'
import { toast } from '@/stores/useToastStore'
import { useAuthStore } from '@/auth/useAuthStore'
import { useHiringPolicyStore } from '@/stores/useHiringPolicyStore'
import {
  ABSORBED_VIEWS, FLOW_VIEWS, HIRING_VIEWS, TALENT_VIEWS, pickHiringView, useHiringViewsStore,
  type HiringViewId,
} from '@/stores/useHiringViewsStore'
import { formatPhoneDisplay, formatPhoneE164 } from '@/lib/phoneFormat'
import { cn } from '@/lib/utils'
import { HiringViewsChooser } from './HiringViewsChooser'
import AnalysisPage from '@/pages/features/talentpipeline/AnalysisPage'
import TalentPipelinePage from '@/pages/features/talentpipeline/TalentPipelinePage'
import {
  type ArchivedRow, type ChecklistItem, type CrossingQueue, type FlowRow, type FlowEvent,
  type JourneyLine, usePhases, btnCls,
} from './flow/shared'
import { TableSection } from './flow/TableView'
import { CalendarSection, ScheduleModal } from './flow/CalendarView'
import { ActionsSection } from './flow/ActionsView'
import NewEntitiesModal from './NewEntitiesModal'
import { DocumentsSection } from './flow/DocumentsView'

// The views that DRAW THEIR OWN HEADER (the engine's PageHeader for the Pipeline, the Talent screens' own): this…
const OWN_HEADER: HiringViewId[] = ['pipeline', 'analysis', 'scores', 'archive']

/** What each view says about itself, under its title. */
const BLURB: Partial<Record<HiringViewId, string>> = {
  table: 'Every active candidate, flat: phase, days and open conditions.',
  calendar: 'What is scheduled, and who is waiting to be.',
  actions: 'Everything open, across every candidate. It shows; the Pipeline decides.',
  documents: 'What each candidate owes, and what was written about them — documents above, evaluations below.',
}

export default function HiringPage({ initialView }: { initialView?: HiringViewId }) {
  const role = useAuthStore((s) => s.user?.role)
  const writer = role === 'admin' || role === 'manager'
  const apps = useRegistryStore((s) => s.apps)
  // THE TALENT VIEWS ANSWER TO THE TALENT APP'S OWN DOOR: folding its two screens in here must not hand them to…
  const effRole = useEffectiveRole()
  useBadgeRulesVersion()   // a matrix edit re-decides this without a reload
  const talentAllowed = useMemo(
    () => isAllowedWith(apps, effRole, 'talent-pipeline'),
    [apps, effRole],
  )
  const selected = useHiringViewsStore((s) => s.selected)
  const setSelected = useHiringViewsStore((s) => s.setSelected)
  const masterViews = useHiringPolicyStore((s) => s.views)
  const fetched = useHiringPolicyStore((s) => s.fetched)
  const ensure = useHiringPolicyStore((s) => s.ensure)
  useEffect(() => { ensure() }, [ensure])

  // A DEEP LINK PRESELECTS ITS VIEW: /app/hiring/flow opens the unified page on the Board (the Flow's own first…
  const [personOpen, setPersonOpen] = useState(false)

  const [picked, setPicked] = useState<HiringViewId>(
    initialView && initialView !== 'pipeline' ? initialView : selected,
  )
  const pick = useCallback((id: HiringViewId) => {
    setPicked(id)
    setSelected(id)
    // leaving the view closes whatever profile it was showing
    setPersonOpen(false)
  }, [setSelected])

  // WHICH VIEWS ARE LAWFUL — two owners, and they own different things.
  const masterSpokeOfTalent = useHiringPolicyStore((s) => s.masterSpokeOfTalent)
  const lawful = useMemo(
    () => HIRING_VIEWS
      .map((v) => v.id)
      .filter((id) => {
        // The Talent screens also need the absorbed app's own door; the Archive was always reachable to anybody on…
        if (TALENT_VIEWS.includes(id)) {
          return talentAllowed && (!masterSpokeOfTalent || masterViews.includes(id))
        }
        if (ABSORBED_VIEWS.includes(id)) return !masterSpokeOfTalent || masterViews.includes(id)
        return masterViews.includes(id)
      }),
    [masterViews, talentAllowed, masterSpokeOfTalent],
  )
  const view = pickHiringView(picked, lawful)
  // A view is only ON SCREEN when it is lawful — pickHiringView's constant fallback is a last resort, not a…
  const onScreen = lawful.includes(view)
  const onFlowView = onScreen && FLOW_VIEWS.includes(view)

  const [rows, setRows] = useState<FlowRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  // calendar state lives up here so a refresh and the modal can reach it
  const [events, setEvents] = useState<FlowEvent[] | null>(null)
  const [scheduleFor, setScheduleFor] = useState<{ cid: string; name: string; type: string } | null>(null)
  // the interview scorecard — opened from the Reports matrix (the Board's Interview lane was the other door until…
  const [scorecardFor, setScorecardFor] = useState<FlowRow | null>(null)
  // the onboarding rows carry the seven DOCUMENT checkpoints (dodd-cert, cpr-cert, …) the candidates slice does not…
  const [onbChecklists, setOnbChecklists] = useState<Record<string, ChecklistItem[]>>({})
  // WHAT HAPPENED, beside what is open (card step 13).
  const [journey, setJourney] = useState<JourneyLine[] | null | false>(null)
  // THE PEOPLE WHO LEFT (the Calendar's journey).
  const [archived, setArchived] = useState<ArchivedRow[] | null | false>(null)
  // The Talent Pipeline's own queue: null = not asked yet, false = the read failed (which is NOT an empty pipeline…
  const [crossing, setCrossing] = useState<CrossingQueue | null | false>(null)
  // The entry door and a nonce that makes the mounted Talent screen re-read after somebody is typed in — it owns…
  const [addToPipeline, setAddToPipeline] = useState(false)
  // THE NEXT PEOPLE TO ENTER — a New Entities button, holding the people about to enter the pipeline.
  const [newEntities, setNewEntities] = useState(false)
  const [pipelineNonce, setPipelineNonce] = useState(0)
  // the slice is read the first time a Flow view is on screen and not again — a ref, not state: asking is not…
  const rowsAsked = useRef(false)

  const loadRows = useCallback(() => {
    rowsAsked.current = true
    api.list<FlowRow>('candidates')
      .then((r) => setRows(r ?? []))
      .catch(() => toast({ type: 'danger', title: 'Could not read the candidates' }))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    if (onFlowView && !rowsAsked.current) loadRows()
  }, [onFlowView, loadRows])

  // THE PEOPLE WAITING IN THE TALENT PIPELINE — they come in through the actions path, which is where they are…
  const loadCrossing = useCallback(() => {
    gasAction<CrossingQueue>('talentCrossingList', {})
      // THE SHAPE IS CHECKED, NOT ASSUMED — leaving New Entities loading crashed the screen with "Cannot read…
      .then((d) => setCrossing(Array.isArray(d?.ready) ? d : false))
      .catch(() => setCrossing(false))
    // setCrossing is named on purpose: the compiler infers it and refuses to keep the memo when the array pretends…
  }, [setCrossing])

  const loadEvents = useCallback(() => {
    gasAction<{ events: FlowEvent[] }>('hiringCalendarList', {})
      .then((d) => setEvents(d.events ?? []))
      .catch(() => setEvents([]))
  }, [])
  useEffect(() => {
    if (view === 'calendar' && events === null) loadEvents()
  }, [view, events, loadEvents])

  // One read, only when the view is opened, and never again in this session: the record is a record, not a live…
  useEffect(() => {
    if (view !== 'actions' || journey !== null) return
    gasAction<{ journey: JourneyLine[] | null }>('hiringJourneyList', {})
      .then((d) => setJourney(d.journey ?? false))
      .catch(() => setJourney(false))
  }, [view, journey])

  useEffect(() => {
    if ((view !== 'actions' && !newEntities) || crossing !== null || !writer || !talentAllowed) return
    loadCrossing()
  }, [view, newEntities, crossing, writer, talentAllowed, loadCrossing])

  // talentNoNumberList refuses anybody who is not a writer, server-side, so a reader is never sent to be denied…
  useEffect(() => {
    if (view !== 'calendar' || archived !== null || !writer) return
    gasAction<{ rows: ArchivedRow[] | null }>('talentNoNumberList', {})
      .then((d) => setArchived(d.rows ?? false))
      .catch(() => setArchived(false))
  }, [view, archived, writer])

  useEffect(() => {
    if (view !== 'documents' || Object.keys(onbChecklists).length) return
    api.list<{ candidateId?: string; id?: string; checklist?: ChecklistItem[] }>('onboarding')
      .then((rows) => {
        const idx: Record<string, ChecklistItem[]> = {}
        for (const r of rows ?? []) {
          const cid = r.candidateId ?? r.id
          if (cid && r.checklist) idx[cid] = r.checklist
        }
        setOnbChecklists(idx)
      })
      .catch(() => { /* no access or no rows — the matrix shows "–" honestly */ })
  }, [view, onbChecklists])

  // SEARCH HAS TO MATCH THE WORD ON SCREEN.
  const { label: STAGE_LABEL } = usePhases()
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((r) =>
      [r.name, r.phone, r.phone && formatPhoneE164(r.phone), r.phone && formatPhoneDisplay(r.phone), r.email, r.city, STAGE_LABEL[r.stage]].filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)))
  }, [rows, q, STAGE_LABEL]) as FlowRow[]


  // The Pipeline is the engine board — its schema comes off the registry (the runtime truth), exactly as the route…
  const pipelineSchema = apps.find((a) => a.id === 'hiring')?.pages.find((p) => p.id === 'pipeline')
  // The board draws its own header and this page floats the chooser over its top-right corner, so the board is told…
  const pipelineView = useMemo(
    () => (pipelineSchema
      ? { ...pipelineSchema, config: { ...pipelineSchema.config, headerInsetRight: true } }
      : undefined),
    [pipelineSchema],
  )

  // NOTHING LAWFUL, NOTHING DRAWN.
  if (fetched && lawful.length === 0) {
    return (
      <EmptyState
        title="No Hiring view is available to you"
        body="Every view of this app is either switched off for everybody or outside your access. The Archive, if you have it, is still its own page."
      />
    )
  }

  const title = HIRING_VIEWS.find((v) => v.id === view)?.label ?? 'Hiring'
  const flowBusy = onFlowView && loading
  const ownHeader = OWN_HEADER.includes(view)
  // THE FLOAT ONLY WORKS WHILE THE STRIP IS NARROW — wider than that and the buttons overlap each other.
  const stripFloats = ownHeader && !(view === 'pipeline' && writer && talentAllowed)

  return (
    <div className={cn(stripFloats && 'relative')}>
      {/* On a view that titles itself, this row keeps ONLY the chooser and
          floats it over that view's own header line — nothing is pushed down. */}
      {/* Floating over a view's own header, this row must let every press
          THROUGH except the chooser's own: it sits on top of whatever that
          view drew in the same corner, and an invisible box that eats clicks
          is worse than one that overlaps. */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-2',
          stripFloats
            ? 'pointer-events-none absolute right-0 top-0 z-10 justify-end [&>*]:pointer-events-auto'
            : ownHeader ? 'mb-2 justify-end' : 'mb-3',
          // one person's profile is not a view to switch away from.
          personOpen && view === 'scores' && 'hidden',
        )}
      >
        {!ownHeader && (
          <div>
            <h1 className="text-[17px] font-bold text-text-1">{title}</h1>
            {BLURB[view] && <p className="text-[12.5px] text-text-3">{BLURB[view]}</p>}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {(view === 'table' || view === 'actions') && (
            <label className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5">
              <Search size={13} className="text-text-3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, phone, phase…"
                className="w-44 bg-transparent text-[12.5px] text-text-1 outline-none"
              />
            </label>
          )}
          {view === 'pipeline' && writer && talentAllowed && (
            <button
              onClick={() => setNewEntities(true)}
              title="The people waiting at the door — the legacy store and the signed applications nobody picked up"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2"
            >
              <UserPlus size={14} /> New Entities
              {crossing && crossing.ready.length > 0 && (
                <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-bold tabular-nums text-text-2">
                  {crossing.ready.length}
                </span>
              )}
            </button>
          )}
          {view === 'calendar' && writer && (
            <button
              onClick={() => setScheduleFor({ cid: '', name: '', type: 'in_person_interview' })}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-on-primary"
            >
              <Plus size={14} /> Schedule
            </button>
          )}
          {onFlowView && (
            <button onClick={() => { loadRows(); if (events !== null) loadEvents() }} title="Refresh" className={btnCls}>
              <RefreshCw size={13} />
            </button>
          )}
          <HiringViewsChooser offeredIds={lawful} active={view} onPick={pick} />
        </div>
      </div>

      {/* `onScreen` guards every body: a view that is not lawful is not drawn,
          not even the Pipeline the fallback constant names. */}
      {onScreen && view === 'pipeline' && (pipelineView ? <PageRenderer schema={pipelineView} /> : null)}
      {onScreen && view === 'analysis' && <AnalysisPage />}
      {onScreen && view === 'scores' && (
        <TalentPipelinePage
          key={pipelineNonce}
          embedded
          onAdd={writer && talentAllowed ? () => setAddToPipeline(true) : undefined}
          onPersonOpen={setPersonOpen}
        />
      )}
      {/* THE ARCHIVE, MOUNTED WHOLE — the Archive, until now a separate
          screen, is the last item of the dropdown:
          the same absorption the Talent screens had, not one line of it
          rewritten, and its own route still answers the letters that link
          there. */}
      {onScreen && view === 'archive' && <ArchivePage inset />}

      {onFlowView && (flowBusy ? (
        <p className="flex items-center gap-2 py-10 text-[13px] text-text-3">
          <Loader2 size={15} className="animate-spin" /> Reading the pipeline…
        </p>
      ) : (
        <>
          {view === 'table' && <TableSection rows={filtered} />}
          {view === 'calendar' && (
            <CalendarSection
              rows={rows}
              events={events}
              archived={archived}
              writer={writer}
              onSchedule={(cid, name, type) => setScheduleFor({ cid, name, type })}
              onSaved={loadEvents}
            />
          )}
          {view === 'actions' && (
            <ActionsSection
              rows={rows}
              journey={journey}
              q={q}
              onOpenPipeline={() => pick('pipeline')}
              // undefined = this person may not see the pipeline at all, which is a different answer from "nobody…
              crossing={writer && talentAllowed ? crossing : undefined}
              onCrossed={() => { loadCrossing(); loadRows() }}
            />
          )}
          {/* ONE VIEW, TWO MATRICES — documents and reports join into a
              single chart, named Documents.
              They are the same people read twice — what they OWE
              and what was WRITTEN about them — and splitting them across two
              rungs made somebody switch views to answer one question about
              one person. `reports` is still an id the cell can name; it is no
              longer a rung, and a stored choice of it lands here. */}
          {view === 'documents' && (
            <DocumentsSection rows={rows} onb={onbChecklists} onScorecard={setScorecardFor} />
          )}
        </>
      ))}

      {/* NEW ENTITIES — the RELEASE. It releases a chosen few people into
          the process: either picked one by one, or simply the last five,
          with the whole list visible in the large modal.
          The queue in Actions is a work list,
          one press per person; this is the whole line at once, ticked. */}
      {newEntities && (
        <NewEntitiesModal
          crossing={crossing}
          onClose={() => setNewEntities(false)}
          onCrossed={() => { setCrossing(null); loadRows(); setPipelineNonce((n) => n + 1) }}
        />
      )}

      {addToPipeline && (
        <AddToPipelineModal
          onClose={() => setAddToPipeline(false)}
          // The pipeline view reads its own rows; the crossing queue is the other list this person could appear in…
          onAdded={() => { setCrossing(null); setPipelineNonce((n) => n + 1) }}
        />
      )}

      {scheduleFor && (
        <ScheduleModal
          rows={rows}
          initial={scheduleFor}
          onClose={() => setScheduleFor(null)}
          onDone={() => { setScheduleFor(null); loadEvents() }}
        />
      )}

      {scorecardFor && (
        <InterviewScorecardModal
          open={!!scorecardFor}
          onOpenChange={(o: boolean) => { if (!o) setScorecardFor(null) }}
          candidateId={scorecardFor.id}
          candidateName={scorecardFor.name}
          onSaved={() => { setScorecardFor(null); loadRows() }}
        />
      )}
    </div>
  )
}
