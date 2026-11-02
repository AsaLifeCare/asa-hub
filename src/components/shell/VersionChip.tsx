// The master's software version in the Topbar, before the sky: the front-end this browser runs (dev when built off
// main, its version number, its commit and when it was built) and whether asa-hub-app runs the same release, so a
// change of version shows at a glance. Read once on mount and again when the tab comes back into view — never on a
// timer.
import { useEffect, useState } from 'react'
import { lane } from '@/pages/features/shifts/laneFetch'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'
import { frontBuild, sameRelease, VERSIONS_PATH } from '@/pages/settings/BuildVersions'
import { cn } from '@/lib/utils'
import { TINT_VAR } from '@/lib/tints'

type Versions = NonNullable<Parameters<typeof sameRelease>[1]>
type Stamp = NonNullable<ReturnType<typeof frontBuild>> & { number?: string; branch?: string }

/** One release: the stamp's back-end fingerprints against what runs. The retired relay names no code, so then
 * asa-hub-app alone decides. */
function released(build: Stamp | null, v: Versions | null): boolean | null {
  if (v && !v.relay.code && build?.python && v.python.code) return build.python === v.python.code
  return sameRelease(build, v)
}

function short(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function VersionChip() {
  const master = useEffectiveIsMaster()
  const [v, setV] = useState<Versions | null>(null)

  useEffect(() => {
    if (!master) return
    let alive = true
    const read = () => {
      lane<Versions>(VERSIONS_PATH).then((got) => { if (alive) setV(got) }).catch(() => { if (alive) setV(null) })
    }
    const seen = () => { if (document.visibilityState === 'visible') read() }
    read()
    document.addEventListener('visibilitychange', seen)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', seen)
    }
  }, [master])

  if (!master) return null
  const build = frontBuild() as Stamp | null
  const same = released(build, v)
  const dev = !build || build.branch !== 'main'
  const version = build?.number ? `v${build.number}` : ''
  const back = v
    ? `asa-hub-app ${v.python.code || '?'} since ${short(v.python.started_at) || '?'} · `
      + (v.relay.code ? `relay ${v.relay.code} since ${short(v.relay.started_at) || '?'}` : 'relay retired')
    : 'back-end not read'
  const verdict = same === true ? 'one release on both ends' : same === false ? 'the back-end runs another release' : ''
  const front = `Front-end ${[version, build?.commit].filter(Boolean).join(' · ') || '—'}`
    + (build?.branch ? ` · ${build.branch}` : '') + (build?.at ? ` · built ${short(build.at)}` : '')
  return (
    <div
      aria-label="Software version"
      title={[front, back, verdict].filter(Boolean).join('\n')}
      className="hidden h-9 items-center gap-1.5 rounded-md px-2 text-text-2 transition-colors hover:bg-surface-2 md:flex"
    >
      <span
        className={cn('h-1.5 w-1.5 rounded-full', same === null && 'bg-text-3')}
        style={same === null ? undefined : { background: TINT_VAR[same ? 'mint' : 'amber'] }}
      />
      {dev && <span className="text-[10.5px] font-semibold uppercase tracking-wide text-text-3">dev</span>}
      {version && <span className="font-mono text-[11.5px] font-semibold tabular-nums text-text-1">{version}</span>}
      {build?.commit && (
        <span className={cn('font-mono text-[11.5px] tabular-nums', version ? 'text-text-2' : 'font-semibold text-text-1')}>
          {build.commit}
        </span>
      )}
      {build?.at && <span className="text-[10.5px] tabular-nums text-text-3">{short(build.at)}</span>}
    </div>
  )
}
