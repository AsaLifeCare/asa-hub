// Sleep — the cortex tracks each client's rest against their ISP sleep target.
// Icon cards (no photos): avg vs target hours, quality, trend, ideal week.
import { useState } from 'react'
import { Moon } from 'lucide-react'
import Card from '@/components/shared/Card'
import { TINT_PAIR } from '@/lib/tints'
import { cn } from '@/lib/utils'
import { sleepProfiles } from '@/lib/seed-wellbeing'
import type { SleepProfile } from '@/lib/seed-wellbeing'
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
export function SleepProfileBody({ profile, onRecord = false }: { profile: SleepProfile; onRecord?: boolean }) {
  if (onRecord) {
    return (
      <>
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-[28px] font-bold leading-8 text-text-1">{profile.targetHours}h</span>
          <span className="font-mono text-[12px] text-text-3">a night · target from the ISP</span>
        </div>
        <p className="mt-3 whitespace-pre-line text-[13px] leading-6 text-text-2">{profile.notes}</p>
      </>
    )
  }
  const pct = (profile.avgHours / profile.targetHours) * 100
  return (
    <>
      <h2 className="mt-0.5 font-display text-[20px] font-bold leading-6 text-text-1">
        <ClientNameRow name={profile.clientName} id={profile.clientId} />
      </h2>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="font-display text-[28px] font-bold leading-8 text-text-1">
          {profile.avgHours.toFixed(1)}h
        </span>
        <span className="font-mono text-[12px] text-text-3">avg / {profile.targetHours}h target</span>
        <span className="ml-auto">
          <TrendArrow trend={profile.trend} />
        </span>
      </div>
      <div className="mt-3">
        <ThinProgress pct={pct} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Chip tint="lavender">{profile.quality}% quality</Chip>
        <Chip>
          {profile.bedtime} → {profile.wakeTime}
        </Chip>
      </div>
      <p className="mt-4 whitespace-pre-line text-[13px] leading-6 text-text-2">{profile.notes}</p>
      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <span className="font-mono text-[10px] uppercase tracking-wide text-text-3">ideal week</span>
        <IdealWeekDots seedKey={profile.id} ratio={Math.min(1, profile.avgHours / profile.targetHours)} />
      </div>
    </>
  )
}

function SleepDetailModal({ profile, onClose }: { profile: SleepProfile; onClose: () => void }) {
  return (
    <DetailModal
      open
      onClose={onClose}
      title="Sleep profile"
      ariaLabel={`${profile.clientName} sleep details`}
      imageIcon="moon"
      imageTint="lavender"
      imageAlt=""
    >
      <SleepProfileBody profile={profile} />
    </DetailModal>
  )
}

export default function SleepPage() {
  const [q, setQ] = useState('')
  const [openProfile, setOpenProfile] = useState<SleepProfile | null>(null)
  const { rows, loading } = useWellbeingRows('sleepProfiles', sleepProfiles)
  const visible = useScopedRows(rows, q, ['clientName', 'notes'])

  const met = visible.filter((s) => s.avgHours >= s.targetHours).length

  return (
    <div>
      <WellbeingHeader
        appName="SLEEP"
        pageLabel="IDEAL REST"
        subcopy="The cortex tracks each client's rest against the sleep target in their ISP — bedtime routine, night notes and trend all roll into one quality score."
        stats={`${met} met target / ${visible.length - met} below`}
      />
      <div className="mb-5 max-w-[380px]">
        <SearchInput value={q} onChange={setQ} placeholder="Search client or note…" />
      </div>

      {loading ? (
        <SkeletonCards count={8} />
      ) : (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {visible.map((s) => {
          const pct = (s.avgHours / s.targetHours) * 100
          return (
            <button key={s.id} type="button" onClick={() => setOpenProfile(s)} className="text-left">
              <Card hover>
                <div className="flex items-start justify-between gap-3">
                  <span className={cn('inline-flex h-10 w-10 items-center justify-center rounded-md', TINT_PAIR('lavender'))}>
                    <Moon size={18} />
                  </span>
                  <TrendArrow trend={s.trend} />
                </div>
                <div className="mt-3">
                  <ClientNameRow name={s.clientName} id={s.clientId} />
                </div>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="font-display text-[24px] font-bold leading-7 text-text-1">
                    {s.avgHours.toFixed(1)}h
                  </span>
                  <span className="font-mono text-[11px] text-text-3">/ {s.targetHours}h target</span>
                </div>
                <div className="mt-2">
                  <ThinProgress pct={pct} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Chip tint="lavender">{s.quality}% quality</Chip>
                  <Chip>
                    {s.bedtime} → {s.wakeTime}
                  </Chip>
                </div>
                <p className="mt-2.5 line-clamp-2 text-[12.5px] leading-5 text-text-2">{s.notes}</p>
                <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-text-3">ideal week</span>
                  <IdealWeekDots seedKey={s.id} ratio={Math.min(1, s.avgHours / s.targetHours)} />
                </div>
              </Card>
            </button>
          )
        })}
        {visible.length === 0 && (
          <Card className="col-span-full text-center text-[13px] text-text-2">
            No sleep profiles match this search or focus.
          </Card>
        )}
      </div>
      )}

      {openProfile && <SleepDetailModal profile={openProfile} onClose={() => setOpenProfile(null)} />}
    </div>
  )
}
