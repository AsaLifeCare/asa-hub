// HOUSES — the grid of active houses, and each house's page on ?house=<code>.
// Staff and above read the `houses` slice (server/house_slices.py, from the master JSON) and the `shifts` slice for…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Loader2 } from 'lucide-react'
import Card from '@/components/shared/Card'
import { api } from '@/lib/api'
import { ohioToday } from '@/lib/ohio'
import { loadIndex } from '@/lib/snapshotClient'
import { useAuthStore } from '@/auth/useAuthStore'
import { useRegistryStore } from '@/stores/useRegistryStore'
import HouseDetail from './HouseDetail'
import HouseGrid from './HouseGrid'
import {
  clockFor, fromClient, fromRow, houseDay, resolveHouse, withBuildError,
  type ClientHouse, type HouseRow, type ShiftRow,
} from './houseModel'
import { TIME_OFF_APP } from './houseTools'

class LaneError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function lane<T>(path: string): Promise<T> {
  const token = useAuthStore.getState().token
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const env = await res.json().catch(() => ({}))
  const status = Number(env.status)
  if (status !== 200) throw new LaneError(String(env.message || `the server answered ${res.status}`), status || res.status)
  return env.data as T
}

function useTimeOffApp(): boolean {
  return useRegistryStore((s) => s.apps.some((a) => a.id === TIME_OFF_APP && a.enabled !== false))
}

function StaffHouses() {
  const role = useAuthStore((s) => s.user?.role ?? '')
  const timeOff = useTimeOffApp()
  const [params, setParams] = useSearchParams()
  const wanted = params.get('house') ?? ''
  const [read, setRead] = useState<HouseRow[] | null>(null)
  // null with no reason: not answered yet; null with a reason: the roster is unknown, never empty
  const [shifts, setShifts] = useState<ShiftRow[] | null>(null)
  const [shiftsWhy, setShiftsWhy] = useState('')
  const [buildError, setBuildError] = useState('')
  const [failed, setFailed] = useState('')
  const [loading, setLoading] = useState(false)
  const [stamp, setStamp] = useState(0)

  const load = useCallback(() => {
    setFailed('')
    setLoading(true)
    api.list<HouseRow>('houses')
      .then((rows) => {
        if (Array.isArray(rows)) setRead(rows)
        else setFailed('The houses slice answered no rows.')
      })
      .catch((err) => setFailed(err instanceof Error ? err.message : 'The houses slice did not answer.'))
      .finally(() => { setLoading(false); setStamp(Date.now()) })
    api.list<ShiftRow>('shifts')
      .then((r) => {
        if (Array.isArray(r)) { setShifts(r); setShiftsWhy('') }
        else { setShifts(null); setShiftsWhy('the shifts slice answered no rows') }
      })
      .catch((err) => { setShifts(null); setShiftsWhy(err instanceof Error ? err.message : 'the shifts slice did not answer') })
    loadIndex().then((ix) => setBuildError(ix?.houses?.error ?? '')).catch(() => setBuildError(''))
  }, [])
  useEffect(() => { load() }, [load])

  const houses = useMemo(() => read && withBuildError(read, buildError), [read, buildError])
  const clock = useMemo(() => clockFor(ohioToday()), [stamp])
  const open = useCallback((code: string) => setParams({ house: code }), [setParams])
  const back = useCallback(() => setParams({}), [setParams])

  if (wanted) {
    const house = houses ? resolveHouse(wanted, houses) : null
    if (!house) {
      return (
        <div className="w-full px-4 py-6 sm:px-5">
          {houses === null && !failed ? (
            <p className="flex items-center gap-2 py-8 text-[13px] text-text-3">
              <Loader2 size={14} className="animate-spin" /> Reading the house…
            </p>
          ) : (
            <Card className="p-6 text-[13px] text-text-2">
              <p>{failed || `No house ${wanted} in the houses the platform reads.`}</p>
              <button type="button" onClick={back} className="mt-3 font-semibold text-primary hover:underline">All houses</button>
            </Card>
          )}
        </div>
      )
    }
    return (
      <HouseDetail view={fromRow(house)} mode="staff" day={houseDay(house.code, shifts, clock)} dayWhy={shiftsWhy}
        timeOff={timeOff} onBack={back} onRefresh={load} loading={loading} />
    )
  }
  return (
    <HouseGrid houses={houses} shifts={shifts} shiftsWhy={shiftsWhy} clock={clock} failed={failed} loading={loading}
      showBooks={role === 'admin' || role === 'manager'} onOpen={open} onRefresh={load} />
  )
}

function ClientHouseView() {
  const timeOff = useTimeOffApp()
  const [got, setGot] = useState<{ house: ClientHouse | null; why: string } | null>(null)
  const [failed, setFailed] = useState('')
  const [closed, setClosed] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setFailed('')
    setClosed(false)
    setLoading(true)
    lane<{ house: ClientHouse | null; why: string }>('/hub-lanes/houses/mine')
      .then(setGot)
      .catch((err) => {
        if (err instanceof LaneError && err.status === 403) setClosed(true)
        else setFailed(err instanceof Error ? err.message : 'Your house could not be read.')
      })
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  if (got?.house && !closed && !failed) {
    return <HouseDetail view={fromClient(got.house)} mode="client" timeOff={timeOff} onRefresh={load} loading={loading} />
  }
  return (
    <div className="w-full px-4 py-6 sm:px-5">
      {!got && !failed && !closed ? (
        <p className="flex items-center gap-2 py-8 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading your house…
        </p>
      ) : (
        <Card className="p-6 text-[13px] text-text-2">
          {closed
            ? <p>Houses is not open for this account — ask the office.</p>
            : failed
              ? <p>Your house could not be read — {failed}</p>
              : <p>No house on file for this account — ask the office.{got?.why ? <span className="block text-text-3">{got.why}</span> : null}</p>}
          <button type="button" onClick={load} className="mt-3 font-semibold text-primary hover:underline">Try again</button>
        </Card>
      )}
    </div>
  )
}

export default function HousesPage() {
  const role = useAuthStore((s) => s.user?.role ?? '')
  return role === 'client' ? <ClientHouseView /> : <StaffHouses />
}
