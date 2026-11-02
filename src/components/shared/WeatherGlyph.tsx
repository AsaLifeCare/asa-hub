// The small sky vocabulary the relay's /weather door speaks, drawn with the platform's own icon set.
// Soft colors on purpose — a day cell wears this in a corner and it must never shout over the day's real content.
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
} from 'lucide-react'

const GLYPHS: Record<string, { Icon: typeof Sun; cls: string; label: string }> = {
  sun: { Icon: Sun, cls: 'text-amber-500', label: 'Sunny' },
  partsun: { Icon: CloudSun, cls: 'text-amber-400', label: 'Partly sunny' },
  cloud: { Icon: Cloud, cls: 'text-slate-400', label: 'Cloudy' },
  fog: { Icon: CloudFog, cls: 'text-slate-400', label: 'Fog' },
  sleet: { Icon: CloudDrizzle, cls: 'text-sky-500', label: 'Sleet' },
  rain: { Icon: CloudRain, cls: 'text-sky-500', label: 'Rain' },
  snow: { Icon: CloudSnow, cls: 'text-sky-400', label: 'Snow' },
  storm: { Icon: CloudLightning, cls: 'text-violet-500', label: 'Storms' },
}

export function weatherLabel(icon: string): string {
  return (GLYPHS[icon] || GLYPHS.cloud).label
}

export default function WeatherGlyph({
  icon,
  className = 'h-3.5 w-3.5',
  title,
}: {
  icon: string
  className?: string
  title?: string
}) {
  const g = GLYPHS[icon] || GLYPHS.cloud
  const { Icon } = g
  return <Icon className={`${g.cls} ${className}`} aria-label={title || g.label} />
}
