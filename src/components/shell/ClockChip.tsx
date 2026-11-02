// The date and the time, beside the sky — in the platform's own style, next to the temperature.
// THE CLOCK READS OHIO — temperature, weather and timezone are OHIO's: every house is in central Ohio, so the…
import { useEffect, useState } from 'react'
import { useUiPrefsStore } from '@/stores/useUiPrefsStore'
import { cn } from '@/lib/utils'

// Tick on the MINUTE, not every second: a topbar clock that re-renders sixty times a minute is sixty renders nobody…
function useMinute(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout>
    let interval: ReturnType<typeof setInterval>
    const tick = () => setNow(new Date())
    const msToMinute = 60_000 - (Date.now() % 60_000)
    timer = setTimeout(() => {
      tick()
      interval = setInterval(tick, 60_000)
    }, msToMinute)
    return () => { clearTimeout(timer); clearInterval(interval) }
  }, [enabled])
  return now
}

/** The company's zone — every house is in central Ohio (Eastern Time). */
const OHIO_TZ = 'America/New_York'

export default function ClockChip() {
  const enabled = useUiPrefsStore((s) => s.topbarClock)
  const weatherOn = useUiPrefsStore((s) => s.topbarWeather)
  const now = useMinute(enabled)
  if (!enabled) return null

  // The reader's own locale shapes the digits; the ZONE is the company's.
  const time = now.toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit', timeZone: OHIO_TZ,
  })
  const weekday = now.toLocaleDateString(undefined, { weekday: 'short', timeZone: OHIO_TZ })
  const date = now.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', timeZone: OHIO_TZ,
  })
  // "EDT"/"EST" — extracted with en-US on purpose: other locales spell the short zone as "GMT-4", which names an…
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: OHIO_TZ, timeZoneName: 'short' })
    .formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? 'ET'

  return (
    <div
      title={`${now.toLocaleDateString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: OHIO_TZ,
      })} — Ohio (Eastern Time)`}
      className={cn(
        'hidden h-9 items-center gap-2 rounded-md px-2 text-text-2 transition-colors hover:bg-surface-2 md:flex',
        // Beside the sky it is the second half of a pair and keeps a hairline between them; alone it closes up on…
        weatherOn ? 'ml-0.5 border-l border-border/60 pl-2.5' : 'ml-0',
      )}
    >
      <span className="text-[12.5px] font-semibold tabular-nums leading-none text-text-1">
        {time}
      </span>
      <span className="flex flex-col leading-none text-text-3">
        <span className="text-[10.5px] font-medium">{weekday} · {zone}</span>
        <span className="text-[10.5px] tabular-nums">{date}</span>
      </span>
    </div>
  )
}
