// Settings → Hub containers (the master only — MASTER_ONLY_SECTIONS, anchor #hubcontainers).
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, RefreshCw } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { EASE_OUT_EXPO } from '@/engine/motion'
import {
  HUB_CONTAINERS_PATH, HUB_CONTAINERS_REFRESH_MS, containerLabel, containerTone, containersFrom, cpuText, memoryText,
  uptimeText, type ContainerTone, type HubContainer,
} from '@/lib/hubContainers'
import { lane, LaneError } from '@/pages/features/shifts/laneFetch'
import { cn } from '@/lib/utils'
import ImagesFolderCard from './ImagesFolderCard'

export type HubContainersState = {
  status: 'idle' | 'loading' | 'ready' | 'failed' | 'refused'
  /** the last list the sidecar really answered; a failed read never empties it */
  rows: HubContainer[] | null
  error: string
  /** the sidecar's own read time (ISO) */
  readAt: string
  /** when this screen last asked */
  checkedAt: number
  refreshing: boolean
}

export const HUB_CONTAINERS_IDLE: HubContainersState = {
  status: 'idle', rows: null, error: '', readAt: '', checkedAt: 0, refreshing: false,
}

/** One relay read now, then every 30 s while the section is mounted and the tab is visible. */
export function useHubContainers(enabled: boolean) {
  const [state, setState] = useState<HubContainersState>(HUB_CONTAINERS_IDLE)
  const flight = useRef<Promise<void> | null>(null)

  const read = useCallback(async () => {
    if (!enabled) return
    if (flight.current) return flight.current
    setState((s) => ({ ...s, status: s.rows ? s.status : 'loading', refreshing: true }))
    const run = (async () => {
      try {
        const got = await lane<{ containers?: unknown; read_at?: unknown }>(HUB_CONTAINERS_PATH)
        if (!Array.isArray(got?.containers)) throw new Error('the server answered without the list')
        setState({ status: 'ready', rows: containersFrom(got.containers), error: '', readAt: String(got.read_at ?? ''),
                   checkedAt: Date.now(), refreshing: false })
      } catch (err) {
        const refused = err instanceof LaneError && err.status === 404
        const error = (err instanceof Error ? err.message : String(err)) || 'the read did not come back'
        setState((s) => ({ ...s, status: refused ? 'refused' : 'failed', error, rows: refused ? null : s.rows,
                           checkedAt: Date.now(), refreshing: false }))
      } finally {
        flight.current = null
      }
    })()
    flight.current = run
    return run
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    void read()
    const timer = window.setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void read()
    }, HUB_CONTAINERS_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [enabled, read])

  return { state, refresh: read }
}

const PILL: Record<ContainerTone, string> = {
  good: 'bg-tint-mint text-tint-fg-mint',
  warn: 'bg-tint-amber text-tint-fg-amber',
  bad: 'bg-tint-danger text-tint-fg-danger',
  plain: 'bg-tint-slate text-tint-fg-slate',
}

const clock = (iso: string, fallback: number) => {
  const t = iso ? Date.parse(iso) : NaN
  const at = Number.isFinite(t) ? t : fallback
  return at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
}

/** The table, the honest error and the empty answer — drawn from the state alone. */
export function HubContainersBody({ state }: { state: HubContainersState }) {
  const now = state.checkedAt || Date.now()
  const at = clock(state.readAt, state.checkedAt)
  if (state.status === 'refused') {
    return (
      <p data-hub-containers-refused className="text-[13px] text-text-2">
        The relay did not open this read for this session ({state.error}).
      </p>
    )
  }
  const failed = state.status === 'failed' ? (
    <div data-hub-containers-failed
      className="mb-3 rounded-md border border-danger/40 bg-danger/5 px-3 py-2.5 text-[13px] leading-[20px] text-text-1">
      <p>{state.error}</p>
      <p className="mt-1 text-[12px] text-text-2">
        {state.rows ? `The rows below are the last good read${at ? `, from ${at}` : ''} — not live.`
          : 'Nothing is shown, because nothing was read.'}
      </p>
    </div>
  ) : null
  if (!state.rows) {
    return failed ?? (
      <p className="flex items-center gap-2 text-[13px] text-text-3">
        <Loader2 size={14} className="animate-spin" /> Reading the containers…
      </p>
    )
  }
  return (
    <>
      {failed}
      {state.rows.length === 0 ? (
        <p data-hub-containers-empty className="text-[13px] text-text-2">
          The sidecar answered and found no asa-hub container on the host.
        </p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-3">
                <th className="px-1 py-1.5 font-semibold">Name</th>
                <th className="px-1 py-1.5 font-semibold">State</th>
                <th className="px-1 py-1.5 font-semibold">Uptime</th>
                <th className="px-1 py-1.5 font-semibold">Image</th>
                <th className="px-1 py-1.5 text-right font-semibold">CPU</th>
                <th className="px-1 py-1.5 text-right font-semibold">Memory</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((c) => {
                const tone = containerTone(c)
                return (
                  <tr key={c.name} data-container={c.name} className="border-b border-border align-top last:border-0">
                    <td className="px-1 py-2">
                      <div className="font-medium text-text-1">{c.name}</div>
                      {c.restart_count > 0 && (
                        <div className="text-[11px] text-text-3">restarted {c.restart_count}×</div>
                      )}
                      {c.error && <div className="text-[11px] text-tint-fg-amber">{c.error}</div>}
                    </td>
                    <td className="px-1 py-2">
                      <span data-container-tone={tone} title={c.status}
                        className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize leading-4',
                          PILL[tone])}>
                        {containerLabel(c)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-1 py-2 tabular-nums text-text-2">{uptimeText(c, now)}</td>
                    <td className="max-w-[180px] truncate px-1 py-2 text-text-2" title={c.image}>{c.image || '—'}</td>
                    <td className="px-1 py-2 text-right tabular-nums text-text-1">{cpuText(c)}</td>
                    <td className="whitespace-nowrap px-1 py-2 text-right tabular-nums text-text-1">{memoryText(c)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {state.status === 'ready' && at && <p className="mt-2 text-[11.5px] text-text-3">Read at {at}.</p>}
    </>
  )
}

export default function HubContainersSection() {
  const { state, refresh } = useHubContainers(true)
  return (
    <motion.section
      id="hubcontainers"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-20"
    >
      <Card>
        <CardHeader
          title="Hub containers"
          sub="The asa-hub containers on the host, as the status sidecar reads them. Refreshed every 30 seconds while this page is open."
          extra={
            <button type="button" onClick={() => void refresh()} disabled={state.refreshing} data-hub-containers-refresh
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50">
              <RefreshCw size={13} className={cn(state.refreshing && 'animate-spin')} /> Refresh
            </button>
          }
        />
        <HubContainersBody state={state} />
      </Card>
      <div className="mt-4">
        <ImagesFolderCard />
      </div>
    </motion.section>
  )
}
