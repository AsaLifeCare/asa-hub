// STAFF CANDIDATES — one candidate at a time: overview, actions, the pipeline, information, interviews, documents…
// The top card — the platform's own surface — holds the candidate switcher, Share and Actions; the left column…
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useSectionCrumb } from '@/lib/sectionCrumb'
import { useShellHides } from '@/lib/myWorkHides'
import {
  Activity, CalendarCheck, ClipboardList, FolderOpen, IdCard, LayoutGrid, Loader2, MessageSquare, PhoneCall, Users,
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
  APP_NAME, ARCHIVED_META, NOT_OPEN, READ_ONLY, actionsOf, candidateQuery, defaultCandidate, knownDetails, mayEdit, mayUpload, notOnFile,
  openCount, overviewOf, panelOf, readRefusal, resolveCandidate, rosterOf, rowFromOverview, sharePayloadFor, stageMeta, tabFor,
  tabLabel, tabOf, tabsFor, type CandidateAsk, type CandidateDetails, type CandidateTab, type Reach, type Roster, type RosterRow,
} from './candidateModel'
import {
  readActions, readKey, readOverview, readRoster, useCandidateEditions, useCandidateRead, type ReadState,
} from './useCandidateRead'
import CandidateSwitcher from './CandidateSwitcher'
import CandidateActions from './CandidateActions'
import CandidatePanel from './CandidatePanel'
import { Pill } from './CandidateParts'
import OverviewSection from './sections/Overview'
import ActionsSection from './sections/Actions'
import PipelineSection from './sections/Pipeline'
import InformationSection from './sections/Information'
import InterviewsSection from './sections/Interviews'
import DocumentsSection from './sections/Documents'
import ActivitySection from './sections/Activity'
import TextsSection from './sections/Texts'
import TranscriptsSection from './sections/Transcripts'

const TAB_ICONS: Record<CandidateTab, LucideIcon> = {
  overview: LayoutGrid, actions: ClipboardList, pipeline: Users, information: IdCard, interviews: CalendarCheck,
  documents: FolderOpen, activity: Activity, sms: MessageSquare, transcripts: PhoneCall,
}

