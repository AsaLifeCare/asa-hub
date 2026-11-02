// Every active house as a card — photo and 'LABEL - CODE' — under the dark summary band: houses, clients, staff on…
import { useMemo, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import DragPerson from '@/components/shared/DragPerson'
import DriveReadingRoom from '@/components/shared/DriveReadingRoom'
import SearchInput from '@/components/shared/SearchInput'
import SafeImg, { IconTile } from '@/components/shared/SafeImg'
import { heroBand } from '@/lib/tints'
import { useEffectiveUser } from '@/lib/effectiveUser'
import {
  band, gridHouses, houseDay, photoThumb, seesSourceHealth, shortDay, type Clock, type HouseRow, type ShiftRow,
} from './houseModel'

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">{label}</p>
      <p className="font-stat text-[40px] leading-none text-white">{value}</p>
      {sub && <p className="mt-1 text-[12px] text-white/60">{sub}</p>}
    </div>
  )
}

export default function HouseGrid({
  houses,
  shifts,
  shiftsWhy = '',
  clock,
  failed,
  loading,
  showBooks,
  onOpen,
  onRefresh,
}: {
  houses: HouseRow[] | null
  shifts: ShiftRow[] | null
  shiftsWhy?: string
  clock: Clock
  failed: string
  loading: boolean
  showBooks: boolean
  onOpen: (code: string) => void
  onRefresh: () => void
}) {
  const [query, setQuery] = useState('')
  const rows = houses ?? []
  const shown = useMemo(() => gridHouses(rows, query), [rows, query])
  const hidden = rows.filter((h) => !h.active)
  const summary = useMemo(() => band(rows, shifts, clock), [rows, shifts, clock])
  const ready = houses !== null
  const seesSources = seesSourceHealth(useEffectiveUser())

  return (
    <div className="w-full px-4 py-6 sm:px-5">
      <PageHeader
        title="Houses"
        subtitle="Every active house — who lives there, who runs it, who works there, and its tools."
        actions={
          <button type="button" onClick={onRefresh}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      <div className="mb-5 rounded-[16px] bg-detail-hero p-5 shadow-2 sm:p-6">
        <div className={`grid grid-cols-2 gap-5 ${seesSources ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
          <Stat label="Active houses" value={ready ? summary.houses : '—'}
            sub={ready ? 'with an active client in the Client Database' : 'the houses have not answered'} />
          <Stat label="Clients" value={ready ? summary.clients : '—'} sub="active, placed in those houses" />
          <Stat label="Staff this week" value={ready && summary.staffWeek !== null ? summary.staffWeek : '—'}
            sub={summary.staffWeek !== null ? `on the roster, ${shortDay(clock.today)} → ${shortDay(clock.weekEnd)}`
              : shiftsWhy ? `the roster could not be read — ${shiftsWhy}` : 'reading the roster…'} />
          {seesSources && <div className="min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">Sources</p>
            <p className="flex items-center gap-2 font-stat text-[40px] leading-none text-white">
              <span className="h-2.5 w-2.5 rounded-full"
                style={{ background: heroBand(summary.stale.length ? 'amber' : 'mint') }} />
              {!ready ? '—' : summary.stale.length ? summary.stale.length : 'OK'}
            </p>
            <p className="mt-1 text-[12px] text-white/60">
              {!ready ? 'not read yet' : summary.stale.length ? 'stale or unreadable' : 'every source is fresh'}
            </p>
          </div>}
        </div>
        {seesSources && summary.stale.length > 0 && (
          <ul className="mt-4 grid gap-1 border-t border-white/10 pt-3 text-[12px] leading-4 text-white/75">
            {summary.stale.map((s) => (
              <li key={s.key}>
                <span className="font-semibold text-white">{s.label}</span> — {s.state}{s.why ? `: ${s.why}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-4 max-w-[420px]">
        <SearchInput value={query} onChange={setQuery} placeholder="Search a house, a manager or a client…" />
      </div>

      {!ready && !failed && (
        <p className="flex items-center gap-2 py-8 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading the houses…
        </p>
      )}
      {failed && <p className="rounded-md bg-tint-pink px-3 py-2 text-[12.5px] text-tint-fg-pink">{failed}</p>}
      {ready && !failed && shown.length === 0 && (
        <Card className="p-6 text-center text-[13px] text-text-3">
          {query ? 'No house matches that search.' : 'No active house in the Asa Client Database.'}
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((h) => {
          const day = houseDay(h.code, shifts, clock)
          return (
            <Card key={h.code} padded={false} hover className="overflow-hidden">
              <button type="button" onClick={() => onOpen(h.code)} className="block w-full text-left">
                {h.photo.src ? (
                  <SafeImg src={photoThumb(h.photo.src)} icon="house" shape="square"
                    size="aspect-[4/3] w-full" className="rounded-none" alt={h.title} />
                ) : (
                  <div className="grid aspect-[4/3] w-full place-items-center bg-surface-2">
                    <IconTile icon="house" size={56} />
                  </div>
                )}
                <div className="grid gap-2 p-4">
                  <DragPerson name={h.title} id={h.code} type="house" subtitle={h.address} className="block min-w-0">
                    <p className="clamp-1 text-[14px] font-semibold text-text-1">{h.title}</p>
                  </DragPerson>
                  <p className="clamp-1 text-[12px] text-text-3">
                    {h.managers.length ? `House manager · ${h.managers.map((m) => m.name).join(', ')}` : 'No house manager on the calendar'}
                  </p>
                  <div className="flex flex-wrap gap-1.5 text-[11.5px] font-medium text-text-2">
                    <span className="rounded-full bg-surface-2 px-2.5 py-0.5">{h.client_count} client{h.client_count === 1 ? '' : 's'}</span>
                    {day ? (
                      <span className="rounded-full bg-surface-2 px-2.5 py-0.5">{day.onDuty.length} on duty</span>
                    ) : shiftsWhy ? (
                      <span className="rounded-full bg-surface-2 px-2.5 py-0.5" title={shiftsWhy}>On duty unknown</span>
                    ) : null}
                  </div>
                </div>
              </button>
            </Card>
          )
        })}
      </div>

      {ready && hidden.length > 0 && (
        <p className="mt-4 text-[12px] text-text-3">
          Not shown: {hidden.map((h) => `${h.title} (${h.active_why || 'not active'})`).join(' · ')}
        </p>
      )}

      {showBooks && (
        <>
          <h2 className="mb-3 mt-8 font-display text-[17px] font-bold text-text-1">House Books</h2>
          <DriveReadingRoom
            room="houses"
            tree
            emptyLine="No house documents yet — what lands in the House _ Client Books Drive folder appears here."
          />
        </>
      )}
    </div>
  )
}
