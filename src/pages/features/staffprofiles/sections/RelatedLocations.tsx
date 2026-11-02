// Related Locations: every house this person worked at, as a table — the first and the last day worked there; each
// opens in Locations. The map of the one chosen sits under it (the master's while Settings › My Work keeps it).
// All of it is staffProfileOverview's.
import { useState } from 'react'
import { Link } from 'react-router'
import { Maximize2 } from 'lucide-react'
import SafeImg from '@/components/shared/SafeImg'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { photoThumb } from '@/pages/features/houses/houseModel'
import { openAddressInPlatform } from '@/lib/maps'
import { useShellHides } from '@/lib/myWorkHides'
import { cn } from '@/lib/utils'
import { dateWords, locationHref, mapEmbed, overviewOf, type RosterRow, type StaffHouse, type StaffOverview } from '../staffModel'
import { readKey, readOverview, useStaffRead, type ReadState } from '../useStaffRead'
import { EmptyNote, ReadLine, WhyNote, linkCls } from '../StaffParts'

const TH = 'whitespace-nowrap px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const TD = 'whitespace-nowrap px-3 py-2.5 tabular-nums text-text-2'

export default function RelatedLocationsSection({ row }: { row: RosterRow }) {
  const overview = useStaffRead(readKey('staffProfileOverview', row.key), () => readOverview(row.key), overviewOf)
  return <RelatedLocationsView overview={overview} onRetry={overview.reload} />
}

export function RelatedLocationsView({ overview, onRetry }: { overview: ReadState<StaffOverview>; onRetry: () => void }) {
  const o = overview.data
  return (
    <SectionCard title="Related Locations">
      <div className="grid gap-3" data-related-locations="">
        <ReadLine state={overview} what="the related locations" onRetry={onRetry} />
        {o && <WhyNote why={o.why} degraded={o.degraded} />}
        {o && o.houses.length === 0 && <EmptyNote>No house is on record for this person.</EmptyNote>}
        {o && o.houses.length > 0 && (
          <div className="scroll-thin overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[560px] border-collapse text-[13px]">
              <thead className="bg-surface-2/60">
                <tr>
                  <th className={`${TH} w-14`}><span className="sr-only">Photo</span></th>
                  <th className={TH}>Location Name</th>
                  <th className={TH}>First Date</th>
                  <th className={TH}>Last Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {o.houses.map((h) => (
                  <tr key={h.code} data-house={h.code} className="hover:bg-surface-2/60">
                    <td className="px-3 py-2">
                      <SafeImg src={h.photo ? photoThumb(h.photo, 160) : ''} icon="house" shape="square" size={32} alt={h.home_name} />
                    </td>
                    <td className="px-3 py-2.5">
                      <Link to={locationHref(h.code)} className={`${linkCls} font-semibold`}>{h.home_name}</Link>
                    </td>
                    <td className={TD}>{dateWords(h.first_day) || '—'}</td>
                    <td className={TD}>{dateWords(h.last_day) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {o && <HouseMap houses={o.houses} />}
      </div>
    </SectionCard>
  )
}

/** The map of the house chosen, a chip per house with an address; the master's alone while Settings › My Work hides it. */
function HouseMap({ houses }: { houses: StaffHouse[] }) {
  const withAddress = houses.filter((h) => h.address)
  const [picked, setPicked] = useState('')
  const noMap = useShellHides().staff_profile_map
  const shown = noMap ? null
    : withAddress.find((h) => h.code === picked) ?? withAddress.find((h) => h.current) ?? withAddress[0] ?? null
  if (!shown) {
    return houses.length > 0 && !noMap
      ? <EmptyNote kind="missing">No address is on file for these houses, so there is no map.</EmptyNote> : null
  }
  return (
    <div className="grid gap-2" data-map="">
      {withAddress.length > 1 && (
        <div className="scroll-thin flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Map of">
          {withAddress.map((h) => (
            <button key={h.code} type="button" role="tab" aria-selected={h.code === shown.code} onClick={() => setPicked(h.code)}
              data-map-chip={h.code}
              className={cn('shrink-0 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                h.code === shown.code ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text-2 hover:bg-surface-2')}>
              {h.home_name}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
        <iframe key={shown.code} src={mapEmbed(shown.address)} title={`Map of ${shown.home_name}`} loading="lazy"
          className="h-[220px] w-full border-0" data-map-frame={shown.code} />
        <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11.5px] text-text-3">
          <span className="clamp-1">{shown.address}</span>
          <button type="button" onClick={() => openAddressInPlatform(shown.address)} data-map-open=""
            className="inline-flex shrink-0 items-center gap-1 font-semibold text-primary hover:underline">
            <Maximize2 size={12} /> Open larger
          </button>
        </div>
      </div>
    </div>
  )
}
