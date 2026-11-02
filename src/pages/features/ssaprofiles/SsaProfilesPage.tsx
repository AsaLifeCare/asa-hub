// SSA — one Service and Support Administrator at a time: overview, documents and activity.
// The top card — the platform's own surface — holds the SSA switcher, Share and Actions; the left column holds the…
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useSectionCrumb } from '@/lib/sectionCrumb'
import { Activity, FolderOpen, LayoutGrid, Loader2, StickyNote, type LucideIcon } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import SafeImg from '@/components/shared/SafeImg'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import { PhotoReplacePanel, ReplaceablePhoto, useFreshPhotos } from '@/components/shared/PhotoReplace'
import { ActivePill } from '@/pages/features/locations/HouseSwitcher'
import { RetryButton } from '@/pages/features/locations/LocationParts'
import { useDetailPanelStore } from '@/stores/useDetailPanelStore'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { useBadgeAccessStore } from '@/lib/badgeAccess'
import { cn } from '@/lib/utils'
import {
  NOT_OPEN, SSA_TABS, askWithin, defaultSsa, narrowedViewer, overviewOf, panelOf, refusalFor, resolveSsa, rosterOf,
  sharePayloadFor, shutTo, ssaCountyHidden, ssaListEdits, ssaMayEdit, ssaMayNote, ssaNotesOpen, ssaQuery, ssaReach,
  ssaWriteReach, tabOf, tabWithin, withoutDocuments, type Roster, type RosterRow, type SsaAsk, type SsaListEdits,
  type SsaOverview, type SsaReach, type SsaTab,
} from './ssaModel'
import { useShellHides } from '@/lib/myWorkHides'
import { heldRoster, readKey, readOverview, readRoster, useSsaEditions, useSsaRead, type ReadState } from './useSsaRead'
import SsaSwitcher, { type InactiveState } from './SsaSwitcher'
import SsaActions from './SsaActions'
import SsaPanel from './SsaPanel'
import OverviewSection from './sections/Overview'
import DocumentsSection from './sections/Documents'
import ActivitySection from './sections/Activity'
import NotesSection from './sections/Notes'

const TAB_ICONS: Record<SsaTab, LucideIcon> = { overview: LayoutGrid, documents: FolderOpen, activity: Activity, notes: StickyNote }

const NO_LIST_EDITS: SsaListEdits = { docs: false, activity: false }

