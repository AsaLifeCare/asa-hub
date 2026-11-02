import { useEffect, useState } from 'react'

/** A clock that ticks only while `active`, in the component that shows it, so a countdown never redraws a grid. */
export function useNowTick(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    // caught up at once, then every tick
    const first = window.setTimeout(() => setNow(Date.now()), 0)
    const t = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => { window.clearTimeout(first); window.clearInterval(t) }
  }, [active, everyMs])
  return now
}
