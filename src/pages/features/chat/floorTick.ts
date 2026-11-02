/** The chat's Apps Script floor: a short tick that touches no network itself and asks the caller whether a read is due. */
import { useEffect, useRef } from 'react'

/** Run `tick` every `ms` while `on`; `on` false starts no timer at all. The latest `tick` is always the one run. */
export function useFloorTick(on: boolean, tick: () => void, ms: number): void {
  const latest = useRef(tick)
  useEffect(() => { latest.current = tick })
  useEffect(() => {
    if (!on) return
    const id = window.setInterval(() => latest.current(), ms)
    return () => window.clearInterval(id)
  }, [on, ms])
}