export default function StaffCandidatesPage() {
  const [params, setParams] = useSearchParams()
  const isMaster = useEffectiveIsMaster()
  const wanted = params.get('candidate') ?? ''
  const ask = panelOf(params.get('panel'))

  const active = useCandidateRead(readKey('candidateProfileRoster', '*', false), () => readRoster(false), rosterOf)
  // the server's own word that this reader is narrowed to the candidates tied to their houses
  const narrow = !!active.data?.viewer
  // whom editionsMine names beside the master (Settings › Editions): none while the app runs on Apps Script
  const editions = useCandidateEditions(narrow)
  const reach: Reach = { write: isMaster && !narrow, narrow, editions }
  // the photo: the master, or a holder of the information edition, replaces it from the page
  const mayPhoto = reach.write || mayEdit(reach, 'information')
  const [photoOpen, setPhotoOpen] = useState(false)
  const [fresh, keepFresh] = useFreshPhotos()
  const tab = tabFor(params.get('tab'), narrow)
  useSectionCrumb(tabLabel(tab))
  // an address naming a candidate the slice does not carry asks the action's roster too; a narrowed roster is the action's
  const missing = !narrow && !!wanted && !!active.data && !resolveCandidate(wanted, active.data.candidates)
  const live = useCandidateRead(missing ? readKey('candidateProfileRoster', '*', true) : null, () => readRoster(true), rosterOf)
  const roster: Roster | null = (missing && live.data) || active.data
  const candidates = roster?.candidates ?? []
  // one the board no longer carries (out of the process) still opens by its id, from its own record
  const offBoard = missing && live.status !== 'loading' && !resolveCandidate(wanted, candidates)
  const stray = useCandidateRead(offBoard ? readKey('candidateProfileOverview', wanted) : null, () => readOverview(wanted), overviewOf)
  const strayRow = offBoard && stray.data ? rowFromOverview(stray.data) : null
  const row = roster
    ? (wanted ? resolveCandidate(wanted, candidates) ?? (strayRow?.key === wanted ? strayRow : null) : defaultCandidate(candidates))
    : null

  const go = useCallback((key: string, next: CandidateTab, panel: CandidateAsk | null, replace = false) => {
    setParams(new URLSearchParams(candidateQuery(key, next, panel).slice(1)), { replace })
  }, [setParams])

  // an address with no candidate opens on the first in the process
  useEffect(() => {
    if (!wanted && row) go(row.key, tab, ask, true)
  }, [wanted, row, tab, ask, go])

  const onAsk = useCallback((next: CandidateAsk | null) => {
    if (!row) return
    // the detail panel and this one share the slot on the right
    if (next) useDetailPanelStore.getState().closeDetail()
    go(row.key, tab, next)
  }, [row, tab, go])

  // a Pipeline NEXT STEP: that candidate becomes the one on screen, the Pipeline stays, and its panel opens
  const onOpen = useCallback((key: string, next: CandidateAsk) => {
    useDetailPanelStore.getState().closeDetail()
    go(key, 'pipeline', next)
  }, [go])

  const overview = useCandidateRead(row ? readKey('candidateProfileOverview', row.key) : null, () => readOverview(row?.key ?? ''), overviewOf)
  const actions = useCandidateRead(row && !narrow ? readKey('candidateProfileActions', row.key) : null,
    () => readActions(row?.key ?? ''), actionsOf)

  const look = lookupRead(!!row, missing, offBoard, active, live, stray)
  const retry = look.retryLook ? () => { live.reload(); stray.reload() } : active.reload
  const details = row ? knownDetails(row, overview.data) : null

  return (
    <>
      <CandidatesScreen roster={look.roster} onRetry={retry} candidates={candidates} wanted={wanted} row={row}
        tab={tab} details={details} actionsCount={openCount(actions.data)} reach={reach}
        onCandidate={(k) => go(k, 'overview', null)} onTab={(t) => go(row?.key ?? '', t, null)} onAsk={onAsk} onOpen={onOpen}
        onPhoto={mayPhoto ? () => setPhotoOpen(true) : undefined} freshPhoto={row ? fresh[row.key] : ''} />
      {row && mayPhoto && (
        <PhotoReplacePanel open={photoOpen} onClose={() => setPhotoOpen(false)} folder="staff-candidates" recordKey={row.key}
          name={row.name} current={fresh[row.key] || details?.avatar || row.avatar}
          onDone={(photo) => { keepFresh(row.key, photo); active.reload() }} />
      )}
      {row && <CandidatePanel ask={ask} row={{ ...row, stage: details?.stage || row.stage, phone: details?.phone || row.phone }}
        share={sharePayloadFor(row, tab)} onClose={() => onAsk(null)} onAsk={onAsk} canWrite={reach.write} reach={reach} />}
    </>
  )
}

// What the screen draws while a candidate the slice lacks is looked for — on the live board, then by their own…
export function lookupRead(found: boolean, missing: boolean, offBoard: boolean, active: ReadState<unknown>,
  live: ReadState<unknown>, stray: ReadState<unknown>): { roster: ReadState<unknown>; retryLook: boolean } {
  const looking = !found && (
    (missing && !live.data && live.status !== 'failed') || (offBoard && (stray.status === 'loading' || stray.status === 'idle')))
  if (looking) return { roster: { ...active, status: 'loading' }, retryLook: false }
  const failed = !found && missing
    ? (offBoard && stray.status === 'failed' && !notOnFile(stray.error) ? stray
      : !offBoard && live.status === 'failed' ? live : null)
    : null
  return failed ? { roster: failed, retryLook: true } : { roster: active, retryLook: false }
}

