// Care & Support, from the client's ISP: Care plans, Care team, Daily care (every routine the plan writes, and the…
// Care plans and Home & equipment are the one table; Daily care, Health & behavior and Personal goals read one chapter
// at a time in the page, chosen in the Chapter select; Care team is the people the plan names.
import { useState } from 'react'
import { Link } from 'react-router'
import { ChevronDown } from 'lucide-react'
import DragPerson from '@/components/shared/DragPerson'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { useShellHides } from '@/lib/myWorkHides'
import { staffHref } from '@/pages/features/staffprofiles/staffModel'
import { ssaHref } from '@/pages/features/ssaprofiles/ssaModel'
import {
  CARE_EDIT_VIEWS, SECTION_VIEWS, careOf, dayLabel, isNotApplicable, mailHref, personHref, recordText, routineLabel, shownValue,
  telHref, type CareAnswer, type CareView, type ClientAsk, type PersonRow, type RecordRow, type RosterRow,
} from '../clientModel'
import { readCare, readKey, useClientDocs, useClientRead, type ReadState } from '../useClientRead'
import { DocButton, EmptyNote, PencilButton, ReadLine, RecordTable, StatusPill, SubTabs, linkCls } from '../ClientParts'
import { clientCan, useClientReader } from '../clientViewer'
import { recordColumns, subjectOnly } from './recordColumns'

const EMPTY: Record<CareView, string> = {
  plans: 'No care plan is on file for this client.',
  team: 'The plan names nobody on the care team.',
  daily: "No routine is written in this client's ISP.",
  health: 'The plan holds no health or behavior record.',
  goals: 'The plan holds no personal goal.',
  home: 'The plan holds no home or equipment need.',
}

export default function CareSection({ client, view, onView, onAsk }: {
  client: RosterRow
  view: CareView
  onView: (view: string) => void
  onAsk: (ask: ClientAsk) => void
}) {
  // Home & equipment is the master's alone while Settings › My Work hides it: its address opens the section's first
  const hides = useShellHides()
  const shown: CareView = view === 'home' && hides.client_care_home ? SECTION_VIEWS.care[0].id : view
  const care = useClientRead(readKey('clientProfileCare', client.client_key, shown), () => readCare(client.client_key, shown), careOf)
  return <CareBody clientKey={client.client_key} view={shown} care={care} onView={onView} onAsk={onAsk} onRetry={care.reload} />
}

export function CareBody({ clientKey = '', view, care, onView, onAsk, onRetry }: {
  /** the client the ISP is opened for (View ISP) */
  clientKey?: string
  view: CareView
  care: ReadState<CareAnswer>
  onView: (view: string) => void
  onAsk: (ask: ClientAsk) => void
  onRetry: () => void
}) {
  const a = care.data
  // the master's, or a holder's of the care edition (Settings › Editions)
  const adds = clientCan(useClientReader(), 'clients.care') && !!a && (CARE_EDIT_VIEWS as readonly string[]).includes(view)
  const hides = useShellHides()
  const tabs = hides.client_care_home ? SECTION_VIEWS.care.filter((t) => t.id !== 'home') : SECTION_VIEWS.care
  return (
    <div className="grid gap-4" data-care={view}>
      <div className="flex items-center justify-between gap-3">
        <SubTabs tabs={tabs} value={view} onChange={onView} label="Care & Support" />
        {adds && <PencilButton label="Add a care record" onClick={() => onAsk({ kind: 'care-add', view })} />}
      </div>
      <ReadLine state={care} what="the care record" onRetry={onRetry} />
      {a && view === 'team' && <PeopleTable people={a.people} empty={a.why || EMPTY.team} />}
      {a && view !== 'team' && (
        <>
          {subjectOnly('care', view) ? (
            a.rows.length ? <ChapterView key={view} clientKey={clientKey} view={view} rows={a.rows} onAsk={onAsk} />
              : <EmptyNote>{a.why || EMPTY[view]}</EmptyNote>
          ) : (
            <RecordTable rows={a.rows} statuses={a.statuses} columns={recordColumns('care', view, onAsk)} text={recordText}
              empty={a.why || EMPTY[view]} statusFilter />
          )}
          {a.why && a.rows.length > 0 && !subjectOnly('care', view) && (
            <p className="text-[12.5px] leading-5 text-text-3" data-why="">{a.why}</p>
          )}
          {a.absent.length > 0 && (
            <p className="text-[12.5px] leading-5 text-text-3" data-absent="">
              Not in this ISP: {a.absent.map(routineLabel).join(', ')}.
            </p>
          )}
        </>
      )}
    </div>
  )
}

const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.14em] text-text-3'

/** The plan's text one line per bullet: its own line breaks and bullet marks, never a sentence cut in two. */
export function planLines(text: string): string[] {
  return text.split(/\n+/).flatMap((l) => l.split(/\s+[•·]\s+/))
    .map((l) => shownValue(l.replace(/^\s*[•·\-*]\s*/, '').trim())).filter(Boolean)
}

