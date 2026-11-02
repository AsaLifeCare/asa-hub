// CLIENT CANDIDATES — one referral at a time: overview, the intake actions, the pipeline, information, the intake…
// The top card — the platform's own surface — holds the candidate switcher, Share and Actions; the left column…
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useSectionCrumb } from '@/lib/sectionCrumb'
import { useShellHides } from '@/lib/myWorkHides'
import {
  Activity, ClipboardList, FolderOpen, HeartHandshake, IdCard, LayoutGrid, Loader2, MessageSquare, PhoneCall, Users,
  type LucideIcon,
} from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import SafeImg from '@/components/shared/SafeImg'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import { PhotoReplacePanel, ReplaceablePhoto, useFreshPhotos } from '@/components/shared/PhotoReplace'
import { RetryButton } from '@/pages/features/locations/LocationParts'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'
import { useDetailPanelStore } from '@/stores/useDetailPanelStore'
import { cn } from '@/lib/utils'
import {
  APP_NAME, CANDIDATE_TABS, actionsOf, candidateQuery, defaultCandidate, knownDetails, openCount, overviewOf, panelOf,
  readRefusal, resolveCandidate, rosterOf, rowFromOverview, sharePayloadFor, stageMeta, tabLabel, tabOf,
  type CandidateAsk, type CandidateDetails, type CandidateEdition, type CandidateTab, type Roster, type RosterRow,
} from './candidateModel'
import {
  readActions, readKey, readOverview, readRoster, reportOpened, useCandidateEditions, useCandidateRead, type ReadState,
} from './useCandidateRead'
import CandidateSwitcher from './CandidateSwitcher'
import CandidateActions from './CandidateActions'
import CandidatePanel from './CandidatePanel'
import { Pill } from './CandidateParts'
import OverviewSection from './sections/Overview'
import ActionsSection from './sections/Actions'
import PipelineSection from './sections/Pipeline'
import InformationSection from './sections/Information'
import IntakeSection from './sections/Intake'
import DocumentsSection from './sections/Documents'
import ActivitySection from './sections/Activity'
import TextsSection from './sections/Texts'
import TranscriptsSection from './sections/Transcripts'

const TAB_ICONS: Record<CandidateTab, LucideIcon> = {
  overview: LayoutGrid, actions: ClipboardList, pipeline: Users, information: IdCard, intake: HeartHandshake,
  documents: FolderOpen, activity: Activity, sms: MessageSquare, transcripts: PhoneCall,
}

