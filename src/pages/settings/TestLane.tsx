/**
 * THE TEST PANEL EVERY APP CARRIES.
 *
 * EVERYTHING HAS TO CARRY A TEST SETTING.
 *
 * The reason is specific to how this platform failed once
 * before. Test mode is a single global switch — correctly, because it governs
 * the one transport every outbound message uses. But a global switch shown on
 * one screen means the person configuring the LEARNING app has no way to know,
 * from where they are standing, whether the thing they are about to turn on
 * will reach a real member of staff.
 *
 * That is exactly how five people ended up recorded as told about a
 * certificate expiry they were never told about: the state was true somewhere
 * else and nobody looked.
 *
 * So this block appears inside every app's section, reads the LIVE cells rather
 * than a copy, and says what would happen if that app sent something right now.
 * It does not add a second switch — a per-app override is how half a platform
 * ends up in production while the other half rehearses.
 */
import { useEffect, useState } from 'react'
import { Loader2, Radio, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchAlerts } from '@/lib/hiringAlerts'
import { formatPhoneDisplay } from '@/lib/phoneFormat'

type TestMode = { on?: boolean; sms?: string[]; emails?: string[] }

export default function TestLane({ app, sends }: { app: string; sends: string }) {
  const [mode, setMode] = useState<TestMode | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    void (fetchAlerts() as Promise<{ test_mode: TestMode }>)
      .then((r) => alive && setMode(r.test_mode ?? {}))
      .catch(() => alive && setFailed(true))
    return () => { alive = false }
  }, [])

  if (failed) {
    // A PANEL THAT CANNOT READ THE STATE SAYS SO.
    return (
      <div className="rounded-md border border-tint-amber bg-tint-amber px-3 py-2.5 text-[12px] leading-5 text-tint-fg-amber">
        <p className="flex items-center gap-1.5 font-semibold"><TriangleAlert size={13} /> Could not read the sending mode</p>
        <p>Do not assume it is rehearsing. Check Settings → Test mode before turning anything on here.</p>
      </div>
    )
  }

  if (!mode) {
    return <p className="flex items-center gap-2 text-[12px] text-text-3"><Loader2 size={12} className="animate-spin" /> Reading the sending mode…</p>
  }

  const testers = [...(mode.sms ?? []).map(formatPhoneDisplay), ...(mode.emails ?? [])].filter(Boolean)

  return (
    <div className={cn('rounded-md border px-3 py-2.5 text-[12px] leading-5',
      mode.on ? 'border-border bg-surface-2/60 text-text-2' : 'border-tint-pink bg-tint-pink text-tint-fg-pink')}>
      <p className="mb-1 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.06em]">
        <Radio size={13} /> {mode.on ? 'Rehearsing' : 'LIVE — reaching real people'}
      </p>
      {mode.on ? (
        <p>
          Anything <strong className="text-text-1">{app}</strong> sends — {sends} — goes only to{' '}
          <strong className="text-text-1">{testers.length ? testers.join(', ') : 'the tester list'}</strong>, comes back
          marked <em>redirected</em>, and <strong className="text-text-1">is not recorded as told</strong>.
        </p>
      ) : (
        <p>
          Test mode is OFF. Anything <strong>{app}</strong> sends — {sends} — reaches the real recipient and is
          recorded as delivered. Turn a situation on here only if that is what you mean.
        </p>
      )}
      <p className="mt-1 text-[11.5px] opacity-80">
        One switch for the whole platform, in Settings → Test mode. There is deliberately no per-app override:
        half a platform in production while the other half rehearses is the state nobody can reason about.
      </p>
    </div>
  )
}
