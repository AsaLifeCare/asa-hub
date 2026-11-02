// CLIENTS — one client at a time: profile, care & support, medication, appointments, transportation, incidents…
// The top card — the platform's own surface — holds the client switcher, Share and Actions; the left column holds…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useSectionCrumb } from '@/lib/sectionCrumb'
import { useShellHides } from '@/lib/myWorkHides'
import {
  Activity, BadgeDollarSign, Bus, CalendarDays, HeartHandshake, Loader2, Pill, Siren, SquareUser, Wallet, type LucideIcon,
} from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import SafeImg from '@/components/shared/SafeImg'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import { PhotoReplacePanel, ReplaceablePhoto, useFreshPhotos } from '@/components/shared/PhotoReplace'
import { RetryButton } from '@/pages/features/locations/LocationParts'
import { ohioToday } from '@/lib/ohio'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'
import { useDetailPanelStore } from '@/stores/useDetailPanelStore'
import { cn } from '@/lib/utils'
import {
  CLIENT_TABS, clientQuery, defaultClient, mayOpenAsk, panelOf, readRefusal, resolveClient, rosterOf, sharePayloadFor, sourcePanelOf, tabOf,
  viewOf, type BillingView, type CareView, type ClientAsk, type ClientTab, type FundsView, type MedView, type Roster,
  type RosterRow, type TransportView,
} from './clientModel'
import { heldRoster, readKey, readRoster, useClientEditions, useClientRead, type ReadState } from './useClientRead'
import {
  ClientReaderContext, NOT_OPEN, shownTabs, tabOffered, useClientReader, useTransportOffered, type ClientReader,
} from './clientViewer'
import { NotOpenNote } from './ClientParts'
import ClientSwitcher, { type InactiveState } from './ClientSwitcher'
import ClientActions from './ClientActions'
import ClientPanel from './ClientPanel'
import ProfileSection from './sections/Profile'
import CareSection from './sections/Care'
import MedicationSection from './sections/Medication'
import AppointmentsSection from './sections/Appointments'
import TransportationSection from './sections/Transportation'
import IncidentsSection from './sections/Incidents'
import FundsSection from './sections/Funds'
import BillingSection from './sections/Billing'
import ActivitySection from './sections/Activity'

const TAB_ICONS: Record<ClientTab, LucideIcon> = {
  profile: SquareUser, care: HeartHandshake, medication: Pill, appointments: CalendarDays, transportation: Bus,
  incidents: Siren, funds: Wallet, billing: BadgeDollarSign, activity: Activity,
}

