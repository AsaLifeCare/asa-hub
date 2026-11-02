// Overview: the house's details (name, type, house manager and number, address, house phone), its open notes and…
// The house manager is the hotline calendar's (locationOverview); the rest is the houses slice.
import { Fragment } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Pencil, Plus } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import AddressMapLink from '@/components/shared/AddressMap'
import DragPerson from '@/components/shared/DragPerson'
import { TintChip } from '@/pages/features/clientops/OpsPageShell'
import { clientProfileHref, type HouseClient, type HouseRow } from '@/pages/features/houses/houseModel'
import { staffHref } from '@/pages/features/staffprofiles/staffModel'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { ohioDayYear } from '@/lib/ohio'
import {
  NOT_ON_FILE, nameKey, noteClient, notesOf, openNotes, overviewOf, priorityLabel, telHref,
  type HouseNote, type LocationOverview, type PanelAsk,
} from '../locationModel'
import { readKey, readNotes, readOverview, useLocationRead, useLocationViewer, viewerCan, type ReadState } from '../useLocation'
import { useAuthStore } from '@/auth/useAuthStore'
import { Pair, ReadLine, SectionCard, linkCls } from '../LocationParts'

export default function Overview({ house, onAsk }: {
  house: HouseRow
  onAsk: (ask: PanelAsk) => void
}) {
  const { cut } = useLocationViewer()
  const overview = useLocationRead(readKey('locationOverview', house.code), () => readOverview(house.code), overviewOf)
  // a client's or a family member's view has no house notes: they are never asked for
  const notes = useLocationRead(cut ? null : readKey('locationNotes', house.code), () => readNotes(house.code), notesOf)
  return <OverviewView house={house} overview={overview} notes={notes} onAsk={onAsk}
    onRetryOverview={overview.reload} onRetryNotes={notes.reload} />
}

const PRIORITY_TINT: Record<string, 'slate' | 'warning' | 'danger'> = { normal: 'slate', high: 'warning', urgent: 'danger' }