export function CandidatesScreen({
  roster, onRetry, candidates, wanted, row, tab: asked, details, actionsCount, onCandidate, onTab, onAsk, onOpen, reach = READ_ONLY,
  onPhoto, freshPhoto = '',
}: {
  roster: ReadState<unknown>
  onRetry: () => void
  candidates: RosterRow[]
  wanted: string
  row: RosterRow | null
  tab: CandidateTab
  /** what is known of the candidate: the overview's once read, over the roster's line */
  details: CandidateDetails | null
  actionsCount: number | null
  onCandidate: (key: string) => void
  onTab: (tab: CandidateTab) => void
  onAsk: (ask: CandidateAsk) => void
  /** a Pipeline NEXT STEP: that candidate on screen with its panel open */
  onOpen?: (key: string, ask: CandidateAsk) => void
  /** what this reader may do: the writes are the master's; a narrowed reader has three sections */
  reach?: Reach
  /** a press on the photo opens the panel that replaces it (the master, a holder of the information edition) */
  onPhoto?: () => void
  /** the photo this page just named, drawn at once */
  freshPhoto?: string
}) {
  // the breadcrumb inside the page is the master's alone while Settings › My Work hides it (the top bar keeps its own)
  const hides = useShellHides()
  const tabs = tabsFor(reach.narrow)
  const tab = tabs.some((t) => t.id === asked) ? asked : 'overview'
  const label = (id: CandidateTab, text: string) => (id === 'actions' && actionsCount ? `${text} (${actionsCount})` : text)
  const stage = details?.stage || row?.stage || ''
  const position = details?.position || row?.position || ''
  const avatar = freshPhoto || details?.avatar || row?.avatar || ''
  return (
    <div className="w-full pb-16" data-staff-candidates="">
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
        {row && <CandidateActions candidate={row.key} details={details} onAsk={onAsk} onTab={onTab} reach={reach} />}
      </div>

      {!row && (
        <section className="rounded-[20px] border border-border bg-surface p-6 shadow-1">
          {roster.status === 'loading' || roster.status === 'idle' ? (
            <p className="flex items-center gap-2 text-[13px] text-text-3"><Loader2 size={14} className="animate-spin" /> Reading the candidates…</p>
          ) : roster.status === 'failed' && !roster.data ? (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--danger)]">
              The candidates could not be read: {readRefusal(roster.error)} <RetryButton onRetry={onRetry} busy={roster.refreshing} />
            </p>
          ) : (
            <p className="text-[13px] text-text-2">
              {reach.narrow ? (wanted ? NOT_OPEN : 'No candidate is tied to your house.')
                : wanted ? `No candidate ${wanted} in the hiring records the platform reads.` : 'No candidate is in the hiring process.'}
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
              {position && <p className="-mt-1.5 text-center text-[12px] text-text-3">{position}</p>}
              <Pill meta={details?.archived ? ARCHIVED_META : stageMeta(stage)} />
            </div>
            <nav aria-label="Candidate sections" className="grid gap-1 rounded-[20px] border border-border bg-surface p-2 shadow-1">
              {tabs.map((t) => {
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
                <p className="text-[12px] text-text-3">{[position, stageMeta(stage).label].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
            <div className="scroll-thin -mx-1 overflow-x-auto px-1">
              <SegmentedTabs className="w-max" tabs={tabs.map((t) => ({ id: t.id, label: label(t.id, t.label) }))} value={tab}
                onChange={(t) => onTab(tabOf(t))} />
            </div>
          </div>

          <main className="min-w-0" data-section={tab}>
            {tab === 'overview' && <OverviewSection key={row.key} row={row} onAsk={onAsk} onTab={onTab} canWrite={reach.write}
              narrow={reach.narrow} reach={reach} />}
            {tab === 'actions' && <ActionsSection key={row.key} row={row} onAsk={onAsk} canWrite={reach.write} reach={reach} />}
            {tab === 'pipeline' && <PipelineSection candidates={candidates} current={row.key} onCandidate={onCandidate}
              onOpen={reach.narrow ? undefined : onOpen} narrow={reach.narrow} />}
            {tab === 'information' && <InformationSection key={row.key} row={row} onAsk={onAsk} reach={reach} />}
            {tab === 'interviews' && <InterviewsSection key={row.key} row={row} narrow={reach.narrow} onAsk={onAsk} reach={reach} />}
            {tab === 'documents' && <DocumentsSection key={row.key} row={row} onAsk={onAsk} canWrite={mayUpload(reach)} reach={reach} />}
            {tab === 'activity' && <ActivitySection key={row.key} row={row} onAsk={onAsk} reach={reach} />}
            {tab === 'sms' && <TextsSection key={row.key} row={row} />}
            {tab === 'transcripts' && <TranscriptsSection key={row.key} row={row} onAsk={onAsk} />}
          </main>
        </div>
      )}
    </div>
  )
}
