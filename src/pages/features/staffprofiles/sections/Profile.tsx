// Staff Profile: Staff Details (every phone and e-mail on its own line), the MAIS and Employment… The Driver card is the
// Driving tab's; the clients and the houses are Related Clients' and Related Locations'.
// All of it is staffProfileOverview's; the notes are staffProfileNotes'.
import { type ReactNode } from 'react'
import { Link } from 'react-router'
import { Plus } from 'lucide-react'
import DragPerson from '@/components/shared/DragPerson'
import { TintChip } from '@/pages/features/clientops/OpsPageShell'
import { Pair, SectionCard } from '@/pages/features/locations/LocationParts'
import { priorityLabel, telHref } from '@/pages/features/locations/locationModel'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { useShellHides } from '@/lib/myWorkHides'
import {
  DRIVER_TABS, IST_META, STATUS_META, categoryLabel, dateWords, dayPill, drivingSaysMore, houseRole,
  locationHref, maisPill, maisWordNote, mayEditSection, notesOf, overviewOf, pointsTint, pointsWords, staffCan, stampWords,
  standingMeta, workedSpan, type DayState, type LicenseStanding, type RosterRow, type StaffAsk, type StaffDriving, type StaffEdition,
  type StaffMedDel, type StaffNotes, type StaffOverview,
} from '../staffModel'
import { readKey, readNotes, readOverview, useStaffRead, type ReadState } from '../useStaffRead'
import { EditPencil, EmptyNote, Masked, Pill, ReadLine, WhyNote, linkCls } from '../StaffParts'
import { none } from '../staffValues'
import { useStaffViewer } from '../staffViewer'
import EmploymentSection from './Employment'

export default function ProfileSection({ row, onAsk }: { row: RosterRow; onAsk: (ask: StaffAsk) => void }) {
  const { basic } = useStaffViewer()
  const overview = useStaffRead(readKey('staffProfileOverview', row.key), () => readOverview(row.key), overviewOf)
  const notes = useStaffRead(basic ? null : readKey('staffProfileNotes', row.key), () => readNotes(row.key), notesOf)
  if (basic) return <BasicProfileView row={row} overview={overview} onRetry={overview.reload} />
  return <ProfileView row={row} overview={overview} notes={notes} onAsk={onAsk} onRetryOverview={overview.reload}
    onRetryNotes={notes.reload} />
}

/** The BASIC profile: first and last name, role and status, and the ISTs that train this person on the viewer's client. */
export function BasicProfileView({ row, overview, onRetry }: {
  row: RosterRow
  overview: ReadState<StaffOverview>
  onRetry: () => void
}) {
  const o = overview.data
  const p = o?.person ?? null
  const status = p?.status ?? row.status
  return (
    <div className="grid gap-5" data-profile="" data-basic-profile="">
      <ReadLine state={overview} what="the staff profile" onRetry={onRetry} />
      {o && <WhyNote why={o.why} degraded={o.degraded} />}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <SectionCard title="Staff Details">
          <dl data-staff-details="">
            <Pair label="First name">{p?.first_name || row.first_name || none}</Pair>
            <Pair label="Last name">{p?.last_name || row.last_name || none}</Pair>
            <Pair label="Role">{p?.role || row.role || none}</Pair>
            <Pair label="Status" last>{STATUS_META[status].label}</Pair>
          </dl>
        </SectionCard>
        <IstCard ist={o ? o.ist : null} sub="Whether this person is trained on your client's plan."
          empty="No IST record trains this person on your client." />
      </div>
    </div>
  )
}

