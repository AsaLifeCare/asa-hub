// Expenses · Reports — full table (submitter, title, category, amount, date, status) with search + status/category…
// Row click opens a slide-over with the line-item breakdown, totals and gated approve/reject footer.
import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CircleCheck, CircleX, Plus, ReceiptText, Trash2, X } from 'lucide-react'
import { api } from '@/lib/api'
import { ohioDayYear } from '@/lib/ohio'
import type { ExpenseCategory, ExpenseLineItem, ExpenseReport } from '@/lib/seed-ops'
import { personById } from '@/lib/people-lookup'
import { useCan } from '@/auth/permissions'
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import Skeleton from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import SearchInput from '@/components/shared/SearchInput'
import FilterChips, { type ActiveFilter } from '@/components/shared/FilterChips'
import { Badge } from '@/components/shared/Badge'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_TINT, EXPENSE_STATUS_TINT, fmtMoney } from '@/features/ops/utils'
import { cn } from '@/lib/utils'

const FILTER_DEFS = [
  { key: 'status', label: 'Status', options: ['pending', 'approved', 'rejected'] },
  { key: 'category', label: 'Category', options: [...EXPENSE_CATEGORIES] },
]

/* ---------- slide-over detail panel ---------- */

function ReportSlideOver({
  report,
  canEdit,
  onClose,
  onDecide,
}: {
  report: ExpenseReport
  canEdit: boolean
  onClose: () => void
  onDecide: (r: ExpenseReport, status: 'approved' | 'rejected') => void
}) {
  const submitter = personById(report.submitterId)
  const approver = report.approverId ? personById(report.approverId) : undefined
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
      />
      <motion.aside
        initial={{ x: 400, opacity: 0.6 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 400, opacity: 0.6 }}
        transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
        className="fixed bottom-0 right-0 top-0 z-50 flex w-full flex-col border-l border-border bg-surface shadow-3 sm:w-[384px]"
      >
        <div className="flex items-start gap-3 border-b border-border p-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge label={report.status} tint={EXPENSE_STATUS_TINT[report.status]} />
              <Badge label={report.category} tint={EXPENSE_CATEGORY_TINT[report.category]} />
            </div>
            <h2 className="clamp-2 mt-2 font-display text-[17px] font-bold leading-6 text-text-1">{report.title}</h2>
            <div className="mt-2 flex items-center gap-2 text-[12px] text-text-3">
              <DragPerson
                name={submitter?.name ?? ''}
                id={report.submitterId}
                avatar={submitter?.avatar}
                subtitle={submitter?.role}
                className="flex items-center gap-2"
              >
                <Avatar src={submitter?.avatar} name={submitter?.name ?? report.submitterId} size="xs" />
                <span>{submitter?.name ?? report.submitterId}</span>
              </DragPerson>
              <span aria-hidden>·</span>
              {/* `date` is the full stamp the report was filed at — on Ohio's
                  clock, so a Friday-evening filing does not read as Saturday
                  — the whole platform stands in Ohio's timezone. */}
              <span>{ohioDayYear(report.date)}</span>
            </div>
          </div>
          <button
            aria-label="Close panel"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
          >
            <X size={16} />
          </button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto p-5">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
            Line items · {report.lineItems.length}
          </h3>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="w-10 px-3 py-2 text-right" aria-label="Receipt" />
                </tr>
              </thead>
              <tbody>
                {report.lineItems.map((li, i) => (
                  <tr key={i} className="border-t border-border text-[13px]">
                    <td className="px-3 py-2.5 text-text-1">{li.description}</td>
                    <td className="px-3 py-2.5 text-text-2">{li.category}</td>
                    <td className="px-3 py-2.5 text-right font-stat text-text-1">{fmtMoney(li.amount)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {li.receipt ? (
                        <ReceiptText size={14} className="ml-auto text-tint-fg-mint" aria-label="Receipt attached" />
                      ) : (
                        <span className="text-[11px] text-text-3">none</span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-border bg-surface-2 text-[13px] font-semibold">
                  <td className="px-3 py-2.5 text-text-1" colSpan={2}>
                    Total
                  </td>
                  <td className="px-3 py-2.5 text-right font-stat text-text-1">{fmtMoney(report.amount)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>

          {report.notes && (
            <div className="mt-4">
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Notes</h3>
              <p className="rounded-md bg-surface-2 p-3 text-[13px] leading-5 text-text-2">{report.notes}</p>
            </div>
          )}
          {approver && (
            <div className="mt-4 flex items-center gap-2 text-[12px] text-text-3">
              <DragPerson
                name={approver.name}
                id={approver.id}
                avatar={approver.avatar}
                subtitle={approver.role}
                className="flex items-center gap-2"
              >
                <Avatar src={approver.avatar} name={approver.name} size="xs" />
                Decided by {approver.name}
              </DragPerson>
            </div>
          )}
        </div>

        {report.status === 'pending' && (
          <div className="flex gap-2 border-t border-border p-4">
            <button
              disabled={!canEdit}
              title={canEdit ? 'Reject report' : 'Requires expenses.edit — ask an admin'}
              onClick={() => onDecide(report, 'rejected')}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface text-[13px] font-semibold text-danger transition-all duration-150 hover:bg-tint-pink active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CircleX size={15} /> Reject
            </button>
            <button
              disabled={!canEdit}
              title={canEdit ? 'Approve report' : 'Requires expenses.edit — ask an admin'}
              onClick={() => onDecide(report, 'approved')}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CircleCheck size={15} /> Approve
            </button>
          </div>
        )}
      </motion.aside>
    </>
  )
}

/* ---------- new-report modal ---------- */

type DraftLine = ExpenseLineItem
const emptyLine = (): DraftLine => ({ description: '', category: EXPENSE_CATEGORIES[0], amount: 0, receipt: true })

function NewReportModal({ onClose, onCreate }: { onClose: () => void; onCreate: (r: ExpenseReport) => void }) {
  const user = useAuthStore((s) => s.user)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<ExpenseCategory>('Mileage')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  const total = Math.round(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100) / 100
  const valid = title.trim().length > 0 && lines.length > 0 && total > 0 && lines.every((l) => l.description.trim())

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  const submit = async () => {
    if (!valid || saving) return
    setSaving(true)
    const payload = {
      title: title.trim(),
      submitterId: user?.id ?? 'p-01',
      category,
      amount: total,
      date: new Date().toISOString(),
      status: 'pending' as const,
      lineItems: lines.map((l) => ({ ...l, amount: Number(l.amount) || 0, description: l.description.trim() })),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    }
    try {
      const created = await api.create<ExpenseReport>('expenseReports', payload)
      onCreate(created)
      toast({ type: 'success', title: 'Report submitted', body: `${created.title} · ${fmtMoney(created.amount)} · awaiting approval.` })
      onClose()
    } catch {
      toast({ type: 'danger', title: 'Could not submit report', body: 'Please try again.' })
      setSaving(false)
    }
  }

  const inputCls =
    'h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'
  const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3'

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
      />
      <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="New expense report"
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
          className="pointer-events-auto flex max-h-[90dvh] w-[min(640px,100%)] flex-col rounded-lg border border-border bg-surface shadow-3"
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="font-display text-[17px] font-bold text-text-1">New expense report</h2>
            <button aria-label="Close" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1">
              <X size={16} />
            </button>
          </div>

          <div className="scroll-thin flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div>
              <label className={labelCls} htmlFor="nr-title">Title</label>
              <input id="nr-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mileage — Meadowlane route, week 43" className={inputCls} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="nr-category">Category</label>
                <select id="nr-category" value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} className={inputCls}>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Submitted by</label>
                <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text-2">
                  {/* a read-only chip, not an input — the submitter is a person
                      and drags like every other */}
                  <DragPerson name={user?.name ?? ''} id={user?.id} avatar={user?.avatar} className="flex min-w-0 items-center gap-2">
                    <Avatar src={user?.avatar} name={user?.name ?? '?'} size="xs" />
                    {user?.name ?? 'You'}
                  </DragPerson>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className={labelCls.replace('mb-1 ', '')}>Line items</span>
                <button
                  onClick={() => setLines((ls) => [...ls, emptyLine()])}
                  className="flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
                >
                  <Plus size={13} /> Add row
                </button>
              </div>
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 sm:flex-nowrap">
                    <input
                      value={l.description}
                      onChange={(e) => setLine(i, { description: e.target.value })}
                      placeholder="Description"
                      aria-label={`Line ${i + 1} description`}
                      className={cn(inputCls, 'h-8 min-w-[140px] flex-1 border-transparent bg-surface-2')}
                    />
                    <select
                      value={l.category}
                      onChange={(e) => setLine(i, { category: e.target.value })}
                      aria-label={`Line ${i + 1} category`}
                      className={cn(inputCls, 'h-8 w-[130px] border-transparent bg-surface-2')}
                    >
                      {EXPENSE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={l.amount || ''}
                      onChange={(e) => setLine(i, { amount: Number(e.target.value) })}
                      placeholder="0.00"
                      aria-label={`Line ${i + 1} amount`}
                      className={cn(inputCls, 'h-8 w-[96px] border-transparent bg-surface-2 text-right font-stat')}
                    />
                    <label className="flex items-center gap-1.5 text-[12px] text-text-2">
                      <input type="checkbox" checked={l.receipt} onChange={(e) => setLine(i, { receipt: e.target.checked })} className="h-4 w-4 accent-primary" />
                      Receipt
                    </label>
                    <button
                      aria-label={`Remove line ${i + 1}`}
                      disabled={lines.length === 1}
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                      className="grid h-8 w-8 place-items-center rounded-sm text-text-3 transition-colors hover:bg-tint-pink hover:text-danger disabled:opacity-30"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-end text-[13px]">
                <span className="text-text-3">Total&nbsp;</span>
                <span className="font-stat font-bold text-text-1">{fmtMoney(total)}</span>
              </div>
            </div>

            <div>
              <label className={labelCls} htmlFor="nr-notes">Notes (optional)</label>
              <textarea id="nr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={cn(inputCls, 'h-auto py-2')} placeholder="Context for the approver…" />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
            <button onClick={onClose} className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
              Cancel
            </button>
            <button
              disabled={!valid || saving}
              onClick={submit}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ReceiptText size={15} /> {saving ? 'Submitting…' : 'Submit report'}
            </button>
          </div>
        </motion.div>
      </div>
    </>
  )
}

/* ---------- page ---------- */

export default function ExpenseReportsPage() {
  const [reports, setReports] = useState<ExpenseReport[] | null>(null)
  const [qRaw, setQRaw] = useState('')
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<ActiveFilter[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const canEdit = useCan('expenses.edit')
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    let alive = true
    api
      .list<ExpenseReport>('expenseReports')
      .then((rows) => alive && setReports(rows.sort((a, b) => +new Date(b.date) - +new Date(a.date))))
      .catch(() => alive && setReports([]))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => setQ(qRaw), 200)
    return () => clearTimeout(id)
  }, [qRaw])

  const rows = useMemo(() => {
    let out = reports ?? []
    if (q) {
      const needle = q.toLowerCase()
      out = out.filter((r) => JSON.stringify(r).toLowerCase().includes(needle))
    }
    for (const f of filters) out = out.filter((r) => String((r as any)[f.key]) === f.value)
    return out
  }, [reports, q, filters])

  const selected = reports?.find((r) => r.id === selectedId) ?? null

  const decide = async (report: ExpenseReport, status: 'approved' | 'rejected') => {
    if (!canEdit) return
    setSelectedId(null) // decision made — close the slide-over
    const prev = reports
    setReports((rs) => rs?.map((r) => (r.id === report.id ? { ...r, status, approverId: user?.id } : r)) ?? rs)
    try {
      await api.update('expenseReports', report.id, { status, approverId: user?.id })
      toast({ type: status === 'approved' ? 'success' : 'warning', title: `${report.title} ${status}`, body: fmtMoney(report.amount) })
    } catch {
      setReports(prev)
      toast({ type: 'danger', title: 'Update failed', body: 'The report was restored to its previous state.' })
    }
  }

  if (reports === null) {
    return (
      <div className="mx-auto max-w-[1440px] space-y-2">
        <Skeleton className="h-9 w-64" />
        <Card padded={false} className="p-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="mb-2 h-12 w-full" />
          ))}
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        title="Expense reports"
        subtitle={`${rows.length} ${rows.length === 1 ? 'report' : 'reports'}`}
        actions={
          <button
            disabled={!canEdit}
            title={canEdit ? 'Submit a new expense report' : 'Requires expenses.edit — ask an admin'}
            onClick={() => canEdit && setShowNew(true)}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={15} /> New report
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={qRaw} onChange={setQRaw} className="w-[300px] max-w-full" placeholder="Search reports…" />
        <FilterChips
          filters={FILTER_DEFS}
          active={filters}
          onAdd={(f) => setFilters((fs) => [...fs.filter((x) => x.key !== f.key), f])}
          onRemove={(key) => setFilters((fs) => fs.filter((x) => x.key !== key))}
        />
      </div>

      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}>
        <Card padded={false} className="overflow-hidden">
          {rows.length === 0 ? (
            <EmptyState
              title={q ? `No reports match “${q}”` : 'No matching reports'}
              body="Try clearing the search or removing a filter."
              action={q || filters.length ? { label: 'Clear filters', onClick: () => { setQRaw(''); setFilters([]) } } : undefined}
            />
          ) : (
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                    <th className="px-4 py-3">Submitter</th>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <motion.tbody key={`${q}-${filters.map((f) => f.value).join()}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
                  {rows.map((r, i) => {
                    const submitter = personById(r.submitterId)
                    return (
                      <motion.tr
                        key={r.id}
                        initial={i < 12 ? { opacity: 0, y: 8 } : false}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i, 12) * 0.025, duration: 0.2 }}
                        onClick={() => setSelectedId(r.id)}
                        className={cn(
                          'cursor-pointer border-b border-border transition-colors duration-150 last:border-0 hover:bg-surface-2',
                          selectedId === r.id && 'bg-primary-soft',
                        )}
                        style={{ height: 56 }}
                      >
                        <td className="px-4">
                          <div className="flex items-center gap-3">
                            {/* the face belongs to the same person as the name,
                                so one wrapper carries both — it repeats the
                                row's own flex line, and with no submitter on
                                file it disappears and nothing moves */}
                            <DragPerson
                              name={submitter?.name ?? ''}
                              id={r.submitterId}
                              avatar={submitter?.avatar}
                              subtitle={submitter?.role}
                              className="flex min-w-0 items-center gap-3"
                            >
                              <Avatar src={submitter?.avatar} name={submitter?.name ?? r.submitterId} size="sm" />
                              <span className="clamp-1 text-[13px] font-medium text-text-1">{submitter?.name ?? r.submitterId}</span>
                            </DragPerson>
                          </div>
                        </td>
                        <td className="max-w-[280px] px-4">
                          <span className="clamp-1 text-[13px] text-text-1">{r.title}</span>
                          <span className="clamp-1 block text-[11px] text-text-3">{r.lineItems.length} line items</span>
                        </td>
                        <td className="px-4">
                          <Badge label={r.category} tint={EXPENSE_CATEGORY_TINT[r.category]} />
                        </td>
                        <td className="px-4 text-right font-stat text-[13px] font-semibold text-text-1">{fmtMoney(r.amount)}</td>
                        <td className="px-4 text-[13px] text-text-2">{ohioDayYear(r.date)}</td>
                        <td className="px-4">
                          <Badge label={r.status} tint={EXPENSE_STATUS_TINT[r.status]} />
                        </td>
                      </motion.tr>
                    )
                  })}
                </motion.tbody>
              </table>
            </div>
          )}
        </Card>
      </motion.div>

      <AnimatePresence>
        {selected && (
          <ReportSlideOver report={selected} canEdit={canEdit} onClose={() => setSelectedId(null)} onDecide={decide} />
        )}
        {showNew && (
          <NewReportModal
            onClose={() => setShowNew(false)}
            onCreate={(r) => setReports((rs) => [r, ...(rs ?? [])])}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