export default function ClientProfilesPage() {
  const [params, setParams] = useSearchParams()
  const wanted = params.get('client') ?? ''
  const ask = panelOf(params.get('panel'))
  const today = ohioToday()
  const [showInactive, setShowInactive] = useState(false)

  // the slices already in this tab draw the switcher before any read lands
  const active = useClientRead(readKey('clientProfileRoster', '*', false), () => readRoster(false), rosterOf, heldRoster)
  // an address naming a client the active roster does not carry asks for the archived ones too
  const missing = !!wanted && !!active.data && !resolveClient(wanted, active.data.clients)
  const wantInactive = showInactive || missing
  const archived = useClientRead(wantInactive ? readKey('clientProfileRoster', '*', true) : null, () => readRoster(true), rosterOf)
  const roster: Roster | null = (wantInactive && archived.data) || active.data
  const clients = roster?.clients ?? []
  const client = roster ? (wanted ? resolveClient(wanted, clients) : defaultClient(clients)) : null
  const mayWrite = useEffectiveIsMaster()
  const editions = useClientEditions()
  const viewer = roster?.viewer ?? ''
  const reader = useMemo<ClientReader>(() => ({ viewer, mayWrite, editions }), [viewer, mayWrite, editions])
  // Transportation is offered as App Control's row (or the tab's edition) says; an address naming it shut opens the profile
  const transport = useTransportOffered(reader)
  const tab = tabOffered(tabOf(params.get('tab')), transport)
  useSectionCrumb(CLIENT_TABS.find((t) => t.id === tab)?.label)
  const view = viewOf(tab, params.get('view'))
  // the photo: the master, or a holder of the profile edition, replaces it from the page
  const mayPhoto = mayWrite || editions.includes('clients.profile')
  const [photoOpen, setPhotoOpen] = useState(false)
  const [fresh, keepFresh] = useFreshPhotos()
  // a write's panel, from an address or a link, is never opened for an account the write would refuse
  const shownAsk = ask && mayOpenAsk(reader, ask) ? ask : null

  const go = useCallback((key: string, next: ClientTab, nextView: string, panel: ClientAsk | null, replace = false) => {
    setParams(new URLSearchParams(clientQuery(key, next, nextView, panel).slice(1)), { replace })
  }, [setParams])

  // an address with no client opens on the first active one, keeping the tab it named: only the drawing falls back, so
  // a link read before App Control's rows and the editions answer still opens
  useEffect(() => {
    if (wanted || !client) return
    const named = tabOf(params.get('tab'))
    go(client.client_key, named, viewOf(named, params.get('view')), ask, true)
  }, [wanted, client, params, ask, go])

  const onAsk = useCallback((next: ClientAsk | null) => {
    if (!client) return
    if (next) useDetailPanelStore.getState().closeDetail()
    go(client.client_key, tab, view, next)
  }, [client, tab, view, go])
  // a section read from its own app opens its own panel; the address holds it, so one panel is open at a time
  const onPanel = useCallback((value: string | null) => onAsk(value ? { kind: 'source', value } : null), [onAsk])

  const inactive: InactiveState = {
    on: showInactive,
    reading: wantInactive && archived.status === 'loading',
    why: archived.data?.inactiveWhy || (archived.status === 'failed' ? readRefusal(archived.error) : ''),
  }
  // a client the active roster lacks is looked for among the archived ones before the screen says it is unknown
  const looking = missing && !archived.data
  const rosterRead: ReadState<unknown> = looking ? (archived.status === 'failed' ? archived : { ...archived, status: 'loading' }) : active

  return (
    <ClientReaderContext.Provider value={reader}>
      <ClientsScreen roster={rosterRead} onRetry={looking ? archived.reload : active.reload} clients={clients} wanted={wanted} client={client} tab={tab} view={view}
        today={today} inactive={inactive} onInactive={setShowInactive}
        onClient={(k) => go(k, tab, view, null)} onTab={(t) => go(client?.client_key ?? '', t, '', null)}
        onView={(v) => go(client?.client_key ?? '', tab, v, null)} onAsk={onAsk} panel={sourcePanelOf(shownAsk)} onPanel={onPanel}
        onPhoto={mayPhoto ? () => setPhotoOpen(true) : undefined} photoOf={(c) => fresh[c.client_key] || c.avatar} />
      {client && mayPhoto && (
        <PhotoReplacePanel open={photoOpen} onClose={() => setPhotoOpen(false)} folder="clients" recordKey={client.client_key}
          name={client.name} current={fresh[client.client_key] || client.avatar}
          onDone={(photo) => { keepFresh(client.client_key, photo); active.reload() }} />
      )}
      {client && (
        <ClientPanel ask={shownAsk?.kind === 'source' ? null : shownAsk} client={client} clients={clients} share={sharePayloadFor(client, tab, view)}
          onAsk={onAsk} onClose={() => onAsk(null)} />
      )}
    </ClientReaderContext.Provider>
  )
}

