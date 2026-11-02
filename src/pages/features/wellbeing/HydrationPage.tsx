// Hydration — the cortex tracks each client's fluid intake against the daily target in their ISP.
// Icon cards (no photos): avg vs target oz, glasses, trend and an ideal-week strip.
import { useState } from 'react'
import { Droplets } from 'lucide-react'
import Card from '@/components/shared/Card'
import { TINT_PAIR } from '@/lib/tints'
import { cn } from '@/lib/utils'
import { hydrationProfiles } from '@/lib/seed-wellbeing'
import type { HydrationProfile } from '@/lib/seed-wellbeing'
import {
  Chip,
  ClientNameRow,
  IdealWeekDots,
  SearchInput,
  SkeletonCards,
  ThinProgress,
  TrendArrow,
  WellbeingHeader,
  useScopedRows,
} from './components'
import { useWellbeingRows } from './useWellbeingRows'
import DetailModal from './DetailModal'

// The profile, as the app's modal draws it.
export function HydrationProfileBody({ profile, onRecord = false }: { profile: HydrationProfile; onRecord?: boolean }) {
  if (onRecord) {
    return (
      <>
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-[28px] font-bold leading-8 text-text-1">{profile.targetOz}oz</span>
          <span className="font-mono text-[12px] text-text-3">a day · target from the ISP</span>
        </div>
        <p className="mt-3 whitespace-pre-line text-[13px] leading-6 text-text-2">{profile.notes}</p>
      </>
    )
  }
  const pct = (profile.avgOz / profile.targetOz) * 100
  return (
    <>
      <h2 className="mt-0.5 font-display text-[20px] font-bold leading-6 text-text-1">
        <ClientNameRow name={profile.clientName} id={profile.clientId} />
      </h2>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="font-display text-[28px] font-bold leading-8 text-text-1">{profile.avgOz}oz</span>
        <span className="font-mono text-[12px] text-text-3">avg / {profile.targetOz}oz target</span>
        <span className="ml-auto">
          <TrendArrow trend={profile.trend} />
        </span>
      </div>
      <div className="mt-3">
        <ThinProgress pct={pct} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Chip tint="blue">{profile.glasses}/8 glasses</Chip>
        <Chip>last logged {profile.lastLogged}</Chip>
      </div>
      <p className="mt-4 whitespace-pre-line text-[13px] leading-6 text-text-2">{profile.notes}</p>
      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <span className="font-mono text-[10px] uppercase tracking-wide text-text-3">ideal week</span>
        <IdealWeekDots seedKey={profile.id} ratio={Math.min(1, profile.avgOz / profile.targetOz)} />
      </div>
    </>
  )
}

function HydrationDetailModal({ profile, onClose }: { profile: HydrationProfile; onClose: () => void }) {
  return (
    <DetailModal
      open
      onClose={onClose}
      title="Hydration profile"
      ariaLabel={`${profile.clientName} hydration details`}
      imageIcon="droplets"
      imageTint="blue"
      imageAlt=""
    >
      <HydrationProfileBody profile={profile} />
    </DetailModal>
  )
}

export default function HydrationPage() {
  const [q, setQ] = useState('')
  const [openProfile, setOpenProfile] = useState<HydrationProfile | null>(null)
  const { rows, loading } = useWellbeingRows('hydrationProfiles', hydrationProfiles)
  const visible = useScopedRows(rows, q, ['clientName', 'notes'])

  const met = visible.filter((h) => h.avgOz >= h.targetOz).length

  return (
    <div>
      <WellbeingHeader
        appName="HYDRATION"
        pageLabel="IDEAL INTAKE"
        subcopy="The cortex tracks each client's fluid intake against the daily target in their ISP — texture-safe liquids, prompts and logging habits included."
        stats={`${met} met target / ${visible.length - met} below`}
      />
      <div className="mb-5 max-w-[380px]">
        <SearchInput value={q} onChange={setQ} placeholder="Search client or note…" />
      </div>

      {loading ? (
        <SkeletonCards count={8} />
      ) : (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {visible.map((h) => {
          const pct = (h.avgOz / h.targetOz) * 100
          return (
            <button key={h.id} type="button" onClick={() => setOpenProfile(h)} className="text-left">
              <Card hover>
                <div className="flex items-start justify-between gap-3">
                  <span className={cn('inline-flex h-10 w-10 items-center justify-center rounded-md', TINT_PAIR('blue'))}>
                    <Droplets size={18} />
                  </span>
                  <TrendArrow trend={h.trend} />
                </div>
                <div className="mt-3">
                  <ClientNameRow name={h.clientName} id={h.clientId} />
                </div>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="font-display text-[24px] font-bold leading-7 text-text-1">{h.avgOz}oz</span>
                  <span className="font-mono text-[11px] text-text-3">/ {h.targetOz}oz target</span>
                </div>
                <div className="mt-2">
                  <ThinProgress pct={pct} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Chip tint="blue">{h.glasses}/8 glasses</Chip>
                  <Chip>last logged {h.lastLogged}</Chip>
                </div>
                <p className="mt-2.5 line-clamp-2 text-[12.5px] leading-5 text-text-2">{h.notes}</p>
                <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-text-3">ideal week</span>
                  <IdealWeekDots seedKey={h.id} ratio={Math.min(1, h.avgOz / h.targetOz)} />
                </div>
              </Card>
            </button>
          )
        })}
        {visible.length === 0 && (
          <Card className="col-span-full text-center text-[13px] text-text-2">
            No hydration profiles match this search or focus.
          </Card>
        )}
      </div>
      )}

      {openProfile && <HydrationDetailModal profile={openProfile} onClose={() => setOpenProfile(null)} />}
    </div>
  )
}
