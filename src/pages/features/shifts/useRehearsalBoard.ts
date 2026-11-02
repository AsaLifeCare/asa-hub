// The rehearsal board, read from the relay.
// Every read starts a worker in the relay, so a clock being typed or scrolled is read once after it stops, only one…
import { useCallback, useEffect, useRef, useState } from 'react'
import { lane } from './laneFetch'
import { CLOCK_DEBOUNCE_MS, latestOnly, type RehearsalBoard } from './rehearsalLogic'

export function boardPath(clock: string): string {
  return `/hub-lanes/shift-rehearsal${clock ? `?at=${encodeURIComponent(clock)}` : ''}`
}

export function useRehearsalBoard(debounceMs: number = CLOCK_DEBOUNCE_MS) {
  const [board, setBoard] = useState<RehearsalBoard | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  /** One run for this sitting, so everything played here is grouped as one. */
  const run = useRef('')
  /** The clock last asked for ('' is now); null before the first read. */
  const asked = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [read] = useState(() => latestOnly<RehearsalBoard>(
    (clock) => lane<RehearsalBoard>(boardPath(clock)),
    {
      data: (d) => { run.current = run.current || d.run; setBoard(d); setError('') },
      error: (e) => setError(e instanceof Error ? e.message : 'could not be read'),
      busy: setLoading,
    }))

  const load = useCallback((clock: string = '') => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    asked.current = clock
    read(clock)
  }, [read])

  /** A clock typed or scrolled: one read once it stops, and none for the clock already asked. */
  const askClock = useCallback((clock: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      if (clock !== asked.current) load(clock)
    }, debounceMs)
  }, [debounceMs, load])

  const retry = useCallback(() => load(asked.current ?? ''), [load])

  useEffect(() => {
    if (asked.current === null) load('')
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  }, [load])

  return { board, error, loading, load, askClock, retry, run }
}
