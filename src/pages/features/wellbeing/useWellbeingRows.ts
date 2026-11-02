// Load a wellbeing resource from the live/snapshot API.
// No seed rows are shown while loading — a mock is replaced by a loading state rather than left standing — so the…
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

const PLACEHOLDER_IMG = /^\/(meal|workout)-\d+\.jpg$/

function sanitize<T>(rows: T[]): T[] {
  return rows.map((r) => {
    const row = r as { image?: unknown; status?: unknown }
    if (typeof row?.image === 'string' && PLACEHOLDER_IMG.test(row.image)) {
      return { ...r, image: '', status: 'pending' }
    }
    return r
  })
}

// `error` is the failed read's message, kept even where the seed stands in for it: a caller that passes no seed…
export function useWellbeingRows<T>(resource: string, seed: T[]): { rows: T[]; loading: boolean; error: string } {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setError('')
    void api
      .list(resource)
      .then((data) => {
        if (cancelled) return
        setRows(sanitize(Array.isArray(data) && data.length > 0 ? (data as T[]) : seed))
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error && e.message ? e.message : 'The rows could not be read.')
        setRows(sanitize(seed))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource])

  return { rows, loading, error }
}