export default function ClientCandidatesPage() {
  const [params, setParams] = useSearchParams()
  // the presses are the master's (ClientCandidates.gs); a released reader is shown none
  const canWrite = useEffectiveIsMaster()
  // whom editionsMine names beside the master (Settings › Editions): none while the app runs on Apps Script
  const editions = useCandidateEditions()
  // the photo: the master, or a holder of the information edition, replaces it from the page
  const mayPhoto = canWrite || editions.includes('clientCandidates.information')
  const [photoOpen, setPhotoOpen] = useState(false)
  const [fresh, keepFresh] = useFreshPhotos()
  const wanted = params.get('candidate') ?? ''
  const tab = tabOf(params.get('tab'))
  useSectionCrumb(tabLabel(tab))
  const ask = panelOf(params.get('panel'))

  const active = useCandidateRead(readKey('clientCandidateRoster', '*', false), () => readRoster(false), rosterOf)
  // an address naming a referral the slice does not carry asks the action's roster too
  const missing = !!wanted && !!active.data && !resolveCandidate(wanted, active.data.candidates)
  const live = useCandidateRead(missing ? readKey('clientCandidateRoster', '*', true) : null, () => readRoster(true), rosterOf)
  const roster: Roster | null = (missing && live.data) || active.data
  const candidates = roster?.candidates ?? []
  // one the file no longer lists still opens by its id, from its own record
  const offFile = missing && live.status !== 'loading' && !resolveCandidate(wanted, candidates)
  const stray = useCandidateRead(offFile ? readKey('clientCandidateOverview', wanted) : null, () => readOverview(wanted), overviewOf)
  const strayRow = offFile && stray.data ? rowFromOverview(stray.data) : null
  const row = roster
    ? (wanted ? resolveCandidate(wanted, candidates) ?? (strayRow?.key === wanted ? strayRow : null) : defaultCandidate(candidates))
    : null

  const go = useCallback((key: string, next: CandidateTab, panel: CandidateAsk | null, replace = false) => {
    setParams(new URLSearchParams(candidateQuery(key, next, panel).slice(1)), { replace })
  }, [setParams])

  // an address with no candidate opens on the one furthest along in the intake
  useEffect(() => {
    if (!wanted && row) go(row.key, tab, ask, true)
  }, [wanted, row, tab, ask, go])

  const onAsk = useCallback((next: CandidateAsk | null) => {
    if (!row) return
    // the detail panel and this one share the slot on the right
    if (next) useDetailPanelStore.getState().closeDetail()
    go(row.key, tab, next)
  }, [row, tab, go])

  const overview = useCandidateRead(row ? readKey('clientCandidateOverview', row.key) : null, () => readOverview(row?.key ?? ''), overviewOf)
  const actions = useCandidateRead(row ? readKey('clientCandidateActions', row.key) : null, () => readActions(row?.key ?? ''), actionsOf)

  // opening an alerted referral still New is the acknowledgement Potential Clients records — once per referral here
  const reported = useRef(new Set<string>())
  const alertedNew = !!row && ((row.alerted && row.stage === 'new') || (overview.data?.opened === true && overview.data.candidate.key === row.key))
  useEffect(() => {
    if (!row || !alertedNew || reported.current.has(row.key)) return
    reported.current.add(row.key)
    void reportOpened(row.key).catch(() => {})
  }, [row, alertedNew])

  // a referral the slice lacks is looked for in the live file, then by its own record, before the screen says it is…
  const looking = !row && (
    (missing && !live.data && live.status !== 'failed') || (offFile && (stray.status === 'loading' || stray.status === 'idle')))
  const rosterRead: ReadState<unknown> = looking ? { ...active, status: 'loading' } : active
  const details = row ? knownDetails(row, overview.data) : null

  return (
    <>
      <CandidatesScreen roster={rosterRead} onRetry={active.reload} candidates={candidates} wanted={wanted} row={row}
        tab={tab} details={details} actionsCount={openCount(actions.data)} canWrite={canWrite} editions={editions}
        onCandidate={(k) => go(k, 'overview', null)} onTab={(t) => go(row?.key ?? '', t, null)} onAsk={onAsk}
        onPhoto={mayPhoto ? () => setPhotoOpen(true) : undefined} freshPhoto={row ? fresh[row.key] : ''} />
      {row && mayPhoto && (
        <PhotoReplacePanel open={photoOpen} onClose={() => setPhotoOpen(false)} folder="client-candidates" recordKey={row.key}
          name={row.name} current={fresh[row.key] || details?.avatar || row.avatar}
          onDone={(photo) => { keepFresh(row.key, photo); active.reload() }} />
      )}
      {row && <CandidatePanel ask={ask} row={{ ...row, stage: details?.stage || row.stage, phone: details?.phone || row.phone, notes: details?.notes || row.notes }}
        share={sharePayloadFor(row, tab)} onClose={() => onAsk(null)} canWrite={canWrite} editions={editions} onAsk={onAsk} />}
    </>
  )
}