export default function SsaProfilesPage() {
  const [params, setParams] = useSearchParams()
  const wanted = params.get('ssa') ?? ''
  const me = useEffectiveUser()
  const master = me?.isMaster === true
  const [showInactive, setShowInactive] = useState(false)

  // the slices already in this tab draw the switcher before any read lands
  const active = useSsaRead(readKey('ssaProfileRoster', '*', false), () => readRoster(false), rosterOf, heldRoster)
  // an address naming an SSA the current roster does not carry asks for the inactive ones too
  const missing = !!wanted && !!active.data && !resolveSsa(wanted, active.data.ssas)
  // lane 1 drawn first; when it could not name every current client's SSA the action's roster replaces it once read
  const wantAll = showInactive || missing || !!active.data?.partial
  const all = useSsaRead(wantAll ? readKey('ssaProfileRoster', '*', true) : null, () => readRoster(true), rosterOf)
  const roster: Roster | null = (wantAll && all.data) || active.data
  const ssas = roster?.ssas ?? []
  const row = roster ? (wanted ? resolveSsa(wanted, ssas) : defaultSsa(ssas)) : null
  // Documents is the master's alone while Settings › My Work hides it (every part stays hidden until that answers)
  const hides = useShellHides()
  // the notes as the roster said; the slices' roster says nothing, so App Control's Notes row decides as the server does
  const rules = useBadgeAccessStore((s) => s.rules)
  const notes = ssaNotesOpen(all.data?.notes ?? active.data?.notes ?? null, me, rules)
  const reach = withoutDocuments(ssaReach(all.data?.viewer || active.data?.viewer || '', narrowedViewer(me), master, notes),
    master, hides.ssa_documents)
  // whom editionsMine names for the SSA's details and notes: the master and the listed, while SSA runs on Python
  const editions = useSsaEditions()
  const mayEdit = ssaMayEdit(narrowedViewer(me), editions)
  const mayNote = ssaMayNote(narrowedViewer(me), editions)
  // the Documents' and the Activity's entries: every director and badge above one, the master and the listed
  const lists = ssaListEdits(narrowedViewer(me), editions)
  // the photo: the master, or a holder of the details edition, replaces it from the page
  const mayPhoto = master || mayEdit
  const [photoOpen, setPhotoOpen] = useState(false)
  const [fresh, keepFresh] = useFreshPhotos()
  const tab = tabWithin(tabOf(params.get('tab')), reach)
  useSectionCrumb(SSA_TABS.find((t) => t.id === tab)?.label)
  const ask = askWithin(panelOf(params.get('panel')), reach, mayEdit, mayNote && reach.notes, lists)

  const go = useCallback((key: string, next: SsaTab, panel: SsaAsk | null, replace = false) => {
    setParams(new URLSearchParams(ssaQuery(key, next, panel).slice(1)), { replace })
  }, [setParams])

  // an address with no SSA opens on the first active one
  useEffect(() => {
    if (!wanted && row) go(row.key, tab, ask, true)
  }, [wanted, row, tab, ask, go])

  const onAsk = useCallback((next: SsaAsk | null) => {
    if (!row) return
    // the detail panel and this one share the slot on the right
    if (next) useDetailPanelStore.getState().closeDetail()
    go(row.key, tab, next)
  }, [row, tab, go])

  const overview = useSsaRead(row ? readKey('ssaProfileOverview', row.key) : null, () => readOverview(row?.key ?? ''), overviewOf)
  const hideCounty = ssaCountyHidden(master, overview.data)
  // the agency the overview reads (the SSA's own, else the e-mail's) rides a share, not the slice's
  const ownAgency = row && overview.data?.ssa.key === row.key ? overview.data.ssa.agency : ''

  const inactive: InactiveState = {
    on: showInactive,
    reading: (showInactive || missing) && all.status === 'loading',
    why: all.data?.why.join(' ') || (all.status === 'failed' ? refusalFor(all.error, master) : ''),
  }
  // an SSA the current roster lacks is looked for among every SSA before the screen says it is unknown
  const looking = missing && !all.data
  const rosterRead: ReadState<unknown> = looking ? (all.status === 'failed' ? all : { ...all, status: 'loading' }) : active

  return (
    <>
      <SsaScreen roster={rosterRead} onRetry={looking ? all.reload : active.reload} ssas={ssas} wanted={wanted} row={row} tab={tab}
        reach={reach} master={master} overview={overview.data} inactive={inactive} onInactive={setShowInactive}
        onSsa={(k) => go(k, tab, null)} onTab={(t) => go(row?.key ?? '', t, null)} onAsk={onAsk} edit={mayEdit} note={mayNote}
        lists={lists} onPhoto={mayPhoto ? () => setPhotoOpen(true) : undefined} freshPhoto={row ? fresh[row.key] : ''} />
      {row && mayPhoto && (
        <PhotoReplacePanel open={photoOpen} onClose={() => setPhotoOpen(false)} folder="ssa" recordKey={row.key} name={row.name}
          round={false} current={fresh[row.key] || overview.data?.ssa.avatar || row.avatar}
          onDone={(photo) => { keepFresh(row.key, photo); active.reload() }} />
      )}
      {row && <SsaPanel ask={ask} row={row} share={sharePayloadFor(ownAgency ? { ...row, agency: ownAgency } : row, tab, hideCounty)}
        onClose={() => onAsk(null)} />}
    </>
  )
}

