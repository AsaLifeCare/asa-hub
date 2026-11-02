// Expenses · Overview — KPI stats (pending $, approved this month, rejected, average report), monthly spend area…
// Custom feature page — routed explicitly in App.tsx (the schema config for this page in registry/apps.ts documents…
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { CircleCheck, CircleX, ReceiptText } from 'lucide-react'
import { api } from '@/lib/api'
import { ohioDayYear } from '@/lib/ohio'
import type { ExpenseReport } from '@/lib/seed-ops'
import { personById } from '@/lib/people-lookup'
import { useCan } from '@/auth/permissions'
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'
import PageHeader from '@/components/shared/PageHeader'
import Card, { CardHeader } from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import Skeleton from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import { ThemedAreaChart, ThemedDonut } from '@/components/shared/charts'
import { AppIcon } from '@/lib/icons'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { staggerContainer, staggerItem } from '@/engine/motion'
import { EXPENSE_CATEGORY_TINT, EXPENSE_STATUS_TINT, fmtMoney } from '@/features/ops/utils'
import { Badge } from '@/components/shared/Badge'
import { cn } from '@/lib/utils'
import type { TintName } from '@/engine/types'

function MoneyStat({ label, value, icon, tint, caption }: { label: string; value: string; icon: string; tint: TintName; caption: string }) {
  return (
    <motion.div variants={staggerItem}>
      <Card hover>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{label}</div>
            <div className="mt-1.5 font-stat text-[26px] font-bold leading-8 text-text-1">{value}</div>
            <div className="mt-1 text-[12px] text-text-3">{caption}</div>
          </div>
          <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-[12px]', TINT_BG[tint])}>
            <AppIcon name={icon} size={18} className={TINT_FG[tint]} />
          </span>
        </div>
      </Card>
    </motion.div>
  )
}