export function CandidatesScreen({
  roster, onRetry, candidates, wanted, row, tab, details, actionsCount, onCandidate, onTab, onAsk, canWrite = false, editions = [],
  onPhoto, freshPhoto = '',
}: {
  roster: ReadState<unknown>
  onRetry: () => void
  candidates: RosterRow[]
  wanted: string
  row: RosterRow | null
  tab: CandidateTab
  /** what is known of the referral: the overview's once read, over the roster's line */
  details: CandidateDetails | null
  actionsCount: number | null
  onCandidate: (key: string) => void
  onTab: (tab: CandidateTab) => void
  onAsk: (ask: CandidateAsk) => void
  /** the presses are the master's: anyone else is shown none */
  canWrite?: boolean
  /** the editions this reader makes here (editionsMine) */
  editions?: readonly CandidateEdition[]
  /** a press on the photo opens the panel that replaces it (the master, a holder of the information edition) */
  onPhoto?: () => void
  /** the photo this page just named, drawn at once */
  freshPhoto?: string
}) {
  // the breadcrumb inside the page is the master's alone while Settings › My Work hides it (the top bar keeps its own)
  const hides = useShellHides()
  const label = (id: CandidateTab, text: string) => (id === 'actions' && actionsCount ? `${text} (${actionsCount})` : text)
  const stage = details?.stage || row?.stage || ''
  const referral = details?.referral || row?.referral || ''
  const avatar = freshPhoto || details?.avatar || row?.avatar || ''
  return (
    <div className="w-full pb-16" data-client-candidates="">
      {!hides.candidates_crumb && (
        <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-[12.5px]" data-crumb="">
          <span className="text-text-3">{APP_NAME}</span>
          <span className="text-text-3">›</span>
          <span className="font-semibold text-text-1">{tabLabel(tab)}</span>
        </nav>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-surface p-3 shadow-1 sm:p-4"
        data-top-bar="">
        <CandidateSwitcher candidates={candidates} current={row} onPick={onCandidate} />
        {row && <CandidateActions candidate={row.key} details={details} onAsk={onAsk} onTab={onTab} canWrite={canWrite} editions={editions} />}
      </div>

      {!row && (
        <section className="rounded-[20px] border border-border bg-surface p-6 shadow-1">
          {roster.status === 'loading' || roster.status === 'idle' ? (
            <p className="flex items-center gap-2 text-[13px] text-text-3"><Loader2 size={14} className="animate-spin" /> Reading the referrals…</p>
          ) : roster.status === 'failed' && !roster.data ? (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--danger)]">
              The referrals could not be read: {readRefusal(roster.error)} <RetryButton onRetry={onRetry} busy={roster.refreshing} />
            </p>
          ) : (
            <p className="text-[13px] text-text-2">
              {wanted ? `No referral ${wanted} on the Potential Clients file.` : 'No referral is on the Potential Clients file.'}
              {candidates.length > 0 && (
                <button type="button" onClick={() => onCandidate(candidates[0].key)} className="ml-2 font-semibold text-primary hover:underline">
                  Open a candidate
                </button>
              )}
            </p>
          )}
        </section>
      )}

      {row && (
        <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="hidden content-start gap-4 md:grid" data-rail="">
            <div className="grid justify-items-center gap-2.5 rounded-[20px] border border-border bg-surface p-5 shadow-1" data-photo-card="">
              <ReplaceablePhoto name={row.name} onReplace={onPhoto}>
                <SafeImg src={avatar} name={row.name} shape="round" size="h-24 w-24 text-[26px]" eager alt={row.name} />
              </ReplaceablePhoto>
              <p className="text-center font-display text-[15px] font-semibold text-text-1">{row.name}</p>
              <p className="-mt-1.5 text-center text-[12px] text-text-3">{referral ? `Referral ${referral}` : 'No referral number'}</p>
              <Pill meta={stageMeta(stage)} />
            </div>
            <nav aria-label="Candidate sections" className="grid gap-1 rounded-[20px] border border-border bg-surface p-2 shadow-1">
              {CANDIDATE_TABS.map((t) => {
                const Icon = TAB_ICONS[t.id]
                const on = t.id === tab
                return (
                  <button key={t.id} type="button" onClick={() => onTab(t.id)} aria-current={on ? 'page' : undefined} data-tab={t.id}
                    className={cn('flex items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left text-[13px] transition-colors',
                      on ? 'bg-primary-soft font-semibold text-text-1' : 'text-text-2 hover:bg-surface-2')}>
                    <Icon size={16} className="shrink-0" /> <span className="flex-1">{t.label}</span>
                    {t.id === 'actions' && actionsCount !== null && actionsCount > 0 && (
                      <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-semibold tabular-nums text-text-2" data-actions-count="">
                        {actionsCount}
                      </span>
                    )}
                  </button>
                )
              })}
            </nav>
          </aside>

          <div className="grid gap-3 md:hidden">
            <div className="flex items-center gap-3">
              <ReplaceablePhoto name={row.name} onReplace={onPhoto}>
                <Avatar src={avatar} name={row.name} size="lg" />
              </ReplaceablePhoto>
              <div className="min-w-0">
                <p className="font-display text-[15px] font-semibold text-text-1">{row.name}</p>
                <p className="text-[12px] text-text-3">{[referral ? `Referral ${referral}` : '', stageMeta(stage).label].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
            <div className="scroll-thin -mx-1 overflow-x-auto px-1">
              <SegmentedTabs className="w-max" tabs={CANDIDATE_TABS.map((t) => ({ id: t.id, label: label(t.id, t.label) }))} value={tab}
                onChange={(t) => onTab(tabOf(t))} />
            </div>
          </div>

          <main className="min-w-0" data-section={tab}>
            {tab === 'overview' && <OverviewSection key={row.key} row={row} onAsk={onAsk} onTab={onTab} canWrite={canWrite} editions={editions} />}
            {tab === 'actions' && <ActionsSection key={row.key} row={row} onAsk={onAsk} canWrite={canWrite} editions={editions} />}
            {tab === 'pipeline' && <PipelineSection candidates={candidates} current={row.key} onCandidate={onCandidate} />}
            {tab === 'information' && <InformationSection key={row.key} row={row} onAsk={onAsk} editions={editions} />}
            {tab === 'intake' && <IntakeSection key={row.key} row={row} onAsk={onAsk} editions={editions} />}
            {tab === 'documents' && <DocumentsSection key={row.key} row={row} onAsk={onAsk} canWrite={canWrite} editions={editions} />}
            {tab === 'activity' && <ActivitySection key={row.key} row={row} />}
            {tab === 'sms' && <TextsSection key={row.key} row={row} />}
            {tab === 'transcripts' && <TranscriptsSection key={row.key} row={row} onAsk={onAsk} />}
          </main>
        </div>
      )}
    </div>
  )
}
