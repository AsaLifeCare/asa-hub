/** Settings → Hub containers: the relay's answer (GET /hub-lanes/hub-containers) and how a row reads. */

export const HUB_CONTAINERS_PATH = '/hub-lanes/hub-containers'
export const HUB_CONTAINERS_REFRESH_MS = 30_000

export type HubContainer = {
  name: string
  image: string
  state: string
  status: string
  health: string
  started_at: string | null
  finished_at: string | null
  restart_count: number
  cpu_percent: number | null
  mem_used: number | null
  mem_limit: number | null
  error: string
}

export type HubContainersAnswer = { containers: HubContainer[]; read_at: string; cache_s?: number | null }

export type ContainerTone = 'good' | 'warn' | 'bad' | 'plain'

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** One row as the screen keeps it; anything the sidecar did not say stays empty, never invented. */
export function containerFrom(raw: unknown): HubContainer | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = str(r.name).trim()
  if (!name) return null
  return {
    name,
    image: str(r.image),
    state: str(r.state).toLowerCase(),
    status: str(r.status),
    health: str(r.health).toLowerCase(),
    started_at: str(r.started_at) || null,
    finished_at: str(r.finished_at) || null,
    restart_count: num(r.restart_count) ?? 0,
    cpu_percent: num(r.cpu_percent),
    mem_used: num(r.mem_used),
    mem_limit: num(r.mem_limit),
    error: str(r.error),
  }
}

export function containersFrom(raw: unknown): HubContainer[] {
  return (Array.isArray(raw) ? raw : []).map(containerFrom).filter((c): c is HubContainer => c !== null)
}

/** running/healthy green, unhealthy or not yet healthy amber, exited red. */
export function containerTone(c: Pick<HubContainer, 'state' | 'health'>): ContainerTone {
  if (c.state === 'running') return c.health === 'unhealthy' || c.health === 'starting' ? 'warn' : 'good'
  if (c.state === 'restarting' || c.state === 'paused') return 'warn'
  if (c.state === 'exited' || c.state === 'dead' || c.state === 'removing') return 'bad'
  return 'plain'
}

/** The pill's word: the health check's verdict while it runs, else the state. */
export function containerLabel(c: Pick<HubContainer, 'state' | 'health'>): string {
  if (c.state === 'running' && c.health && c.health !== 'none') return c.health
  return c.state || 'unknown'
}

export function durationText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

/** Up for how long while it runs; down since when once it stopped; a dash when Docker did not say. */
export function uptimeText(c: Pick<HubContainer, 'state' | 'started_at' | 'finished_at'>, now: number): string {
  const at = (v: string | null) => (v ? Date.parse(v) : NaN)
  if (c.state === 'running') {
    const t = at(c.started_at)
    return Number.isFinite(t) ? durationText(now - t) : '—'
  }
  const t = at(c.finished_at)
  return Number.isFinite(t) ? `down ${durationText(now - t)}` : '—'
}

export function bytesText(n: number | null): string {
  if (n === null) return '—'
  const gib = n / 1024 ** 3
  if (gib >= 1) return `${gib >= 10 ? Math.round(gib) : gib.toFixed(1)} GiB`
  return `${Math.max(0, Math.round(n / 1024 ** 2))} MiB`
}

export function memoryText(c: Pick<HubContainer, 'mem_used' | 'mem_limit'>): string {
  if (c.mem_used === null) return '—'
  return c.mem_limit ? `${bytesText(c.mem_used)} / ${bytesText(c.mem_limit)}` : bytesText(c.mem_used)
}

export function cpuText(c: Pick<HubContainer, 'cpu_percent'>): string {
  return c.cpu_percent === null ? '—' : `${c.cpu_percent.toFixed(1)}%`
}
