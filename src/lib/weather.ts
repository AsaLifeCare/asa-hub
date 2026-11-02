// One shared forecast for the whole platform (Calendar day cells, Widgets).
// The relay answers /weather from a 30-minute cache of Open-Meteo for Columbus, OH — every house is in central…

export type WeatherDay = {
  date: string
  code: number
  icon: string
  tmax: number | null
  tmin: number | null
  rain: number
}

export type WeatherNow = {
  temp: number | null
  code: number
  icon: string
  humidity: number | null
  wind: number | null
}

export type Forecast = {
  place: string
  now: WeatherNow
  days: WeatherDay[]
  fetched_at: number
}

const STORE_KEY = 'asa:weather:v1'

let cached: Forecast | null = null
let inFlight: Promise<Forecast | null> | null = null

function fromStore(): Forecast | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Forecast
    if (!Array.isArray(parsed.days)) return null
    // a forecast older than three hours is worse than none on a day cell
    if (Date.now() / 1000 - (parsed.fetched_at || 0) > 3 * 3600) return null
    return parsed
  } catch {
    return null
  }
}

/** The instantly-available copy (session, else localStorage), possibly null. */
export function keptForecast(): Forecast | null {
  if (cached) return cached
  cached = fromStore()
  return cached
}

/** Fetch (or reuse) the forecast; resolves null only if we never had one. */
export function loadForecast(): Promise<Forecast | null> {
  const have = keptForecast()
  if (have && Date.now() / 1000 - have.fetched_at < 1800) {
    return Promise.resolve(have)
  }
  if (inFlight) return inFlight
  inFlight = fetch('/weather')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const data = j && j.status === 200 ? (j.data as Forecast) : null
      if (data && Array.isArray(data.days)) {
        cached = data
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify(data))
        } catch {
          /* storage full — session copy still works */
        }
        return data
      }
      return keptForecast()
    })
    .catch(() => keptForecast())
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** The forecast for one YYYY-MM-DD, or null (past days, beyond 16 days). */
export function dayForecast(f: Forecast | null, date: string): WeatherDay | null {
  if (!f) return null
  return f.days.find((d) => d.date === date) || null
}
