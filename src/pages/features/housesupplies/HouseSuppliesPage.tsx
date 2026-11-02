// HOUSE SUPPLIES — one page, one black header, three tabs (`?tab=`): Inventory every house's supplies and assets as Locations draws them…
// Every reader gets the black header: the pharmacy figures for a medication reader, and for everyone else the band…
import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { motion } from 'framer-motion'
import { RefreshCw } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import Skeleton from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { houseMedsReach, tabFor, tabsFor, type HouseSuppliesTab } from '@/lib/houseMedsAccess'
import { heroFigures, isoOf } from '@/lib/houseMedsAnalysis'
import HouseMedsHero from './HouseMedsHero'
import HouseMedsTab from './HouseMedsTab'
import HouseMedsImportTab from './HouseMedsImportTab'
import HouseInventoryTab from './HouseInventoryTab'
import { useHouseMeds } from './useHouseMeds'

const LABELS: Record<HouseSuppliesTab, string> = {
  inventory: 'Inventory', medications: 'Medications', import: 'Import',
}

function todayIso(): string {
  const now = new Date()
  return isoOf(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
}

export default function HouseSuppliesPage() {
  const user = useEffectiveUser()
  const reach = useMemo(() => houseMedsReach(user), [user])
  const [params, setParams] = useSearchParams()
  const tab = tabFor(params.get('tab'), reach)
  const tabs = tabsFor(reach)
  const { state, refresh } = useHouseMeds(reach.medications)
  const view = state.data
  const today = todayIso()
  const figures = useMemo(() => (view ? heroFigures(view, today) : null), [view, today])

  const open = (next: HouseSuppliesTab, show?: string) => {
    const p = new URLSearchParams(params)
    p.set('tab', next)
    if (show) p.set('show', show)
    else p.delete('show')
    setParams(p, { replace: true })
  }

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="House Supplies"
          subtitle="What each house owns, and what the pharmacy dispensed for its residents"
          actions={reach.medications ? (
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={state.refreshing}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
            >
              <RefreshCw size={14} className={state.refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
          ) : undefined}
        />
      </motion.div>

      {reach.medications ? (state.status === 'loading' && !view
        ? <Skeleton className="mb-5 h-[236px] w-full rounded-[16px]" />
        : <HouseMedsHero state={state} figures={figures} view={view} canImport={reach.import}
            onOpen={(t, show) => open(t, show)} onRetry={() => void refresh()} />) : (
        <div className="mb-5 rounded-[16px] bg-detail-hero p-5 shadow-2 sm:p-6">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-white/45">
            House Supplies · Inventory
          </p>
          <p className="mt-3 font-stat text-[26px] leading-tight text-white">What each house owns</p>
          <p className="mt-1.5 max-w-[640px] text-[12.5px] leading-[1.5] text-white/60">
            The supplies each house keeps, listed below.
          </p>
        </div>
      )}

      {tabs.length > 1 && (
        <SegmentedTabs
          className="mb-5 w-fit"
          tabs={tabs.map((t) => ({ id: t, label: LABELS[t] }))}
          value={tab}
          onChange={(t) => open(t as HouseSuppliesTab)}
        />
      )}

      {tab === 'inventory' && <HouseInventoryTab />}

      {tab === 'medications' && (view
        ? <HouseMedsTab view={view} todayIso={today} initialLow={params.get('show') === 'low'}
            onChanged={() => void refresh()} />
        : state.status === 'failed'
          ? <EmptyState title="The medications could not be read" body={state.error} action={{ label: 'Try again', onClick: () => void refresh() }} />
          : <Skeleton className="h-[320px] w-full rounded-lg" />)}

      {tab === 'import' && (view
        ? <HouseMedsImportTab view={view} todayIso={today} onChanged={() => void refresh()} />
        : state.status === 'failed'
          ? <EmptyState title="The ledger could not be read" body={state.error} action={{ label: 'Try again', onClick: () => void refresh() }} />
          : <Skeleton className="h-[320px] w-full rounded-lg" />)}
    </div>
  )
}
