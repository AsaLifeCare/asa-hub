// Settings → Back-end per app (the master only — MASTER_ONLY_SECTIONS, anchor #backends): each app on Python, or moved
// there. Apps Script is not offered: the relay refuses it.
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, Loader2, Server } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { relayLane } from '@/lib/noticesApi'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

export const BACKENDS_PATH = '/hub-lanes/backends'

export type Backend = 'apps_script' | 'python'

export type BackendApp = {
  id: string
  label: string
  reads: string[]
  backend: Backend
  setBy: string
  setAt: string
}

export type BackendView = {
  apps: BackendApp[]
  python: { reachable: boolean; why: string }
  storeWhy: string
  settling: boolean
}

export const BACKENDS_LAND =
  'Its next read and write go to Python, which reads the platform’s own database; the sheet is still written through the paced queue. Nothing goes back to the old engine.'

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The relay's answer as this screen draws it; null when it is not the list. */
export function backendViewFrom(raw: unknown): BackendView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const d = raw as Record<string, unknown>
  if (!Array.isArray(d.apps)) return null
  const apps: BackendApp[] = []
  for (const a of d.apps) {
    if (!a || typeof a !== 'object') continue
    const r = a as Record<string, unknown>
    const id = text(r.id)
    if (!id) continue
    apps.push({
      id,
      label: text(r.label) || id,
      reads: Array.isArray(r.reads) ? r.reads.filter((x): x is string => typeof x === 'string') : [],
      backend: r.backend === 'python' ? 'python' : 'apps_script',
      setBy: text(r.set_by),
      setAt: text(r.set_at),
    })
  }
  const py = (d.python && typeof d.python === 'object' ? d.python : {}) as Record<string, unknown>
  return {
    apps,
    python: { reachable: py.reachable === true, why: text(py.why) },
    storeWhy: text(d.store_why),
    settling: d.settling === true,
  }
}

/** When and by whom a row was last switched, in words. */
export function switchedWords(app: BackendApp): string {
  if (!app.setAt) return 'Never switched — not on Python yet.'
  const at = new Date(app.setAt)
  const when = Number.isNaN(at.getTime()) ? app.setAt : at.toLocaleString()
  return `Switched ${when}${app.setBy ? ` by ${app.setBy}` : ''}.`
}

export default function BackendsSection() {
  const [view, setView] = useState<BackendView | null>(null)
  const [failed, setFailed] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      const got = backendViewFrom(await relayLane<unknown>(BACKENDS_PATH))
      if (!got) {
        setFailed('the read came back without the list')
        return
      }
      setFailed('')
      setView(got)
    } catch (e) {
      setView(null)
      setFailed((e instanceof Error ? e.message : String(e)) || 'the read did not come back')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  /** One app onto Python; only what the server answered is adopted. */
  const move = async (app: BackendApp) => {
    const backend: Backend = 'python'
    setBusy(app.id)
    try {
      const got = backendViewFrom(await relayLane<unknown>(BACKENDS_PATH, {
        method: 'POST', body: JSON.stringify({ app: app.id, backend }),
      }))
      if (got) setView(got)
      toast({ type: 'success', title: `${app.label}: Python`, body: BACKENDS_LAND })
    } catch (e) {
      toast({ type: 'danger', title: 'Not switched', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy('')
    }
  }

  return (
    <motion.section
      id="backends"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-20"
    >
      <Card>
        <CardHeader
          title="Back-end per app — who answers each app's reads"
          sub="Python answers every app, reading the platform's own database. An app not on Python yet is moved here, once; what Python cannot answer just now is said, never handed elsewhere."
        />
        {view === null ? (
          failed ? (
            <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2.5 text-[13px] leading-[20px] text-text-1"
              data-backends-failed>
              <p>The back-ends could not be read — {failed}. Nothing is shown, so nothing is switched blind.</p>
              <button type="button" onClick={() => { setFailed(''); void load() }}
                className="mt-2 inline-flex h-8 items-center rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
                Try again
              </button>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-[13px] text-text-3">
              <Loader2 size={14} className="animate-spin" /> Reading the back-ends…
            </p>
          )
        ) : (
          <BackendsView view={view} busy={busy} onMove={(app) => void move(app)} />
        )}
      </Card>
    </motion.section>
  )
}

/** The rows once read: each app on Python, or its one move there, and what stands between Python and its reads. */
export function BackendsView({ view, busy, onMove }: {
  view: BackendView
  busy: string
  onMove: (app: BackendApp) => void
}) {
  return (
    <div className="space-y-3" data-backends>
      {!view.python.reachable && (
        <p className="rounded-md border border-border bg-tint-amber px-3 py-2 text-[12.5px] text-text-2" data-backends-python-down>
          Python cannot answer just now — {view.python.why || 'it did not say why'} Its apps say so until it can.
        </p>
      )}
      {view.python.reachable && view.python.why && (
        <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-text-2" data-backends-python-note>
          {view.python.why}
        </p>
      )}
      {view.settling && (
        <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-text-2" data-backends-settling>
          App Control or Editions changed in the last minutes: Python answers once its copy holds the change.
        </p>
      )}
      {view.storeWhy && (
        <p className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12.5px] text-text-1" data-backends-store>
          The switch itself could not be read ({view.storeWhy}).
        </p>
      )}
      {view.apps.map((app) => {
        const python = app.backend === 'python'
        return (
          <div key={app.id} className="flex items-start gap-3 rounded-md border border-border px-3 py-2.5" data-backend={app.id}>
            <Server size={16} className="mt-0.5 shrink-0 text-text-3" />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-text-1">{app.label}</p>
              <p className="mt-0.5 text-[12px] leading-[18px] text-text-3">
                {app.reads.length} read{app.reads.length === 1 ? '' : 's'}. {switchedWords(app)}
              </p>
            </div>
            {python ? (
              <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-[12px] font-semibold text-primary"
                aria-label={`${app.label}: answered by Python`} data-backend-on={app.id}>
                <CheckCircle2 size={13} /> Python
              </span>
            ) : (
              <button type="button" disabled={busy === app.id} onClick={() => onMove(app)}
                aria-label={`${app.label}: move to Python`} data-backend-move={app.id}
                className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3',
                  'text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50')}>
                {busy === app.id && <Loader2 size={13} className="animate-spin text-text-3" />}
                Move to Python
              </button>
            )}
          </div>
        )
      })}
      {!view.apps.length && <p className="text-[13px] text-text-3">No app has a Python back-end yet.</p>}
    </div>
  )
}