// The IST rows: the client, the house, trained or due, and the pill.
export function IstCard({ ist, sub, empty, onAsk }: {
  ist: StaffOverview['ist'] | null
  sub: string
  empty: string
  onAsk?: (ask: StaffAsk) => void
}) {
  return (
    <SectionCard title="ISTs" sub={sub}>
      {ist && ist.length === 0 && <p className="text-[13px] text-text-3">{empty}</p>}
      <ul className="divide-y divide-border" data-ist="">
        {(ist ?? []).map((r) => (
          <li key={r.id || `${r.client_key}-${r.house}`} className="flex items-center gap-3 py-2.5" data-ist-row={r.id}>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-text-1">
                <DragPerson name={r.client_name} type="client">{r.client_name || r.client_key}</DragPerson>
              </p>
              <p className="text-[12px] text-text-3">
                {[r.house, r.status === 'done' ? (r.trained_at ? `Trained ${dateWords(r.trained_at)}` : 'Trained')
                  : r.due ? `Due ${dateWords(r.due)}` : ''].filter(Boolean).join(' · ')}
              </p>
            </div>
            {r.status ? <Pill meta={IST_META[r.status]} /> : <span className="text-text-3">—</span>}
            {onAsk && r.id && <EditPencil section="ist" id={r.id} label={r.client_name} onAsk={onAsk} />}
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

const PRIORITY_TINT: Record<string, 'slate' | 'warning' | 'danger'> = { normal: 'slate', high: 'warning', urgent: 'danger' }

export function ProfileView({ row, overview, notes, onAsk, onRetryOverview, onRetryNotes }: {
  row: RosterRow
  overview: ReadState<StaffOverview>
  notes: ReadState<StaffNotes>
  onAsk: (ask: StaffAsk) => void
  onRetryOverview: () => void
  onRetryNotes: () => void
}) {
  const viewer = useStaffViewer()
  const can = (e: StaffEdition) => staffCan(viewer, e)
  // the ISTs and Where they worked: the master's while Settings › My Work keeps them
  const istsWorkedHidden = useShellHides().staff_profile_ists_worked
  const o = overview.data
  const p = o?.person ?? null
  const status = p?.status ?? row.status
  return (
    <div className="grid gap-5" data-profile="">
      <ReadLine state={overview} what="the staff profile" onRetry={onRetryOverview} />
      {o && <WhyNote why={o.why} degraded={o.degraded} />}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <div className="grid gap-5">
          <SectionCard title="Staff Details" extra={mayEditSection(viewer, 'profile') ? <EditPencil section="profile" onAsk={onAsk} /> : undefined}>
            <dl data-staff-details="">
              <Pair label="First name">{p?.first_name || row.first_name || none}</Pair>
              <Pair label="Last name">{p?.last_name || row.last_name || none}</Pair>
              <Pair label="Employee ID">
                {(p?.employee_id || row.employee_id) || none}
                {p?.employee_id_source === 'roster' && <span className="ml-1.5 text-[11.5px] text-text-3">(the roster's id)</span>}
              </Pair>
              <Pair label="Role">{p?.role || row.role || none}</Pair>
              <Pair label="Start date">{p ? (dateWords(p.start_date) || p.start_date || none) : '—'}</Pair>
              <Pair label="Status">{STATUS_META[status].label}</Pair>
              <Pair label={p && p.phones.length > 1 ? 'Phones' : 'Phone'}>
                {!p ? '—' : p.phones.length === 0 ? none : (
                  <ul className="grid gap-1" data-phones="">
                    {p.phones.map((ph) => (
                      <li key={ph.value} data-phone={ph.value}>
                        <a href={telHref(ph.value)} className={linkCls}>{formatPhoneDisplay(ph.value)}</a>
                        {ph.label && <span className="ml-1.5 text-[11.5px] text-text-3">{ph.label}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </Pair>
              <Pair label={p && p.emails.length > 1 ? 'Emails' : 'Email'} last>
                {!p ? '—' : p.emails.length === 0 ? none : (
                  <ul className="grid gap-1" data-emails="">
                    {p.emails.map((em) => (
                      <li key={em.value} data-email={em.value}>
                        <a href={`mailto:${em.value}`} className="break-all hover:underline">{em.value}</a>
                        {em.label && <span className="ml-1.5 text-[11.5px] text-text-3">{em.label}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </Pair>
            </dl>
          </SectionCard>
        </div>

        <MedDelCard medDel={o ? o.medDel : undefined} onAsk={can('staff.mais') ? onAsk : undefined} />
      </div>

      <EmploymentSection row={row} onAsk={onAsk} />

      {!istsWorkedHidden && <div className="grid items-start gap-5 lg:grid-cols-2" data-ists-worked="">
        <IstCard ist={o ? o.ist : null} sub="Which clients this person is trained on, and where." empty="No IST record names this person."
          onAsk={can('staff.ist') ? onAsk : undefined} />

        <SectionCard title="Where they worked" sub="Houses from the Calendar Archive and the PSI punches.">
          {o && o.houses.length === 0 && <p className="text-[13px] text-text-3">No shift names this person in the last months.</p>}
          <ul className="divide-y divide-border" data-worked="">
            {(o?.houses ?? []).map((h) => (
              <li key={h.code} className="flex items-center gap-3 py-2.5" data-worked-house={h.code}>
                <div className="min-w-0 flex-1">
                  <Link to={locationHref(h.code)} className={`${linkCls} text-[13.5px] font-semibold`}>{h.home_name}</Link>
                  <p className="text-[12px] text-text-3">{workedSpan(h) || '—'}</p>
                </div>
                {houseRole(h) && <TintChip label={h.hm ? 'HM' : 'Lead'} tint={h.hm ? 'violet' : 'blue'} />}
                {h.current && <TintChip label="Current" tint="mint" />}
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>}

      <SectionCard title="Staff notes" extra={can('staff.notes') ? (
        <button type="button" onClick={() => onAsk({ kind: 'note' })} data-add-note=""
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12.5px] font-semibold text-primary hover:bg-primary-soft">
          <Plus size={13} /> Add Note
        </button>
      ) : undefined}>
        <NotesPreview notes={notes} onAsk={onAsk} onRetry={onRetryNotes} />
      </SectionCard>
    </div>
  )
}

const quiet = 'text-[13px] text-text-3'
/** A day in words; a cell's own words that are no whole date ("9/23") are shown as written, never parsed into a guess. */
const dayOr = (v: string): ReactNode => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? dateWords(v) : v) || none

const notRead = <span className="text-text-3" data-not-read="">Not read</span>

/** A standing's pill and the tab that said it. */
function StandingPill({ s }: { s: LicenseStanding }) {
  return (
    <>
      <Pill meta={standingMeta(s)} />
      {s.source && <span className="ml-1.5 text-[11.5px] text-text-3">{s.source}</span>}
    </>
  )
}

/** A licence or insurance day with the pill Staff Compliance gives the same day: Expired, Due Soon, nothing when current. */
function DueDay({ day, state }: { day: string; state: DayState }) {
  const pill = day ? dayPill(state) : null
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-day-state={pill ? state : undefined}>
      {dayOr(day)}
      {pill && <Pill meta={pill} />}
    </span>
  )
}

// The employee driver tab's facts.
export function DriverCard({ driving: d, onAsk }: { driving: StaffDriving | null | undefined; onAsk?: (ask: StaffAsk) => void }) {
  // a tab that was not read: what only it holds is unread, not absent
  const mainUnread = !!d && d.unread.includes(DRIVER_TABS.main)
  const standingUnread = !!d && (d.unread.includes(DRIVER_TABS.compliance) || d.standingAmbiguous)
  const mainOnly = (node: ReactNode): ReactNode => (mainUnread ? notRead : node)
  // a row that says only "No" is one quiet line, never a grid of "Not on file"
  const saysNo = !!d && d.found && d.driver === false && !mainUnread && !drivingSaysMore(d)
  return (
    <SectionCard title="Driver" sub={d?.found && d.source ? `From the Employee Database · ${d.source}` : undefined}
      extra={onAsk && d ? <EditPencil section="driving" onAsk={onAsk} /> : undefined}>
      <div className="grid gap-2" data-driver-card="">
        {d === null && <EmptyNote kind="missing">This profile answer does not carry the driving record yet.</EmptyNote>}
        {d?.why && <WhyNote why={d.why} degraded={d.degraded} said={d.ambiguous || d.standingAmbiguous} />}
        {d && !d.found && !d.ambiguous && !d.standingAmbiguous && !d.degraded && (
          <p className={quiet} data-driver-none="">Not a driver on file</p>
        )}
        {d && saysNo && <p className={quiet} data-driver-no="">{`Not a driver (the ${d.source} tab says ${d.driverWord || 'No'})`}</p>}
        {d?.found && !saysNo && (
          <dl data-driver="">
            <Pair label="Driver">
              {d.driver === true ? 'Yes' : d.driver === false ? 'No' : none}
              {d.driverStanding && (
                <span className="ml-2" data-driver-standing={d.driverStanding.state}><StandingPill s={d.driverStanding} /></span>
              )}
            </Pair>
            <Pair label="Points">
              {mainOnly(d.points !== null ? (
                <span data-points={pointsTint(d.points)}><Pill meta={{ label: pointsWords(d.points), tint: pointsTint(d.points) }} /></span>
              ) : d.pointsNote ? <span className="text-text-2" data-points-note="">{d.pointsNote}</span> : none)}
            </Pair>
            <Pair label="License standing">
              {d.standing ? <span data-standing={d.standing.state}><StandingPill s={d.standing} /></span>
                : standingUnread ? notRead : none}
            </Pair>
            <Pair label="License expires">{mainOnly(<DueDay day={d.licenseExpires} state={d.licenseState} />)}</Pair>
            <Pair label="DL #"><Masked value={d.dlLast4} /></Pair>
            <Pair label="Abstract (latest)">{dayOr(d.abstractLatest)}</Pair>
            <Pair label="Abstract (original)">{mainOnly(dayOr(d.abstractOriginal))}</Pair>
            <Pair label="Insurance expires" last><DueDay day={d.insuranceExpires} state={d.insuranceState} /></Pair>
          </dl>
        )}
      </div>
    </SectionCard>
  )
}

// One line per Cat level from the DODD MAIS scrape: the latest record, its pill, and how many older ones it has.
export function MedDelCard({ medDel: m, onAsk }: { medDel: StaffMedDel | null | undefined; onAsk?: (ask: StaffAsk) => void }) {
  return (
    <SectionCard title="Med Del (MAIS)" sub={m && m.certs.length > 0 ? 'The latest DODD MAIS record for each Cat level.' : undefined}>
      <div className="grid gap-2" data-mais-card="">
        {m === null && <EmptyNote kind="missing">This profile answer does not carry the MAIS record yet.</EmptyNote>}
        {m?.why && <WhyNote why={m.why} degraded={m.degraded} said={m.ambiguous} />}
        {m && m.certs.length === 0 && !m.ambiguous && !m.degraded && <p className={quiet} data-mais-none="">No MAIS record on file</p>}
        {m && m.certs.length > 0 && (
          <ul className="divide-y divide-border" data-mais="">
            {m.certs.map((c) => {
              const sub = [maisWordNote(c), c.older ? `${c.older} older record${c.older === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
              return (
                <li key={c.level} className="flex items-center gap-3 py-2.5" data-mais-level={c.level}>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-text-1">{c.level}</p>
                    <p className="text-[12px] tabular-nums text-text-2">{`${dateWords(c.effective) || '—'} → ${dateWords(c.expires) || '—'}`}</p>
                    {sub && <p className="text-[11.5px] text-text-3" data-mais-sub="">{sub}</p>}
                  </div>
                  <Pill meta={maisPill(c)} />
                  {onAsk && <EditPencil section="mais" id={c.level} label={c.level} onAsk={onAsk} />}
                </li>
              )
            })}
          </ul>
        )}
        {m?.matchedBy === 'search' && m.certs.length > 0 && (
          <p className="text-[11.5px] text-text-3" data-mais-search="">Found by the name the registry was searched with; the registry spells it differently.</p>
        )}
      </div>
    </SectionCard>
  )
}

export function NotesPreview({ notes, onAsk, onRetry }: { notes: ReadState<StaffNotes>; onAsk: (ask: StaffAsk) => void; onRetry: () => void }) {
  const writes = staffCan(useStaffViewer(), 'staff.notes')
  const open = (notes.data?.notes ?? []).filter((n) => n.state === 'open')
  const body = (n: StaffNotes['notes'][number]) => (
    <>
      <span className="flex flex-wrap items-center gap-1.5">
        <TintChip label={priorityLabel(n.priority)} tint={PRIORITY_TINT[n.priority] ?? 'slate'} />
        <span className="text-[12px] font-semibold text-text-2">{categoryLabel(n.category)}</span>
        <span className="ml-auto text-[11.5px] text-text-3">{[n.by, stampWords(n.at)].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="clamp-2 mt-1 block text-[13px] leading-5 text-text-1">{n.details}</span>
    </>
  )
  return (
    <div className="grid gap-2">
      <ReadLine state={notes} what="the staff notes" onRetry={onRetry} />
      {notes.data?.why && <WhyNote why={notes.data.why} />}
      {notes.data && open.length === 0 && <p className="text-[13px] text-text-3">No open staff notes.</p>}
      {open.length > 0 && (
        <ul className="grid gap-2" data-notes="">
          {open.map((n) => (
            <li key={n.id} data-note={n.id}>
              {writes ? (
                <button type="button" onClick={() => onAsk({ kind: 'note' })}
                  className="w-full rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-surface-2">
                  {body(n)}
                </button>
              ) : (
                <div className="w-full rounded-lg border border-border px-3 py-2.5" data-note-read="">{body(n)}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
