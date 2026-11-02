// FLOW · TABLE — extracted verbatim from FlowPage.tsx.
// The board, flat: phase, days and open conditions.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { CheckCircle2 } from 'lucide-react'
import Card from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { ohioDateTime } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import {
  type FlowRow, usePhases, stageItems, itemViewable, viewItemDoc,
  profileRoute, inputCls,
} from './shared'
import { MISSING_STYLE, STATUS_META } from '@/engine/templates/pipeline/utils'
import TableActionButtons from '@/features/hiring/TableActionButtons'

// ONE READING OF THE CONDITIONS — the second table of chips goes and one remains, wearing the onboarding table's…
function ConditionCells({ r }: { r: FlowRow }) {
  const items = stageItems(r)
  if (items.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px] text-text-2">
        <CheckCircle2 size={14} className="text-success" /> All clear
      </span>
    )
  }
  return (
    <span className="flex flex-col gap-1">
      {items.map((c) => {
        const m = STATUS_META[c.status] ?? STATUS_META.pending
        const Icon = m.icon
        const canView = itemViewable(r, c)
        const face = (
          <>
            <span
              className={cn('grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full', m.bg, m.fg)}
              style={c.status === 'missing' ? MISSING_STYLE : undefined}
            >
              <Icon size={10} strokeWidth={2.4} />
            </span>
            <span className="text-[11.5px] leading-4">{c.label}</span>
          </>
        )
        return canView ? (
          <button
            key={c.id}
            type="button"
            title={`${c.label} · ${m.tooltip} — click to open`}
            onClick={(e) => { e.stopPropagation(); void viewItemDoc(r, c.id, c.label) }}
            className="flex items-center gap-1.5 text-left text-text-1 hover:text-primary"
          >
            {face}
          </button>
        ) : (
          <span key={c.id} title={`${c.label} · ${m.tooltip}`} className="flex items-center gap-1.5 text-text-2">
            {face}
          </span>
        )
      })}
    </span>
  )
}

export function TableSection({ rows }: { rows: FlowRow[] }) {
  const navigate = useNavigate()
  const { stages: STAGES, label: STAGE_LABEL, tint: STAGE_TINT } = usePhases()
  const [phase, setPhase] = useState('all')
  const [sort, setSort] = useState<'name-asc' | 'name-desc' | 'days-desc' | 'days-asc'>('name-asc')
  const view = useMemo(() => {
    const out = phase === 'all' ? rows.slice() : rows.filter((r) => r.stage === phase)
    out.sort((a, b) => {
      if (sort === 'name-asc') return a.name.localeCompare(b.name)
      if (sort === 'name-desc') return b.name.localeCompare(a.name)
      const da = a.daysInStage ?? 0, db = b.daysInStage ?? 0
      return sort === 'days-desc' ? db - da : da - db
    })
    return out
  }, [rows, phase, sort])
  return (
    <Card className="overflow-x-auto p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2.5">
        <select value={phase} onChange={(e) => setPhase(e.target.value)} className={cn(inputCls, 'w-auto')}>
          <option value="all">All phases</option>
          {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={cn(inputCls, 'w-auto')}>
          <option value="name-asc">Name A–Z</option>
          <option value="name-desc">Name Z–A</option>
          <option value="days-desc">Most days</option>
          <option value="days-asc">Fewest days</option>
        </select>
        {/* THE SECOND TABLE OF CHIPS IS GONE, leaving a single one.
            Two ways of drawing
            the same fact, chosen by a switch, meant two people looking at the
            same row could describe it differently. What is left is the one
            the rest of the platform already speaks — the onboarding table's
            own icons. */}
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11.5px] uppercase tracking-wide text-text-3">
            <th className="px-3 py-2">Candidate</th>
            <th className="px-3 py-2">Phone</th>
            <th className="px-3 py-2">Phase</th>
            <th className="px-3 py-2">Days</th>
            {/* THE STAGE, IN THIS EXACT POSITION — after Days and before
                OPEN CONDITIONS, a column naming the stage this person is
                standing in: hired, Onboarding and the rest.
                It carries the ARRIVAL as well as the name, because the chip
                alone would repeat the Phase column two places to the left and
                a column that says nothing new is a column somebody has to
                read twice to be sure. `stageSince` comes off
                log_status_history and is blank — never guessed — for a card
                whose status was typed straight into the sheet. */}
            <th className="px-3 py-2">Stage</th>
            <th className="px-3 py-2">Open conditions</th>
            {/* THE BUTTONS: one upload per owed item — the amber ones
                included — and the Accept/Decline, in the house style.
                LAST COLUMN, and it stays last. */}
            <th className="px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {view.length === 0 && (
            <tr><td colSpan={7} className="px-3 py-6 text-center text-[12.5px] italic text-text-3">No active records</td></tr>
          )}
          {view.map((r) => {
            const tint = STAGE_TINT[r.stage] ?? 'blue'
            return (
              <tr key={r.id} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2">
                  <span
                    onClick={(e) => { e.stopPropagation(); navigate(profileRoute(r.id)) }}
                    title="Open the full profile"
                    className="flex cursor-pointer items-center gap-2"
                  >
                    {/* avatar and name travel together — one grip for the
                        whole person, and the row's flex gap moves inside it */}
                    <DragPerson name={r.name} id={r.id} type="staff" subtitle={STAGE_LABEL[r.stage]} className="flex min-w-0 items-center gap-2">
                      <Avatar src="" name={r.name} size="sm" />
                      <span className="text-text-1 hover:text-primary">{r.name}</span>
                    </DragPerson>
                  </span>
                </td>
                <td className="px-3 py-2 text-text-2">{r.phone ? formatPhoneDisplay(r.phone) : '—'}</td>
                <td className="px-3 py-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-bold', TINT_BG[tint], TINT_FG[tint])}>
                    {STAGE_LABEL[r.stage] ?? r.stage}
                  </span>
                </td>
                <td className="px-3 py-2 text-text-2">{r.daysInStage ?? '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="text-text-1">{STAGE_LABEL[r.stage] ?? r.stage}</span>
                  {/* OHIO, NOT UTC AND NOT THE DEVICE — day and hour are
                      displayed on OHIO's clock. The arrival is stored as an
                      ISO stamp
                      — 2026-08-06T16:11:08.486Z — and printing it raw asked a
                      person to do timezone arithmetic to read their own board.
                      `ohioDateTime` is the platform's one formatter for this
                      and it answers in America/New_York whatever the viewer's
                      laptop believes the time is. */}
                  <span className="ml-1.5 text-[11.5px] text-text-3">
                    {r.stageSince
                      ? `since ${ohioDateTime(r.stageSince) || r.stageSince}${r.daysAtStage != null ? ` · ${r.daysAtStage}d` : ''}`
                      : 'arrival not recorded'}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <ConditionCells r={r} />
                </td>
                <td className="w-[150px] min-w-[150px] px-3 py-2 align-top">
                  <TableActionButtons r={r} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}
