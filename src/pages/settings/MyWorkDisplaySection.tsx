// Settings → My Work: the parts of My Work, My Inbox's Sources card, parts of SSA and Scheduling's hours column the…
// with Bookmarks (MyAsaHideBody).
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { EASE_OUT_EXPO } from '@/engine/motion'
import Card, { CardHeader } from '@/components/shared/Card'
import CatalogueNotice, { catalogueOf, type CatalogueState } from '@/components/shared/CatalogueNotice'
import { Switch } from '@/components/ui/switch'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { fetchAlerts, dropAlertsCache } from '@/lib/hiringAlerts'
import ConfigReadFailed from './ConfigReadFailed'
import SupportAutomationsBody from './SupportAutomationsBody'
import AppsCutBody from './AppsCutBody'
import MyWorkHidesBody from './MyWorkHidesBody'
import WorldHideBody from './WorldHideBody'
import MyAsaHideBody from './MyAsaHideBody'
import {
  MY_WORK_SWITCHES, SCHED_LANDS, SSA_LANDS, STAMPS_LANDS, SWITCHES_OFF, SWITCH_GROUPS, hideWordFor, type SwitchPart,
  type SwitchValues,
} from './myWorkDisplay'

type AlertRow = { key: string; value: string; note: string; default_value: string; group: string }

export default function MyWorkDisplaySection() {
  const [hidden, setHidden] = useState<SwitchValues | null>(null)
  /** the switches whose keys the backend's catalogue carries; one it does not know yet is not offered */
  const [known, setKnown] = useState<SwitchPart[]>(() => MY_WORK_SWITCHES.map((s) => s.part))
  const [busy, setBusy] = useState(false)
  const [catalogue, setCatalogue] = useState<CatalogueState | null>(null)
  /** why the config read failed; '' while it is being read or once it landed */
  const [failed, setFailed] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await (fetchAlerts() as Promise<{ rows: AlertRow[] }>)
      setCatalogue(catalogueOf(d))
      const rows = (d.rows ?? []).filter((r) => r.group === 'mywork')
      const byKey = new Map(rows.map((r) => [r.key, r.value]))
      setKnown(MY_WORK_SWITCHES.filter((s) => byKey.has(s.key)).map((s) => s.part))
      const next: SwitchValues = { ...SWITCHES_OFF }
      for (const s of MY_WORK_SWITCHES) next[s.part] = hideWordFor(s.part, byKey.get(s.key))
      setHidden(next)
    } catch (e) {
      // never painted as "nothing hidden": a switch flipped over a value nobody read would write a law
      setHidden(null)
      setFailed((e instanceof Error ? e.message : String(e)) || 'the read did not come back')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const flip = async (part: SwitchPart, on: boolean) => {
    if (!hidden) return
    const sw = MY_WORK_SWITCHES.find((s) => s.part === part)
    if (!sw) return
    const before = hidden
    setHidden({ ...hidden, [part]: on })
    setBusy(true)
    try {
      await gasAction('hiringAlertsSet', { values: { [sw.key]: on ? 'yes' : 'no' } })
      dropAlertsCache()
      toast({ type: 'success', title: 'Saved',
        body: sw.page === 'Scheduling' ? SCHED_LANDS : sw.page === 'SSA' ? SSA_LANDS : sw.page === 'Every app' || sw.page === 'Staff' || sw.page === 'Clients' || sw.page === 'Families & Guardians' ? STAMPS_LANDS : `Everyone else sees it on ${sw.page} within about three minutes.` })
    } catch (e) {
      setHidden(before)
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.section
      id="mywork"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-20"
    >
      <Card>
        <CardHeader
          title="My Work — what everyone else sees"
          sub="Each switch hides one part of My Work, My Inbox’s Sources card, one part of SSA, Scheduling’s hours column, Staff’s source notes, a whole app, the sidebar’s + Add apps, My Work’s Time off message buttons, My World or My asa. and Bookmarks from every account but yours. Your own session keeps seeing everything, with a line naming what is hidden."
        />
        {hidden === null ? (
          failed
            ? <ConfigReadFailed why={failed} onRetry={() => { setFailed(''); void load() }} />
            : <p className="flex items-center gap-2 text-[13px] text-text-3"><Loader2 size={14} className="animate-spin" /> Reading the config…</p>
        ) : (
          <MyWorkDisplayBody hidden={hidden} known={known} catalogue={catalogue} busy={busy}
            onFlip={(part, on) => void flip(part, on)} />
        )}
        <AppsCutBody />
        <MyWorkHidesBody />
        <WorldHideBody />
        <MyAsaHideBody />
        <SupportAutomationsBody />
      </Card>
    </motion.section>
  )
}

/** The switches once the config was read; a key the backend does not know yet is not offered as a switch. */
export function MyWorkDisplayBody({ hidden, known, catalogue, busy, onFlip }: {
  hidden: SwitchValues
  known: readonly SwitchPart[]
  catalogue: CatalogueState | null
  busy: boolean
  onFlip: (part: SwitchPart, on: boolean) => void
}) {
  if (!known.length) {
    return (
      <p className="rounded-md border border-border px-3 py-2.5 text-[13px] leading-[20px] text-text-2" data-not-known>
        The backend does not know these switches yet — they arrive with the platform release that carries
        them. Until then My Work, My Inbox and SSA show everything, as they shipped; Scheduling keeps its hours
        hidden from everyone else.
      </p>
    )
  }
  return (
    <div className="space-y-3">
      <CatalogueNotice catalogue={catalogue} />
      {SWITCH_GROUPS.map((g) => (
        <div key={g.heading || 'my-work'} className="space-y-3" data-switch-group={g.heading || 'my-work'}>
          {g.heading && (
            <h3 className="pt-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">{g.heading}</h3>
          )}
          {g.switches.map((s) => (
            <div key={s.part} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-text-1">{s.label}</p>
                <p className="text-[12px] text-text-3">{s.desc}</p>
                {known.includes(s.part) ? (
                  <p className="text-[12px] font-medium text-text-2" data-part={s.part}>
                    {hidden[s.part] ? 'Hidden from everyone else' : 'Shown to everyone'}
                  </p>
                ) : (
                  <p className="text-[12px] font-medium text-text-2" data-not-known={s.part}>
                    The backend does not know this switch yet — it arrives with the platform release that carries it.
                    {s.page === 'Scheduling' || s.page === 'Every app' || s.page === 'Staff' || s.page === 'Clients'
                      || s.page === 'Families & Guardians'
                      ? ' Until then it stays hidden from everyone else.' : ' Until then it hides nothing.'}
                  </p>
                )}
              </div>
              {known.includes(s.part) && (
                <Switch checked={hidden[s.part]} onCheckedChange={(on) => onFlip(s.part, on)} disabled={busy}
                  aria-label={`Hide ${s.label.toLowerCase()}`} />
              )}
            </div>
          ))}
        </div>
      ))}
      <p className="text-[12px] leading-4 text-text-3">
        If this setting cannot be read, My Work, My Inbox and SSA show everything, as they shipped; the updated
        stamps, the Staff source notes and the Scheduling hours stay hidden from everyone else.
      </p>
    </div>
  )
}
