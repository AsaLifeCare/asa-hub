// Staff: everyone on record for the house, the first and the latest shift, and each photo as the Staff app finds it.
// A row opens the person in the panel; a name opens their own profile.
import { useMemo } from 'react'
import { Link } from 'react-router'
import { FileText, Loader2, Plus } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { clientProfileHref, type HouseRow } from '@/pages/features/houses/houseModel'
import { staffHref } from '@/pages/features/staffprofiles/staffModel'
import type { PlatformDocMeta } from '@/lib/platformDoc'
import { cn } from '@/lib/utils'
import {
  IST_NONE, dayWords, istCellFor, nameKey, staffOf, staffRole, type LocationStaff, type PanelAsk, type StaffMember,
} from '../locationModel'
import {
  readKey, readStaff, useCan, useLocationDoc, useLocationRead, type LocationDocOpener, type ReadState,
} from '../useLocation'
import { ReadLine, SectionCard, linkCls } from '../LocationParts'
import { rosterOf } from '@/pages/features/staffprofiles/staffModel'
import { readKey as staffReadKey, readRoster, useStaffRead } from '@/pages/features/staffprofiles/useStaffRead'

export const IST_PAPER_HINT = 'PDF, PNG or JPG · up to 15 MB.'

/** The viewer's heading for an IST paper. */
export const istDocMeta = (staff: string, client: string, at: string): PlatformDocMeta =>
  ({ title: `IST · ${staff} · ${client}`, subtitle: at ? `Trained ${dayWords(at)}` : 'IST paper', icon: 'file-text' })

export default function Staff({ house, onAsk }: { house: HouseRow; onAsk: (ask: PanelAsk) => void }) {
  const staff = useLocationRead(readKey('locationStaff', house.code), () => readStaff(house.code), staffOf)
  const doc = useLocationDoc(house.code)
  // each person's photo as the Staff app finds it (its own roster read); a viewer it is not open to sees the name alone
  const roster = useStaffRead(staffReadKey('staffProfileRoster', '*', false), () => readRoster(false), rosterOf)
  const avatars = useMemo(() => new Map((roster.data?.staff ?? []).filter((r) => r.avatar).map((r) => [nameKey(r.name), r.avatar])),
    [roster.data])
  return <StaffView house={house} staff={staff} onAsk={onAsk} doc={doc} onRetry={staff.reload} avatars={avatars} />
}

const TH = 'whitespace-nowrap px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'

