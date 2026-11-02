// The four estate screens, made writable: reporting a call off, cancelling, removing and editing all have to be…
// One hook, three screens.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { invalidate } from '@/lib/apiCache'
import { toast } from '@/stores/useToastStore'

export type OpsRow = Record<string, any> & { id: string }

/** name = by the row's title field · date = newest first · random = a shuffle */
export type OpsOrder = 'newest' | 'oldest' | 'name' | 'random'

export const OPS_ORDER_OPTIONS: { id: OpsOrder; label: string }[] = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'name', label: 'Name A→Z' },
  { id: 'random', label: 'Random' },
]

const str = (v: unknown) => String(v ?? '').trim()

/** Tolerant over the mirrors' mixed formats (ISO, M/D/YYYY, empty). */
export function opsDate(v: unknown): Date | null {
  const s = str(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Deterministic per shuffle round, so a re-render does not reshuffle. */
function seededShuffle<T>(rows: T[], seed: number): T[] {
  const out = [...rows]
  let s = seed || 1
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) % 4294967296
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function useOpsCrud({
  resource,
  titleKey,
  dateKey,
  witnessKey,
}: {
  resource: string
  /** the field a person reads as "whose row is this" — used for A→Z and search */
  titleKey: string
  /** the field that dates the row — used for newest/oldest */
  dateKey: string
  /** the column the backend re-checks before touching the row (see Estate.gs) */
  witnessKey: string
}) {
  const [rows, setRows] = useState<OpsRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [order, setOrder] = useState<OpsOrder>('newest')
  const [shuffleSeed, setShuffleSeed] = useState(1)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setError(null)
    setRows(null)
    let alive = true
    api
      .list<Record<string, unknown>>(resource as never)
      .then((r) => {
        if (alive) setRows((Array.isArray(r) ? r : []).map((x, i) => ({ ...x, id: str((x as any).id) || `${resource}-${i}` })))
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'The live API did not answer.')
      })
    return () => {
      alive = false
    }
  }, [resource])

  useEffect(() => load(), [load])

  const ordered = useMemo(() => {
    const list = rows ?? []
    if (order === 'random') return seededShuffle(list, shuffleSeed)
    const out = [...list]
    if (order === 'name') {
      out.sort((a, b) => str(a[titleKey]).localeCompare(str(b[titleKey])))
      return out
    }
    const t = (r: OpsRow) => opsDate(r[dateKey])?.getTime() ?? (order === 'newest' ? -Infinity : Infinity)
    out.sort((a, b) => (order === 'newest' ? t(b) - t(a) : t(a) - t(b)))
    return out
  }, [rows, order, shuffleSeed, titleKey, dateKey])

  const fail = (e: unknown, fallback: string) => {
    const msg = e instanceof Error ? e.message : fallback
    toast({ type: 'danger', title: fallback, body: msg })
  }

  /** Report a new row. The backend drops any field the sheet does not have. */
  const create = useCallback(
    async (payload: Record<string, unknown>) => {
      setBusy(true)
      try {
        const saved = await api.create<OpsRow>(resource as never, payload as any)
        setRows((prev) => [{ ...(payload as any), ...(saved as any) }, ...(prev ?? [])])
        invalidate(resource)
        toast({ type: 'success', title: 'Reported', body: 'The record is in the sheet.' })
        return true
      } catch (e) {
        fail(e, 'Could not save the report')
        return false
      } finally {
        setBusy(false)
      }
    },
    [resource],
  )

  /** Edit an existing row — witness-checked server-side, rolled back on refusal. */
  const update = useCallback(
    async (row: OpsRow, patch: Record<string, unknown>) => {
      setBusy(true)
      const before = rows ?? []
      setRows((prev) => (prev ?? []).map((r) => (r.id === row.id ? { ...r, ...patch } : r)))
      try {
        const saved = await api.update<OpsRow>(resource as never, row.id, {
          ...patch,
          witness: str(row[witnessKey]),
        } as any)
        setRows((prev) => (prev ?? []).map((r) => (r.id === row.id ? { ...r, ...patch, ...(saved as any) } : r)))
        invalidate(resource)
        toast({ type: 'success', title: 'Saved', body: 'The sheet has the change.' })
        return true
      } catch (e) {
        setRows(before)
        fail(e, 'Could not save the change')
        return false
      } finally {
        setBusy(false)
      }
    },
    [resource, rows, witnessKey],
  )

  // Cancel/remove.
  const remove = useCallback(
    async (row: OpsRow) => {
      setBusy(true)
      const before = rows ?? []
      setRows((prev) => (prev ?? []).filter((r) => r.id !== row.id))
      try {
        // the witness rides along: the backend re-checks it before touching the row, so a row the estate's form…
        const res = (await api.remove(resource as never, row.id, { witness: str(row[witnessKey]) })) as any
        invalidate(resource)
        toast({
          type: 'success',
          title: res?.cancelled ? 'Cancelled' : 'Removed',
          body: res?.cancelled ? 'The row is marked cancelled in the sheet.' : 'The row is gone from the sheet.',
        })
        return true
      } catch (e) {
        setRows(before)
        fail(e, 'Could not remove the row')
        return false
      } finally {
        setBusy(false)
      }
    },
    [resource, rows, witnessKey],
  )

  return {
    rows: rows ?? [],
    ordered,
    loading: rows === null && !error,
    error,
    order,
    setOrder,
    shuffleSeed,
    reshuffle: () => setShuffleSeed((s) => s + 1),
    busy,
    create,
    update,
    remove,
    reload: load,
  }
}
