// Optional live-sky chip in the Topbar — off by default, per person (Settings → Appearance → "Weather in the top…
// The forecast comes ONLY from the relay's cached /weather door (lib/weather) — never a sheet, never a mock.
import { useEffect, useState } from 'react'
import WeatherGlyph, { weatherLabel } from '@/components/shared/WeatherGlyph'
import { keptForecast, loadForecast, type Forecast } from '@/lib/weather'
import { useUiPrefsStore } from '@/stores/useUiPrefsStore'

export default function WeatherChip() {
  const enabled = useUiPrefsStore((s) => s.topbarWeather)
  const [wx, setWx] = useState<Forecast | null>(() => keptForecast())

  useEffect(() => {
    if (!enabled) return
    let alive = true
    // the sky comes from the relay's cached door, never from a sheet
    loadForecast().then((f) => {
      if (alive && f) setWx(f)
    })
    return () => { alive = false }
  }, [enabled])

  if (!enabled || !wx) return null
  const today = wx.days[0]
  return (
    <div
      title={`${weatherLabel(wx.now.icon)} · ${wx.place}`}
      className="hidden h-9 items-center gap-1.5 rounded-md px-2 text-text-2 transition-colors hover:bg-surface-2 md:flex"
    >
      <WeatherGlyph icon={wx.now.icon} className="h-4 w-4" />
      <span className="text-[12.5px] font-semibold tabular-nums text-text-1">{wx.now.temp ?? '—'}°</span>
      {today && (
        <span className="text-[10.5px] tabular-nums text-text-3">
          {today.tmax ?? '—'}°/{today.tmin ?? '—'}°
        </span>
      )}
    </div>
  )
}
