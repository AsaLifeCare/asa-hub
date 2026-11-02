// Inventory · Medications — THE PHARMACY'S OWN RECORD, whole-screen — a ridiculous screen, everything zeroed out…
// The first draft kept a dead seeded stock table above the pharmacy panel — zeros in the middle, "no matching…
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { gasAction } from '@/features/hiring/shared'
import { useAuthStore } from '@/auth/useAuthStore'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import DragPerson from '@/components/shared/DragPerson'
import Skeleton from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import SearchInput from '@/components/shared/SearchInput'
import { EASE_OUT_EXPO, staggerContainer } from '@/engine/motion'
import { SummaryStrip } from '@/features/ops/inventory/shared'
import SheetEditor from '@/components/shared/SheetEditor'
import { cn } from '@/lib/utils'

type PharmMed = { client: string; drug: string; qty: number | null; remaining: number | null; sig: string }
type PharmHouse = { house: string; file_date: string; period_start: string; period_end: string; meds: PharmMed[] }

export default function InventoryMedicationsPage() {
  const isManager = useAuthStore((s) => ['admin', 'manager'].includes(String(s.user?.role)))
  const [houses, setHouses] = useState<PharmHouse[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [qRaw, setQRaw] = useState('')
  const [asSheet, setAsSheet] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!isManager) return
    let alive = true
    gasAction<{ houses: PharmHouse[] }>('inventoryPharmacy', {}, { timeoutMs: 60000 })
      .then((d) => { if (alive) setHouses(d.houses ?? []) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [isManager])

  useEffect(() => {
    const id = setTimeout(() => setQ(qRaw), 200)
    return () => clearTimeout(id)
  }, [qRaw])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (houses ?? [])
      .map((h) => ({
        ...h,
        meds: needle
          ? h.meds.filter((m) => `${m.client} ${m.drug} ${m.sig}`.toLowerCase().includes(needle))
          : h.meds,
      }))
      .filter((h) => h.meds.length > 0 || !needle)
  }, [houses, q])

  const allMeds = useMemo(() => (houses ?? []).flatMap((h) => h.meds), [houses])
  const lowCount = allMeds.filter((m) => m.remaining != null && m.remaining <= 7).length

  if (!isManager) {
    return <p className="py-10 text-center text-[13px] italic text-text-3">The pharmacy record is for admins and managers.</p>
  }
  if (failed) {
    return (
      <div className="mx-auto max-w-[1440px]">
        <PageHeader title="Inventory · Medications" subtitle="The pharmacy's own record" />
        <EmptyState title="The pharmacy record did not answer" body="This screen reads the biweekly dispensing reports live — nothing is cached or invented, so nothing shows until it answers." />
      </div>
    )
  }
  if (houses === null) {
    return (
      <div className="mx-auto max-w-[1440px] space-y-2">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        </div>
        <Card padded={false} className="p-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="mb-2 h-12 w-full" />)}
        </Card>
      </div>
    )
  }
  if (houses.length === 0) {
    return (
      <div className="mx-auto max-w-[1440px]">
        <PageHeader title="Inventory · Medications" subtitle="The pharmacy's own record" />
        <EmptyState title="No dispensing reports yet" body="The pharmacy's biweekly per-house reports fill this the moment they are parsed." />
      </div>
    )
  }

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="mx-auto max-w-[1440px]">
      <PageHeader
        title="Inventory · Medications"
        subtitle="The pharmacy's own remaining-quantity record — the latest dispensing report per house"
      />

      <SummaryStrip
        stats={[
          { label: 'Houses reported', value: houses.length, icon: 'home', tint: 'blue' },
          { label: 'Medications on record', value: allMeds.length, icon: 'pill', tint: 'mint' },
          { label: 'Low (≤ 7 doses left)', value: lowCount, icon: 'triangle-alert', tint: 'amber' },
          { label: 'Latest report', value: houses.map((h) => h.file_date).sort().reverse()[0] ?? '—', icon: 'calendar-days', tint: 'lavender' },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={qRaw} onChange={setQRaw} className="w-[300px] max-w-full" placeholder="Search clients, drugs…" />
        <button onClick={() => setAsSheet((v) => !v)}
          className="h-9 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2">
          {asSheet ? 'Normal view' : 'Sheet view'}
        </button>
      </div>

      {asSheet && (
        <SheetEditor
          toolbar
          title="pharmacy — latest deliveries"
          columns={[
            { key: 'house', label: 'House' }, { key: 'client', label: 'Client' },
            { key: 'drug', label: 'Drug' }, { key: 'qty', label: 'Dispensed' },
            { key: 'remaining', label: 'Remaining' }, { key: 'sig', label: 'Directions' },
          ]}
          rows={shown.flatMap((h) => h.meds.map((m) => ({ house: h.house, ...m }))) as unknown as Record<string, unknown>[]}
        />
      )}

      {!asSheet && <div className="space-y-4">
        {shown.map((h) => (
          <motion.div key={h.house} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}>
            <Card padded={false} className="overflow-hidden">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-2.5">
                <h3 className="text-[13.5px] font-bold text-text-1">{h.house}</h3>
                <span className="text-[11.5px] text-text-3">
                  report {h.file_date}{h.period_start ? ` · covers ${h.period_start} → ${h.period_end}` : ''} · {h.meds.length} meds
                </span>
              </div>
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full min-w-[680px] border-collapse text-[12.5px]">
                  <thead>
                    <tr className="border-b border-border text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
                      <th className="px-4 py-2">Client</th>
                      <th className="px-4 py-2">Drug</th>
                      <th className="px-4 py-2 text-right">Dispensed</th>
                      <th className="px-4 py-2 text-right">Remaining</th>
                      <th className="px-4 py-2">Directions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.meds.map((m, i) => {
                      const low = m.remaining != null && m.remaining <= 7
                      return (
                        <tr key={i} className={cn('border-b border-border/60 last:border-0', low ? 'bg-tint-amber/60' : 'hover:bg-surface-2')}>
                          {/* the client arrives as a name or as initials — the
                              cell is the only place they appear on this row */}
                          <td className="whitespace-nowrap px-4 py-2 font-medium text-text-1">
                            <DragPerson name={m.client || ''} type="client" subtitle={h.house || undefined}>{m.client || '—'}</DragPerson>
                          </td>
                          <td className="max-w-[260px] px-4 py-2"><span className="clamp-1 block text-text-2" title={m.drug}>{m.drug || '—'}</span></td>
                          <td className="px-4 py-2 text-right tabular-nums text-text-2">{m.qty ?? '—'}</td>
                          <td className={cn('px-4 py-2 text-right font-stat font-bold tabular-nums', low ? 'text-tint-fg-amber' : 'text-text-1')}>
                            {m.remaining ?? '—'}{low && ' ⚠'}
                          </td>
                          <td className="max-w-[300px] px-4 py-2"><span className="clamp-1 block text-[11.5px] text-text-3" title={m.sig}>{m.sig || '—'}</span></td>
                        </tr>
                      )
                    })}
                    {h.meds.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-3 text-center text-[12px] italic text-text-3">Nothing matches in this house.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>}

      <p className="mt-3 px-1 text-[11.5px] text-text-3">
        "Remaining" is the pharmacy's own column from its dispensing report — never a local count that drifts. Amber rows are at seven doses or fewer.
      </p>
    </motion.div>
  )
}