// One chapter of the plan read in the page: the Chapter select, then its date, details and the plan's own lines.
function ChapterView({ clientKey, view, rows, onAsk }: {
  clientKey: string
  view: CareView
  rows: RecordRow[]
  onAsk: (ask: ClientAsk) => void
}) {
  const [chosen, setChosen] = useState(rows[0].id)
  const r = rows.find((x) => x.id === chosen) ?? rows[0]
  const docs = useClientDocs()
  const edits = clientCan(useClientReader(), 'clients.care') && !!r.edit
  const lines = r.text ? planLines(r.text) : []
  return (
    <div className="grid gap-4" data-chapters={view}>
      <label className="grid gap-1.5">
        <span className="text-[12px] text-text-3">Chapter</span>
        <span className="relative">
          <select value={r.id} onChange={(e) => setChosen(e.target.value)} data-chapter-select=""
            className="h-12 w-full appearance-none rounded-[14px] border border-border bg-surface px-4 pr-10 text-[14px] text-text-1 outline-none focus:border-primary">
            {rows.map((x) => <option key={x.id} value={x.id}>{x.record || '—'}</option>)}
          </select>
          <ChevronDown size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-text-3" />
        </span>
      </label>
      <article className="rounded-[16px] border border-border bg-surface shadow-1" data-chapter={r.id}>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-[20px] font-semibold text-text-1">{r.record || '—'}</h3>
            <StatusPill status={r.status} />
          </div>
          <div className="flex items-center gap-3 text-[13px]">
            <span className="text-text-3">Date</span>
            <span className="text-text-2">{dayLabel(r.date) || r.date || '—'}</span>
            {edits && <PencilButton label={`Edit ${r.record || 'the record'}`}
              onClick={() => onAsk({ kind: 'record', section: 'care', view, id: r.id, edit: true })} />}
          </div>
        </header>
        <div className="grid gap-6 px-6 py-5">
          {r.details && (
            <section className="grid gap-2">
              <h4 className={LABEL}>Details</h4>
              <p className="whitespace-pre-wrap text-[14px] leading-6 text-text-1">{shownValue(r.details)}</p>
            </section>
          )}
          {lines.length > 0 && (
            <section className="grid gap-2">
              <h4 className={LABEL}>As the plan writes it</h4>
              <ul className="grid list-disc gap-2.5 pl-5 text-[14px] leading-6 text-text-1 marker:text-text-3">
                {lines.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </section>
          )}
          {r.file_id && (
            <div className="flex justify-end">
              <DocButton busy={docs.opening === `${clientKey}|${r.file_id}`} onOpen={() => docs.open(clientKey, r.file_id, r.source || r.record || 'ISP')}>
                View ISP
              </DocButton>
            </div>
          )}
        </div>
      </article>
    </div>
  )
}

const TH = 'whitespace-nowrap px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'

/** The client record's SSA opens the SSA's profile and its house manager the Staff profile; anyone else, the people directory. */
export function careTeamHref(p: Pick<PersonRow, 'name' | 'relationship' | 'person_id' | 'source'>): string {
  const role = p.relationship.trim().toLowerCase()
  if (p.source === 'Client record' && role === 'ssa') return ssaHref(p.name)
  if (p.source === 'Client record' && role === 'house manager') return staffHref(p.name)
  return p.person_id ? personHref(p.person_id) : ''
}

const cell = (v: string): string => (v ? shownValue(v) : '—')

export function PeopleTable({ people, empty }: { people: CareAnswer['people']; empty: string }) {
  if (!people.length) return <EmptyNote>{empty}</EmptyNote>
  return (
    <div className="scroll-thin overflow-x-auto rounded-[16px] border border-border bg-surface shadow-1">
      <table className="w-full min-w-[640px] border-collapse text-[13px]" data-people="">
        <thead className="border-b border-border bg-surface-2/50">
          <tr><th className={TH}>Name</th><th className={TH}>Relationship</th><th className={TH}>Phone</th><th className={TH}>Email</th></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {people.map((p) => {
            const to = careTeamHref(p)
            return (
              <tr key={`${p.name}|${p.relationship}`} data-person={p.name}>
                <td className="px-4 py-3">
                  <DragPerson name={p.name} id={p.person_id || undefined} type="staff" subtitle={p.relationship}>
                    {to ? <Link to={to} className={`${linkCls} font-semibold`}>{p.name}</Link>
                      : <span className="font-semibold text-text-1">{p.name}</span>}
                  </DragPerson>
                </td>
                <td className="px-4 py-3 text-text-2">{cell(p.relationship)}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  {p.phone && !isNotApplicable(p.phone) ? <a href={telHref(p.phone)} className={linkCls}>{formatPhoneDisplay(p.phone)}</a> : cell(p.phone)}
                </td>
                <td className="px-4 py-3">
                  {p.email && !isNotApplicable(p.email) ? <a href={mailHref(p.email)} className={linkCls}>{p.email}</a> : cell(p.email)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
