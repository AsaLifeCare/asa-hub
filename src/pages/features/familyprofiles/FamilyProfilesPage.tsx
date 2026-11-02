// FAMILIES — one family member at a time: overview, documents and activity.
// The top card — the platform's own surface — holds the family switcher, Share and Actions; the left column holds…
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useSectionCrumb } from '@/lib/sectionCrumb'
import { Activity, FolderOpen, LayoutGrid, Loader2, StickyNote, type LucideIcon } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import SafeImg from '@/components/shared/SafeImg'
import { PhotoReplacePanel, ReplaceablePhoto, useFreshPhotos } from '@/components/shared/PhotoReplace'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import { ActivePill } from '@/pages/features/locations/HouseSwitcher'
import { RetryButton } from '@/pages/features/locations/LocationParts'
import { useDetailPanelStore } from '@/stores/useDetailPanelStore'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'
import { cn } from '@/lib/utils'
import {
  CAN_ALL, CAN_NONE, FAMILY_TABS, defaultFamily, familyCan, familyQuery, familyTabs, mayOpenAsk, overviewOf, panelOf, readRefusal,
  resolveFamily, rosterOf, sharePayloadFor, tabOf, viewNarrowed, type FamilyAsk, type FamilyCan, type FamilyOverview,
  type FamilyTab, type FamilyView, type RosterRow,
} from './familyModel'
import { readKey, readOverview, readRoster, useFamilyEditions, useFamilyRead, type ReadState } from './useFamilyRead'
import FamilySwitcher from './FamilySwitcher'
import FamilyActions from './FamilyActions'
import FamilyPanel from './FamilyPanel'
import OverviewSection from './sections/Overview'
import DocumentsSection from './sections/Documents'
import ActivitySection from './sections/Activity'
import NotesSection from './sections/Notes'

const TAB_ICONS: Record<FamilyTab, LucideIcon> = {
  overview: LayoutGrid, documents: FolderOpen, activity: Activity, notes: StickyNote,
}

const MASTER_VIEW: FamilyView = { kind: 'master', notes: true }

export default function FamilyProfilesPage() {
  const [params, setParams] = useSearchParams()
  const wanted = params.get('family') ?? ''
  const writes = useEffectiveIsMaster()
  const editions = useFamilyEditions()
  const asked = panelOf(params.get('panel'))
  const [showInactive, setShowInactive] = useState(false)

  const roster = useFamilyRead(readKey('familyProfileRoster', '*'), () => readRoster(), rosterOf)
  const families = roster.data?.families ?? []
  const view = roster.data?.view ?? MASTER_VIEW
  // Notes is this viewer's only when the server opens the notes to them; its address opens the Overview otherwise
  const askedTab = tabOf(params.get('tab'))
  const tab: FamilyTab = askedTab === 'notes' && !(roster.data ? view.notes : writes) ? 'overview' : askedTab
  useSectionCrumb(FAMILY_TABS.find((t) => t.id === tab)?.label)
  // every mode of the panel but Share files something: the master's, or a holder's of its edition (Settings › Editions)
  const can = familyCan(writes, editions, view)
  const ask = asked && mayOpenAsk(can, asked) ? asked : null
  const row = roster.data ? (wanted ? resolveFamily(wanted, families) : defaultFamily(families)) : null
  // the photo: the master, or a holder of the profile edition (can.edit), replaces it from the page
  const [photoOpen, setPhotoOpen] = useState(false)
  const [fresh, keepFresh] = useFreshPhotos()

  const go = useCallback((key: string, next: FamilyTab, panel: FamilyAsk | null, replace = false) => {
    setParams(new URLSearchParams(familyQuery(key, next, panel).slice(1)), { replace })
  }, [setParams])

  // an address with no family member opens on the first active one
  useEffect(() => {
    if (!wanted && row) go(row.key, tab, ask, true)
  }, [wanted, row, tab, ask, go])

  const onAsk = useCallback((next: FamilyAsk | null) => {
    if (!row) return
    // the detail panel and this one share the slot on the right
    if (next) useDetailPanelStore.getState().closeDetail()
    go(row.key, tab, next)
  }, [row, tab, go])

  const overview = useFamilyRead(row ? readKey('familyProfileOverview', row.key) : null, () => readOverview(row?.key ?? ''), overviewOf)

  return (
    <>
      <FamilyScreen roster={roster} onRetry={roster.reload} families={families} why={roster.data?.why ?? []} wanted={wanted} row={row}
        tab={tab} view={view} writes={writes} can={can} overview={overview.data} showInactive={showInactive} onInactive={setShowInactive}
        onFamily={(k) => go(k, tab, null)} onTab={(t) => go(row?.key ?? '', t, null)} onAsk={onAsk}
        onPhoto={can.edit ? () => setPhotoOpen(true) : undefined} freshPhoto={row ? fresh[row.key] : ''} />
      {row && can.edit && (
        <PhotoReplacePanel open={photoOpen} onClose={() => setPhotoOpen(false)} folder="families" recordKey={row.key} name={row.name}
          current={fresh[row.key] || overview.data?.family.avatar || row.avatar}
          onDone={(photo) => { keepFresh(row.key, photo); roster.reload() }} />
      )}
      {row && <FamilyPanel ask={ask} row={row} share={sharePayloadFor(row, tab)} onClose={() => onAsk(null)}
        onRenamed={(key) => go(key, tab, null)} onCreated={(key) => go(key, 'activity', null)} onAsk={onAsk} />}
    </>
  )
}