export default function ExpensesOverviewPage() {
  const [reports, setReports] = useState<ExpenseReport[] | null>(null)
  const canEdit = useCan('expenses.edit')
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()

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

  const derived = useMemo(() => {
    const rows = reports ?? []
    const pending = rows.filter((r) => r.status === 'pending')
    const pendingSum = pending.reduce((s, r) => s + r.amount, 0)
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const approvedMonth = rows.filter((r) => r.status === 'approved' && new Date(r.date) >= monthStart)
    const approvedMonthSum = approvedMonth.reduce((s, r) => s + r.amount, 0)
    const rejected = rows.filter((r) => r.status === 'rejected')
    const avg = rows.length ? rows.reduce((s, r) => s + r.amount, 0) / rows.length : 0

    // monthly spend, last 6 months (oldest → newest)
    const monthly: number[] = Array.from({ length: 6 }, () => 0)
    const now = new Date()
    for (const r of rows) {
      const d = new Date(r.date)
      const monthsAgo = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
      if (monthsAgo >= 0 && monthsAgo < 6) monthly[5 - monthsAgo] += r.amount
    }
    const byCategory = new Map<string, number>()
    for (const r of rows) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + r.amount)
    return { pending, pendingSum, approvedMonthSum, approvedCount: approvedMonth.length, rejected, avg, monthly, byCategory }
  }, [reports])

  const decide = async (report: ExpenseReport, status: 'approved' | 'rejected') => {
    if (!canEdit) return
    const prev = reports
    setReports((rs) => rs?.map((r) => (r.id === report.id ? { ...r, status, approverId: user?.id } : r)) ?? rs)
    try {
      await api.update('expenseReports', report.id, { status, approverId: user?.id })
      toast({
        type: status === 'approved' ? 'success' : 'warning',
        title: `${report.title} ${status}`,
        body: `${fmtMoney(report.amount)} · submitted by ${personById(report.submitterId)?.name ?? report.submitterId}`,
      })
    } catch {
      setReports(prev)
      toast({ type: 'danger', title: 'Update failed', body: 'The report was restored to its previous state.' })
    }
  }

  if (reports === null) {
    return (
      <div className="mx-auto max-w-[1440px]">
        <Skeleton className="h-9 w-64" />
        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
          <Skeleton className="h-72 w-full rounded-lg" />
          <Skeleton className="h-72 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  if (reports.length === 0) {
    return (
      <Card className="mt-6">
        <EmptyState title="No expense reports yet" body="Submitted reports will appear here." />
      </Card>
    )
  }

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="mx-auto max-w-[1440px]">
      <PageHeader
        title="Expenses · Overview"
        subtitle={`${reports.length} reports · ${fmtMoney(reports.reduce((s, r) => s + r.amount, 0))} total claimed`}
        actions={
          <button
            onClick={() => navigate('/app/expenses/reports')}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]"
          >
            <ReceiptText size={15} /> All reports
          </button>
        }
      />

      {/* stat row */}
      <div className="mb-5 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <MoneyStat label="Pending approval" value={fmtMoney(derived.pendingSum)} icon="hourglass" tint="amber" caption={`${derived.pending.length} reports waiting`} />
        <MoneyStat label="Approved this month" value={fmtMoney(derived.approvedMonthSum)} icon="circle-check" tint="mint" caption={`${derived.approvedCount} reports`} />
        <MoneyStat label="Rejected" value={String(derived.rejected.length)} icon="circle-x" tint="pink" caption={fmtMoney(derived.rejected.reduce((s, r) => s + r.amount, 0))} />
        <MoneyStat label="Average report" value={fmtMoney(Math.round(derived.avg))} icon="receipt" tint="blue" caption="across all statuses" />
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-6 xl:grid-cols-12">
        {/* monthly spend */}
        <motion.div variants={staggerItem} className="md:col-span-6 xl:col-span-8">
          <Card hover className="h-[320px]">
            <CardHeader title="Monthly spend" sub="All categories · last 6 months" />
            <ThemedAreaChart series={[{ name: 'Spend', points: derived.monthly.map((v) => Math.round(v)), color: 'amber' }]} height={220} />
          </Card>
        </motion.div>

        {/* category donut */}
        <motion.div variants={staggerItem} className="md:col-span-3 xl:col-span-4">
          <Card hover className="h-[320px]">
            <CardHeader title="Spend by category" />
            <div className="flex items-center gap-4">
              <ThemedDonut
                slices={[...derived.byCategory.entries()].map(([label, value]) => ({
                  label,
                  value: Math.round(value),
                  tint: EXPENSE_CATEGORY_TINT[label as keyof typeof EXPENSE_CATEGORY_TINT] ?? 'blue',
                }))}
                size={150}
                centerLabel="total $"
              />
              <div className="flex-1 space-y-2">
                {[...derived.byCategory.entries()].map(([label, value]) => (
                  <div key={label} className="flex items-center gap-2 text-[12px]">
                    <Badge label={label} tint={EXPENSE_CATEGORY_TINT[label as keyof typeof EXPENSE_CATEGORY_TINT] ?? 'blue'} />
                    <span className="ml-auto font-stat font-semibold text-text-1">{fmtMoney(Math.round(value))}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </motion.div>

        {/* pending approvals */}
        <motion.div variants={staggerItem} className="md:col-span-6 xl:col-span-12">
          <Card hover>
            <CardHeader
              title="Awaiting approval"
              sub={canEdit ? `${derived.pending.length} reports need a decision` : 'You have read-only access — ask an admin for expenses.edit'}
            />
            {derived.pending.length === 0 ? (
              <EmptyState title="Queue is clear" body="Every submitted report has been decided." />
            ) : (
              <div className="space-y-1">
                {derived.pending.map((r) => {
                  const submitter = personById(r.submitterId)
                  return (
                    <motion.div
                      key={r.id}
                      variants={staggerItem}
                      className="flex flex-wrap items-center gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-surface-2"
                    >
                      <DragPerson
                        name={submitter?.name ?? ''}
                        id={r.submitterId}
                        avatar={submitter?.avatar}
                        subtitle={submitter?.role}
                        className="flex shrink-0"
                      >
                        <Avatar src={submitter?.avatar} name={submitter?.name ?? r.submitterId} size="md" />
                      </DragPerson>
                      <div className="min-w-0 flex-1">
                        <div className="clamp-1 text-[14px] font-medium text-text-1">{r.title}</div>
                        <div className="clamp-1 text-[12px] text-text-3">
                          <DragPerson
                            name={submitter?.name ?? ''}
                            id={r.submitterId}
                            avatar={submitter?.avatar}
                            subtitle={submitter?.role}
                          >
                            {submitter?.name ?? r.submitterId}
                          </DragPerson> · {ohioDayYear(r.date)} · {r.lineItems.length} line items
                        </div>
                      </div>
                      <Badge label={r.category} tint={EXPENSE_CATEGORY_TINT[r.category]} />
                      <Badge label={r.status} tint={EXPENSE_STATUS_TINT[r.status]} />
                      <span className="w-24 text-right font-stat text-[14px] font-semibold text-text-1">{fmtMoney(r.amount)}</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          disabled={!canEdit}
                          title={canEdit ? 'Approve report' : 'Requires expenses.edit — ask an admin'}
                          onClick={() => decide(r, 'approved')}
                          className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <CircleCheck size={14} /> Approve
                        </button>
                        <button
                          disabled={!canEdit}
                          title={canEdit ? 'Reject report' : 'Requires expenses.edit — ask an admin'}
                          onClick={() => decide(r, 'rejected')}
                          className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-danger transition-all duration-150 hover:bg-tint-pink active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <CircleX size={14} /> Reject
                        </button>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </Card>
        </motion.div>
      </div>
    </motion.div>
  )
}
