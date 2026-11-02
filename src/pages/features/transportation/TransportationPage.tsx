// TRANSPORTATION — the wheels, one screen.
// Every piece of the information was already in hand, whether or not it read as a merge with Fleet and Mileage.
import { useEffect, useMemo, useState } from 'react'
import {
  Accessibility, Bus, CalendarDays, Gauge, Loader2, MapPin, Route as RouteIcon,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import { api } from '@/lib/api'
import { ohioDayYear } from '@/lib/ohio'
import { cn } from '@/lib/utils'

type Row = Record<string, unknown>
const s = (r: Row, k: string) => String(r[k] ?? '').trim()

function day(v: string): string {
  if (!v) return ''
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return ohioDayYear(v) || v
  return v
}
const mapsHref = (address: string) => `https://maps.google.com/?q=${encodeURIComponent(address)}`

const VEHICLE_STATUS: Record<string, string> = {
  active: 'bg-tint-mint text-tint-fg-mint',
  service: 'bg-tint-amber text-tint-fg-amber',
  retired: 'bg-surface-3 text-text-3',
}

export default function TransportationPage() {
  const [visits, setVisits] = useState<Row[] | null>(null)
  const [fleet, setFleet] = useState<Row[] | null>(null)
  const [mileage, setMileage] = useState<Row[] | null>(null)
  const [routes, setRoutes] = useState<Row[] | null>(null)

  useEffect(() => {
    let alive = true
    const grab = (resource: string, set: (r: Row[]) => void) =>
      api.list<Row>(resource as never).then((r) => { if (alive) set(Array.isArray(r) ? r : []) }).catch(() => { if (alive) set([]) })
    void grab('drVisits', setVisits)
    void grab('fleetVehicles', setFleet)
    void grab('mileageLogs', setMileage)
    void grab('routes', setRoutes)
    return () => { alive = false }
  }, [])

  /** the actual runs: booked visits from today on, soonest first */
  const runs = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return (visits ?? [])
      .map((r) => ({ r, t: Date.parse(s(r, 'appointment_date')) }))
      .filter((x) => !Number.isNaN(x.t) && x.t >= today.getTime())
      .sort((a, b) => a.t - b.t)
      .slice(0, 20)
      .map((x) => x.r)
  }, [visits])

  const recentMiles = useMemo(() => [...(mileage ?? [])].slice(-15).reverse(), [mileage])
  const milesTotal = useMemo(
    () => (mileage ?? []).reduce((a, r) => a + (parseFloat(s(r, 'miles')) || 0), 0),
    [mileage],
  )

  const loading = visits === null && fleet === null

  return (
    <div>
      <PageHeader
        title="Transportation Users"
        subtitle="Every wheel the company turns — the booked runs, the fleet, the mileage and the planned routes."
      />

      {loading ? (
        <p className="mt-6 flex items-center gap-2 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading the road…
        </p>
      ) : (
        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          {/* ── the runs — appointments ARE the transport workload ── */}
          <div className="space-y-4">
            <Card padded={false} className="overflow-hidden">
              <p className="border-b border-border px-4 py-2.5 text-[12.5px] font-bold text-text-1">
                Upcoming runs · {runs.length}
                <span className="ml-2 text-[11px] font-medium text-text-3">booked appointments, from the form the houses already use</span>
              </p>
              {runs.length === 0 ? (
                <p className="px-4 py-5 text-center text-[12.5px] italic text-text-3">
                  Nothing booked from today on — new appointment bookings land here on their own.
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {runs.map((v, i) => (
                    <div key={s(v, 'id') || i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <span className="w-[92px] shrink-0 text-[12px] font-semibold tabular-nums text-text-1">{day(s(v, 'appointment_date'))}</span>
                      <span className="w-[70px] shrink-0 text-[11.5px] tabular-nums text-text-3">{s(v, 'appointment_start_time') || '—'}</span>
                      <span className="min-w-[120px] text-[13px] font-semibold text-text-1">{s(v, 'client_name') || '—'}</span>
                      {/^y/i.test(s(v, 'wheelchair_van_required')) && (
                        <span className="flex items-center gap-1 rounded-full bg-tint-amber px-1.5 py-px text-[10.5px] font-semibold text-tint-fg-amber">
                          <Accessibility size={10} /> Van
                        </span>
                      )}
                      {s(v, 'appointment_address') && (
                        <a href={mapsHref(s(v, 'appointment_address'))} target="_blank" rel="noreferrer" className="clamp-1 min-w-0 flex-1 text-[11.5px] text-primary hover:underline">
                          <MapPin size={10} className="mr-0.5 inline" />{s(v, 'appointment_address')}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card padded={false} className="overflow-hidden">
              <p className="border-b border-border px-4 py-2.5 text-[12.5px] font-bold text-text-1">
                <RouteIcon size={13} className="mr-1.5 inline" />
                Planned routes · {(routes ?? []).length}
              </p>
              {(routes ?? []).length === 0 ? (
                <p className="px-4 py-5 text-center text-[12.5px] italic text-text-3">
                  No standing routes planned yet — "Add route" lives on this app's toolbar for admins.
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {(routes ?? []).map((r, i) => (
                    <div key={s(r, 'id') || i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <span className="min-w-[120px] text-[13px] font-semibold text-text-1">{s(r, 'route') || 'Route'}</span>
                      <span className="text-[11.5px] text-text-3">{s(r, 'driver')}</span>
                      <span className="text-[11.5px] text-text-3">{s(r, 'vehicle')}</span>
                      {s(r, 'pickupTime') && <span className="text-[11.5px] tabular-nums text-text-3"><CalendarDays size={10} className="mr-0.5 inline" />{s(r, 'pickupTime')}</span>}
                      <span className="clamp-1 min-w-0 flex-1 text-[11.5px] text-text-3">{s(r, 'destination')}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* ── the fleet and the miles ── */}
          <div className="space-y-4">
            <Card padded={false} className="overflow-hidden">
              <p className="border-b border-border px-4 py-2.5 text-[12.5px] font-bold text-text-1">
                <Bus size={13} className="mr-1.5 inline" />
                The fleet · {(fleet ?? []).length}
              </p>
              {(fleet ?? []).length === 0 ? (
                <p className="px-4 py-5 text-center text-[12.5px] italic text-text-3">
                  No vehicles on file yet.
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {(fleet ?? []).map((v, i) => (
                    <div key={s(v, 'id') || i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <span className="w-[64px] shrink-0 text-[12.5px] font-bold text-text-1">{s(v, 'unit') || '—'}</span>
                      <span className="min-w-0 flex-1 text-[12.5px] text-text-2">{s(v, 'vehicle')}</span>
                      {s(v, 'assignedHouse') && <span className="text-[11px] text-text-3">{s(v, 'assignedHouse')}</span>}
                      {s(v, 'primaryDriver') && <span className="text-[11px] text-text-3">{s(v, 'primaryDriver')}</span>}
                      <span className={cn('shrink-0 rounded-full px-1.5 py-px text-[10.5px] font-bold', VEHICLE_STATUS[s(v, 'status')] ?? 'bg-surface-2 text-text-3')}>
                        {s(v, 'status') || '—'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card padded={false} className="overflow-hidden">
              <p className="border-b border-border px-4 py-2.5 text-[12.5px] font-bold text-text-1">
                <Gauge size={13} className="mr-1.5 inline" />
                Recent mileage · {recentMiles.length}
                {milesTotal > 0 && <span className="ml-2 text-[11px] font-medium text-text-3">{Math.round(milesTotal).toLocaleString()} mi on the record</span>}
              </p>
              {recentMiles.length === 0 ? (
                <p className="px-4 py-5 text-center text-[12.5px] italic text-text-3">
                  No mileage logged yet.
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {recentMiles.map((m, i) => (
                    <div key={s(m, 'id') || i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                      <span className="w-[86px] shrink-0 text-[11.5px] font-semibold tabular-nums text-text-1">{day(s(m, 'date'))}</span>
                      <span className="w-[56px] shrink-0 text-[11.5px] text-text-2">{s(m, 'unit')}</span>
                      <span className="min-w-0 flex-1 text-[11.5px] text-text-3">{s(m, 'driver')}{s(m, 'purpose') ? ` · ${s(m, 'purpose')}` : ''}</span>
                      <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-text-1">{s(m, 'miles')} mi</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