export function FamilyScreen({
  roster, onRetry, families, why, wanted, row, tab, view, writes, can, overview, showInactive, onInactive, onFamily, onTab, onAsk,
  onPhoto, freshPhoto = '',
}: {
  roster: ReadState<unknown>
  onRetry: () => void
  families: RosterRow[]
  why: string[]
  wanted: string
  row: RosterRow | null
  tab: FamilyTab
  /** how far the server lets this session read, as the roster says */
  view: FamilyView
  /** the master's session */
  writes: boolean
  /** the writes this viewer makes: every one for the master, a holder's editions; `writes` decides when not said */
  can?: FamilyCan
  /** the family member's overview once read, for the photo and Actions */
  overview: FamilyOverview | null
  showInactive: boolean
  onInactive: (on: boolean) => void
  onFamily: (key: string) => void
  onTab: (tab: FamilyTab) => void
  onAsk: (ask: FamilyAsk) => void
  /** a press on the photo opens the panel that replaces it (the master, a holder of the profile edition) */
  onPhoto?: () => void
  /** the photo this page just named, drawn at once */
  freshPhoto?: string
}) {
  const allowed = can ?? (writes ? CAN_ALL : CAN_NONE)
  const tabs = familyTabs(view.notes)
  const own = overview && row && (!overview.family.key || overview.family.key === row.key) ? overview : null
  const avatar = freshPhoto || own?.family.avatar || row?.avatar || ''
  const caption = row?.relationship || 'Family member'
  return (
    <div className="w-full pb-16" data-family-profiles="">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-surface p-3 shadow-1 sm:p-4"
        data-top-bar="">
        <FamilySwitcher families={families} current={row} why={why} showInactive={showInactive} onInactive={onInactive} onPick={onFamily} />
        {row && <FamilyActions clients={own?.clients ?? null} writes={writes} can={allowed} onAsk={onAsk} />}
      </div>

      {!row && (
        <section className="rounded-[20px] border border-border bg-surface p-6 shadow-1">
          {roster.status === 'loading' || roster.status === 'idle' ? (
            <p className="flex items-center gap-2 text-[13px] text-text-3"><Loader2 size={14} className="animate-spin" /> Reading the family members…</p>
          ) : roster.status === 'failed' && !roster.data ? (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--danger)]">
              The family members could not be read: {readRefusal(roster.error, writes)} <RetryButton onRetry={onRetry} busy={roster.refreshing} />
            </p>
          ) : (
            <div className="grid gap-2">
              <p className="text-[13px] text-text-2">
                {wanted ? `No family member ${wanted} in the records the platform reads.`
                  : viewNarrowed(view) ? 'No family member is open to you here.'
                    : 'No client record, plan or directory row names a family member.'}
                {families.length > 0 && (
                  <button type="button" onClick={() => onFamily(families[0].key)} className="ml-2 font-semibold text-primary hover:underline">
                    Open a family member
                  </button>
                )}
              </p>
              {why.length > 0 && <ul className="grid gap-1 text-[12px] leading-4 text-text-3" data-why="">{why.map((w) => <li key={w}>{w}</li>)}</ul>}
            </div>
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
              <p className="-mt-1.5 text-center text-[12px] text-text-3">{caption}</p>
              <ActivePill active={row.status === 'active'} />
            </div>
            <nav aria-label="Family sections" className="grid gap-1 rounded-[20px] border border-border bg-surface p-2 shadow-1">
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
                <p className="text-[12px] text-text-3">{caption}</p>
              </div>
            </div>
            <div className="scroll-thin -mx-1 overflow-x-auto px-1">
              <SegmentedTabs className="w-max" tabs={tabs.map((t) => ({ id: t.id, label: t.label }))} value={tab}
                onChange={(t) => onTab(tabOf(t))} />
            </div>
          </div>

          <main className="min-w-0" data-section={tab}>
            {tab === 'overview' && <OverviewSection key={row.key} row={row}
              onEdit={allowed.edit ? () => onAsk({ kind: 'edit' }) : undefined} />}
            {tab === 'notes' && view.notes && <NotesSection key={row.key} row={row} writes={allowed.note}
              onEditNote={allowed.note ? (id) => onAsk({ kind: 'note-edit', id }) : undefined} />}
            {tab === 'documents' && <DocumentsSection key={row.key} row={row}
              onEdit={allowed.edit ? () => onAsk({ kind: 'edit' }) : undefined}
              onAdd={allowed.doc ? () => onAsk({ kind: 'doc' }) : undefined} />}
            {tab === 'activity' && <ActivitySection key={row.key} row={row}
              onEditCall={allowed.call ? (id) => onAsk({ kind: 'call-edit', id }) : undefined} />}
          </main>
        </div>
      )}
    </div>
  )
}
