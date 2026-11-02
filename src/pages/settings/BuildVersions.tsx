// The master's versions box, in Settings › Profile's header: the front-end this browser runs, whether the back-end
// (asa-hub-app and the relay) runs the same release, and the Apps Script build that last answered.
import { useEffect, useState } from 'react'
import { lane } from '@/pages/features/shifts/laneFetch'
import { cn } from '@/lib/utils'
import { TINT_FG } from '@/lib/tints'

type Build = { commit?: string; at?: string; python?: string; relay?: string }
type Versions = {
  relay: { code: string; started_at: string }
  python: { code: string; started_at: string; why: string }
  engine_build: string
}

export const VERSIONS_PATH = '/hub-lanes/versions'

/** The stamp vite.config.ts baked into this build; null outside a build. */
export function frontBuild(): Build | null {
  const raw: unknown = import.meta.env.VITE_HUB_BUILD
  if (typeof raw !== 'string' || !raw) return null
  try {
    const got = JSON.parse(raw) as Build
    return got && typeof got === 'object' ? got : null
  } catch {
    return null
  }
}

function when(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** One release on both ends: the back-end's code fingerprints are the ones this build was made with. */
export function sameRelease(build: Build | null, v: Versions | null): boolean | null {
  if (!build?.python || !build?.relay || !v?.python.code || !v?.relay.code) return null
  return build.python === v.python.code && build.relay === v.relay.code
}

export default function BuildVersions() {
  const build = frontBuild()
  const [v, setV] = useState<Versions | null>(null)
  const [why, setWhy] = useState('')
  useEffect(() => {
    let alive = true
    lane<Versions>(VERSIONS_PATH)
      .then((got) => { if (alive) setV(got) })
      .catch((e) => { if (alive) setWhy(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])
  const same = sameRelease(build, v)
  const row = 'flex items-baseline justify-between gap-3'
  return (
    <div className="min-w-[210px] rounded-md border border-border bg-surface-2 px-3 py-2 text-[11px] leading-5"
      aria-label="Versions">
      <div className={row} title={build?.at ? `built ${build.at}` : 'not a built front-end'}>
        <span className="text-text-3">Front-end</span>
        <span className="font-mono text-text-1">{build?.commit || '—'}{build?.at ? ` · ${when(build.at)}` : ''}</span>
      </div>
      <div className={row}
        title={v ? `asa-hub-app ${v.python.code || '?'} since ${v.python.started_at || '?'} · relay ${v.relay.code} since ${v.relay.started_at}` : why}>
        <span className="text-text-3">Back-end</span>
        <span className={cn('font-mono', same === true ? TINT_FG.mint : same === false ? TINT_FG.amber : 'text-text-2')}>
          {v === null
            ? (why ? 'not read' : '…')
            : same === true
              ? `${build?.commit || 'same'} ✓`
              : same === false
                ? `differs · ${v.python.code || '?'}`
                : v.python.code || v.python.why || '—'}
        </span>
      </div>
    </div>
  )
}