export function OverviewView({ house, overview, notes, onAsk, onRetryOverview, onRetryNotes }: {
  house: HouseRow
  overview: ReadState<LocationOverview>
  notes: ReadState<HouseNote[]>
  onAsk: (ask: PanelAsk) => void
  onRetryOverview: () => void
  onRetryNotes: () => void
}) {
  const viewer = useLocationViewer()
  const { cut } = viewer
  const writes = viewerCan(viewer, 'locations.house')
  const anyNote = viewerCan(viewer, 'locations.notesAny')
  const addClients = viewerCan(viewer, 'locations.clientsAdd')
  const me = useAuthStore((s) => s.user?.name || s.user?.email || '')
  const o = overview.data
  const hm = o?.managers[0] ?? null
  const address = house.address || o?.address || ''
  const open = notes.data ? openNotes(notes.data) : []
  // the houses slice's clients; for a viewer who adds clients, any the house's own read already carries too — a…
  const clients: HouseClient[] = !addClients ? house.clients : [...house.clients, ...(o?.clients ?? [])
    .filter((c) => !house.clients.some((h) => nameKey(h.name) === nameKey(c.name)))
    .map((c) => ({ name: c.name, client_key: c.client_key }))]
  return (
    <div className="grid gap-5">
      <SectionCard title="House Details" extra={writes && o && Object.keys(o.edit).length > 0 ? (
        <button type="button" onClick={() => onAsk({ kind: 'house' })} data-edit-house="" aria-label="Edit the house details"
          title="Edit the house details"
          className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-text-2 hover:bg-surface-2 hover:text-text-1">
          <Pencil size={14} />
        </button>
      ) : undefined}>
        <ReadLine state={overview} what="the house details" onRetry={onRetryOverview} />
        <dl data-house-details="">
          <Pair label="Location name">
            <Link to={`/app/houses/dossier?house=${encodeURIComponent(house.code)}`} className={linkCls}>{house.title}</Link>
          </Pair>
          <Pair label="Type">{o ? (o.type ?? <span className="text-text-3">{NOT_ON_FILE}</span>) : '—'}</Pair>
          <Pair label="House manager">
            {hm ? (
              <DragPerson name={hm.name} type="staff" subtitle="House manager">
                <Link to={staffHref(hm.name)} className={linkCls}>{hm.name}</Link>
              </DragPerson>
            ) : o ? (
              <span className="text-text-3">Not on the hotline calendar{o.managersWhy ? ` — ${o.managersWhy}` : ''}</span>
            ) : '—'}
            {o && o.managers.length > 1 && (
              <span className="mt-0.5 block text-[12px] text-text-3">
                Also on the calendar: {o.managers.slice(1).map((m, i) => (
                  <Fragment key={m.name}>{i > 0 && ', '}<Link to={staffHref(m.name)} className={linkCls}>{m.name}</Link></Fragment>
                ))}
              </span>
            )}
            {o?.registryManager && !o.managers.some((m) => nameKey(m.name) === nameKey(o.registryManager?.name)) && (
              <span className="mt-0.5 block text-[12px] text-text-3" data-registry-manager="">
                The house registry names <Link to={staffHref(o.registryManager.name)} className={linkCls}>{o.registryManager.name}</Link>{o.registryManager.phone ? ` · ${formatPhoneDisplay(o.registryManager.phone)}` : ''}
              </span>
            )}
          </Pair>
          <Pair label="HM number">
            {hm?.phone ? <a href={telHref(hm.phone)} className={linkCls}>{formatPhoneDisplay(hm.phone)}</a>
              : o ? <span className="text-text-3">{NOT_ON_FILE}</span> : '—'}
          </Pair>
          <Pair label="Address">
            {address ? (
              <AddressMapLink address={address} title={house.title} />
            ) : <span className="text-text-3">{NOT_ON_FILE}{house.address_why ? ` — ${house.address_why}` : ''}</span>}
          </Pair>
          <Pair label="House phone" last>
            {o?.housePhone ? <a href={telHref(o.housePhone)} className={linkCls}>{formatPhoneDisplay(o.housePhone)}</a>
              : o ? <span className="text-text-3">{NOT_ON_FILE}</span> : '—'}
          </Pair>
        </dl>
      </SectionCard>

      {!cut && <SectionCard title="House Notes" extra={writes ? (
        <button type="button" onClick={() => onAsk({ kind: 'notes' })}
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12.5px] font-semibold text-primary hover:bg-primary-soft">
          <Plus size={13} /> Add note
        </button>
      ) : undefined}>
        <ReadLine state={notes} what="the house notes" onRetry={onRetryNotes} />
        {notes.data && open.length === 0 && <p className="text-[13px] text-text-3">No house notes.</p>}
        {open.length > 0 && (
          <ul className="grid gap-2" data-notes="">
            {open.map((n) => {
              const client = noteClient(n, house.clients)
              return (
                <li key={n.id} data-note={n.id}>
                  <button type="button"
                    onClick={() => onAsk(anyNote || (writes && n.by === me) ? { kind: 'note', id: n.id } : { kind: 'notes' })}
                    className="w-full rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-surface-2">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <TintChip label={priorityLabel(n.priority)} tint={PRIORITY_TINT[n.priority] ?? 'slate'} />
                      {client && <span className="text-[12px] font-semibold text-text-2">{client}</span>}
                      <span className="ml-auto text-[11.5px] text-text-3">{[n.by, ohioDayYear(n.at)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="clamp-2 mt-1 block text-[13px] leading-5 text-text-1">{n.details}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>}

      <SectionCard title={cut ? 'Your clients here' : 'Associated clients'} extra={addClients ? (
        <button type="button" onClick={() => onAsk({ kind: 'clients-add' })} data-clients-add-open=""
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12.5px] font-semibold text-primary hover:bg-primary-soft">
          <Plus size={13} /> Add clients
        </button>
      ) : undefined}>
        {clients.length === 0 && <p className="text-[13px] text-text-3">No active client in the Asa Client Database.</p>}
        <ul className="divide-y divide-border" data-clients="">
          {clients.map((c) => (
            <li key={c.client_id || c.name} className="flex items-center gap-3 py-2.5">
              <Avatar src={c.avatar} name={c.name} size="md" />
              <DragPerson name={c.name} id={c.client_id} type="client" avatar={c.avatar} className="min-w-0 flex-1">
                <Link to={clientProfileHref(c)} className={`${linkCls} text-[13.5px] font-semibold`}>
                  {c.name}
                </Link>
              </DragPerson>
              <Link to={clientProfileHref(c)} aria-label={`Open ${c.name}`}
                className="grid h-8 w-8 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
                <ArrowRight size={15} />
              </Link>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  )
}
