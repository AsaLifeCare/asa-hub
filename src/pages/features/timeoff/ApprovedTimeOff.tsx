// THE TIME OFF PANEL (the operator's layout) — the right panel a time off opens in, the same wherever it is opened
// (Time Off › Requests, Scheduling › Time Off Requests, My Work, My Calendar): who, the dates, the reason, the
// person's approved days that year, and the scheduled shifts it overlaps. An approver decides a waiting request on it
// (its answers in the footer), and once approved both sides see it. Edit is drawn only where the record's own rule
// names the reader an approver; the person on it, and anyone who only reads it, never sees it.
import type { ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import { daysLine, longDate, shiftCells, yearLabel, type ApprovedView } from './approvedModel'

const LABEL = 'text-[12.5px] text-text-3'
const VALUE = 'mt-0.5 break-words text-[14px] text-text-1'
const PILL_TINT: Record<string, string> = {
  mint: 'bg-tint-mint text-tint-fg-mint',
  amber: 'bg-tint-amber text-tint-fg-amber',
  slate: 'bg-tint-slate text-tint-fg-slate',
  danger: 'bg-tint-danger text-tint-fg-danger',
  pink: 'bg-tint-pink text-tint-fg-pink',
  lavender: 'bg-tint-lavender text-tint-fg-lavender',
}

/** The pill the header carries: where the request stands. */
export function StatePill({ label, tint }: { label: string; tint: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${PILL_TINT[tint] ?? PILL_TINT.slate}`} data-status={label}>
      {label}
    </span>
  )
}

/** The green pill of an approved request. */
export function ApprovedPill() {
  return <StatePill label="Approved" tint="mint" />
}

/** The amber pill of a request still waiting on its approvers. */
export function WaitingPill() {
  return <StatePill label="Waiting" tint="amber" />
}

/** The outlined pencil button; drawn only for an approver. */
export function EditButton({ onEdit }: { onEdit: () => void }) {
  return (
    <button type="button" onClick={onEdit} data-act="edit"
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[13px] font-semibold text-text-1 hover:bg-surface-2">
      <Pencil size={14} /> Edit
    </button>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={LABEL}>{label}</dt>
      <dd className={VALUE}>{children}</dd>
    </div>
  )
}

/** Everything under the person's name: the facts grid, the reason, the year's days, the impacted shifts. */
export function ApprovedBody({ view }: { view: ApprovedView }) {
  const f = view.facts
  const reason = view.reason === undefined ? (view.reading ? 'Reading…' : '—')
    : view.reason === null ? 'Only the approvers and the person who asked read it.' : view.reason || 'No reason was given.'
  return (
    <div className="mt-4 grid gap-4" data-approved-time-off="">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
        <Fact label="Start date">{longDate(view.start)}</Fact>
        <Fact label="End date">{longDate(view.end || view.start)}</Fact>
        <Fact label="Requested">{longDate(view.requested)}</Fact>
        <Fact label="Number of days">{view.days}</Fact>
      </dl>
      <dl>
        <Fact label="Reason">
          <span className="whitespace-pre-line leading-[1.55]">{reason}</span>
        </Fact>
      </dl>
      <dl>
        <Fact label={yearLabel(f, view.start)}>
          {f && f.year_days != null
            ? <span data-year-days="">{daysLine(f.year_days)}</span>
            : view.reading ? <span className="text-text-3">Reading…</span>
              : <span className="text-[12.5px] text-danger">— {f?.year_why || view.factsWhy || 'could not be read'}</span>}
        </Fact>
      </dl>
      <section className="border-t border-border pt-4" data-impacted-shifts="">
        <h3 className="text-[15px] font-semibold text-text-1">Impacted shifts</h3>
        <p className="mt-0.5 text-[12.5px] text-text-3">Scheduled shifts overlapping this request.</p>
        <ImpactedTable view={view} />
      </section>
    </div>
  )
}

function ImpactedTable({ view }: { view: ApprovedView }) {
  const shifts = view.facts?.shifts
  if (!shifts && view.reading) {
    return <p className="mt-3 text-[12.5px] text-text-3">Reading the calendars…</p>
  }
  if (!shifts) {
    return (
      <p className="mt-3 text-[12.5px] text-danger">
        The shifts could not be read — {view.facts?.shifts_why || view.factsWhy || 'no reason was given'}.
      </p>
    )
  }
  if (!shifts.length) {
    return <p className="mt-3 text-[12.5px] text-text-3">No scheduled shift of theirs overlaps these days.</p>
  }
  return (
    <table className="mt-3 w-full table-fixed text-left text-[13px]">
      <thead>
        <tr className="border-b border-border text-[12px] text-text-3">
          <th className="w-[30%] py-2 font-normal">Date</th>
          <th className="w-[28%] py-2 font-normal">Location</th>
          <th className="w-[21%] py-2 font-normal">Start</th>
          <th className="w-[21%] py-2 font-normal">End</th>
        </tr>
      </thead>
      <tbody>
        {shifts.map((s) => {
          const c = shiftCells(s)
          return (
            <tr key={`${s.house_code}|${s.date}|${s.start_min}`} className="border-b border-border align-top last:border-b-0"
              data-shift={s.date}>
              <td className="py-2.5 pr-2 font-semibold text-text-1">{c.date}</td>
              <td className="break-words py-2.5 pr-2 text-text-2">{s.location || s.house_code}</td>
              <td className="py-2.5 pr-2 text-text-1">{c.start}</td>
              <td className="py-2.5 text-text-1">
                {c.end}
                {c.endDate && <span className="block text-[11.5px] text-text-3" data-end-date="">{c.endDate}</span>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** The whole panel: the header's pill, the person under "Employee", Edit beside them for an approver; a waiting
 * request carries its own pill and its approvers' answers in the footer. */
export default function ApprovedTimeOffPanel({ open, view, mayEdit, onEdit, onClose, footer, badge }: {
  open: boolean
  view: ApprovedView
  mayEdit: boolean
  onEdit: () => void
  onClose: () => void
  footer?: ReactNode
  /** the header's pill; Approved unless given */
  badge?: ReactNode
}) {
  return (
    <SidePanel open={open} onClose={onClose} label="Time off request" badge={badge ?? <ApprovedPill />}
      overline="Employee" title={view.person} titleAside={mayEdit ? <EditButton onEdit={onEdit} /> : undefined}
      footer={footer}>
      <ApprovedBody view={view} />
    </SidePanel>
  )
}