export function ClientsScreen({ roster, onRetry, clients, wanted, client, tab, view, today, inactive, onInactive, onClient, onTab, onView, onAsk,
  panel = null, onPanel = () => {}, onPhoto, photoOf = (c) => c.avatar }: {
  roster: ReadState<unknown>
  onRetry: () => void
  clients: RosterRow[]
  wanted: string
  client: RosterRow | null
  tab: ClientTab
  view: string
  today: string
  inactive: InactiveState
  onInactive: (on: boolean) => void
  onClient: (key: string) => void
  onTab: (tab: ClientTab) => void
  onView: (view: string) => void
  onAsk: (ask: ClientAsk) => void
  /** the open panel of a section read from its own app, as that section's own parameter */
  panel?: string | null
  onPanel?: (panel: string | null) => void
  /** a press on the photo opens the panel that replaces it (the master, a holder of the profile edition) */
  onPhoto?: () => void
  /** the client's photo, a replaced one drawn at once */
  photoOf?: (client: RosterRow) => string
}) {
  const reader = useClientReader()
  // Medication and Billing are the master's alone while Settings › My Work hides them (hidden until it answers);
  // Transportation is whom App Control's row names, and the holders of its edition
  const hides = useShellHides()
  const transport = useTransportOffered(reader)
  const tabs = shownTabs(CLIENT_TABS, reader.viewer).filter((t) =>
    !(t.id === 'medication' && hides.client_medication) && !(t.id === 'billing' && hides.client_billing) &&
    !(t.id === 'transportation' && !transport))
  const tabOpen = tabs.some((t) => t.id === tab)
  return (
    <div className="w-full pb-16" data-client-profiles="">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-surface p-3 shadow-1 sm:p-4"
        data-top-bar="">
        <ClientSwitcher clients={clients} current={client} inactive={inactive} onInactive={onInactive} onPick={onClient} />
        {client && <ClientActions tab={tab} view={view} onAsk={onAsk} />}
      </div>

      {!client && (
        <section className="rounded-[20px] border border-border bg-surface p-6 shadow-1">
          {roster.status === 'loading' || roster.status === 'idle' ? (
            <p className="flex items-center gap-2 text-[13px] text-text-3"><Loader2 size={14} className="animate-spin" /> Reading the clients…</p>
          ) : roster.status === 'failed' && !roster.data && readRefusal(roster.error) === NOT_OPEN ? (
            <p className="text-[13px] text-text-2" data-not-open="">{NOT_OPEN}</p>
          ) : roster.status === 'failed' && !roster.data ? (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--danger)]">
              The clients could not be read: {readRefusal(roster.error)} <RetryButton onRetry={onRetry} busy={roster.refreshing} />
            </p>
          ) : (
            <p className="text-[13px] text-text-2">
              {wanted ? `No client ${wanted} in the clients the platform reads.` : 'No client is on record.'}
              {clients.length > 0 && (
                <button type="button" onClick={() => onClient(clients[0].client_key)} className="ml-2 font-semibold text-primary hover:underline">
                  Open a client
                </button>
              )}
            </p>
          )}
        </section>
      )}

      {client && (
        <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="hidden content-start gap-4 md:grid" data-rail="">
            <div className="grid justify-items-center gap-3 rounded-[20px] border border-border bg-surface p-5 shadow-1" data-photo-card="">
              <ReplaceablePhoto name={client.name} onReplace={onPhoto}>
                <SafeImg src={photoOf(client)} name={client.name} shape="round" size="h-24 w-24 text-[26px]" eager alt={client.name} />
              </ReplaceablePhoto>
              <p className="text-center font-display text-[15px] font-semibold text-text-1">{client.name}</p>
            </div>
            <nav aria-label="Client sections" className="grid gap-1 rounded-[20px] border border-border bg-surface p-2 shadow-1">
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
              <ReplaceablePhoto name={client.name} onReplace={onPhoto}>
                <Avatar src={photoOf(client)} name={client.name} size="lg" />
              </ReplaceablePhoto>
              <p className="font-display text-[15px] font-semibold text-text-1">{client.name}</p>
            </div>
            <div className="scroll-thin -mx-1 overflow-x-auto px-1">
              <SegmentedTabs className="w-max" tabs={tabs.map((t) => ({ id: t.id, label: t.label }))} value={tab}
                onChange={(t) => onTab(tabOf(t))} />
            </div>
          </div>

          <main className="min-w-0" data-section={tab}>
            {tab === 'profile' && <ProfileSection key={client.client_key} client={client} today={today} onAsk={onAsk} />}
            {tab === 'care' && <CareSection key={client.client_key} client={client} view={view as CareView} onView={onView} onAsk={onAsk} />}
            {tab === 'medication' && tabOpen && (
              <MedicationSection key={client.client_key} client={client} view={view as MedView} today={today} onView={onView} onAsk={onAsk}
                panel={panel} onPanel={onPanel} />
            )}
            {tab === 'appointments' && <AppointmentsSection key={client.client_key} client={client} panel={panel} onPanel={onPanel} />}
            {tab === 'transportation' && tabOpen && (
              <TransportationSection key={client.client_key} client={client} view={view as TransportView} onView={onView}
                panel={panel} onPanel={onPanel} />
            )}
            {tab === 'incidents' && <IncidentsSection key={client.client_key} client={client} onAsk={onAsk} />}
            {tab === 'funds' && (
              <FundsSection key={client.client_key} client={client} view={view as FundsView} onView={onView} panel={panel} onPanel={onPanel} />
            )}
            {tab === 'billing' && tabOpen && (
              <BillingSection key={client.client_key} client={client} view={view as BillingView} onView={onView} panel={panel} onPanel={onPanel} />
            )}
            {tab === 'activity' && <ActivitySection key={client.client_key} client={client} onAsk={onAsk} />}
            {!tabOpen && <NotOpenNote />}
          </main>
        </div>
      )}
    </div>
  )
}