export function StaffView({ house, staff, onAsk, doc, onRetry, avatars }: {
  house: HouseRow
  staff: ReadState<LocationStaff>
  onAsk: (ask: PanelAsk) => void
  doc: LocationDocOpener
  onRetry: () => void
  /** each person's photo by their folded name; nothing drawn where none */
  avatars?: Map<string, string>
}) {
  const writes = useCan('locations.house')
  const putBack = useCan('locations.staffRemove')
  const rows = staff.data?.rows ?? []
  const removed = staff.data?.removed ?? []
  // the answer's own list of the house's current clients, else the houses slice's
  const clients: { name: string }[] = staff.data?.clients.length ? staff.data.clients : house.clients
  return (
    <SectionCard title="Staff" extra={writes ? (
      <button type="button" onClick={() => onAsk({ kind: 'ist', staff: '', client: '' })} data-ist-record=""
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover">
        <Plus size={14} /> Record IST
      </button>
    ) : undefined}>
      <ReadLine state={staff} what="the house's staff" onRetry={onRetry} stamp={false} />
      {staff.data?.why && <p className="mb-3 text-[12.5px] text-[var(--warning)]">{staff.data.why}</p>}
      {staff.data && rows.length === 0 && <p className="text-[13px] text-text-3">Nobody on record for this house.</p>}
      {rows.length > 0 && (
        <div className="scroll-thin overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] border-collapse text-[13px]" data-staff-table="">
            <thead className="bg-surface-2/60">
              <tr>
                <th className={TH}>Staff</th>
                <th className={TH}>First shift</th>
                <th className={TH}>Latest shift</th>
                <th className={TH}>Shifts</th>
                {clients.map((c, i) => (
                  <th key={c.name} className={TH} data-ist-col={c.name}>
                    Client {i + 1} (IST)
                    <Link to={clientProfileHref(c)}
                      className="mt-0.5 block normal-case tracking-normal text-[11.5px] font-medium text-primary hover:underline">{c.name}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((m) => (
                <StaffLine key={m.name} m={m} clients={clients.map((c) => c.name)} onAsk={onAsk} doc={doc}
                  avatar={avatars?.get(nameKey(m.name)) ?? ''} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {writes && rows.length > 0 && clients.length > 0 && <p className="mt-3 text-[12px] text-text-3">IST papers: {IST_PAPER_HINT}</p>}
      {removed.length > 0 && (
        <div className="mt-4 grid gap-1.5 border-t border-border pt-3" data-staff-removed="">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">Taken off this house</h3>
          {removed.map((r) => (
            <div key={r.name} className="flex flex-wrap items-center gap-2 text-[12.5px] text-text-2" data-staff-off={r.name}>
              <span className="min-w-0 flex-1">
                <Link to={staffHref(r.name)} className={cn(linkCls, 'font-semibold')}>{r.name}</Link>
                {(r.by || r.at) && <span className="text-text-3"> · {[r.by, dayWords(r.at)].filter(Boolean).join(' · ')}</span>}
              </span>
              {putBack && (
                <button type="button" onClick={() => onAsk({ kind: 'staff-back', name: r.name })} data-staff-back-open={r.name}
                  className="rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary-soft">Put back</button>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

function StaffLine({ m, clients, onAsk, doc, avatar }: {
  m: StaffMember
  clients: string[]
  onAsk: (ask: PanelAsk) => void
  doc: LocationDocOpener
  avatar: string
}) {
  const role = staffRole(m)
  return (
    <tr className="cursor-pointer transition-colors hover:bg-surface-2/60" data-staff={m.name}
      onClick={() => onAsk({ kind: 'staff', name: m.name })}>
      <td className="px-3 py-3">
        <span className="flex items-center gap-2.5">
          {/* a photo when the person has one; no initials badge in its place */}
          {avatar && <Avatar src={avatar} name={m.name} size="sm" />}
          <span className="min-w-0">
            {/* the whole name, never cut: the table scrolls sideways instead */}
            <DragPerson name={m.name} type="staff" avatar={avatar || undefined}>
              <Link to={staffHref(m.name)} className={cn(linkCls, 'whitespace-nowrap font-semibold')}
                onClick={(e) => e.stopPropagation()}>{m.name}</Link>
            </DragPerson>
            {role && <span className="block text-[11.5px] text-text-3">{role}</span>}
          </span>
        </span>
      </td>
      <DateCell day={m.first.day} />
      <DateCell day={m.last.day} />
      <td className="px-3 py-3 text-text-2">{m.shifts ?? '—'}</td>
      {clients.map((client) => (
        <td key={client} className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
          <IstButton m={m} client={client} onAsk={onAsk} doc={doc} />
        </td>
      ))}
    </tr>
  )
}

function DateCell({ day }: { day: string }) {
  return <td className="whitespace-nowrap px-3 py-3 text-text-2">{dayWords(day) || '—'}</td>
}

export const CELL_BTN = 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-primary transition-colors hover:bg-surface-2 disabled:cursor-wait disabled:opacity-70'

export function IstButton({ m, client, onAsk, doc }: {
  m: StaffMember
  client: string
  onAsk: (ask: PanelAsk) => void
  doc: LocationDocOpener
}) {
  const writes = useCan('locations.house')
  const cell = istCellFor(m, client)
  if (cell.kind === 'none') return <span className="text-text-3" title={IST_NONE} data-ist="none">—</span>
  if (cell.kind === 'paper') {
    const busy = doc.opening === cell.fileId
    return (
      <span className="flex items-center gap-1.5">
        <button type="button" className={CELL_BTN} data-ist="paper" disabled={busy} aria-busy={busy || undefined}
          onClick={() => doc.open(cell.fileId, istDocMeta(m.name, client, cell.at))}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} IST document
        </button>
        {writes && (
          <button type="button" className={cn(CELL_BTN, 'px-2')} data-ist="newer" title="Update the training"
            aria-label={`Update the IST training of ${m.name} with ${client}`} onClick={() => onAsk({ kind: 'ist', staff: m.name, client })}>
            Update
          </button>
        )}
      </span>
    )
  }
  return (
    <span className="flex flex-col items-start gap-1">
      {cell.kind === 'trained' && (
        // the green day says trained; the word stands alone only where no day is on file
        <span className="whitespace-nowrap text-[12px] font-semibold text-[var(--success)]" data-ist="trained"
          title={cell.at ? `Trained ${dayWords(cell.at)}` : undefined}>
          {cell.at ? dayWords(cell.at) : 'Trained'}
        </span>
      )}
      {writes ? (
        <button type="button" className={cn(CELL_BTN, cell.kind === 'trained' && 'px-2 py-1 text-[11.5px]')} data-ist="upload"
          onClick={() => onAsk({ kind: 'ist', staff: m.name, client })}>
          Update
        </button>
      ) : cell.kind === 'upload' && <span className="text-[12px] text-text-3" data-ist="owed">No paper on file</span>}
    </span>
  )
}