export function SsaScreen({ roster, onRetry, ssas, wanted, row, tab, reach, master, overview, inactive, onInactive, onSsa, onTab, onAsk, edit = false,
  note = false, lists = NO_LIST_EDITS, onPhoto, freshPhoto = '' }: {
  roster: ReadState<unknown>
  onRetry: () => void
  ssas: RosterRow[]
  wanted: string
  row: RosterRow | null
  tab: SsaTab
  /** the sections, notes and writes this session is offered */
  reach: SsaReach
  /** the master in its own session: a refusal is a deployment without SSA, never a shut door */
  master: boolean
  /** the SSA's overview once read, for the photo, Actions and whether the county is hidden */
  overview: SsaOverview | null
  inactive: InactiveState
  onInactive: (on: boolean) => void
  onSsa: (key: string) => void
  onTab: (tab: SsaTab) => void
  onAsk: (ask: SsaAsk) => void
  /** the master or a holder of the SSA's details edition: Edit details is offered */
  edit?: boolean
  /** a holder of the notes edition: Add note and the composer are offered where the notes are read */
  note?: boolean
  /** a maker of the Documents' or the Activity's edition: each entry's pencil is offered */
  lists?: SsaListEdits
  /** a press on the photo opens the panel that replaces it (the master, a holder of the details edition) */
  onPhoto?: () => void
  /** the photo this page just named, drawn at once */
  freshPhoto?: string
}) {
  const own = overview && row && (!overview.ssa.key || overview.ssa.key === row.key) ? overview : null
  const avatar = freshPhoto || own?.ssa.avatar || row?.avatar || ''
  const tabs = SSA_TABS.filter((t) => reach.tabs.includes(t.id))
  const writes = ssaWriteReach(reach, note)
  return (
    <div className="w-full pb-16" data-ssa-profiles="">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-surface p-3 shadow-1 sm:p-4"
        data-top-bar="">
        <SsaSwitcher ssas={ssas} current={row} inactive={inactive} onInactive={onInactive} onPick={onSsa}
          hideCounty={ssaCountyHidden(master, overview)} />
        {row && <SsaActions details={own?.ssa ?? row} clients={own?.clients ?? null} write={writes.write} edit={edit} onAsk={onAsk} />}
      </div>

      {!row && (
        <section className="rounded-[20px] border border-border bg-surface p-6 shadow-1">
          {roster.status === 'loading' || roster.status === 'idle' ? (
            <p className="flex items-center gap-2 text-[13px] text-text-3"><Loader2 size={14} className="animate-spin" /> Reading the SSAs…</p>
          ) : roster.status === 'failed' && !roster.data && shutTo(roster.error, master) ? (
            <p className="text-[13px] text-text-2" data-read="not-open">{NOT_OPEN}</p>
          ) : roster.status === 'failed' && !roster.data ? (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--danger)]">
              The SSAs could not be read: {refusalFor(roster.error, master)} <RetryButton onRetry={onRetry} busy={roster.refreshing} />
            </p>
          ) : (
            <p className="text-[13px] text-text-2">
              {wanted ? `No SSA ${wanted} in the client records the platform reads.` : 'No client record names an SSA.'}
              {ssas.length > 0 && (
                <button type="button" onClick={() => onSsa(ssas[0].key)} className="ml-2 font-semibold text-primary hover:underline">
                  Open an SSA
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
              <ReplaceablePhoto name={row.name} onReplace={onPhoto} round={false}>
                <SafeImg src={avatar} name={row.name} shape="square" size="h-24 w-24 text-[26px]" eager alt={row.name} />
              </ReplaceablePhoto>
              <p className="text-center font-display text-[15px] font-semibold text-text-1">{row.name}</p>
              <ActivePill active={row.status === 'active'} />
            </div>
            <nav aria-label="SSA sections" className="grid gap-1 rounded-[20px] border border-border bg-surface p-2 shadow-1">
              {tabs.map((t) => {
                const Icon = TAB_ICONS[t.id]
                const on = t.id === tab
                return (
                  <button key={t.id} type="button" onClick={() => onTab(t.id)} aria-current={on ? 'page' : undefined} data-tab={t.id}
                    className={cn('flex items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left text-[13px] transition-colors',
                      on ? 'bg-primary-soft font-semibold text-text-1' : 'text-text-2 hover:bg-surface-2')}>
                    <Icon size={16} className="shrink-0" /> {t.label}
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
              </div>
            </div>
            <div className="scroll-thin -mx-1 overflow-x-auto px-1">
              <SegmentedTabs className="w-max" tabs={tabs.map((t) => ({ id: t.id, label: t.label }))} value={tab}
                onChange={(t) => onTab(tabOf(t))} />
            </div>
          </div>

          <main className="min-w-0" data-section={tab}>
            {tab === 'overview' && <OverviewSection key={row.key} row={row}
              onEdit={edit ? () => onAsk({ kind: 'edit' }) : undefined} />}
            {tab === 'documents' && <DocumentsSection key={row.key} row={row}
              onEdit={lists.docs ? (id) => onAsk({ kind: 'doc-edit', id }) : undefined} />}
            {tab === 'activity' && <ActivitySection key={row.key} row={row}
              onEdit={lists.activity ? (id) => onAsk({ kind: 'activity-edit', id }) : undefined} />}
            {tab === 'notes' && writes.notes && <NotesSection key={row.key} row={row} write={writes.write} />}
          </main>
        </div>
      )}
    </div>
  )
}
